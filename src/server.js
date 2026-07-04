import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScan, startScheduler, stopScheduler } from "./core/monitor.js";
import { load, activeListings } from "./core/store.js";
import { findMatches, entryLabel } from "./core/matcher.js";
import { renderDigest } from "./summary.js";
import {
  listDealers,
  addDealer,
  updateDealer,
  removeDealer,
  getDealer,
} from "./core/dealerStore.js";
import { scrapeDealer } from "./scrapers/index.js";
import { validateDealerInput } from "./core/dealerStore.js";
import {
  listEntries,
  getEntry,
  addEntry,
  updateEntry,
  removeEntry,
} from "./core/watchlistStore.js";
import { sendDailyEmail, startEmailScheduler, stopEmailScheduler, nextDailyRun } from "./core/emailer.js";
import { mailConfig, isMailConfigured } from "./config/notifications.js";
import { getLastEmailAt } from "./core/store.js";
import * as durable from "./core/durable.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS) || 30 * 60 * 1000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Latest scan result, kept in memory so the dashboard is instant.
let lastResult = null;

// --- API -------------------------------------------------------------------

// Health check for load balancers / platform probes.
app.get("/healthz", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Current matched & active listings (from persisted store), with metadata.
app.get("/api/listings", (req, res) => {
  const db = load();
  const active = activeListings(db);
  // Re-derive match labels against the current watchlist so filters stay fresh.
  const watchlist = listEntries();
  const matched = findMatches(active, watchlist);
  res.json({
    generatedAt: lastResult?.startedAt || null,
    count: matched.length,
    watchlist: watchlist.map(entryLabel),
    dealers: listDealers()
      .filter((d) => d.enabled !== false)
      .map((d) => ({ id: d.id, name: d.name, type: d.type })),
    listings: matched,
  });
});

// --- Watchlist database (CRUD) ---------------------------------------------

app.get("/api/watchlist", (_req, res) =>
  res.json(listEntries().map((e) => ({ ...e, displayLabel: entryLabel(e) }))));

app.get("/api/watchlist/:id", (req, res) => {
  const entry = getEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: "Entry not found." });
  res.json({ ...entry, displayLabel: entryLabel(entry) });
});

app.post("/api/watchlist", (req, res) => {
  const { entry, error } = addEntry(req.body || {});
  if (error) return res.status(400).json({ error });
  res.status(201).json(entry);
});

app.put("/api/watchlist/:id", (req, res) => {
  const { entry, error } = updateEntry(req.params.id, req.body || {});
  if (error) return res.status(error === "Entry not found." ? 404 : 400).json({ error });
  res.json(entry);
});

app.delete("/api/watchlist/:id", (req, res) => {
  const { ok, error } = removeEntry(req.params.id);
  if (error) return res.status(404).json({ error });
  res.json({ ok });
});

// --- Dealer database (CRUD) ------------------------------------------------

app.get("/api/dealers", (_req, res) => res.json(listDealers().map(publicDealer)));

app.get("/api/dealers/:id", (req, res) => {
  const dealer = getDealer(req.params.id);
  if (!dealer) return res.status(404).json({ error: "Dealer not found." });
  res.json(publicDealer(dealer));
});

app.post("/api/dealers", (req, res) => {
  const { dealer, error } = addDealer(req.body || {});
  if (error) return res.status(400).json({ error });
  res.status(201).json(publicDealer(dealer));
});

app.put("/api/dealers/:id", (req, res) => {
  const { dealer, error } = updateDealer(req.params.id, req.body || {});
  if (error) return res.status(error === "Dealer not found." ? 404 : 400).json({ error });
  res.json(publicDealer(dealer));
});

app.delete("/api/dealers/:id", (req, res) => {
  const { ok, error } = removeDealer(req.params.id);
  if (error) return res.status(404).json({ error });
  res.json({ ok });
});

