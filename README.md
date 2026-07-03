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
npm run email       # send the daily digest now (updates since last email)
npm test            # run the test suite
```

## Manage your watchlist (web interface)

Open the **Watchlist** page at **http://localhost:3000/watchlist.html** (linked
from the dashboard nav) to submit the specific cars you're hunting for. Each
search captures make, model, trim, **color**, a year range, max price, max
mileage, and must-have **features** (e.g. AWD, Sunroof, Leather). Fill in only
what matters — blank fields match anything, and a listing must satisfy every
field you set. You can edit or delete searches at any time.

Searches are persisted in `data/watchlist.json` (seeded on first run from
`src/config/watchlist.js`) and every scan checks all dealers against them.

## Configure your watchlist (in code)

You can also edit `src/config/watchlist.js` (used to seed the database). Each
entry lists criteria; a listing matches when it satisfies every field present
(missing fields mean "any"):

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

Supported fields: `make`, `model`, `trim`, `color`, `features` (array),
`yearMin`, `yearMax`, `priceMin`, `priceMax`, `mileageMin`, `mileageMax`, and a
friendly `label`.

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

## Daily email digest (7am, automatically)

When the server is running it emails you a digest **every day at 7:00 AM
America/New_York** containing only the matches that are **new since the last
email**. The send time and timezone are configurable (`MAIL_HOUR`, `MAIL_TZ`).

Configure delivery with environment variables (nothing is committed):

```bash
export MAIL_TO="you@example.com"          # recipient
export MAIL_FROM="Car Monitor <bot@you.com>"
export SMTP_HOST="smtp.gmail.com"          # your SMTP server
export SMTP_PORT=587
export SMTP_USER="you@example.com"
export SMTP_PASS="app-password"
# Optional:
export MAIL_HOUR=7                          # local hour to send (default 7)
export MAIL_TZ="America/New_York"           # timezone (default ET)
export MAIL_SEND_EMPTY=false                # email even with no new matches
npm start
```

**Dry-run mode:** with no `SMTP_HOST` set, the platform still runs the full
pipeline but writes each email to `data/outbox/*.html` instead of sending, so you
can preview exactly what would go out.

Trigger a send yourself anytime:

- **Dashboard** → **Send test email**
- CLI: `npm run email`
- API: `POST /api/email/send` (and `GET /api/email/status` for the schedule)

**Stateless / serverless deployments:** if you don't keep the server running,
drive the digest from an external cron instead — it tracks "since the last email"
in `data/listings.json`, so it works the same way:

```cron
0 7 * * *  cd /path/to/car-dealer-monitor && npm run email
```

### One-off standalone digest

`npm run digest` writes a self-contained HTML file (inline styles + images) to
`data/digest.html` — handy to pipe into any mailer or hand to a provider API
(SendGrid, SES, Postmark). `GET /api/digest` returns the same HTML from the
running server.

## Deployment

To use the platform for real — a public URL and the 7am email firing on its own
— it needs to run somewhere always-on. The repo ships ready-to-use configs.

**Important:** the daily-email scheduler runs in-process, so the host must stay
awake. Disable any "scale to zero" / "auto-sleep" behavior (noted in each config
below), or drive the digest from an external cron instead (`0 7 * * * npm run
email`). State (dealers, watchlist, seen listings) lives under `DATA_DIR` — mount
a persistent disk there so it survives restarts and redeploys.

### Docker (self-host on any VPS)

```bash
cp .env.example .env      # add MAIL_TO + SMTP_* (optional; blank = dry-run)
docker compose up -d --build
# open http://<your-host>:3000
```

The `docker-compose.yml` mounts a named volume at `/data`, restarts on failure,
and reads email settings from `.env`. To build/run the image directly:

```bash
docker build -t car-dealer-monitor .
docker run -d -p 3000:3000 -v car-data:/data --env-file .env car-dealer-monitor
```

### Render (one-click)

`render.yaml` is a Blueprint. In the Render dashboard: **New → Blueprint** →
select this repo. It provisions a web service (health-checked at `/healthz`) with
a 1 GB persistent disk mounted at `/data`. Set the secret env vars (`MAIL_TO`,
`SMTP_*`) in the dashboard. (Persistent disks require a paid instance type.)

### Fly.io

```bash
fly launch --copy-config --now
fly secrets set MAIL_TO=you@example.com SMTP_HOST=... SMTP_USER=... SMTP_PASS=...
fly deploy
```

`fly.toml` mounts a volume at `/data`, health-checks `/healthz`, and keeps
`min_machines_running = 1` with `auto_stop_machines = false` so the 7am email
fires.

### Any Node host (Railway, Heroku-style, bare metal)

A `Procfile` (`web: npm start`) covers buildpack platforms. Anywhere Node 20+
runs, `npm ci && npm start` works; set `DATA_DIR` to a writable, persistent path.

### Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where JSON databases + outbox are stored (mount a disk) |
| `SCAN_INTERVAL_MS` | `1800000` | Scan cadence (30 min) |
| `MAIL_TO` | — | Digest recipient(s) |
| `MAIL_FROM` | `Car Dealer Monitor <no-reply@localhost>` | From header |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_SECURE` | — | SMTP delivery (blank host = dry-run) |
| `MAIL_HOUR` / `MAIL_TZ` | `7` / `America/New_York` | Daily send time |
| `MAIL_SEND_EMPTY` | `false` | Email even with no new matches |

## Architecture

```
src/
  config/
    watchlist.js     seed watchlist (loaded into the database on first run)
    dealers.js       seed dealers (loaded into the database on first run)
    notifications.js email/schedule config (from env vars)
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
    watchlistStore.js watchlist database (CRUD, validation, seeding)
    monitor.js       one scan cycle + scheduler
    emailer.js       daily "since last email" digest + 7am scheduler
  summary.js         standalone HTML digest renderer
  email.js           SMTP transport (nodemailer) + dry-run outbox
  server.js          Express API + serves the dashboard
  cli.js             scan / digest / watchlist / email commands
public/
  index.html/app.js     dashboard
  watchlist.html/js      watchlist management interface
  dealers.html/js        dealer management interface
test/                unit tests
```

## API

| Endpoint                 | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `GET /healthz`           | Health check for load balancers / platform probes  |
| `GET /api/listings`      | Current matched, active listings (+ metadata)      |
| `GET /api/status`        | Last scan time, counts, recent scan history        |
| `GET /api/watchlist`     | List all watchlist searches                        |
| `GET /api/watchlist/:id` | Get one watchlist search                            |
| `POST /api/watchlist`    | Add a search (make/model/color/features/year/price)|
| `PUT /api/watchlist/:id` | Update a search                                     |
| `DELETE /api/watchlist/:id`| Remove a search                                   |
| `GET /api/dealers`       | List all dealers in the database                   |
| `GET /api/dealers/:id`   | Get one dealer                                      |
| `POST /api/dealers`      | Add a dealer (`{ name, type, url, selectors? }`)   |
| `PUT /api/dealers/:id`   | Update a dealer (e.g. `{ enabled: false }`)        |
| `DELETE /api/dealers/:id`| Remove a dealer                                     |
| `POST /api/dealers/test` | Test-scrape a dealer config without saving         |
| `POST /api/scan`         | Trigger a scan immediately                         |
| `GET /api/digest`        | Standalone HTML summary of matches                 |
| `GET /api/email/status`  | Email schedule, recipient, last/next send          |
| `POST /api/email/send`   | Send the daily digest now (updates since last email)|

## License

MIT
