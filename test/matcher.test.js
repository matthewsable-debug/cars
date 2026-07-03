import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesEntry, findMatches, entryLabel } from "../src/core/matcher.js";
import { normalizeListing, parseTitle, toInt } from "../src/core/listing.js";

const dealer = { id: "d1", name: "Test Dealer" };

test("toInt parses messy strings", () => {
  assert.equal(toInt("$34,995"), 34995);
  assert.equal(toInt("42,100 mi"), 42100);
  assert.equal(toInt("2021"), 2021);
  assert.equal(toInt(""), null);
  assert.equal(toInt(null), null);
  assert.equal(toInt(18000), 18000);
});

test("parseTitle extracts year/make/model/trim", () => {
  const p = parseTitle("2021 Toyota Tacoma TRD Off-Road");
  assert.equal(p.year, 2021);
  assert.equal(p.make, "Toyota");
  assert.equal(p.model, "Tacoma");
  assert.equal(p.trim, "TRD Off-Road");
});

test("normalizeListing produces stable ids and clean fields", () => {
  const a = normalizeListing({ title: "2020 Honda Civic", price: "$21,500", mileage: "30,000 mi", link: "http://x/1" }, dealer);
  const b = normalizeListing({ title: "2020 Honda Civic", price: "$21,500", mileage: "30,000 mi", link: "http://x/1" }, dealer);
  assert.equal(a.id, b.id, "same link => same id");
  assert.equal(a.price, 21500);
  assert.equal(a.mileage, 30000);
  assert.equal(a.make, "Honda");
});

test("matchesEntry respects make/model/year/price/mileage", () => {
  const listing = normalizeListing(
    { title: "2021 Toyota Tacoma TRD Off-Road", price: 38000, mileage: 40000, link: "http://x/2" },
    dealer
  );
  assert.ok(matchesEntry(listing, { make: "Toyota", model: "Tacoma", yearMin: 2019, priceMax: 42000, mileageMax: 60000 }));
  assert.ok(!matchesEntry(listing, { make: "Honda" }), "wrong make");
  assert.ok(!matchesEntry(listing, { make: "Toyota", priceMax: 30000 }), "over price");
  assert.ok(!matchesEntry(listing, { make: "Toyota", mileageMax: 30000 }), "over mileage");
  assert.ok(!matchesEntry(listing, { make: "Toyota", yearMin: 2022 }), "too old");
});

test("trim can be matched from the title", () => {
  const listing = normalizeListing({ title: "2019 Honda Civic Type R", price: 40000, link: "http://x/3" }, dealer);
  assert.ok(matchesEntry(listing, { make: "Honda", model: "Civic", trim: "Type R" }));
});

test("make matches via the title when the make field is blank/odd", () => {
  // A JSON-feed listing with no make field, but the title names the marque.
  const l = normalizeListing({ title: "1973 Porsche 911 Carrera RS", make: "", link: "http://x/p1" }, dealer);
  assert.ok(matchesEntry(l, { make: "Porsche" }), "matched via title");
  // And a differently-formatted make field still matches by title.
  const l2 = normalizeListing({ title: "1973 Porsche 911", make: "Porsche AG", link: "http://x/p2" }, dealer);
  assert.ok(matchesEntry(l2, { make: "Porsche" }));
  assert.ok(!matchesEntry(l2, { make: "Ferrari" }));
});

test("color matches from the color field or the title", () => {
  const l1 = normalizeListing({ title: "2021 Toyota Tacoma", color: "Blue", link: "http://x/c1" }, dealer);
  assert.ok(matchesEntry(l1, { make: "Toyota", color: "blue" }));
  assert.ok(!matchesEntry(l1, { make: "Toyota", color: "red" }));
  const l2 = normalizeListing({ title: "2021 Red Toyota Tacoma", link: "http://x/c2" }, dealer);
  assert.ok(matchesEntry(l2, { color: "Red" }), "color found in title");
});

test("features must all be present (from features list, trim, or title)", () => {
  const listing = normalizeListing({
    title: "2021 Toyota Tacoma TRD Off-Road",
    features: ["AWD", "Sunroof", "Heated Seats"],
    link: "http://x/f1",
  }, dealer);
  assert.ok(matchesEntry(listing, { make: "Toyota", features: ["AWD", "Sunroof"] }));
  assert.ok(matchesEntry(listing, { features: ["TRD"] }), "feature found in title");
  assert.ok(!matchesEntry(listing, { features: ["AWD", "Navigation"] }), "missing one feature");
});

test("findMatches annotates matchedLabels", () => {
  const listings = [
    normalizeListing({ title: "2021 Toyota Tacoma", price: 35000, mileage: 20000, link: "http://x/4" }, dealer),
    normalizeListing({ title: "2005 Ford Focus", price: 4000, link: "http://x/5" }, dealer),
  ];
  const wl = [{ label: "Tacoma deal", make: "Toyota", model: "Tacoma", priceMax: 42000 }];
  const matches = findMatches(listings, wl);
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].matchedLabels, ["Tacoma deal"]);
});

test("entryLabel falls back to make/model", () => {
  assert.equal(entryLabel({ make: "Mazda", model: "MX-5" }), "Mazda MX-5");
  assert.equal(entryLabel({ label: "Fun car", make: "Mazda" }), "Fun car");
});
