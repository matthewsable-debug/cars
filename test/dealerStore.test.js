import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEALERS_FILE = path.join(__dirname, "..", "data", "dealers.json");

// Work against a scratch dealers.json and restore anything that was there.
let backup = null;
beforeEach(() => {
  backup = fs.existsSync(DEALERS_FILE) ? fs.readFileSync(DEALERS_FILE, "utf8") : null;
  fs.mkdirSync(path.dirname(DEALERS_FILE), { recursive: true });
  fs.writeFileSync(DEALERS_FILE, JSON.stringify({ dealers: [] }, null, 2));
});
afterEach(() => {
  if (backup !== null) fs.writeFileSync(DEALERS_FILE, backup);
  else fs.rmSync(DEALERS_FILE, { force: true });
});

// Import fresh each test isn't necessary; the module reads the file each call.
const store = await import("../src/core/dealerStore.js");

test("addDealer validates required fields", () => {
  assert.equal(store.addDealer({ name: "" }).error, "Name is required.");
  assert.match(store.addDealer({ name: "X", type: "html", url: "" }).error, /URL is required/);
  assert.match(store.addDealer({ name: "X", type: "html", url: "notaurl" }).error, /not valid/);
  assert.match(store.addDealer({ name: "X", type: "bogus" }).error, /Type must be/);
});

test("addDealer creates a dealer with a slug id and default selectors", () => {
  const { dealer } = store.addDealer({ name: "Downtown Toyota", type: "html", url: "https://d.com/inv" });
  assert.equal(dealer.id, "downtown-toyota");
  assert.equal(dealer.enabled, true);
  assert.ok(dealer.selectors && dealer.selectors.card, "default selectors applied");
  assert.equal(store.getDealer("downtown-toyota").name, "Downtown Toyota");
});

test("duplicate names get unique ids", () => {
  const a = store.addDealer({ name: "City Motors", type: "html", url: "https://a.com" }).dealer;
  const b = store.addDealer({ name: "City Motors", type: "html", url: "https://b.com" }).dealer;
  assert.equal(a.id, "city-motors");
  assert.notEqual(a.id, b.id);
  assert.match(b.id, /^city-motors-[0-9a-f]{4}$/);
});

test("updateDealer patches fields and toggles enabled", () => {
  const { dealer } = store.addDealer({ name: "Sunset", type: "html", url: "https://s.com" });
  const upd = store.updateDealer(dealer.id, { enabled: false });
  assert.equal(upd.dealer.enabled, false);
  assert.equal(store.updateDealer("nope", { enabled: true }).error, "Dealer not found.");
});

test("removeDealer deletes and reports missing", () => {
  const { dealer } = store.addDealer({ name: "Gone", type: "demo" });
  assert.deepEqual(store.removeDealer(dealer.id), { ok: true });
  assert.equal(store.getDealer(dealer.id), null);
  assert.equal(store.removeDealer(dealer.id).error, "Dealer not found.");
});

test("demo dealers do not require a URL", () => {
  const { dealer, error } = store.addDealer({ name: "Sample Lot", type: "demo", inventorySize: 10 });
  assert.equal(error, undefined);
  assert.equal(dealer.type, "demo");
  assert.equal(dealer.inventorySize, 10);
});
