import * as cheerio from "cheerio";
import { fetchText } from "./http.js";
import { autoExtractListings } from "./autoExtract.js";

// Config-driven scraper for dealer inventory pages. When the dealer provides a
// `selectors.card`, it extracts one raw listing per matched card. Otherwise it
// falls back to selector-free auto-extraction (schema.org data + a DOM
// heuristic), which generalizes across dealer sites without per-site tuning.

export async function scrapeHtmlDealer(dealer, { fetchImpl = fetchText } = {}) {
  const selectors = dealer.selectors || {};
  const useAuto = !selectors.card;

  const pages = buildPageUrls(dealer);
  const results = [];

  for (const pageUrl of pages) {
    let html;
    try {
      html = await fetchImpl(pageUrl);
    } catch (err) {
      // Surface the failure but keep going with any pages that did load.
      err.pageUrl = pageUrl;
      throw err;
    }
    if (useAuto) {
      results.push(...autoExtractListings(html, pageUrl));
      continue;
    }
    const $ = cheerio.load(html);
    $(selectors.card).each((_, el) => {
      const card = $(el);
      const raw = {
        title: extract($, card, selectors.title),
        price: extract($, card, selectors.price),
        mileage: extract($, card, selectors.mileage),
        year: extract($, card, selectors.year),
        link: absolutize(extract($, card, selectors.link), pageUrl),
        image: absolutize(extract($, card, selectors.image), pageUrl),
        location: extract($, card, selectors.location),
        sold: isSold($, card, selectors),
      };
      if (raw.title || raw.link) results.push(raw);
    });
  }
  return results;
}

// Detect a car that's already sold / sale-pending, either via a configured
// `selectors.sold` element or a "sold"/"sale pending" marker in the card text.
function isSold($, card, selectors) {
  if (selectors.sold) {
    const target = selectors.sold.sel ? card.find(selectors.sold.sel) : card;
    if (target && target.length > 0) return true;
  }
  // Strip tags to spaces so adjacent elements (e.g. a "SOLD" badge glued to the
  // title) don't merge into one word and defeat the boundary match.
  const text = ($.html(card) || "").replace(/<[^>]+>/g, " ");
  return /\b(sold|sale[\s-]?pending|no longer available)\b/i.test(text);
}

function buildPageUrls(dealer) {
  // The inventory page is either explicitly cached (auto-discovered) or the
  // dealer's URL. `dealer.url` is now the dealer's main website; discovery in
  // scrapeDealer resolves and passes the deeper inventory URL via inventoryUrl.
  const base = dealer.inventoryUrl || dealer.url;
  const pg = dealer.pagination;
  if (!pg || !pg.maxPages || pg.maxPages <= 1) return [base];
  const urls = [];
  for (let p = 1; p <= pg.maxPages; p++) {
    urls.push(base + (pg.param || "?page={page}").replace("{page}", String(p)));
  }
  return urls;
}

function extract($, card, spec) {
  if (!spec) return "";
  const target = spec.sel ? card.find(spec.sel).first() : card;
  if (!target || target.length === 0) return "";
  let value = spec.attr ? target.attr(spec.attr) || "" : target.text();
  value = String(value).replace(/\s+/g, " ").trim();
  if (spec.regex) {
    const m = value.match(new RegExp(spec.regex));
    value = m ? m[0] : "";
  }
  return value;
}

function absolutize(url, base) {
  if (!url) return "";
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}
