import * as cheerio from "cheerio";

// Generic, selector-free extraction of vehicle listings from an inventory page.
// Dealer sites vary too much for fixed CSS classes to generalize, so instead we:
//
//   1. Read schema.org structured data (JSON-LD Vehicle/Car/Product), which most
//      dealer platforms embed for SEO — the most reliable, cleanest source.
//   2. Fall back to a DOM heuristic: repeated blocks that contain a price, a
//      model year, and a link to a detail page.
//
// Returns raw listing objects (the same shape scrapers emit); normalization and
// sold-filtering happen downstream.

export function autoExtractListings(html, pageUrl) {
  const $ = cheerio.load(html);
  // Try each strategy; keep whichever found the most listings. Ties prefer the
  // earlier (cleaner) strategy: structured data, then embedded JSON, then DOM.
  const candidates = [
    extractJsonLd($, pageUrl),
    extractEmbeddedJson($, pageUrl),
    extractHeuristic($, pageUrl),
  ];
  let best = [];
  for (const c of candidates) if (c.length > best.length) best = c;
  return best;
}

// How many listings the page appears to contain (used by inventory discovery to
// verify a candidate page without site-specific selectors).
export function countListings(html, pageUrl) {
  return autoExtractListings(html, pageUrl).length;
}

// Summarize a page's structure to explain why extraction found nothing (shown in
// the Test-scrape result). Reveals whether it's a category hub, JS-only, etc.
export function diagnose(html, pageUrl) {
  const $ = cheerio.load(html);
  const detail = [];
  $("a[href]").each((_, a) => {
    const h = $(a).attr("href") || "";
    if (DETAIL_SLUG_RE.test(h)) detail.push(absOrRaw(h, pageUrl));
  });
  const body = clean($("body").text());
  const yearSnippets = [];
  const re = /\S[^]{0,12}\b(?:19|20)\d{2}\b[^]{0,18}/g;
  let m;
  while ((m = re.exec(body)) && yearSnippets.length < 4) yearSnippets.push(clean(m[0]).slice(0, 48));
  return {
    bytes: html.length,
    links: $("a[href]").length,
    images: $("img").length,
    detailLinks: detail.length,
    detailSamples: [...new Set(detail)].slice(0, 6),
    jsonLd: $('script[type="application/ld+json"]').length,
    embeddedJson: $("#__NEXT_DATA__").length > 0 || /__NUXT__|__INITIAL_STATE__/.test(html),
    prices: (body.match(/\$\s?\d{2,3}(?:,\d{3})+/g) || []).length,
    yearSnippets,
  };
}

function absOrRaw(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

// Same-site links that look like deeper inventory pages (model categories or
// individual vehicle pages). Used to crawl "hub" inventory pages that list
// categories rather than cars (e.g. /inventory/ → /inventory/porsche-911/).
export function inventorySubLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  let baseHost = "";
  try {
    baseHost = new URL(baseUrl).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  const self = baseUrl.split("#")[0].replace(/\/$/, "");
  const out = new Set();
  $("a[href]").each((_, a) => {
    const abs = absOrRaw($(a).attr("href") || "", baseUrl).split("#")[0];
    if (!DETAIL_SLUG_RE.test(abs)) return;
    let host = "";
    try {
      host = new URL(abs).hostname.replace(/^www\./, "");
    } catch {
      return;
    }
    if (host !== baseHost) return;
    if (abs.replace(/\/$/, "") === self) return; // skip the page itself
    out.add(abs);
  });
  return [...out];
}

// Extract listings from a JSON feed (e.g. a Rails `/vehicles.json` endpoint):
// parse it and walk the tree for vehicle-like objects. Handles arbitrary shapes
// (top-level array, { vehicles: [...] }, paginated wrappers, etc.).
export function extractListingsFromJson(text, pageUrl) {
  let data;
  try {
    data = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    return [];
  }
  const out = [];
  walk(data, pageUrl, out, { count: 0 });
  return dedupe(out);
}

// ---- schema.org JSON-LD ---------------------------------------------------

function extractJsonLd($, pageUrl) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let data;
    try {
      data = JSON.parse($(el).text());
    } catch {
      return;
    }
    for (const node of flattenLd(data)) {
      const listing = ldNodeToListing(node, pageUrl);
      if (listing) out.push(listing);
    }
  });
  return dedupe(out);
}

