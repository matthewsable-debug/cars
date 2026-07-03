import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dealers as seedDealers } from "../config/dealers.js";
import { DATA_DIR } from "../config/paths.js";

const DEALERS_FILE = path.join(DATA_DIR, "dealers.json");

// Persisted database of dealers the platform monitors. On first use it seeds
// itself from src/config/dealers.js, then becomes the source of truth so
// dealers can be added, edited, enabled/disabled, and removed at runtime
// through the API and management UI.

const VALID_TYPES = ["html", "browser", "demo"];
// Types that fetch a live website and therefore need a URL + selectors.
const WEB_TYPES = ["html", "browser"];

// Applied to HTML dealers when the submitter doesn't provide their own. These
// generic selectors match a lot of server-rendered inventory pages and give a
// newly submitted dealer a fighting chance; the "test" endpoint reveals whether
// they actually work so they can be refined.
export const DEFAULT_SELECTORS = {
  card: ".inventory-card, .vehicle-card, li.vehicle, article.vehicle",
  title: { sel: ".vehicle-title, h2 a, h3 a, .title" },
  price: { sel: ".price, .vehicle-price, [class*=price]" },
  mileage: { sel: ".mileage, .odometer, [class*=mileage]" },
  year: { sel: ".vehicle-title, h2 a, h3 a, .title", regex: "(19|20)\\d{2}" },
  link: { sel: "a", attr: "href" },
  image: { sel: "img", attr: "src" },
};

export function loadDealers() {
  try {
    const raw = fs.readFileSync(DEALERS_FILE, "utf8");
    const db = JSON.parse(raw);
    if (Array.isArray(db?.dealers)) return db.dealers;
  } catch {
    // fall through to seed
  }
  // First run: seed from the static config and persist. HTML dealers that don't
  // specify a card selector get the generic defaults, so a seed dealer can be
  // just a name + main URL.
  const seeded = seedDealers.map((d) => {
    const dealer = { ...d, createdAt: new Date().toISOString() };
    if (WEB_TYPES.includes(dealer.type) && !(dealer.selectors && dealer.selectors.card)) {
      dealer.selectors = { ...DEFAULT_SELECTORS };
    }
    return dealer;
  });
  saveDealers(seeded);
  return seeded;
}

export function saveDealers(dealers) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DEALERS_FILE, JSON.stringify({ dealers }, null, 2));
}

export function listDealers() {
  return loadDealers();
}

export function getDealer(id) {
  return loadDealers().find((d) => d.id === id) || null;
}

// Validate + normalize submitted dealer input. Returns { value } or { error }.
export function validateDealerInput(input, { partial = false } = {}) {
  const out = {};
  const err = (m) => ({ error: m });

  if (!partial || input.name !== undefined) {
    const name = String(input.name || "").trim();
    if (!name) return err("Name is required.");
    if (name.length > 120) return err("Name is too long.");
    out.name = name;
  }

  if (!partial || input.type !== undefined) {
    const type = String(input.type || "html").trim().toLowerCase();
    if (!VALID_TYPES.includes(type)) return err(`Type must be one of: ${VALID_TYPES.join(", ")}.`);
    out.type = type;
  }

  const effectiveType = out.type || input.type || "html";
  if (WEB_TYPES.includes(effectiveType)) {
    if (!partial || input.url !== undefined) {
      const url = String(input.url || "").trim();
      if (!url) return err("A website URL is required for this dealer type.");
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return err("URL is not valid.");
      }
      if (!/^https?:$/.test(parsed.protocol)) return err("URL must start with http:// or https://.");
      out.url = url;
    }
  }

  if (input.selectors !== undefined) {
    if (input.selectors && typeof input.selectors === "object") out.selectors = input.selectors;
  }
  if (input.pagination !== undefined) out.pagination = input.pagination || undefined;
  if (input.seedMakes !== undefined) out.seedMakes = input.seedMakes;
  if (input.inventorySize !== undefined) out.inventorySize = Number(input.inventorySize) || undefined;
  if (input.enabled !== undefined) out.enabled = !!input.enabled;

  return { value: out };
}

export function addDealer(input) {
  const { value, error } = validateDealerInput(input);
  if (error) return { error };

  const dealers = loadDealers();
  const dealer = {
    id: makeId(value.name, dealers),
    name: value.name,
    type: value.type,
    enabled: value.enabled !== undefined ? value.enabled : true,
    createdAt: new Date().toISOString(),
  };
  if (WEB_TYPES.includes(value.type)) {
    dealer.url = value.url;
    dealer.selectors =
      value.selectors && value.selectors.card ? value.selectors : { ...DEFAULT_SELECTORS };
    if (value.pagination) dealer.pagination = value.pagination;
  }
  if (value.type === "demo") {
    if (value.seedMakes) dealer.seedMakes = value.seedMakes;
    if (value.inventorySize) dealer.inventorySize = value.inventorySize;
  }

  dealers.push(dealer);
  saveDealers(dealers);
  return { dealer };
}

export function updateDealer(id, patch) {
  const dealers = loadDealers();
  const idx = dealers.findIndex((d) => d.id === id);
  if (idx === -1) return { error: "Dealer not found." };

  const { value, error } = validateDealerInput(patch, { partial: true });
  if (error) return { error };

  const updated = { ...dealers[idx], ...value, id, updatedAt: new Date().toISOString() };
  dealers[idx] = updated;
  saveDealers(dealers);
  return { dealer: updated };
}

// Persist an auto-discovered inventory URL on a dealer so we don't re-crawl the
// homepage every scan. Bypasses validation (internal, not user-submitted).
export function cacheInventoryUrl(id, inventoryUrl) {
  if (!inventoryUrl) return { ok: false };
  const dealers = loadDealers();
  const idx = dealers.findIndex((d) => d.id === id);
  if (idx === -1) return { ok: false };
  if (dealers[idx].inventoryUrl === inventoryUrl) return { ok: true, unchanged: true };
  dealers[idx] = { ...dealers[idx], inventoryUrl, inventoryDiscoveredAt: new Date().toISOString() };
  saveDealers(dealers);
  return { ok: true };
}

export function removeDealer(id) {
  const dealers = loadDealers();
  const next = dealers.filter((d) => d.id !== id);
  if (next.length === dealers.length) return { error: "Dealer not found." };
  saveDealers(next);
  return { ok: true };
}

// Human-readable, unique id derived from the dealer name.
function makeId(name, existing) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "dealer";
  const taken = new Set(existing.map((d) => d.id));
  if (!taken.has(base)) return base;
  let id;
  do {
    id = `${base}-${crypto.randomBytes(2).toString("hex")}`;
  } while (taken.has(id));
  return id;
}

export { DEALERS_FILE };
