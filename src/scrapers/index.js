import { scrapeDemoDealer } from "./demoScraper.js";
import { scrapeHtmlDealer } from "./htmlScraper.js";
import { discoverInventoryUrl } from "./discovery.js";
import { renderPage, browserFetchJson, closeBrowser } from "./browserScraper.js";
import { fetchText } from "./http.js";
import {
  countListings,
  extractListingsFromJson,
  autoExtractListings,
  inventorySubLinks,
  diagnose,
} from "./autoExtract.js";
import { normalizeListing } from "../core/listing.js";

// Adapter registry. Add your own by registering a function keyed by dealer type.
// Each adapter takes a dealer config and returns an array of RAW listing objects.
// The `browser` type reuses the HTML extraction but fetches via a real browser.
const ADAPTERS = {
  demo: scrapeDemoDealer,
  html: scrapeHtmlDealer,
  browser: scrapeHtmlDealer,
};

// Dealer types that fetch a live site and support inventory auto-discovery.
const WEB_TYPES = new Set(["html", "browser"]);

export function registerAdapter(type, fn) {
  ADAPTERS[type] = fn;
}

export { closeBrowser };

// Scrape one dealer and return normalized listings plus any error encountered.
// For web dealers, `dealer.url` is the dealer's MAIN website; if we don't yet
// have a cached inventory URL, we auto-discover the inventory page deeper in the
// site. `browser` dealers render pages in headless Chromium (for JS-heavy or
// bot-protected sites). Sold / sale-pending cars are filtered out.
export async function scrapeDealer(dealer, { fetchImpl, jsonFetch, debug } = {}) {
  const adapter = ADAPTERS[dealer.type];
  if (!adapter) {
    return { dealer, listings: [], error: `No adapter for type "${dealer.type}"` };
  }

  // Non-web dealers (demo): just run the adapter.
  if (!WEB_TYPES.has(dealer.type)) {
    try {
      const raw = await adapter(dealer, { fetchImpl });
      return { dealer, listings: keep(raw, dealer), error: null };
    } catch (err) {
      return { dealer, listings: [], error: err.message || String(err) };
    }
  }

  // Web dealers: try PLAIN HTTP first (needs no browser — works anywhere,
  // including hosts without Chromium), then fall back to a headless browser only
  // for sites that block plain requests or render inventory with JavaScript.
  const attempts = [];
  if (fetchImpl || jsonFetch) {
    attempts.push({ fetchFn: fetchImpl, jsonFetch }); // test / explicit injection
  } else {
    attempts.push({ fetchFn: fetchText }); // plain HTTP with browser-like headers
    if (dealer.type === "browser") attempts.push({ browser: true }); // headless fallback
  }

  let last = { dealer, listings: [], error: null };
  for (const attempt of attempts) {
    try {
      const res = await scrapeWeb(dealer, adapter, { ...attempt, debug });
      if (res.listings.length > 0) return res; // success — stop here
      last = res;
    } catch (err) {
      last = { dealer, listings: [], error: err.message || String(err) };
    }
  }
  return last;
}

