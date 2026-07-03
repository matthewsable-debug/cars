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
    browserPromise = chromium.launch({
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
    });
  }
  return browserPromise;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Fetch a URL's fully-rendered HTML. Matches the fetchText(url) signature so it
// can be dropped in as the scraper/discovery fetch implementation.
export async function renderPage(url, { waitSelector, timeoutMs = 30000 } = {}) {
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
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Give JS-rendered inventory a chance to populate.
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 8000 }).catch(() => {});
    }
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    return await page.content();
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
