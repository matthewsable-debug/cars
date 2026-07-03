import { scrapeAll } from "../scrapers/index.js";
import { findMatches } from "./matcher.js";
import { load, save, reconcile, activeListings } from "./store.js";
import { listDealers } from "./dealerStore.js";
import { watchlist as defaultWatchlist } from "../config/watchlist.js";

// Runs one full monitoring cycle: scrape every enabled dealer, match listings
// against the watchlist, persist results, and report what's new. Dealers come
// from the persisted dealer database by default, so runtime edits take effect.
export async function runScan({
  dealers = listDealers(),
  watchlist = defaultWatchlist,
  persist = true,
} = {}) {
  const startedAt = new Date();
  const scraped = await scrapeAll(dealers);

  const allListings = [];
  const dealerReports = [];
  for (const r of scraped) {
    allListings.push(...r.listings);
    dealerReports.push({
      dealer: r.dealer.name,
      dealerId: r.dealer.id,
      scanned: r.listings.length,
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
