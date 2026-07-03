import { scrapeDemoDealer } from "./demoScraper.js";
import { scrapeHtmlDealer } from "./htmlScraper.js";
import { discoverInventoryUrl } from "./discovery.js";
import { normalizeListing } from "../core/listing.js";

// Adapter registry. Add your own by registering a function keyed by dealer type.
// Each adapter takes a dealer config and returns an array of RAW listing objects.
const ADAPTERS = {
  demo: scrapeDemoDealer,
  html: scrapeHtmlDealer,
};

export function registerAdapter(type, fn) {
  ADAPTERS[type] = fn;
}

// Scrape one dealer and return normalized listings plus any error encountered.
// For HTML dealers, `dealer.url` is the dealer's MAIN website; if we don't yet
// have a cached inventory URL, we auto-discover the inventory page deeper in the
// site. Sold / sale-pending cars are filtered out so they never surface.
export async function scrapeDealer(dealer, { fetchImpl } = {}) {
  const adapter = ADAPTERS[dealer.type];
  if (!adapter) {
    return { dealer, listings: [], error: `No adapter for type "${dealer.type}"` };
  }
  try {
    let working = dealer;
    let discoveredInventoryUrl = null;
    if (dealer.type === "html" && !dealer.inventoryUrl && dealer.url) {
      const disc = await discoverInventoryUrl(dealer.url, {
        fetchImpl,
        cardSelector: dealer.selectors?.card,
      });
      discoveredInventoryUrl = disc.url;
      working = { ...dealer, inventoryUrl: disc.url };
    }

    const raw = await adapter(working, { fetchImpl });
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
