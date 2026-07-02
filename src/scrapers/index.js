import { scrapeDemoDealer } from "./demoScraper.js";
import { scrapeHtmlDealer } from "./htmlScraper.js";
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
export async function scrapeDealer(dealer) {
  const adapter = ADAPTERS[dealer.type];
  if (!adapter) {
    return { dealer, listings: [], error: `No adapter for type "${dealer.type}"` };
  }
  try {
    const raw = await adapter(dealer);
    const listings = raw.map((r) => normalizeListing(r, dealer));
    return { dealer, listings, error: null };
  } catch (err) {
    return { dealer, listings: [], error: err.message || String(err) };
  }
}

// Scrape all enabled dealers concurrently.
export async function scrapeAll(dealers) {
  const enabled = dealers.filter((d) => d.enabled !== false);
  const results = await Promise.all(enabled.map((d) => scrapeDealer(d)));
  return results;
}
