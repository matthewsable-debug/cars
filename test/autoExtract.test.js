import { test } from "node:test";
import assert from "node:assert/strict";
import { autoExtractListings } from "../src/scrapers/autoExtract.js";
import { scrapeDealer } from "../src/scrapers/index.js";

const JSONLD_PAGE = `<!doctype html><html><head>
<script type="application/ld+json">
{ "@context":"https://schema.org", "@graph": [
  { "@type":"Car", "name":"1985 Audi Sport Quattro SWB",
    "brand":{"@type":"Brand","name":"Audi"}, "model":"Sport Quattro",
    "vehicleModelDate":"1985", "color":"White",
    "mileageFromOdometer":{"@type":"QuantitativeValue","value":24000},
    "url":"/showroom/1985-audi-sport-quattro-swb/",
    "image":"https://cdn.example/1.jpg",
    "offers":{"@type":"Offer","price":"450000","priceCurrency":"USD","availability":"https://schema.org/InStock"} },
  { "@type":"Car", "name":"1990 Audi Quattro 20V",
    "brand":{"name":"Audi"}, "vehicleModelDate":"1990",
    "url":"/showroom/1990-audi-quattro-20v/",
    "offers":{"price":85000,"availability":"https://schema.org/SoldOut"} }
]}
</script></head><body></body></html>`;

test("auto-extract reads schema.org JSON-LD vehicles", () => {
  const items = autoExtractListings(JSONLD_PAGE, "https://dealer.test/showroom/");
  assert.equal(items.length, 2);
  const a = items[0];
  assert.equal(a.title, "1985 Audi Sport Quattro SWB");
  assert.equal(a.make, "Audi");
  assert.equal(a.year, 1985);
  assert.equal(a.price, 450000);
  assert.equal(a.mileage, 24000);
  assert.equal(a.link, "https://dealer.test/showroom/1985-audi-sport-quattro-swb/");
  assert.equal(a.image, "https://cdn.example/1.jpg");
  // The SoldOut offer is flagged (and filtered out downstream).
  assert.equal(items[1].sold, true);
});

const DOM_PAGE = `<!doctype html><html><body>
  <div class="results">
    <article class="card-x">
      <a href="/inventory/2019-toyota-tacoma-123"><h3>2019 Toyota Tacoma TRD</h3></a>
      <img src="/img/tacoma.jpg">
      <span class="pricing">$34,995</span>
      <div class="odo">42,100 miles</div>
    </article>
    <article class="card-x">
      <a href="/inventory/2021-honda-civic-456"><h3>2021 Honda Civic</h3></a>
      <img data-src="/img/civic.jpg">
      <span class="pricing">$21,500</span>
      <div class="odo">18,000 miles</div>
    </article>
    <a href="/about">About us</a>
  </div>
</body></html>`;

test("auto-extract falls back to a DOM heuristic (price + year + detail link)", () => {
  const items = autoExtractListings(DOM_PAGE, "https://dealer.test/inventory");
  assert.equal(items.length, 2);
  const t = items.find((i) => /Tacoma/.test(i.title));
  assert.equal(t.price, "$34,995");
  assert.equal(t.year, "2019");
  assert.equal(t.mileage, "42,100");
  assert.equal(t.link, "https://dealer.test/inventory/2019-toyota-tacoma-123");
  assert.equal(t.image, "https://dealer.test/img/tacoma.jpg");
});

test("scrapeDealer works with NO selectors via auto-extraction", async () => {
  const dealer = {
    id: "auto",
    name: "Auto Dealer",
    type: "html",
    url: "https://dealer.test/",
    inventoryUrl: "https://dealer.test/inventory", // skip discovery
  };
  const fetchImpl = async () => DOM_PAGE;
  const result = await scrapeDealer(dealer, { fetchImpl });
  assert.equal(result.error, null);
  assert.equal(result.listings.length, 2);
  assert.equal(result.listings[0].make, "Toyota");
  assert.ok(result.listings[0].price > 0);
});