function flattenLd(data) {
  const res = [];
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (n["@graph"]) visit(n["@graph"]);
    if (n.itemListElement) visit(n.itemListElement);
    if (n.item) visit(n.item);
    res.push(n);
  };
  visit(data);
  return res;
}

function ldTypes(n) {
  const t = n["@type"];
  return (Array.isArray(t) ? t : [t]).filter(Boolean).map((x) => String(x).toLowerCase());
}

function ldNodeToListing(n, pageUrl) {
  const types = ldTypes(n);
  const isVehicle = types.some((t) =>
    ["vehicle", "car", "motorcycle", "motorizedvehicle", "boat", "truck"].includes(t)
  );
  const isProduct = types.includes("product") || types.includes("individualproduct");
  if (!isVehicle && !isProduct) return null;

  const offer = firstOffer(n.offers);
  const price = num(n.price) ?? num(offer?.price) ?? num(offer?.lowPrice);
  if (!isVehicle && price == null) return null; // a plain Product with no price isn't a car

  const name = str(n.name);
  const make = str(n.brand?.name ?? n.brand ?? n.manufacturer?.name ?? n.manufacturer);
  const model = str(n.model?.name ?? n.model);
  const year =
    num(n.vehicleModelDate ?? n.modelDate ?? n.productionDate) ??
    yearFrom(name) ??
    null;
  const mileage = num(n.mileageFromOdometer?.value ?? n.mileageFromOdometer);
  const color = str(n.color ?? n.vehicleInteriorColor);
  const url = abs(str(n.url) || str(offer?.url), pageUrl);
  const image = abs(firstImage(n.image), pageUrl);
  const availability = str(offer?.availability ?? n.availability).toLowerCase();
  const condition = str(n.itemCondition).toLowerCase();
  const sold = /soldout|discontinued|outofstock/.test(availability) || condition.includes("sold");

  if (!name && !url) return null;
  const title = name || [year, make, model].filter(Boolean).join(" ").trim();
  if (!title) return null;

  return { title, make, model, year, price, mileage, color, link: url, image, sold };
}

function firstOffer(offers) {
  if (!offers) return null;
  return Array.isArray(offers) ? offers[0] : offers;
}
function firstImage(image) {
  if (!image) return "";
  if (Array.isArray(image)) return firstImage(image[0]);
  if (typeof image === "object") return str(image.url ?? image.contentUrl);
  return str(image);
}

// ---- embedded JSON (Next.js / React state, JSON script blocks) ------------

// Modern dealer/boutique sites (often Next.js) ship their inventory as a JSON
// blob in the page — <script id="__NEXT_DATA__">, <script type="application/
// json">, or an inline window.__NUXT__/__INITIAL_STATE__ assignment. We parse
// those and walk the tree for objects that look like vehicle listings.
function extractEmbeddedJson($, pageUrl) {
  const blobs = [];
  $("script").each((_, el) => {
    const type = ($(el).attr("type") || "").toLowerCase();
    const id = ($(el).attr("id") || "").toLowerCase();
    const raw = $(el).text();
    if (!raw || raw.length > 4_000_000) return;
    if (id === "__next_data__" || type === "application/json") {
      tryParse(raw, blobs);
    } else if (/__(NEXT_DATA|NUXT|INITIAL_STATE|APOLLO_STATE|PRELOADED_STATE|remixContext)__/.test(raw)) {
      const m = raw.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
      if (m) tryParse(m[1], blobs);
    }
  });

  const out = [];
  const budget = { count: 0 };
  for (const data of blobs) walk(data, pageUrl, out, budget);
  return dedupe(out);
}

function tryParse(raw, arr) {
  try {
    arr.push(JSON.parse(raw));
  } catch {
    /* not valid JSON */
  }
}

function walk(node, pageUrl, out, budget) {
  if (budget.count > 50_000 || node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) {
      budget.count++;
      walk(x, pageUrl, out, budget);
    }
    return;
  }
  const listing = objToListing(node, pageUrl);
  if (listing) out.push(listing);
  for (const k in node) {
    budget.count++;
    walk(node[k], pageUrl, out, budget);
  }
}

