import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScan, startScheduler, stopScheduler } from "./core/monitor.js";
import { load, activeListings } from "./core/store.js";
import { findMatches, entryLabel } from "./core/matcher.js";
import { renderDigest } from "./summary.js";
import { dealers } from "./config/dealers.js";
import { watchlist } from "./config/watchlist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS) || 30 * 60 * 1000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Latest scan result, kept in memory so the dashboard is instant.
let lastResult = null;

// --- API -------------------------------------------------------------------

// Current matched & active listings (from persisted store), with metadata.
app.get("/api/listings", (req, res) => {
  const db = load();
  const active = activeListings(db);
  // Re-derive match labels against the current watchlist so filters stay fresh.
  const matched = findMatches(active, watchlist);
  res.json({
    generatedAt: lastResult?.startedAt || null,
    count: matched.length,
    watchlist: watchlist.map(entryLabel),
    dealers: dealers.filter((d) => d.enabled !== false).map((d) => ({ id: d.id, name: d.name, type: d.type })),
    listings: matched,
  });
});

app.get("/api/watchlist", (_req, res) => res.json(watchlist));

app.get("/api/dealers", (_req, res) =>
  res.json(dealers.map((d) => ({ id: d.id, name: d.name, type: d.type, enabled: d.enabled !== false }))));

app.get("/api/status", (_req, res) => {
  const db = load();
  res.json({
    lastScan: lastResult?.startedAt || (db.scans[0]?.at ?? null),
    totalTracked: Object.keys(db.listings).length,
    activeMatches: activeListings(db).length,
    recentScans: db.scans.slice(0, 10),
    intervalMinutes: Math.round(SCAN_INTERVAL_MS / 60000),
  });
});

// Trigger a fresh scan on demand.
app.post("/api/scan", async (_req, res) => {
  try {
    lastResult = await runScan({ dealers, watchlist });
    res.json({
      ok: true,
      totalScanned: lastResult.totalScanned,
      totalMatched: lastResult.totalMatched,
      newCount: lastResult.newCount,
      durationMs: lastResult.durationMs,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Standalone HTML digest (openable / emailable) of the latest scan.
app.get("/api/digest", (_req, res) => {
  const db = load();
  const active = activeListings(db);
  const matched = findMatches(active, watchlist);
  const result = lastResult || {
    startedAt: db.scans[0]?.at || new Date().toISOString(),
    dealers: dealers.filter((d) => d.enabled !== false),
    newCount: matched.filter((l) => l.isNew).length,
    matches: matched,
  };
  res.type("html").send(renderDigest({ ...result, matches: matched }));
});

app.listen(PORT, () => {
  console.log(`\n🚗 Car Dealer Monitor running at http://localhost:${PORT}`);
  console.log(`   Dashboard:  http://localhost:${PORT}/`);
  console.log(`   Digest:     http://localhost:${PORT}/api/digest`);
  console.log(`   Scanning ${dealers.filter((d) => d.enabled !== false).length} dealer(s) every ${Math.round(SCAN_INTERVAL_MS / 60000)} min\n`);

  // Kick off the background scheduler (also runs one scan immediately).
  startScheduler({
    intervalMs: SCAN_INTERVAL_MS,
    onScan: (result) => {
      lastResult = result;
      const stamp = new Date().toLocaleTimeString();
      console.log(`[${stamp}] scan: ${result.totalMatched} matches, ${result.newCount} new (of ${result.totalScanned} scanned)`);
    },
  });
});

process.on("SIGINT", () => {
  stopScheduler();
  process.exit(0);
});
