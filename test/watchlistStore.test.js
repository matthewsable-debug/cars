import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WL_FILE = path.join(__dirname, "..", "data", "watchlist.json");

let backup = null;
beforeEach(() => {
  backup = fs.existsSync(WL_FILE) ? fs.readFileSync(WL_FILE, "utf8") : null;
  fs.mkdirSync(path.dirname(WL_FILE), { recursive: true });
  fs.writeFileSync(WL_FILE, JSON.stringify({ entries: [] }, null, 2));
});
afterEach(() => {
  if (backup !== null) fs.writeFileSync(WL_FILE, backup);
  else fs.rmSync(WL_FILE, { force: true });
});

const store = await import("../src/core/watchlistStore.js");

test("addEntry requires at least one criterion", () => {
  assert.match(store.addEntry({ label: "Empty" }).error, /at least one criterion/);
});

test("addEntry creates an entry with slug id and normalized features", () => {
  const { entry } = store.addEntry({
    make: "Toyota", model: "Tacoma", yearMin: 2019, priceMax: 42000,
    color: "Blue", features: "AWD, Sunroof , ",
  });
  assert.equal(entry.id, "toyota-tacoma");
  assert.deepEqual(entry.features, ["AWD", "Sunroof"]);
  assert.equal(entry.color, "Blue");
  assert.equal(store.getEntry("toyota-tacoma").make, "Toyota");
});

test("addEntry validates year and price ranges", () => {
  assert.match(store.addEntry({ make: "X", yearMin: 2022, yearMax: 2020 }).error, /Year \(from\)/);
  assert.match(store.addEntry({ make: "X", priceMin: 50000, priceMax: 10000 }).error, /Min price/);
  assert.match(store.addEntry({ make: "X", priceMax: "abc" }).error, /must be a number/);
});

test("updateEntry can relax a criterion by clearing it", () => {
  const { entry } = store.addEntry({ make: "Mazda", model: "MX-5", priceMax: 30000 });
  const upd = store.updateEntry(entry.id, { priceMax: "" });
  assert.equal(upd.entry.priceMax, undefined);
  assert.ok(!("priceMax" in upd.entry), "cleared key removed");
});

test("removeEntry deletes and reports missing", () => {
  const { entry } = store.addEntry({ make: "Subaru", model: "Outback" });
  assert.deepEqual(store.removeEntry(entry.id), { ok: true });
  assert.equal(store.removeEntry(entry.id).error, "Entry not found.");
});
