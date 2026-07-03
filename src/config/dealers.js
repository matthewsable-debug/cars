// The dealer websites to monitor.
//
// Two adapter types are supported out of the box:
//
//   type: "html"   Fetches the dealer's site and extracts vehicles using CSS
//                  selectors. Set `url` to the dealer's MAIN website — the app
//                  automatically discovers the inventory page deeper in the site
//                  (and caches it as `inventoryUrl`). Because every dealer's
//                  markup differs, the selectors below are examples; sensible
//                  defaults are applied when omitted. Cars marked sold / sale
//                  pending are automatically excluded.
//
//   type: "browser" Same as "html", but fetches pages with a real headless
//                  browser (Playwright/Chromium). Use this for sites that render
//                  inventory with JavaScript or block plain HTTP requests with
//                  bot protection (a 403 to non-browser clients). Heavier, but it
//                  behaves like a real browser.
//
//   type: "demo"   Generates realistic sample inventory locally. This lets the
//                  platform run end-to-end with no network access so you can see
//                  the dashboard, matching, and digests working immediately.
//                  Remove or disable these once your real dealers are configured.
//
// You can also register fully custom adapters in code (see src/scrapers/index.js).

export const dealers = [
  {
    id: "demo-metro-auto",
    name: "Metro Auto Group (demo)",
    type: "demo",
    enabled: true,
    // The demo adapter fabricates a spread of inventory around these makes.
    seedMakes: ["Toyota", "Honda", "Subaru", "Mazda", "Tesla", "Ford", "BMW"],
    inventorySize: 40,
  },
  {
    id: "demo-sunset-motors",
    name: "Sunset Motors (demo)",
    type: "demo",
    enabled: true,
    seedMakes: ["Toyota", "Tesla", "Subaru", "Chevrolet", "Honda"],
    inventorySize: 30,
  },

  {
    id: "european-collectibles",
    name: "European Collectibles",
    // Bot-protected classic-car dealer; use the browser scraper. Inventory is at
    // /vehicles (set explicitly to skip discovery). Vehicles are auto-detected.
    type: "browser",
    enabled: true,
    url: "https://www.europeancollectibles.com/",
    inventoryUrl: "https://www.europeancollectibles.com/vehicles",
  },
  {
    id: "cultivated-collector",
    name: "The Cultivated Collector",
    // Bot-protected classic/exotic dealer; browser scraper + auto-detection.
    type: "browser",
    enabled: true,
    url: "https://thecultivatedcollector.com/",
  },
  {
    id: "copley-west",
    name: "Copley West",
    // copleywest.com is JavaScript-rendered and behind bot protection, so it
    // needs the headless-browser scraper. No selectors: vehicles are
    // auto-detected. Inventory lives at /showroom/.
    type: "browser",
    enabled: true,
    url: "https://www.copleywest.com/",
  },

  // ---- Example real-dealer configuration (disabled by default) --------------
  // Enable and adapt the selectors to a real inventory page to go live.
  {
    id: "example-html-dealer",
    name: "Example Dealer (HTML)",
    type: "html",
    enabled: false,
    // `url` is the dealer's MAIN website. The app auto-discovers the inventory
    // page deeper in the site and caches it as `inventoryUrl`. (You can still
    // set `inventoryUrl` explicitly here to skip discovery.)
    url: "https://www.example-dealer.com",
    // Optional: how to page through results. `{page}` is substituted.
    pagination: { param: "?page={page}", maxPages: 3 },
    selectors: {
      // A selector matching each vehicle card on the page.
      card: ".inventory-card, .vehicle-card, li.vehicle",
      // Fields extracted relative to each card. `attr` pulls an attribute
      // instead of text; `regex` (optional) extracts a capture group.
      title: { sel: ".vehicle-title, h2 a" },
      price: { sel: ".price, .vehicle-price" },
      mileage: { sel: ".mileage, .odometer" },
      year: { sel: ".vehicle-title, h2 a", regex: "(19|20)\\d{2}" },
      link: { sel: "a.vehicle-link, h2 a", attr: "href" },
      image: { sel: "img", attr: "src" },
    },
  },
];

export default dealers;