const K = {
  price: ["price", "saleprice", "sale_price", "askingprice", "asking_price", "listprice", "list_price", "priceusd", "price_usd", "amount", "msrp"],
  year: ["year", "modelyear", "model_year", "vehicleyear"],
  make: ["make", "brand", "manufacturer"],
  model: ["model", "modelname", "model_name"],
  title: ["title", "name", "headline", "displayname", "display_name", "heading", "fulltitle", "full_title"],
  mileage: ["mileage", "odometer", "miles", "kilometers", "kms"],
  color: ["color", "colour", "exteriorcolor", "exterior_color", "paint"],
  url: ["url", "link", "permalink", "path", "href", "detailurl", "detail_url", "slug"],
  image: ["image", "imageurl", "image_url", "photo", "thumbnail", "featuredimage", "featured_image", "heroimage"],
  images: ["images", "photos", "gallery", "media"],
  status: ["status", "availability", "condition", "state"],
};

function objToListing(obj, pageUrl) {
  const get = lcGetter(obj);
  const price = numDeep(firstOf(get, K.price));
  const priced = price != null && price >= 100;

  const year = num(firstOf(get, K.year));
  const make = str(firstOf(get, K.make));
  const model = str(firstOf(get, K.model));
  let title = str(firstOf(get, K.title));
  const yearInTitle = YEAR_RE.test(title);
  const hasYear = (year != null && year >= 1900 && year <= 2100) || yearInTitle;
  const link = abs(str(firstOf(get, K.url)), pageUrl);

  // Accept a record if it has a price, OR it's clearly a specific vehicle: a
  // year plus a make/model (or a vehicle-like title) and a link to it. The
  // second path catches "Price on request" classics that omit a price.
  const namedVehicle = hasYear && (make || model || yearInTitle) && !!link;
  if (!priced && !namedVehicle) return null;

  if (!title) title = [year, make, model].filter(Boolean).join(" ").trim();
  if (!title) return null;
  // Skip non-vehicle records (e.g. an "about" blurb with a founding year).
  if (!make && !model && NON_MODEL_YEAR.test(title)) return null;

  let image = str(firstOf(get, K.image));
  if (!image) {
    const arr = firstOf(get, K.images);
    if (Array.isArray(arr) && arr.length) {
      image = typeof arr[0] === "string" ? arr[0] : str(arr[0]?.url ?? arr[0]?.src);
    }
  }
  const status = str(firstOf(get, K.status)).toLowerCase();

  return {
    title,
    make,
    model,
    year,
    price: priced ? price : null,
    mileage: numDeep(firstOf(get, K.mileage)),
    color: str(firstOf(get, K.color)),
    link,
    image: abs(image, pageUrl),
    sold: /\bsold\b|sale[\s-]?pending|soldout/.test(status),
  };
}

function lcGetter(obj) {
  const map = {};
  for (const k in obj) map[k.toLowerCase()] = obj[k];
  return map;
}
function firstOf(get, keys) {
  for (const k of keys) if (get[k] != null && get[k] !== "") return get[k];
  return null;
}
// Numbers that may be wrapped as { amount } / { value } / { raw }.
function numDeep(v) {
  if (v && typeof v === "object") return num(v.amount ?? v.value ?? v.raw ?? v.price);
  return num(v);
}

// ---- DOM heuristic --------------------------------------------------------

const PRICE_RE = /\$\s?\d{1,3}(?:,\d{3})+|\$\s?\d{4,}/;
const YEAR_RE = /\b(19|20)\d{2}\b/;
// Links that look like a vehicle detail page, or a 17-char VIN in the path.
const DETAIL_RE =
  /\/(vehicle|vehicles|inventory|used|new|certified|vin|detail|listing|for-sale|cars?|auto|stock)\b|\/[A-HJ-NPR-Z0-9]{17}(?:[/?]|$)/i;
