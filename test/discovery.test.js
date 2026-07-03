import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverInventoryUrl } from "../src/scrapers/discovery.js";
import { scrapeDealer } from "../src/scrapers/index.js";

const HOME = `<!doctype html><html><body>
  <a href="/about">About Us</a>
  <a href="/finance">Financing</a>
  <a href="/inventory/used">Shop Used Inventory</a>
  <a href="https://facebook.com/dealer">Facebook</a>
  <nav><a href="/new-vehicles">New Vehicles</a></nav>
</body></html>`;

const INVENTORY = `<!doctype html><html><body>
  <div class="vehicle-card"><a class="vehicle-link" href="/v/1"><h2 class="vehicle-title">2021 Toyota Tacoma</h2></a><span class="price">$38,000</span></div>
  <div class="vehicle-card"><a class="vehicle-link" href="/v/2"><h2 class="vehicle-title">2020 Honda Civic</h2></a><span class="price">$19,000</span></div>
</body></html>`;

function router(map) {
  return async (url) => {
    for (const [needle, html] of Object.entries(map)) {
      if (url.includes(needle)) return html;
    }
    throw new Error("404 " + url);
  };
}

test("discoverInventoryUrl finds the inventory link from the homepage", async () => {
  const fetchImpl = router({ "example.com/inventory/used": INVENTORY, "example.com": HOME });
  const { url, verified } = await discoverInventoryUrl("https://www.example.com", {
    fetchImpl,
    cardSelector: ".vehicle-card",
  });
  assert.match(url, /\/inventory\/used$/);
  assert.equal(verified, true);
});

test("discoverInventoryUrl uses the homepage when it already lists cars", async () => {
  const fetchImpl = router({ "shop.example.com": INVENTORY });
  const { url, fromHome } = await discoverInventoryUrl("https://shop.example.com", {
    fetchImpl,
    cardSelector: ".vehicle-card",
  });
  assert.equal(fromHome, true);
  assert.match(url, /shop\.example\.com/);
});

test("scrapeDealer auto-discovers inventory from a dealer's main URL", async () => {
  const fetchImpl = router({ "example.com/inventory/used": INVENTORY, "example.com": HOME });
  const dealer = {
    id: "d",
    name: "D",
    type: "html",
    url: "https://www.example.com",
    selectors: {
      card: ".vehicle-card",
      title: { sel: ".vehicle-title" },
      price: { sel: ".price" },
      link: { sel: "a.vehicle-link", attr: "href" },
    },
  };
  const result = await scrapeDealer(dealer, { fetchImpl });
  assert.equal(result.error, null);
  assert.match(result.discoveredInventoryUrl, /\/inventory\/used$/);
  assert.equal(result.listings.length, 2);
  assert.equal(result.listings[0].make, "Toyota");
});
