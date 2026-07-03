import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScan } from "./core/monitor.js";
import { renderDigest } from "./summary.js";
import { listDealers } from "./core/dealerStore.js";
import { listEntries } from "./core/watchlistStore.js";
import { entryLabel } from "./core/matcher.js";

// Read dealers and the watchlist from their persisted databases (seeded from
// config on first run), so the CLI and the web UI operate on the same data.
const dealers = listDealers();
const watchlist = listEntries();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2] || "scan";

const money = (n) => (n != null ? "$" + n.toLocaleString() : "n/a");

async function main() {
  switch (cmd) {
    case "scan":
      return doScan();
    case "digest":
      return doDigest();
    case "watchlist":
      return showWatchlist();
    default:
      console.log("Usage: node src/cli.js [scan|digest|watchlist]");
      process.exit(1);
  }
}

async function doScan() {
  console.log(`Scanning ${dealers.filter((d) => d.enabled !== false).length} dealer(s)…\n`);
  const result = await runScan({ dealers, watchlist });

  for (const d of result.dealers) {
    const status = d.error ? `ERROR: ${d.error}` : `${d.scanned} vehicles`;
    console.log(`  • ${d.dealer}: ${status}`);
  }
  console.log(
    `\n${result.totalMatched} match(es) of ${result.totalScanned} scanned, ` +
      `${result.newCount} new.\n`
  );

  const show = result.matches
    .slice()
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    .slice(0, 25);
  for (const l of show) {
    const tag = l.isNew ? "🆕 " : "   ";
    console.log(`${tag}${l.title.padEnd(34)} ${money(l.price).padStart(9)}  ${String(l.mileage ?? "").padStart(7)}mi  ${l.dealer}`);
    console.log(`     ${l.url}`);
  }
  if (result.matches.length > show.length) {
    console.log(`\n…and ${result.matches.length - show.length} more. Run the dashboard to see all.`);
  }
}

async function doDigest() {
  const result = await runScan({ dealers, watchlist });
  const html = renderDigest(result);
  const out = path.join(__dirname, "..", "data", "digest.html");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`Digest written to ${out}`);
  console.log(`(${result.totalMatched} matches, ${result.newCount} new). Open it in a browser or email it.`);
}

function showWatchlist() {
  console.log("Watchlist:\n");
  for (const e of watchlist) {
    const crit = [];
    if (e.yearMin || e.yearMax) crit.push(`year ${e.yearMin ?? "*"}–${e.yearMax ?? "*"}`);
    if (e.priceMax) crit.push(`≤ ${money(e.priceMax)}`);
    if (e.mileageMax) crit.push(`≤ ${e.mileageMax.toLocaleString()} mi`);
    if (e.color) crit.push(`${e.color}`);
    if (e.features?.length) crit.push(e.features.join(", "));
    console.log(`  • ${entryLabel(e)}${crit.length ? "  (" + crit.join(", ") + ")" : ""}`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
