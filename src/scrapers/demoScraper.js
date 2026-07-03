// Generates realistic sample inventory so the whole platform runs end-to-end
// with zero network access. Each demo dealer produces a deterministic-but-varied
// spread of vehicles. Photos are inline SVG data-URIs so they always render,
// even offline. Swap demo dealers for real ones once you're ready to go live.

const MODELS = {
  Toyota: ["Tacoma", "RAV4", "Camry", "Corolla", "4Runner", "Highlander"],
  Honda: ["Civic", "Accord", "CR-V", "Pilot", "HR-V"],
  Subaru: ["Outback", "Forester", "Crosstrek", "WRX", "Ascent"],
  Mazda: ["MX-5", "CX-5", "Mazda3", "CX-30", "CX-9"],
  Tesla: ["Model 3", "Model Y", "Model S"],
  Ford: ["F-150", "Mustang", "Escape", "Bronco", "Explorer"],
  BMW: ["3 Series", "5 Series", "X3", "X5"],
  Chevrolet: ["Silverado", "Equinox", "Malibu", "Bolt"],
};

const TRIMS = ["Base", "Sport", "Limited", "Touring", "TRD Off-Road", "Type R", "Premium", "XLE"];
const SWATCHES = ["#1e3a5f", "#7a1f2b", "#2d4739", "#4a4a4a", "#5a4a2b", "#2b3a4a"];
// Real color names + a matching swatch for the SVG photo.
const PAINT = [
  ["White", "#e8e8e8"], ["Black", "#1a1a1a"], ["Silver", "#c0c0c0"], ["Gray", "#6b7280"],
  ["Blue", "#1e3a8a"], ["Red", "#991b1b"], ["Green", "#14532d"], ["Beige", "#c9b896"],
];
const FEATURES = [
  "AWD", "Sunroof", "Leather Seats", "Navigation", "Backup Camera", "Heated Seats",
  "Apple CarPlay", "Adaptive Cruise", "Blind Spot Monitor", "Third Row",
];

export async function scrapeDemoDealer(dealer) {
  const makes = dealer.seedMakes || Object.keys(MODELS);
  const count = dealer.inventorySize || 30;
  const rng = mulberry32(hashStr(dealer.id));
  const listings = [];

  for (let i = 0; i < count; i++) {
    const make = makes[Math.floor(rng() * makes.length)];
    const models = MODELS[make] || ["Sedan"];
    const model = models[Math.floor(rng() * models.length)];
    const trim = pickTrim(make, model, rng);
    const year = 2015 + Math.floor(rng() * 10); // 2015-2024
    const mileage = Math.floor(5000 + rng() * 95000);
    const basePrice = priceFor(make, model, year, mileage, rng);
    const stock = `${dealer.id.slice(0, 3).toUpperCase()}${1000 + i}`;
    const [colorName, colorHex] = PAINT[Math.floor(rng() * PAINT.length)];
    const features = pickFeatures(rng);
    // ~12% of inventory is already sold — these are excluded downstream.
    const sold = rng() < 0.12;

    const title = `${year} ${make} ${model}${trim && trim !== "Base" ? " " + trim : ""}`;
    listings.push({
      title,
      make,
      model,
      trim,
      year,
      price: basePrice,
      mileage,
      color: colorName,
      features,
      sold,
      link: `https://dealer.example/${dealer.id}/vehicle/${stock}`,
      image: carSvg(make, model, year, colorHex, SWATCHES[i % SWATCHES.length]),
      location: dealer.name,
    });
  }
  return listings;
}

function pickTrim(make, model, rng) {
  if (make === "Honda" && model === "Civic" && rng() < 0.25) return "Type R";
  if (make === "Toyota" && model === "Tacoma" && rng() < 0.4) return "TRD Off-Road";
  return TRIMS[Math.floor(rng() * TRIMS.length)];
}

function priceFor(make, model, year, mileage, rng) {
  const luxury = make === "Tesla" || make === "BMW" ? 1.5 : 1;
  const base = 15000 * luxury;
  const yearBoost = (year - 2015) * 1800;
  const mileagePenalty = mileage * 0.12;
  const noise = (rng() - 0.5) * 4000;
  const price = base + yearBoost - mileagePenalty + noise;
  return Math.max(6000, Math.round(price / 50) * 50);
}

// Pick 2-4 distinct features.
function pickFeatures(rng) {
  const pool = [...FEATURES];
  const n = 2 + Math.floor(rng() * 3);
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

// A clean inline SVG "photo" card so listings render with no external requests.
// `bodyColor` paints the car so the listing's color shows; `bg` is the backdrop.
function carSvg(make, model, year, bodyColor, bg) {
  const label = `${year} ${make}`;
  const sub = model;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#111"/>
    </linearGradient></defs>
    <rect width="400" height="260" fill="url(#g)"/>
    <g>
      <path d="M60 165 q10 -40 45 -45 l90 -4 q30 0 55 28 l40 6 q22 4 22 22 l0 12 -12 0 a18 18 0 0 0 -36 0 l-120 0 a18 18 0 0 0 -36 0 l-14 0 q-8 0 -8 -12 z" fill="${bodyColor}" stroke="#0006" stroke-width="1"/>
      <circle cx="128" cy="182" r="15" fill="#111"/><circle cx="128" cy="182" r="7" fill="#ccc"/>
      <circle cx="266" cy="182" r="15" fill="#111"/><circle cx="266" cy="182" r="7" fill="#ccc"/>
    </g>
    <text x="24" y="48" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#fff">${escapeXml(label)}</text>
    <text x="24" y="78" font-family="Arial, sans-serif" font-size="20" fill="#e6e6e6">${escapeXml(sub)}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

// Deterministic PRNG so each dealer produces stable inventory between runs.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
