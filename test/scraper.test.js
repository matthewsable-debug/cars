import { test } from "node:test";
import assert from "node:assert/strict";
import { scrapeHtmlDealer } from "../src/scrapers/htmlScraper.js";
import { scrapeDemoDealer } from "../src/scrapers/demoScraper.js";

test("html scraper extracts listings from markup with configured selectors", async () => {
  const html = `
    <ul>
      <li class="vehicle">
        <a class="vehicle-link" href="/vehicle/100"><h2 class="vehicle-title">2021 Toyota Tacoma TRD</h2></a>
        <span class="price">$38,500</span>
        <span class="mileage">41,200 mi</span>
        <img src="/img/100.jpg">
      </li>
      <li class="vehicle">
        <a class="vehicle-link" href="/vehicle/101"><h2 class="vehicle-title">2019 Honda Civic</h2></a>
        <span class="price">$19,000</span>
        <span class="mileage">55,000 mi</span>
        <img src="https://cdn.example/101.jpg">
      </li>
    </ul>`;

  const dealer = {
    id: "t",
    name: "T",
    type: "html",
    url: "https://dealer.test/inventory",
    selectors: {
      card: "li.vehicle",
      title: { sel: ".vehicle-title" },
      price: { sel: ".price" },
      mileage: { sel: ".mileage" },
      year: { sel: ".vehicle-title", regex: "(19|20)\\d{2}" },
      link: { sel: "a.vehicle-link", attr: "href" },
      image: { sel: "img", attr: "src" },
    },
  };

  const raw = await scrapeHtmlDealer(dealer, { fetchImpl: async () => html });
  assert.equal(raw.length, 2);
  assert.equal(raw[0].title, "2021 Toyota Tacoma TRD");
  assert.equal(raw[0].price, "$38,500");
  assert.equal(raw[0].year, "2021");
  // relative URLs are resolved against the page URL
  assert.equal(raw[0].link, "https://dealer.test/vehicle/100");
  assert.equal(raw[0].image, "https://dealer.test/img/100.jpg");
  // absolute image URL preserved
  assert.equal(raw[1].image, "https://cdn.example/101.jpg");
});

test("demo scraper is deterministic and well-formed", async () => {
  const dealer = { id: "demo-x", name: "Demo X", type: "demo", seedMakes: ["Toyota", "Honda"], inventorySize: 12 };
  const a = await scrapeDemoDealer(dealer);
  const b = await scrapeDemoDealer(dealer);
  assert.equal(a.length, 12);
  assert.deepEqual(a.map((x) => x.title), b.map((x) => x.title), "deterministic across runs");
  for (const l of a) {
    assert.ok(l.title && l.link && l.image.startsWith("data:image/svg+xml"));
    assert.ok(l.price > 0);
    assert.ok(["Toyota", "Honda"].includes(l.make));
  }
});
