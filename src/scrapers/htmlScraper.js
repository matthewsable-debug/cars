import * as cheerio from "cheerio";
import { fetchText } from "./http.js";

// Generic, config-driven scraper for server-rendered dealer inventory pages.
// Reads the `selectors` block from a dealer config and extracts one raw listing
// per matched card. Resolves relative image/link URLs against the page URL.

export async function scrapeHtmlDealer(dealer, { fetchImpl = fetchText } = {}) {
  const selectors = dealer.selectors || {};
  if (!selectors.card) {
    throw new Error(`Dealer ${dealer.id} is missing selectors.card`);
  }

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
      };
      if (raw.title || raw.link) results.push(raw);
    });
  }
  return results;
}

function buildPageUrls(dealer) {
  const base = dealer.url;
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
