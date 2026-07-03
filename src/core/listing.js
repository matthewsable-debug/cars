import crypto from "node:crypto";

// A normalized vehicle listing. Every scraper adapter is expected to emit
// objects that this function cleans up into a consistent shape.
//
// Canonical fields:
//   id        stable hash derived from dealer + link (or title) so we can
//             detect the same listing across scans and flag genuinely new ones
//   dealerId  which dealer this came from
//   dealer    human-readable dealer name
//   make, model, trim, year, price, mileage
//   title     original listing title
//   url       clickable link to the listing
//   image     photo URL
//   firstSeen ISO timestamp when we first observed it
//   lastSeen  ISO timestamp of the most recent scan that saw it

export function normalizeListing(raw, dealer) {
  const title = clean(raw.title) || "";
  const url = clean(raw.url) || clean(raw.link) || "";
  const parsed = parseTitle(title);

  const make = clean(raw.make) || parsed.make || "";
  const model = clean(raw.model) || parsed.model || "";
  const trim = clean(raw.trim) || parsed.trim || "";
  const year = toInt(raw.year) || parsed.year || null;
  const price = toInt(raw.price);
  const mileage = toInt(raw.mileage);
  const color = clean(raw.color);
  const features = normalizeFeatures(raw.features);
  const sold = raw.sold === true || /\bsold\b|sale[\s-]?pending/i.test(title);

  const idBasis = `${dealer.id}::${url || title}`;
  const id = crypto.createHash("sha1").update(idBasis).digest("hex").slice(0, 16);

  return {
    id,
    dealerId: dealer.id,
    dealer: dealer.name,
    make,
    model,
    trim,
    year,
    price,
    mileage,
    color,
    features,
    sold,
    title,
    url,
    image: clean(raw.image) || "",
    location: clean(raw.location) || "",
  };
}

// Accept features as an array or a comma/pipe-separated string; return a clean
// array of non-empty strings.
export function normalizeFeatures(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[,|]/);
  return arr.map((f) => clean(f)).filter(Boolean);
}

function clean(v) {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

// Pull an integer out of messy strings like "$34,995", "42,100 mi", "2021".
export function toInt(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  const digits = String(v).replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

// Best-effort parse of a listing title such as
// "2021 Toyota Tacoma TRD Off-Road" into structured fields.
export function parseTitle(title) {
  const out = { year: null, make: "", model: "", trim: "" };
  if (!title) return out;

  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) out.year = parseInt(yearMatch[0], 10);

  // Remove the year, then take the first token as make and the next as model.
  let rest = title.replace(/\b(19|20)\d{2}\b/, "").replace(/\s+/g, " ").trim();
  const tokens = rest.split(" ").filter(Boolean);
  if (tokens.length) {
    out.make = tokens[0];
    if (tokens.length > 1) out.model = tokens[1];
    if (tokens.length > 2) out.trim = tokens.slice(2).join(" ");
  }
  return out;
}
