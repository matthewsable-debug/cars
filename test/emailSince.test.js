import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Verifies the "updates since the last email" watermark logic end-to-end
// against the file store, using the demo dealers and a scratch data dir.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const files = ["listings.json", "watchlist.json", "dealers.json"].map((f) => path.join(DATA, f));

let backups = {};
beforeEach(() => {
  fs.mkdirSync(DATA, { recursive: true });
  for (const f of files) backups[f] = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
  for (const f of files) fs.rmSync(f, { force: true });
  // No SMTP configured → dry-run mode.
  delete process.env.SMTP_HOST;
});
afterEach(() => {
  for (const f of files) {
    if (backups[f] !== null) fs.writeFileSync(f, backups[f]);
    else fs.rmSync(f, { force: true });
  }
});

test("first email includes matches; a second email right after has no updates", async () => {
  const { sendDailyEmail } = await import("../src/core/emailer.js?first");

  const first = await sendDailyEmail();
  assert.ok(first.dryRun, "dry-run without SMTP");
  assert.ok(first.count > 0, "first email carries the current matches");

  const second = await sendDailyEmail();
  assert.equal(second.skipped, true, "nothing new since the last email");
  assert.equal(second.count, 0);
});
