import { scrapeAll } from "../scrapers/index.js";
import { findMatches } from "./matcher.js";
import { load, save, reconcile, activeListings } from "./store.js";
import { listDealers, cacheInventoryUrl } from "./dealerStore.js";
import { listEntries } from "./watchlistStore.js";

// Runs one full monitoring cycle: scrape every enabled dealer, match listings
// against the watchlist, persist results, and report what's new. Dealers and the
// watchlist come from their persisted databases by default, so runtime edits
// take effect on the next scan.
export async function runScan({
  dealers = listDealers(),
  watchlist = listEntries(),
  persist = true,
} = {}) {
  const startedAt = new Date();
  const scraped = await scrapeAll(dealers);

  const allListings = [];
  const dealerReports = [];
  for (const r of scraped) {
    allListings.push(...r.listings);
    // Remember the auto-discovered inventory page so we skip re-crawling next time.
    if (r.discoveredInventoryUrl && r.dealer?.id && r.dealer.id !== "__test__") {
      cacheInventoryUrl(r.dealer.id, r.discoveredInventoryUrl);
    }
    dealerReports.push({
      dealer: r.dealer.name,
      dealerId: r.dealer.id,
      scanned: r.listings.length,
      inventoryUrl: r.discoveredInventoryUrl || r.dealer.inventoryUrl || null,
      error: r.error,
    });
  }

  const matches = findMatches(allListings, watchlist);

  const db = load();
  const result = reconcile(db, matches);
  if (persist) save(db);

  return {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    dealers: dealerReports,
    totalScanned: allListings.length,
    totalMatched: matches.length,
    newCount: result.newListings.length,
    newListings: result.newListings,
    matches,
    active: activeListings(db),
  };
}

let timer = null;

// Start periodic monitoring. Returns a stop() function.
export function startScheduler({ intervalMs = 30 * 60 * 1000, onScan } = {}) {
  stopScheduler();
  const tick = async () => {
    try {
      const result = await runScan();
      if (onScan) onScan(result);
    } catch (err) {
      console.error("[monitor] scan failed:", err.message);
    }
  };
  tick(); // run immediately on start
  timer = setInterval(tick, intervalMs);
  return stopScheduler;
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
