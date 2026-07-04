import { chromium } from "playwright";

// Renders pages in a real headless Chromium via Playwright. Use this for dealer
// sites that render inventory with JavaScript and/or block plain HTTP requests
// with bot protection (they serve a 403 to non-browser clients). The rendered
// HTML is handed back to the same Cheerio-based extraction the `html` scraper
// uses, so selectors and sold-detection behave identically.
//
// The browser is launched lazily and reused across pages within a scan, then
// closed by the monitor when the scan finishes (see closeBrowser).

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        // --no-sandbox is required when running as root in a container.
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled",
        ],
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
          : {}),
      })
      .catch((err) => {
        // Don't cache a rejected promise — allow a later retry — and give a
        // clear hint (Chromium missing on hosts that didn't install it).
        browserPromise = null;
        throw new Error(
          `headless browser unavailable (${err.message.split("\n")[0]}). ` +
            `On Render/Heroku native runtimes, deploy with the Docker image so Chromium is installed.`
        );
      });
  }
  return browserPromise;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Fetch a URL's fully-rendered HTML. Matches the fetchText(url) signature so it
// can be dropped in as the scraper/discovery fetch implementation.
export async function renderPage(url, { waitSelector, timeoutMs = 20000, quick = false } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  // Reduce the most obvious automation signal some bot checks look for.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  try {
    // page.goto only throws on NETWORK errors, not HTTP 4xx/5xx — so a bot-block
    // (403) or missing page would otherwise return a blank body and masquerade as
    // "0 vehicles". Capture the status and fail loudly instead.
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const status = resp ? resp.status() : 0;
    // Give JS-rendered inventory a brief chance to populate, then return. Kept
    // short so crawling several pages stays fast.
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: quick ? 3000 : 6000 }).catch(() => {});
    }
    // `quick` uses shorter settle times — used when crawling many sub-pages via
    // the browser so a whole hub of model pages fits within the request budget.
    await page.waitForLoadState("networkidle", { timeout: quick ? 2000 : 5000 }).catch(() => {});
    await page.waitForTimeout(quick ? 200 : 400);
    const html = await page.content();
    if (status >= 400) {
      const hint = status === 403 || status === 429 ? " — likely bot protection blocking headless Chromium" : "";
      throw new Error(`HTTP ${status} from ${url}${hint}`);
    }
    return html;
  } finally {
    await context.close().catch(() => {});
  }
}

// Fetch a JSON feed from inside the dealer's page. We first load a same-origin
// page (which clears the bot check the way a real visitor does), then run the
// site's own `fetch` for each candidate URL and return the first JSON response.
// This reliably reaches Rails-style `/vehicles.json` feeds behind bot protection.
export async function browserFetchJson(pageUrl, urls) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: UA,
    locale: "en-US",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    return await page.evaluate(async (list) => {
      for (const u of list) {
        try {
          const r = await fetch(u, { headers: { Accept: "application/json" } });
          if (!r.ok) continue;
          const t = await r.text();
          const s = t.trim();
          if (s && (s[0] === "{" || s[0] === "[")) return t;
        } catch {
          /* try next */
        }
      }
      return null;
    }, urls);
  } finally {
    await context.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const current = browserPromise;
  browserPromise = null;
  try {
    const browser = await current;
    await browser.close();
  } catch {
    /* already gone */
  }
}
