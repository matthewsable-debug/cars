// The dealer websites to monitor.
//
// Two adapter types are supported out of the box:
//
//   type: "html"   Fetches a listing/inventory page and extracts vehicles using
//                  CSS selectors. Configure `url` and `selectors`. This works
//                  against most server-rendered dealer inventory pages. Because
//                  every dealer's markup differs, the selectors below are
//                  examples — copy a dealer's inventory URL, inspect the page,
//                  and fill in the selectors that match its listing cards.
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

  // ---- Example real-dealer configuration (disabled by default) --------------
  // Enable and adapt the selectors to a real inventory page to go live.
  {
    id: "example-html-dealer",
    name: "Example Dealer (HTML)",
    type: "html",
    enabled: false,
    url: "https://www.example-dealer.com/inventory/used",
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