// Run discovery → JSON feed → HTML extraction for a web dealer using one fetch
// strategy (plain HTTP or headless browser).
async function scrapeWeb(dealer, adapter, { fetchFn, jsonFetch, browser, debug }) {
  const fetchImpl = browser
    ? (url) => renderPage(url, { waitSelector: dealer.selectors?.card })
    : fetchFn;

  let working = dealer;
  let discoveredInventoryUrl = null;
  if (!dealer.inventoryUrl && dealer.url) {
    const disc = await discoverInventoryUrl(dealer.url, {
      fetchImpl,
      cardSelector: dealer.selectors?.card,
      countListings: dealer.selectors?.card ? undefined : countListings,
    });
    discoveredInventoryUrl = disc.url;
    working = { ...dealer, inventoryUrl: disc.url };
  }

  // Prefer a JSON feed when one exists (e.g. Rails `/vehicles.json`).
  if (!dealer.selectors?.card) {
    const invUrl = working.inventoryUrl || working.url;
    const candidates = jsonCandidates(invUrl);
    if (candidates.length) {
      const getJson =
        jsonFetch ||
        (browser
          ? (urls) => browserFetchJson(invUrl, urls)
          : (urls) => httpFetchJson(urls, fetchImpl || fetchText));
      let text = null;
      try {
        text = await getJson(candidates);
      } catch {
        /* fall through to HTML */
      }
      if (text) {
        const items = extractListingsFromJson(text, invUrl);
        if (items.length >= 2) {
          return {
            dealer,
            listings: items.map((r) => normalizeListing(r, dealer)).filter((l) => !l.sold),
            error: null,
            discoveredInventoryUrl,
            source: "json",
          };
        }
      }
    }
  }

  // Selector mode: use the configured CSS-selector scraper as-is.
  if (dealer.selectors?.card) {
    const raw = await adapter(working, { fetchImpl });
    return { dealer, listings: keep(raw, dealer), error: null, discoveredInventoryUrl, source: "html" };
  }

  // Auto mode: fetch the inventory page ourselves so we can also crawl sub-pages
  // and diagnose failures.
  const invUrl = working.inventoryUrl || working.url;
  const html = await fetchImpl(invUrl);
  const byId = new Map();
  for (const r of autoExtractListings(html, invUrl)) addListing(byId, r, dealer);

  const dbg = debug ? { inventoryUrl: invUrl, hubCars: byId.size, ...diagnose(html, invUrl) } : null;

  // "Hub" inventory pages list model categories rather than cars. If we found
  // little, follow the deeper inventory links (categories / vehicle pages) and
  // aggregate what they contain — in parallel, with a time budget, so it stays
  // responsive.
  if (byId.size < 2) {
    const allSubs = inventorySubLinks(html, invUrl);
    const subs = allSubs.slice(0, MAX_SUBPAGES);
    if (dbg) {
      dbg.subLinksFound = allSubs.length;
      dbg.crawled = [];
    }
    const deadline = Date.now() + CRAWL_BUDGET_MS;
    await mapLimit(subs, CRAWL_CONCURRENCY, async (sub) => {
      if (Date.now() > deadline) return;
      const before = byId.size;
      try {
        const subHtml = await fetchImpl(sub);
        for (const r of autoExtractListings(subHtml, sub)) addListing(byId, r, dealer);
        if (dbg) dbg.crawled.push(`${pathOf(sub)}:${byId.size - before}`);
      } catch {
        if (dbg) dbg.crawled.push(`${pathOf(sub)}:err`);
      }
    });
  }

  const listings = [...byId.values()].filter((l) => !l.sold);
  if (dbg) {
    dbg.rawCars = byId.size; // unique cars found before dropping sold ones
    dbg.total = listings.length; // available cars returned
  }
  return { dealer, listings, error: null, discoveredInventoryUrl, source: "html", debug: dbg };
}

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

const MAX_SUBPAGES = 18;
const CRAWL_CONCURRENCY = 5;
const CRAWL_BUDGET_MS = 40000;

function addListing(byId, raw, dealer) {
  const l = normalizeListing(raw, dealer);
  if (!byId.has(l.id)) byId.set(l.id, l);
}

// Run async `fn` over `items` with at most `limit` in flight at once.
async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

// Normalize raw listings and drop sold ones.
function keep(raw, dealer) {
  return raw.map((r) => normalizeListing(r, dealer)).filter((l) => !l.sold);
}

// Candidate JSON-feed URLs for an inventory page (Rails/most frameworks).
function jsonCandidates(inventoryUrl) {
  if (!inventoryUrl) return [];
  const out = [];
  try {
    const u = new URL(inventoryUrl);
    const path = u.pathname.replace(/\/$/, "");
    const asJson = new URL(u);
    asJson.pathname = (path || "") + ".json";
    out.push(asJson.toString());
    const asParam = new URL(u);
    asParam.searchParams.set("format", "json");
    out.push(asParam.toString());
  } catch {
    /* ignore */
  }
  return out;
}

// Try each candidate over plain HTTP; return the first JSON-looking body.
async function httpFetchJson(urls, fetchFn) {
  for (const u of urls) {
    try {
      const t = await fetchFn(u);
      if (t && /^\s*[[{]/.test(t)) return t;
    } catch {
      /* try next */
    }
  }
  return null;
}

// Scrape all enabled dealers concurrently.
export async function scrapeAll(dealers, opts = {}) {
  const enabled = dealers.filter((d) => d.enabled !== false);
  const results = await Promise.all(enabled.map((d) => scrapeDealer(d, opts)));
  return results;
}
