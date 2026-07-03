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
  const fromLd = extractJsonLd($, pageUrl);
  const fromDom = extractHeuristic($, pageUrl);
  // Prefer whichever found more; structured data wins ties (it's cleaner).
  return fromLd.length >= fromDom.length ? (fromLd.length ? fromLd : fromDom) : fromDom;
}

// How many listings the page appears to contain (used by inventory discovery to
// verify a candidate page without site-specific selectors).
export function countListings(html, pageUrl) {
  return autoExtractListings(html, pageUrl).length;
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

// ---- DOM heuristic --------------------------------------------------------

const PRICE_RE = /\$\s?\d{1,3}(?:,\d{3})+|\$\s?\d{4,}/;
const YEAR_RE = /\b(19|20)\d{2}\b/;
// Links that look like a vehicle detail page, or a 17-char VIN in the path.
const DETAIL_RE =
  /\/(vehicle|vehicles|inventory|used|new|certified|vin|detail|listing|for-sale|cars?|auto|stock)\b|\/[A-HJ-NPR-Z0-9]{17}(?:[/?]|$)/i;

function extractHeuristic($, pageUrl) {
  const byContainer = new Map();

  $("a[href]").each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const text = clean($a.text());
    if (!DETAIL_RE.test(href) && !YEAR_RE.test(text)) return;

    // Walk up to the nearest ancestor that also contains a price.
    let el = $a;
    let card = null;
    for (let i = 0; i < 6 && el.length; i++) {
      if (PRICE_RE.test(el.text())) {
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
    const price = (ct.match(PRICE_RE) || [])[0];
    if (!year || !price) return; // a real listing has both

    const title =
      text && YEAR_RE.test(text)
        ? text
        : clean(card.find("h1,h2,h3,h4,[class*=title]").first().text()) || text;
    if (!title) return;

    const img = card.find("img").first();
    const image = abs(
      img.attr("src") || img.attr("data-src") || img.attr("data-lazy") || img.attr("data-original") || "",
      pageUrl
    );
    const mileage = (ct.match(/([\d,]{3,})\s*(?:mi|miles|mileage|km)\b/i) || [])[1];
    const sold = /\b(sold|sale[\s-]?pending|no longer available)\b/i.test(ct);

    byContainer.set(node, {
      title,
      price,
      year,
      mileage,
      link: abs(href, pageUrl),
      image,
      sold,
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
