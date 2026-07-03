import { test } from "node:test";
import assert from "node:assert/strict";
import { autoExtractListings, extractListingsFromJson } from "../src/scrapers/autoExtract.js";
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

const NEXT_PAGE = `<!doctype html><html><body>
<div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"inventory":{"vehicles":[
  {"id":1,"year":1973,"make":"Porsche","model":"911 Carrera RS","price":895000,"mileage":42000,
   "exteriorColor":"Grand Prix White","slug":"/vehicles/1973-porsche-911-carrera-rs",
   "images":[{"url":"/img/rs.jpg"}],"status":"available"},
  {"id":2,"year":1965,"make":"Shelby","model":"Cobra","salePrice":"1250000",
   "url":"/vehicles/1965-shelby-cobra","thumbnail":"/img/cobra.jpg","status":"sold"}
]}}},"page":"/vehicles"}
</script></body></html>`;

test("auto-extract reads embedded Next.js JSON (__NEXT_DATA__)", () => {
  const items = autoExtractListings(NEXT_PAGE, "https://dealer.test/vehicles");
  assert.equal(items.length, 2);
  const rs = items.find((i) => /Carrera RS/.test(i.title));
  assert.equal(rs.make, "Porsche");
  assert.equal(rs.year, 1973);
  assert.equal(rs.price, 895000);
  assert.equal(rs.mileage, 42000);
  assert.equal(rs.color, "Grand Prix White");
  assert.equal(rs.link, "https://dealer.test/vehicles/1973-porsche-911-carrera-rs");
  assert.equal(rs.image, "https://dealer.test/img/rs.jpg");
  assert.equal(items.find((i) => /Cobra/.test(i.title)).sold, true);
});

const POA_PAGE = `<!doctype html><html><body>
  <div class="results">
    <div class="v-card">
      <a href="/vehicles/123-1973-porsche-911-carrera-rs"><h3>1973 Porsche 911 Carrera RS</h3></a>
      <img src="/img/rs.jpg">
      <span class="price">Price on request</span>
    </div>
    <div class="v-card">
      <a href="/vehicles/456-1965-shelby-cobra"><h3>1965 Shelby Cobra</h3></a>
      <img src="/img/cobra.jpg">
      <div class="status">Inquire</div>
    </div>
    <a href="/about">About</a>
  </div>
</body></html>`;

test("auto-extract catches classic cars with no listed price (Price on request)", () => {
  const items = autoExtractListings(POA_PAGE, "https://dealer.test/vehicles");
  assert.equal(items.length, 2);
  const rs = items.find((i) => /Carrera RS/.test(i.title));
  assert.equal(rs.title, "1973 Porsche 911 Carrera RS");
  assert.equal(rs.price, null); // POA — no number, still detected
  assert.equal(rs.link, "https://dealer.test/vehicles/123-1973-porsche-911-carrera-rs");
  assert.equal(rs.image, "https://dealer.test/img/rs.jpg");
});

const VEHICLES_JSON = JSON.stringify({
  vehicles: [
    { year: 1973, make: "Porsche", model: "911 Carrera RS", price: 895000, mileage: 42000,
      exterior_color: "White", url: "/vehicles/123-1973-porsche", photos: [{ url: "/img/1.jpg" }], status: "available" },
    { year: 1965, make: "Shelby", model: "Cobra", price: 1250000, url: "/vehicles/456-1965-shelby", status: "sold" },
    { year: 1990, make: "Ferrari", model: "F40", price: 3200000, url: "/vehicles/789-1990-ferrari" },
  ],
});

test("extractListingsFromJson reads a Rails-style vehicles feed", () => {
  const items = extractListingsFromJson(VEHICLES_JSON, "https://dealer.test/vehicles.json");
  assert.equal(items.length, 3);
  const p = items.find((i) => /Porsche/.test(i.title || i.make));
  assert.equal(p.make, "Porsche");
  assert.equal(p.year, 1973);
  assert.equal(p.price, 895000);
  assert.equal(p.link, "https://dealer.test/vehicles/123-1973-porsche");
  assert.equal(p.image, "https://dealer.test/img/1.jpg");
  assert.equal(items.find((i) => /Shelby/.test(i.make)).sold, true);
});

test("scrapeDealer prefers a JSON feed and filters sold cars", async () => {
  const dealer = {
    id: "ec", name: "European Collectibles", type: "browser",
    url: "https://dealer.test/", inventoryUrl: "https://dealer.test/vehicles",
  };
  // Inject the JSON feed (stands in for the in-browser fetch of /vehicles.json).
  const result = await scrapeDealer(dealer, { jsonFetch: async () => VEHICLES_JSON });
  assert.equal(result.source, "json");
  assert.equal(result.listings.length, 2, "3 in feed minus 1 sold");
  assert.ok(result.listings.every((l) => !l.sold));
  assert.ok(result.listings.some((l) => l.make === "Ferrari"));
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
