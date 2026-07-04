import * as cheerio from "cheerio";
import { fetchText } from "./http.js";

// Given a dealer's MAIN website URL, automatically find the inventory / used-cars
// listing page deeper in the site. Dealers differ wildly, so we:
//   1. Check whether the homepage itself already shows vehicle cards.
//   2. Otherwise rank same-site links by inventory-ish keywords in the URL/text.
//   3. Verify the top candidates actually contain vehicle cards (when we know the
//      card selector), returning the first that does.
//   4. Fall back to the best-scored link, or the homepage.

const STRONG = [
  "inventory", "used-cars", "used-car", "used-vehicles", "used-vehicle",
  "preowned", "pre-owned", "for-sale", "all-inventory", "vehicle-search",
  "used-inventory", "shop-used",
];
const MEDIUM = ["used", "vehicles", "showroom", "browse", "listings", "stock", "search", "shop"];

export async function discoverInventoryUrl(
  homeUrl,
  { fetchImpl = fetchText, cardSelector, countListings } = {}
) {
  const home = safeUrl(homeUrl);
  if (!home) return { url: homeUrl, candidates: [], error: "Invalid URL" };

  // How many listings a page contains: by the dealer's card selector if given,
  // otherwise by selector-free auto-detection (schema.org + DOM heuristic).
  const listingCount = (html, url) => {
    if (cardSelector) {
      try {
        return cheerio.load(html)(cardSelector).length;
      } catch {
        return 0;
      }
    }
    return countListings ? countListings(html, url) : 0;
  };
  const canVerify = !!cardSelector || !!countListings;

  let html;
  try {
    html = await fetchImpl(home);
  } catch (err) {
    return { url: home, candidates: [], error: err.message };
  }
  const $ = cheerio.load(html);

  // 1. Homepage is already an inventory page?
  if (canVerify && listingCount(html, home) >= 2) {
    return { url: home, candidates: [{ url: home, score: 999 }], verified: true, fromHome: true };
  }

  // 2. Rank same-site links.
  const host = hostOf(home);
  const seen = new Set();
  const scored = [];
  $("a[href]").each((_, a) => {
    const abs = absolutize($(a).attr("href") || "", home);
    if (!abs) return;
    if (!sameSite(hostOf(abs), host)) return;
    const url = stripHash(abs);
    if (seen.has(url)) return;
    seen.add(url);
    const score = scoreLink(url, $(a).text() || "");
    if (score > 0) scored.push({ url, score, text: ($(a).text() || "").trim().slice(0, 60) });
  });
  scored.sort((a, b) => b.score - a.score);

  // 3. Verify the strongest candidates really contain vehicle listings.
  if (canVerify) {
    for (const c of scored.slice(0, 4)) {
      try {
        const cHtml = await fetchImpl(c.url);
        if (listingCount(cHtml, c.url) >= 2) {
          return { url: c.url, candidates: scored, verified: true };
        }
      } catch {
        /* try next candidate */
      }
    }
  }

  // 4. Nothing scored (or nothing verified): probe well-known inventory paths on
  // the same origin. Many SPA dealer sites render their nav client-side, so the
  // plain homepage HTML has no inventory link to score — but /inventory (etc.)
  // still resolves. Verify each so we only adopt one that actually lists cars.
  if (canVerify) {
    for (const path of COMMON_PATHS) {
      const guess = originPlus(home, path);
      if (!guess || seen.has(guess)) continue;
      seen.add(guess);
      try {
        const gHtml = await fetchImpl(guess);
        if (listingCount(gHtml, guess) >= 2) {
          return { url: guess, candidates: scored, verified: true, probed: true };
        }
      } catch {
        /* try next path */
      }
    }
  }

  // 5. Fallbacks.
  if (scored.length) return { url: scored[0].url, candidates: scored, verified: false };
  return { url: home, candidates: [], verified: false };
}

// Inventory paths commonly used across dealer platforms, best-first. Kept short
// so a failed discovery doesn't fetch (and possibly headless-render) too many.
const COMMON_PATHS = [
  "/inventory",
  "/inventory/",
  "/vehicles",
  "/used-vehicles",
  "/pre-owned",
  "/inventory.html",
];

// origin (scheme + host) of `base` joined with an absolute `path`.
function originPlus(base, path) {
  try {
    return new URL(path, new URL(base).origin).toString();
  } catch {
    return "";
  }
}

function scoreLink(url, text) {
  const u = url.toLowerCase();
  const t = text.toLowerCase();
  let s = 0;
  for (const k of STRONG) {
    if (u.includes(k)) s += 10;
    if (t.includes(k.replace(/[-/]/g, " "))) s += 6;
  }
  for (const k of MEDIUM) {
    if (u.includes(k)) s += 3;
    if (t.includes(k)) s += 3;
  }
  if (/\b(view|shop|browse|see|all)\b[\s\S]{0,20}\b(inventory|used|vehicles|cars)\b/.test(t)) s += 6;
  // Slightly prefer shallower paths (closer to a top-level inventory section).
  const depth = (new URL(u).pathname.match(/\//g) || []).length;
  if (s > 0 && depth <= 2) s += 2;
  return s;
}


function safeUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
function hostOf(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}
// Same registrable site if hostnames match or share their last two labels
// (so www.dealer.com, dealer.com, and inventory.dealer.com are "same site").
function sameSite(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const la = a.split(".").slice(-2).join(".");
  const lb = b.split(".").slice(-2).join(".");
  return la === lb;
}
function absolutize(href, base) {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}
function stripHash(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString();
  } catch {
    return u;
  }
}
