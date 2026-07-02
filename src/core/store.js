import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_FILE = path.join(DATA_DIR, "listings.json");

// A tiny JSON-file store. It keeps the union of every matched listing we've ever
// seen, with firstSeen/lastSeen timestamps so the platform can highlight what's
// genuinely new since the previous scan.

export function load() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const db = JSON.parse(raw);
    if (!db.listings) db.listings = {};
    if (!db.scans) db.scans = [];
    return db;
  } catch {
    return { listings: {}, scans: [] };
  }
}

export function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Merge a fresh set of matched listings into the store. Returns a summary that
// separates brand-new listings from ones we've seen before, plus the full
// current set of active listings from this scan.
export function reconcile(db, matches) {
  const now = new Date().toISOString();
  const seenIds = new Set();
  const newListings = [];
  const updatedListings = [];

  for (const m of matches) {
    seenIds.add(m.id);
    const existing = db.listings[m.id];
    if (existing) {
      const merged = {
        ...existing,
        ...m,
        firstSeen: existing.firstSeen,
        lastSeen: now,
        isNew: false,
      };
      db.listings[m.id] = merged;
      updatedListings.push(merged);
    } else {
      const created = { ...m, firstSeen: now, lastSeen: now, isNew: true };
      db.listings[m.id] = created;
      newListings.push(created);
    }
  }

  // Mark listings that were previously active but are absent now as sold/gone.
  for (const [id, listing] of Object.entries(db.listings)) {
    if (!seenIds.has(id)) {
      listing.active = false;
    } else {
      listing.active = true;
    }
  }

  const scan = {
    at: now,
    matched: matches.length,
    new: newListings.length,
  };
  db.scans.unshift(scan);
  db.scans = db.scans.slice(0, 100); // keep last 100 scans

  return { now, newListings, updatedListings, activeCount: seenIds.size, scan };
}

export function activeListings(db) {
  return Object.values(db.listings).filter((l) => l.active !== false);
}

export function allListings(db) {
  return Object.values(db.listings);
}

export { DB_FILE, DATA_DIR };
