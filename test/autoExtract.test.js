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

test("JSON feed with no prices (Price on request) is still read", () => {
  const feed = JSON.stringify([
    { year: 1973, make: "Porsche", model: "911 Carrera RS", url: "/vehicles/1", photo: "/i/1.jpg" },
    { year: 1961, make: "Jaguar", model: "E-Type", url: "/vehicles/2" },
    { about: "European Collectibles, founded in 1986", url: "/about" },
  ]);
  const items = extractListingsFromJson(feed, "https://dealer.test/vehicles.json");
  assert.equal(items.length, 2, "two priced-less vehicles, not the about record");
  assert.equal(items[0].make, "Porsche");
  assert.equal(items[0].price, null);
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

const NOISE_PAGE = `<!doctype html><html><body>
  <div class="grid">
    <div class="v">
      <a href="/vehicles/123-1973-porsche-911"><img src="/i/1.jpg"><h3>1973 Porsche 911 Carrera</h3></a>
      <span class="p">Price on request</span>
    </div>
    <div class="promo"><a href="/about"><img src="/logo.png">European Collectibles — founded in 1986</a></div>
    <footer><a href="/"><img src="/px.gif">© 2024 European Collectibles. All rights reserved.</a></footer>
  </div>
</body></html>`;

test("DOM heuristic ignores marketing/copyright years, keeps real cars", () => {
  const items = autoExtractListings(NOISE_PAGE, "https://dealer.test/vehicles");
  assert.equal(items.length, 1, "only the real vehicle, not the 1986/2024 blurbs");
  assert.match(items[0].title, /Porsche 911/);
  assert.equal(items[0].link, "https://dealer.test/vehicles/123-1973-porsche-911");
});

test("scrapeDealer crawls a hub inventory page into model sub-pages", async () => {
  // A "hub" /inventory/ page that only links to model categories (no cars),
  // each of which lists actual vehicles — like Sloan Motor Cars.
  const HUB = `<html><body>
    <a href="/inventory/porsche-911/"><img src="/c/911.jpg">911</a>
    <a href="/inventory/porsche-993/"><img src="/c/993.jpg">993</a>
    <a href="/about">About</a>
  </body></html>`;
  const P911 = `<html><body>
    <div class="car"><a href="/inventory/porsche-911/1973-carrera-rs/"><img src="/v/1.jpg"><h3>1973 Porsche 911 Carrera RS</h3></a><span>$895,000</span></div>
  </body></html>`;
  const P993 = `<html><body>
    <div class="car"><a href="/inventory/porsche-993/1995-turbo/"><img src="/v/2.jpg"><h3>1995 Porsche 993 Turbo</h3></a><span>Inquire</span></div>
  </body></html>`;
  const fetchImpl = async (url) => {
    if (/\/inventory\/porsche-911\/?$/.test(url)) return P911;
    if (/\/inventory\/porsche-993\/?$/.test(url)) return P993;
    if (/\/inventory\/?$/.test(url)) return HUB;
    if (url.replace(/\/$/, "").endsWith("sloan.test")) return HUB;
    throw new Error("404 " + url);
  };
  const dealer = {
    id: "sloan", name: "Sloan", type: "html",
    url: "https://sloan.test/", inventoryUrl: "https://sloan.test/inventory/",
  };
  const result = await scrapeDealer(dealer, { fetchImpl });
  assert.equal(result.error, null);
  assert.equal(result.listings.length, 2, "aggregated cars from both model pages");
  assert.ok(result.listings.every((l) => matchesEntryPorsche(l)));
});
// A model page (e.g. /inventory/porsche-930/) that lists MANY cars, where each
// car's link is a plain title link and its photo sits in a separate wrapper.
// The old "climb to the nearest ancestor with an image + year" heuristic
// collapsed every card into the one shared grid container and returned a single
// car; the per-leaf-link path must recover all of them, with correct sold flags
// even when minified markup abuts the SOLD badge to a price/title.
const LIST_PAGE = `<!doctype html><html><body><section class="grid">
  <div class="card"><div class="media"><img src="/1.jpg"></div><a class="title" href="/inventory/porsche-930/1989-porsche-930-s-slantnose">1989 930 S Slantnose</a><div class="price">$295,500</div></div>
  <div class="card"><div class="media"><img src="/2.jpg"></div><a class="title" href="/inventory/porsche-930/1988-porsche-930-coupe">1988 930 Coupe</a><div class="price">$189,000</div><span class="badge">SOLD</span></div>
  <div class="card"><div class="media"><img src="/3.jpg"></div><a class="title" href="/inventory/porsche-930/1987-porsche-930-targa">1987 930 Targa</a><div class="price">$210,000</div></div>
  <div class="card"><div class="media"><img src="/4.jpg"></div><a class="title" href="/inventory/porsche-930/1986-porsche-930-cab">1986 930 Cabriolet</a><span class="badge">SOLD</span></div>
</section><footer><a href="/inventory/porsche-911/">More 911s</a></footer></body></html>`;

test("per-leaf-link extraction recovers a full list page (not just one card)", () => {
  const items = autoExtractListings(LIST_PAGE, "https://sloan.test/inventory/porsche-930/");
  assert.equal(items.length, 4, "one listing per car, not collapsed to a single card");
  const sold = items.filter((i) => i.sold);
  assert.equal(sold.length, 2, "both SOLD badges detected despite abutting markup");
  // The footer category link (/inventory/porsche-911/, no year) is not a car.
  assert.ok(items.every((i) => /porsche-930/.test(i.link)));
});

test("model CATEGORY links (no year in slug) are not mistaken for cars", () => {
  const HUB = `<html><body>
    <a href="/inventory/porsche-930/"><img src="/c/930.jpg">930</a>
    <a href="/inventory/porsche-991/"><img src="/c/991.jpg">991</a>
  </body></html>`;
  assert.equal(autoExtractListings(HUB, "https://sloan.test/inventory/").length, 0);
});

function matchesEntryPorsche(l) {
  return /Porsche/i.test(l.title);
}

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