// Test-scrape a dealer config WITHOUT saving it, so a user can validate the
// URL and selectors when submitting a new dealer website. Accepts either a
// saved dealer id (?id=) or a full dealer body to try.
app.post("/api/dealers/test", async (req, res) => {
  let dealer = req.body || {};
  if (dealer.id && !dealer.url && !dealer.type) {
    const existing = getDealer(dealer.id);
    if (!existing) return res.status(404).json({ error: "Dealer not found." });
    dealer = existing;
  } else {
    const { value, error } = validateDealerInput(dealer);
    if (error) return res.status(400).json({ error });
    dealer = { id: "__test__", name: value.name || "Test", ...value };
  }
  try {
    const result = await scrapeDealer(dealer, { debug: true });
    res.json({
      ok: !result.error,
      error: result.error,
      count: result.listings.length,
      method: result.source || null, // "json" (feed) or "html" (page scrape)
      inventoryUrl: result.discoveredInventoryUrl || dealer.inventoryUrl || dealer.url || null,
      sample: result.listings.slice(0, 6),
      debug: result.debug || null, // page structure when nothing was found
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/status", (_req, res) => {
  const db = load();
  res.json({
    lastScan: lastResult?.startedAt || (db.scans[0]?.at ?? null),
    totalTracked: Object.keys(db.listings).length,
    activeMatches: activeListings(db).length,
    recentScans: db.scans.slice(0, 10),
    intervalMinutes: Math.round(SCAN_INTERVAL_MS / 60000),
    persistence: durable.status(),
  });
});

// Trigger a fresh scan on demand.
app.post("/api/scan", async (_req, res) => {
  try {
    lastResult = await runScan({ dealers: listDealers(), watchlist: listEntries() });
    res.json({
      ok: true,
      totalScanned: lastResult.totalScanned,
      totalMatched: lastResult.totalMatched,
      newCount: lastResult.newCount,
      durationMs: lastResult.durationMs,
      dealers: lastResult.dealers, // per-dealer scanned counts + any errors
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Email digest ----------------------------------------------------------

app.get("/api/email/status", (_req, res) => {
  const cfg = mailConfig();
  const db = load();
  res.json({
    configured: isMailConfigured(),
    dryRun: !cfg.smtp.host,
    to: cfg.to || null,
    hour: cfg.hour,
    timezone: cfg.timezone,
    lastEmailAt: getLastEmailAt(db),
    nextRun: nextDailyRun(cfg.hour, cfg.timezone).toISOString(),
  });
});

// Send the daily digest right now (updates since the last email). Useful for a
// "send test" button or an external cron. Set ?scan=false to skip re-scanning.
app.post("/api/email/send", async (req, res) => {
  try {
    const scan = req.query.scan !== "false";
    const result = await sendDailyEmail({ scan });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Standalone HTML digest (openable / emailable) of the latest scan.
app.get("/api/digest", (_req, res) => {
  const db = load();
  const active = activeListings(db);
  const matched = findMatches(active, listEntries());
  const result = lastResult || {
    startedAt: db.scans[0]?.at || new Date().toISOString(),
    dealers: listDealers().filter((d) => d.enabled !== false),
    newCount: matched.filter((l) => l.isNew).length,
    matches: matched,
  };
  res.type("html").send(renderDigest({ ...result, matches: matched }));
});

// Restore data from the database (if DATABASE_URL is set) before serving, so a
// fresh deploy comes up with the previously saved dealers/watchlist/listings.
await durable.init();
const persistence = durable.status();

app.listen(PORT, () => {
  console.log(`\n🚗 Car Dealer Monitor running at http://localhost:${PORT}`);
  if (persistence.mode === "database") {
    console.log("   Storage:    Postgres (durable — survives redeploys) ✅");
  } else if (persistence.mode === "error") {
    console.log(`   Storage:    ⚠️  DATABASE_URL set but NOT connected — data will be LOST on redeploy. ${persistence.error || ""}`);
  } else {
    console.log("   Storage:    local files only — set DATABASE_URL (or mount a disk at DATA_DIR) so data survives redeploys ⚠️");
  }
  console.log(`   Dashboard:  http://localhost:${PORT}/`);
  console.log(`   Digest:     http://localhost:${PORT}/api/digest`);
  console.log(`   Dealers:    http://localhost:${PORT}/dealers.html`);
  console.log(`   Scanning ${listDealers().filter((d) => d.enabled !== false).length} dealer(s) every ${Math.round(SCAN_INTERVAL_MS / 60000)} min\n`);

  // Kick off the background scheduler (also runs one scan immediately).
  startScheduler({
    intervalMs: SCAN_INTERVAL_MS,
    onScan: (result) => {
      lastResult = result;
      const stamp = new Date().toLocaleTimeString();
      console.log(`[${stamp}] scan: ${result.totalMatched} matches, ${result.newCount} new (of ${result.totalScanned} scanned)`);
    },
  });

  // Schedule the daily digest email (updates since the last email).
  const cfg = mailConfig();
  const next = startEmailScheduler({
    onSend: (r) => {
      const how = r.sent ? `sent to ${r.to}` : r.dryRun ? `dry-run → ${r.file}` : r.skipped ? "skipped (no updates)" : "not sent";
      console.log(`[email] daily digest: ${r.count ?? 0} update(s), ${how}`);
    },
  });
  console.log(
    `   Daily email at ${cfg.hour}:00 ${cfg.timezone} → ` +
      `${isMailConfigured() ? cfg.to : "DRY-RUN (writes to data/outbox/; set SMTP_HOST + MAIL_TO to send)"}`
  );
  console.log(`   Next email:  ${next.toISOString()}\n`);
});

async function shutdown() {
  stopScheduler();
  stopEmailScheduler();
  try {
    await durable.flush();
    await durable.close();
  } catch {
    /* best effort */
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown); // docker/orchestrator stop

// Shape a stored dealer for API responses (full config, safe to expose).
function publicDealer(d) {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    enabled: d.enabled !== false,
    url: d.url || null,
    inventoryUrl: d.inventoryUrl || null,
    selectors: d.selectors || null,
    pagination: d.pagination || null,
    seedMakes: d.seedMakes || null,
    inventorySize: d.inventorySize || null,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
  };
}
