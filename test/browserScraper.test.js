import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { scrapeDealer, closeBrowser } from "../src/scrapers/index.js";
import { matchesEntry } from "../src/core/matcher.js";

// End-to-end test of the headless-browser scraper against a locally served,
// JavaScript-rendered "dealer" site. Skips automatically if a browser can't be
// launched (e.g. CI without the Chromium download), so it never blocks the suite.

async function browserAvailable() {
  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
        : {}),
    });
    await b.close();
    return true;
  } catch {
    return false;
  }
}

// Homepage links to /showroom; the showroom builds its vehicle cards with JS,
// so a static fetch would see nothing — only a real browser renders them.
function startSite() {
  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url.startsWith("/?")) {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><html><body>
        <a href="/about">About</a>
        <a href="/showroom/">The Showroom</a>
      </body></html>`);
    } else if (req.url.startsWith("/showroom")) {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><html><body>
        <div id="grid"></div>
        <script>
          const cars = [
            { t: "1985 Audi Sport Quattro SWB", p: "$450,000", href: "/showroom/1985-audi-sport-quattro-swb/" },
            { t: "1990 Audi Quattro 20V", p: "$85,000", href: "/showroom/1990-audi-quattro-20v/" }
          ];
          document.getElementById("grid").innerHTML = cars.map(c =>
            '<div class="vehicle-card"><a class="vehicle-link" href="'+c.href+'">' +
            '<h2 class="vehicle-title">'+c.t+'</h2></a><span class="price">'+c.p+'</span></div>'
          ).join("");
        </script>
      </body></html>`);
    } else {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// An inventory page that paints its grid from an XHR to a JSON API — the cars
// are never in the DOM as parseable cards, only in the captured API response.
function startApiSite() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/inventory.json")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          vehicles: [
            { year: 1973, make: "Porsche", model: "911 Carrera RS", price: 895000, url: "/inventory/1973-911-carrera-rs" },
            { year: 1995, make: "Porsche", model: "993 Turbo", price: 210000, url: "/inventory/1995-993-turbo" },
            { year: 1988, make: "Porsche", model: "930 Slantnose", price: 295000, url: "/inventory/1988-930-slantnose" },
          ],
        })
      );
    } else if (req.url.startsWith("/inventory")) {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><html><body><div id="grid">Loading…</div>
        <script>fetch('/api/inventory.json').then(r=>r.json()).then(d=>{
          document.getElementById('grid').textContent = d.vehicles.length + ' cars';
        });</script>
      </body></html>`);
    } else {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("browser scraper captures a JSON API response and reads cars from it", async (t) => {
  if (!(await browserAvailable())) {
    t.skip("headless browser not available");
    return;
  }
  const server = await startApiSite();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/`;
  const dealer = {
    id: "api-test",
    name: "API Test",
    type: "browser",
    url: base,
    inventoryUrl: `${base}inventory`, // skip discovery; go straight to the page
  };
  try {
    const result = await scrapeDealer(dealer, { debug: true });
    assert.equal(result.error, null);
    assert.equal(result.listings.length, 3, "cars read from the captured API JSON");
    assert.ok(result.listings.every((l) => /Porsche/i.test(`${l.make} ${l.title}`)));
    const bdbg = (result.attemptDebug || []).find((d) => d.fetchMode === "browser");
    assert.ok(bdbg && bdbg.apiFeeds >= 1, "an API feed was captured");
  } finally {
    await closeBrowser();
    server.close();
  }
});

test("browser scraper renders JS inventory and auto-discovers the showroom", async (t) => {
  if (!(await browserAvailable())) {
    t.skip("headless browser not available");
    return;
  }
  const server = await startSite();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/`;

  const dealer = {
    id: "copley-test",
    name: "Copley Test",
    type: "browser",
    url: base,
    selectors: {
      card: ".vehicle-card",
      title: { sel: ".vehicle-title" },
      price: { sel: ".price" },
      link: { sel: "a.vehicle-link", attr: "href" },
      year: { sel: ".vehicle-title", regex: "(19|20)\\d{2}" },
    },
  };

  try {
    const result = await scrapeDealer(dealer);
    assert.equal(result.error, null);
    assert.match(result.discoveredInventoryUrl, /\/showroom/);
    assert.equal(result.listings.length, 2, "JS-rendered cards were scraped");
    assert.equal(result.listings[0].make, "Audi");
    assert.ok(result.listings[0].price > 0);
    // The "Audi Quattro" watchlist search matches these (Quattro is in the title).
    assert.ok(
      result.listings.every((l) => matchesEntry(l, { make: "Audi", model: "Quattro" })),
      "Audi Quattro watchlist entry matches the scraped cars"
    );
  } finally {
    await closeBrowser();
    server.close();
  }
});
