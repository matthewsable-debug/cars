import { scrapeDemoDealer } from "./demoScraper.js";
import { scrapeHtmlDealer } from "./htmlScraper.js";
import { discoverInventoryUrl } from "./discovery.js";
import { renderPage, closeBrowser } from "./browserScraper.js";
import { countListings } from "./autoExtract.js";
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
export async function scrapeDealer(dealer, { fetchImpl } = {}) {
  const adapter = ADAPTERS[dealer.type];
  if (!adapter) {
    return { dealer, listings: [], error: `No adapter for type "${dealer.type}"` };
  }
  // `browser` dealers fetch through a real browser (unless a fetch impl is
  // injected, e.g. in tests). Everything else defaults to plain HTTP.
  const resolvedFetch =
    fetchImpl ||
    (dealer.type === "browser"
      ? (url) => renderPage(url, { waitSelector: dealer.selectors?.card })
      : undefined);

  try {
    let working = dealer;
    let discoveredInventoryUrl = null;
    if (WEB_TYPES.has(dealer.type) && !dealer.inventoryUrl && dealer.url) {
      const disc = await discoverInventoryUrl(dealer.url, {
        fetchImpl: resolvedFetch,
        cardSelector: dealer.selectors?.card,
        // When there's no card selector, verify pages via auto-detection.
        countListings: dealer.selectors?.card ? undefined : countListings,
      });
      discoveredInventoryUrl = disc.url;
      working = { ...dealer, inventoryUrl: disc.url };
    }

    const raw = await adapter(working, { fetchImpl: resolvedFetch });
    const listings = raw
      .map((r) => normalizeListing(r, dealer))
      .filter((l) => !l.sold); // exclude cars already sold / sale-pending

    return { dealer, listings, error: null, discoveredInventoryUrl };
  } catch (err) {
    return { dealer, listings: [], error: err.message || String(err) };
  }
}

// Scrape all enabled dealers concurrently.
export async function scrapeAll(dealers, opts = {}) {
  const enabled = dealers.filter((d) => d.enabled !== false);
  const results = await Promise.all(enabled.map((d) => scrapeDealer(d, opts)));
  return results;
}
