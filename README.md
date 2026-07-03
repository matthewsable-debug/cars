# 🚗 Car Dealer Monitor

A platform that monitors multiple car dealer websites for a watchlist of cars
you care about, then delivers the results as a photo summary with clickable
links — both a live web **dashboard** and an emailable **digest**.

It runs end-to-end out of the box using built-in demo dealers (no network or API
keys required), so you can see everything working immediately, then swap in real
dealer inventory pages when you're ready.

The dashboard shows matched vehicles as photo cards — price, mileage, dealer,
watchlist-match chips, and a clickable link to each listing — with search,
filter, and sort controls, plus a **Scan now** button.

## What it does

- **Watch a list of cars** — define target make/model/trim/year/price/mileage in
  a simple config (`src/config/watchlist.js`).
- **Monitor many dealers** — pluggable scraper adapters (`src/config/dealers.js`).
  A config-driven HTML scraper handles most server-rendered inventory pages; demo
  dealers generate realistic sample inventory for instant testing.
- **Match & de-duplicate** — every listing is normalized and matched against your
  watchlist. Listings are tracked across scans, so genuinely **new** arrivals are
  flagged.
- **Deliver summaries** — a filterable web dashboard and a self-contained HTML
  digest, both with **photos** and **clickable links** to each listing.
- **Run on a schedule** — the server scans automatically at a configurable
  interval; you can also scan on demand.

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

- Dashboard: `http://localhost:3000/`
- Emailable digest: `http://localhost:3000/api/digest`

The server runs a scan on startup and every 30 minutes after (configurable via
`SCAN_INTERVAL_MS`). Use the **Scan now** button to refresh on demand.

## Command line

```bash
npm run scan        # run one scan and print matches to the terminal
npm run digest      # write a standalone HTML summary to data/digest.html
npm run watchlist   # print your current watchlist
npm test            # run the test suite
```

## Configure your watchlist

Edit `src/config/watchlist.js`. Each entry lists criteria; a listing matches when
it satisfies every field present (missing fields mean "any"):

```js
{
  label: "Toyota Tacoma (low miles)",
  make: "Toyota",
  model: "Tacoma",
  yearMin: 2019,
  priceMax: 42000,
  mileageMax: 60000,
}
```

Supported fields: `make`, `model`, `trim`, `yearMin`, `yearMax`, `priceMin`,
`priceMax`, `mileageMin`, `mileageMax`, and a friendly `label`.

## Manage dealers (web interface)

The easiest way to add and manage dealers is the built-in **Dealers** page at
**http://localhost:3000/dealers.html** (linked from the dashboard nav). From
there you can:

- **Submit a dealer website** — enter a name and its inventory page URL. Sensible
  extraction selectors are applied by default; expand **Advanced** to customize
  them.
- **Test before saving** — the **Test scrape** button fetches the page and reports
  how many vehicles it found (and the first one), so you can validate the URL and
  selectors up front.
- **Enable / disable** a dealer without deleting it (toggle the switch).
- **Edit** or **Delete** any dealer.

Dealers are persisted in a JSON database at `data/dealers.json`, seeded on first
run from `src/config/dealers.js`. Once seeded, the database is the source of truth
and every scan reads from it, so changes take effect on the next cycle (or the
next **Scan now**).

## Configure dealers (in code)

You can also edit `src/config/dealers.js` (used to seed the database). To monitor
a real dealer, add an `html` dealer and point the selectors at its inventory
page's listing cards:

```js
{
  id: "my-dealer",
  name: "My Local Dealer",
  type: "html",
  enabled: true,
  url: "https://www.mydealer.com/inventory/used",
  pagination: { param: "?page={page}", maxPages: 3 },
  selectors: {
    card:    ".vehicle-card",
    title:   { sel: ".vehicle-title" },
    price:   { sel: ".price" },
    mileage: { sel: ".mileage" },
    year:    { sel: ".vehicle-title", regex: "(19|20)\\d{2}" },
    link:    { sel: "a.vehicle-link", attr: "href" },
    image:   { sel: "img", attr: "src" },
  },
}
```

Tips for filling in selectors: open the dealer's inventory page, right-click a
listing card → **Inspect**, and copy the class names for the card and each field.
Relative `href`/`src` values are resolved automatically. Disable the demo dealers
once your real ones are configured.

> Please respect each site's Terms of Service and `robots.txt`, and keep scan
> intervals reasonable.

### Custom adapters

For sites that need JavaScript rendering or a JSON API, register your own adapter
in code:

```js
import { registerAdapter } from "./src/scrapers/index.js";
registerAdapter("myapi", async (dealer) => {
  // return an array of raw listings: { title, price, mileage, year, link, image }
});
```

## Delivering the digest by email

`npm run digest` writes a fully self-contained HTML file (inline styles and
images) to `data/digest.html`. Because it's standalone, you can pipe it straight
into any mailer. Example with a local `sendmail`:

```bash
npm run digest && (
  echo "To: you@example.com"
  echo "Subject: Your car watch summary"
  echo "Content-Type: text/html"
  echo
  cat data/digest.html
) | sendmail -t
```

Or fetch `GET /api/digest` from the running server and hand the HTML to your email
provider's API (SendGrid, SES, Postmark, etc.).

## Architecture

```
src/
  config/
    watchlist.js     the cars you want (criteria)
    dealers.js       seed dealers (loaded into the database on first run)
  scrapers/
    index.js         adapter registry + orchestration
    http.js          fetch wrapper (UA, timeout, retry)
    htmlScraper.js   config-driven CSS-selector scraper
    demoScraper.js   realistic offline sample inventory
  core/
    listing.js       normalize + parse listings, stable ids
    matcher.js       match listings against the watchlist
    store.js         JSON persistence + new-listing detection
    dealerStore.js   dealer database (CRUD, validation, seeding)
    monitor.js       one scan cycle + scheduler
  summary.js         standalone HTML digest renderer
  server.js          Express API + serves the dashboard
  cli.js             scan / digest / watchlist commands
public/
  index.html/app.js  dashboard
  dealers.html/js     dealer management interface
test/                unit tests
```

## API

| Endpoint                 | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `GET /api/listings`      | Current matched, active listings (+ metadata)      |
| `GET /api/status`        | Last scan time, counts, recent scan history        |
| `GET /api/watchlist`     | The configured watchlist                           |
| `GET /api/dealers`       | List all dealers in the database                   |
| `GET /api/dealers/:id`   | Get one dealer                                      |
| `POST /api/dealers`      | Add a dealer (`{ name, type, url, selectors? }`)   |
| `PUT /api/dealers/:id`   | Update a dealer (e.g. `{ enabled: false }`)        |
| `DELETE /api/dealers/:id`| Remove a dealer                                     |
| `POST /api/dealers/test` | Test-scrape a dealer config without saving         |
| `POST /api/scan`         | Trigger a scan immediately                         |
| `GET /api/digest`        | Standalone HTML summary of matches                 |

## License

MIT