// A link to a SPECIFIC vehicle (keyword + a slug/id segment, or a VIN). Used to
// distinguish a real listing card from marketing blocks that merely mention a year.
const DETAIL_SLUG_RE =
  /\/(?:vehicles?|inventory|listings?|cars?|autos?|stock|detail|for-sale)\/[^/?#]+|\/[A-HJ-NPR-Z0-9]{17}(?:[/?#]|$)/i;
// "since 1986", "est. 1986", "© 2024" etc. — years that are NOT model years.
const NON_MODEL_YEAR = /\b(since|est\.?|established|founded|copyright|©|all rights)\b/i;

// Only treat a card as sold on a clear signal: an all-caps SOLD badge, or an
// explicit phrase. Avoids false positives from prose like "only 60 were sold".
export function detectSold(text) {
  return /\bSOLD\b/.test(text) || /sale[\s-]?pending|sold[\s-]?out|no longer available/i.test(text);
}

// A title names a specific vehicle: it has a model year, a real word beside it
// (a make/model), and isn't a "founded/since/copyright <year>" marketing phrase.
function looksLikeVehicleTitle(title) {
  if (!title || !YEAR_RE.test(title)) return false;
  if (NON_MODEL_YEAR.test(title)) return false;
  const words = title.replace(/[^a-zA-Z ]+/g, " ").split(/\s+/).filter((w) => w.length > 1);
  return words.length >= 1; // at least one make/model-ish word besides the year
}

function extractHeuristic($, pageUrl) {
  const byContainer = new Map();

  $("a[href]").each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const text = clean($a.text());
    if (!DETAIL_RE.test(href) && !YEAR_RE.test(text)) return;

    // The listing card is the nearest ancestor of this link that holds a photo
    // AND a model year — a reliable "card" signal that doesn't depend on a
    // visible price (high-end classics are often "Price on request").
    let el = $a;
    let card = null;
    for (let i = 0; i < 7 && el.length; i++) {
      if (el.find("img").length > 0 && YEAR_RE.test(el.text())) {
        card = el;
        break;
      }
      el = el.parent();
    }
    if (!card) return;

    const node = card.get(0);
    if (byContainer.has(node)) return;

    const ct = card.text();
    const year = (ct.match(YEAR_RE) || [])[0];
    if (!year) return;

    // A real listing card links to a SPECIFIC vehicle, or shows a price. This
    // rejects marketing blocks ("...founded in 1986", copyright footers) that
    // merely contain a year near a logo image. Consider the anchor we started
    // from as well as any detail link inside the card.
    const startIsDetail = DETAIL_SLUG_RE.test(href);
    const descDetail = startIsDetail
      ? null
      : card.find("a[href]").filter((_, el) => DETAIL_SLUG_RE.test($(el).attr("href") || "")).first();
    const hasDetail = startIsDetail || (descDetail && descDetail.length > 0);
    const priceMatch = ct.match(PRICE_RE);
    if (!hasDetail && !priceMatch) return;

    // Title: prefer the SHORTEST year-bearing candidate (a heading or the link
    // text) — that's the vehicle's name, not the long description blob.
    const heading = clean(card.find("h1,h2,h3,h4,h5,[class*=title],[class*=name],[class*=heading]").first().text());
    const cands = [heading, text].filter((c) => c && YEAR_RE.test(c)).sort((a, b) => a.length - b.length);
    let title = cands[0] || heading || text;
    if (!title) return;
    if (!YEAR_RE.test(title)) title = `${year} ${title}`.trim();
    if (title.length > 100) title = title.slice(0, 100).replace(/\s+\S*$/, ""); // trim a blob
    if (!looksLikeVehicleTitle(title)) return;

    const img = card.find("img").first();
    const image = abs(
      img.attr("src") || img.attr("data-src") || img.attr("data-lazy") || img.attr("data-original") || "",
      pageUrl
    );
    const linkHref = startIsDetail ? href : descDetail && descDetail.length ? descDetail.attr("href") : href;
    const mileage = (ct.match(/([\d,]{3,})\s*(?:mi|miles|mileage|km)\b/i) || [])[1];

    byContainer.set(node, {
      title,
      // Full card text (capped) — used for matching (a car's make may only appear
      // in its description, e.g. a Porsche-only dealer that names cars "930 S").
      description: clean(ct).slice(0, 400),
      price: priceMatch ? priceMatch[0] : null, // optional — POA classics have none
      year,
      mileage,
      link: abs(linkHref, pageUrl),
      image,
      sold: detectSold(ct),
    });
  });

  return dedupe([...byContainer.values()]);
}

// ---- helpers --------------------------------------------------------------

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.link || it.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
function clean(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}
function str(v) {
  if (v == null) return "";
  if (typeof v === "object") return "";
  return clean(v);
}
function num(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const digits = String(v).replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = Math.round(parseFloat(digits));
  return Number.isFinite(n) ? n : null;
}
function yearFrom(s) {
  const m = String(s || "").match(YEAR_RE);
  return m ? parseInt(m[0], 10) : null;
}
function abs(url, base) {
  if (!url) return "";
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}
