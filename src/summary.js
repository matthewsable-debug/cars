// Builds a self-contained HTML summary of matched listings, grouped by the
// watchlist label they matched. Inline styles + inline images make it safe to
// email or save as a standalone file. New listings are highlighted.

export function renderDigest(result, { title = "Car Watch Summary" } = {}) {
  const listings = result.matches || [];
  const groups = groupByLabel(listings);
  const when = new Date(result.startedAt || Date.now()).toLocaleString();

  const sections = Object.entries(groups)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, items]) => renderGroup(label, items))
    .join("\n");

  const summaryLine =
    `${listings.length} match${listings.length === 1 ? "" : "es"} across ` +
    `${result.dealers?.length ?? 0} dealer${result.dealers?.length === 1 ? "" : "s"}` +
    (result.newCount ? ` &middot; <strong style="color:#c2410c">${result.newCount} new</strong>` : "");

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827">
<div style="max-width:720px;margin:0 auto;padding:24px 16px">
  <div style="background:#111827;color:#fff;border-radius:12px;padding:20px 24px">
    <div style="font-size:22px;font-weight:700">🚗 ${esc(title)}</div>
    <div style="opacity:.8;margin-top:6px;font-size:14px">${summaryLine}</div>
    <div style="opacity:.6;margin-top:2px;font-size:12px">Generated ${esc(when)}</div>
  </div>
  ${listings.length === 0 ? emptyState() : sections}
  <div style="text-align:center;color:#9ca3af;font-size:12px;margin-top:28px">
    Car Dealer Monitor &middot; matched against your watchlist
  </div>
</div>
</body></html>`;
}

function renderGroup(label, items) {
  const cards = items
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    .map(renderCard)
    .join("\n");
  return `<div style="margin-top:24px">
    <div style="font-size:16px;font-weight:700;margin:0 0 12px 2px">
      ${esc(label)} <span style="color:#6b7280;font-weight:500">(${items.length})</span>
    </div>
    ${cards}
  </div>`;
}

function renderCard(l) {
  const newBadge = l.isNew
    ? `<span style="background:#c2410c;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:8px">NEW</span>`
    : "";
  const price = l.price != null ? `$${l.price.toLocaleString()}` : "Call for price";
  const miles = l.mileage != null ? `${l.mileage.toLocaleString()} mi` : "—";
  return `<a href="${esc(l.url)}" style="text-decoration:none;color:inherit;display:block">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:12px;overflow:hidden">
      <tr>
        <td width="160" valign="top" style="padding:0">
          <img src="${esc(l.image)}" alt="${esc(l.title)}" width="160" style="display:block;width:160px;height:110px;object-fit:cover">
        </td>
        <td valign="top" style="padding:12px 16px">
          <div style="font-size:15px;font-weight:700">${esc(l.title)}${newBadge}</div>
          <div style="font-size:18px;font-weight:700;color:#111827;margin-top:4px">${price}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:4px">${miles} &middot; ${esc(l.dealer)}</div>
          <div style="font-size:12px;color:#2563eb;margin-top:8px">View listing →</div>
        </td>
      </tr>
    </table>
  </a>`;
}

function emptyState() {
  return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center;color:#6b7280;margin-top:24px">
    No listings matched your watchlist in this scan.
  </div>`;
}

function groupByLabel(listings) {
  const groups = {};
  for (const l of listings) {
    const labels = l.matchedLabels && l.matchedLabels.length ? l.matchedLabels : ["Other"];
    for (const label of labels) {
      (groups[label] ||= []).push(l);
    }
  }
  return groups;
}

function esc(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
}
