// Dashboard client: loads matched listings, renders cards with photos and
// clickable links, and supports search / filter / sort, plus on-demand scans.

const state = { listings: [], filtered: [] };

const els = {
  stats: document.getElementById("stats"),
  results: document.getElementById("results"),
  empty: document.getElementById("empty"),
  search: document.getElementById("search"),
  labelFilter: document.getElementById("labelFilter"),
  dealerFilter: document.getElementById("dealerFilter"),
  sort: document.getElementById("sort"),
  newOnly: document.getElementById("newOnly"),
  scanBtn: document.getElementById("scanBtn"),
};

async function load() {
  const [listings, status] = await Promise.all([
    fetch("/api/listings").then((r) => r.json()),
    fetch("/api/status").then((r) => r.json()),
  ]);
  state.listings = listings.listings || [];
  populateFilters(listings);
  renderStats(listings, status);
  applyFilters();
}

function populateFilters(data) {
  const labels = (data.watchlist || []).slice().sort();
  els.labelFilter.innerHTML =
    '<option value="">All watchlist items</option>' +
    labels.map((l) => `<option value="${escAttr(l)}">${esc(l)}</option>`).join("");
  const dealers = data.dealers || [];
  els.dealerFilter.innerHTML =
    '<option value="">All dealers</option>' +
    dealers.map((d) => `<option value="${escAttr(d.name)}">${esc(d.name)}</option>`).join("");
}

function renderStats(data, status) {
  const newCount = state.listings.filter((l) => l.isNew).length;
  const last = status.lastScan ? new Date(status.lastScan).toLocaleString() : "never";
  const cards = [
    ["Matches", data.count ?? state.listings.length],
    ["New", newCount],
    ["Dealers watched", (data.dealers || []).length],
    ["Watchlist items", (data.watchlist || []).length],
    ["Last scan", last, true],
  ];
  els.stats.innerHTML = cards
    .map(([lbl, num, small]) =>
      `<div class="stat"><div class="num" style="${small ? "font-size:15px" : ""}">${esc(String(num))}</div><div class="lbl">${esc(lbl)}</div></div>`)
    .join("");
}

function applyFilters() {
  const q = els.search.value.trim().toLowerCase();
  const label = els.labelFilter.value;
  const dealer = els.dealerFilter.value;
  const newOnly = els.newOnly.checked;

  let list = state.listings.filter((l) => {
    if (newOnly && !l.isNew) return false;
    if (label && !(l.matchedLabels || []).includes(label)) return false;
    if (dealer && l.dealer !== dealer) return false;
    if (q) {
      const hay = `${l.title} ${l.make} ${l.model} ${l.dealer}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sort = els.sort.value;
  list.sort((a, b) => {
    switch (sort) {
      case "price-desc": return (b.price ?? -1) - (a.price ?? -1);
      case "mileage-asc": return (a.mileage ?? Infinity) - (b.mileage ?? Infinity);
      case "year-desc": return (b.year ?? 0) - (a.year ?? 0);
      case "new": return Number(b.isNew) - Number(a.isNew);
      case "price-asc":
      default: return (a.price ?? Infinity) - (b.price ?? Infinity);
    }
  });

  state.filtered = list;
  render();
}

function render() {
  const list = state.filtered;
  els.empty.hidden = list.length > 0;
  els.results.innerHTML = list.map(card).join("");
}

function card(l) {
  const price = l.price != null ? `$${l.price.toLocaleString()}` : "Call for price";
  const miles = l.mileage != null ? `${l.mileage.toLocaleString()} mi` : "Mileage n/a";
  const labels = (l.matchedLabels || []).map((x) => `<span class="chip">${esc(x)}</span>`).join("");
  const detail = [l.color, (l.features || []).slice(0, 3).join(", ")].filter(Boolean).join(" · ");
  return `<a class="card" href="${escAttr(l.url)}" target="_blank" rel="noopener">
    <div class="photo">
      ${l.isNew ? '<span class="badge-new">NEW</span>' : ""}
      <img loading="lazy" src="${escAttr(l.image)}" alt="${escAttr(l.title)}">
    </div>
    <div class="body">
      <div class="title">${esc(l.title)}</div>
      <div class="price">${price}</div>
      <div class="meta">${esc(miles)} &middot; ${esc(l.dealer)}</div>
      ${detail ? `<div class="meta">${esc(detail)}</div>` : ""}
      <div class="labels">${labels}</div>
      <div class="cta">View listing →</div>
    </div>
  </a>`;
}

async function scanNow() {
  els.scanBtn.disabled = true;
  els.scanBtn.textContent = "Scanning…";
  try {
    await fetch("/api/scan", { method: "POST" });
    await load();
  } catch (e) {
    alert("Scan failed: " + e.message);
  } finally {
    els.scanBtn.disabled = false;
    els.scanBtn.textContent = "Scan now";
  }
}

function esc(s) {
  return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
function escAttr(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
}

["input", "change"].forEach((ev) => {
  els.search.addEventListener(ev, applyFilters);
  els.labelFilter.addEventListener(ev, applyFilters);
  els.dealerFilter.addEventListener(ev, applyFilters);
  els.sort.addEventListener(ev, applyFilters);
  els.newOnly.addEventListener(ev, applyFilters);
});
els.scanBtn.addEventListener("click", scanNow);

load();
