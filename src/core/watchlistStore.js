import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { watchlist as seedWatchlist } from "../config/watchlist.js";
import { normalizeFeatures } from "./listing.js";
import { DATA_DIR } from "../config/paths.js";
import * as durable from "./durable.js";

const WATCHLIST_FILE = path.join(DATA_DIR, "watchlist.json");

// Persisted database of watchlist entries — the specific cars the user wants to
// find (make, model, trim, year range, price/mileage caps, color, and features).
// Seeded from src/config/watchlist.js on first use, then the source of truth so
// entries can be added, edited, and removed at runtime via the API and UI.

export function loadWatchlist() {
  try {
    const raw = fs.readFileSync(WATCHLIST_FILE, "utf8");
    const db = JSON.parse(raw);
    if (Array.isArray(db?.entries)) return db.entries;
  } catch {
    // fall through to seed
  }
  const seeded = seedWatchlist.map((e) => ({
    id: makeId(e, []),
    ...e,
    features: normalizeFeatures(e.features),
    createdAt: new Date().toISOString(),
  }));
  saveWatchlist(seeded);
  return seeded;
}

export function saveWatchlist(entries) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify({ entries }, null, 2));
  durable.put("watchlist", { entries });
}

export function listEntries() {
  return loadWatchlist();
}

export function getEntry(id) {
  return loadWatchlist().find((e) => e.id === id) || null;
}

// Validate + normalize a submitted watchlist entry. Returns { value } or { error }.
export function validateEntryInput(input, { partial = false } = {}) {
  const out = {};
  const err = (m) => ({ error: m });

  const str = (v) => String(v ?? "").trim();
  const num = (v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  if (input.label !== undefined) out.label = str(input.label);
  if (input.make !== undefined) out.make = str(input.make);
  if (input.model !== undefined) out.model = str(input.model);
  if (input.trim !== undefined) out.trim = str(input.trim);
  if (input.color !== undefined) out.color = str(input.color);
  if (input.features !== undefined) out.features = normalizeFeatures(input.features);

  for (const key of ["yearMin", "yearMax", "priceMin", "priceMax", "mileageMin", "mileageMax"]) {
    if (input[key] !== undefined) {
      const n = num(input[key]);
      if (Number.isNaN(n)) return err(`${key} must be a number.`);
      if (n !== undefined) out[key] = n;
      else out[key] = undefined; // allow clearing
    }
  }

  if (out.yearMin !== undefined && out.yearMax !== undefined && out.yearMin > out.yearMax) {
    return err("Year (from) can't be greater than Year (to).");
  }
  if (out.priceMin !== undefined && out.priceMax !== undefined && out.priceMin > out.priceMax) {
    return err("Min price can't be greater than max price.");
  }

  // For a create, require at least one real criterion so an entry isn't "match all".
  if (!partial) {
    const hasCriterion =
      out.make || out.model || out.trim || out.color ||
      (out.features && out.features.length) ||
      out.yearMin !== undefined || out.yearMax !== undefined ||
      out.priceMax !== undefined || out.mileageMax !== undefined;
    if (!hasCriterion) return err("Add at least one criterion (e.g. make, model, color, or a feature).");
  }

  return { value: out };
}

export function addEntry(input) {
  const { value, error } = validateEntryInput(input);
  if (error) return { error };
  const entries = loadWatchlist();
  const entry = {
    id: makeId(value, entries),
    ...value,
    features: value.features || [],
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);
  saveWatchlist(entries);
  return { entry };
}

export function updateEntry(id, patch) {
  const entries = loadWatchlist();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return { error: "Entry not found." };
  const { value, error } = validateEntryInput(patch, { partial: true });
  if (error) return { error };
  const updated = { ...entries[idx], ...value, id, updatedAt: new Date().toISOString() };
  // Drop any keys explicitly cleared to undefined so criteria really relax.
  for (const k of Object.keys(updated)) if (updated[k] === undefined) delete updated[k];
  entries[idx] = updated;
  saveWatchlist(entries);
  return { entry: updated };
}

export function removeEntry(id) {
  const entries = loadWatchlist();
  const next = entries.filter((e) => e.id !== id);
  if (next.length === entries.length) return { error: "Entry not found." };
  saveWatchlist(next);
  return { ok: true };
}

// Human-readable, unique id derived from the label or make+model.
function makeId(entry, existing) {
  const basis =
    entry.label || [entry.make, entry.model, entry.trim].filter(Boolean).join(" ") || "car";
  const base =
    basis
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "car";
  const taken = new Set(existing.map((e) => e.id));
  if (!taken.has(base)) return base;
  let id;
  do {
    id = `${base}-${crypto.randomBytes(2).toString("hex")}`;
  } while (taken.has(id));
  return id;
}

export { WATCHLIST_FILE };
