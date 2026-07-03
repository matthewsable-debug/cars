// Watchlist client: submit the specific cars to find (make, model, year, color,
// features, price/mileage caps) and edit/delete existing searches.

const $ = (id) => document.getElementById(id);
const els = {
  form: $("wlForm"), formTitle: $("formTitle"), editId: $("editId"),
  label: $("label"), make: $("make"), model: $("model"), trim: $("trim"), color: $("color"),
  yearMin: $("yearMin"), yearMax: $("yearMax"), priceMax: $("priceMax"), mileageMax: $("mileageMax"),
  features: $("features"),
  saveBtn: $("saveBtn"), cancelBtn: $("cancelBtn"),
  notice: $("notice"), list: $("list"), empty: $("empty"), count: $("count"),
};

function esc(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
}
function notify(msg, kind = "ok") {
  els.notice.textContent = msg;
  els.notice.className = `notice show ${kind}`;
}
function clearNotice() { els.notice.className = "notice"; }

const numOrUndef = (v) => (String(v).trim() === "" ? undefined : Number(v));

function formToPayload() {
  return {
    label: els.label.value.trim(),
    make: els.make.value.trim(),
    model: els.model.value.trim(),
    trim: els.trim.value.trim(),
    color: els.color.value.trim(),
    yearMin: numOrUndef(els.yearMin.value),
    yearMax: numOrUndef(els.yearMax.value),
    priceMax: numOrUndef(els.priceMax.value),
    mileageMax: numOrUndef(els.mileageMax.value),
    features: els.features.value.split(",").map((s) => s.trim()).filter(Boolean),
  };
}

function resetForm() {
  els.form.reset();
  els.editId.value = "";
  els.formTitle.textContent = "Add a car to find";
  els.saveBtn.textContent = "Add to watchlist";
  els.cancelBtn.style.display = "none";
  clearNotice();
}

function fillForm(e) {
  els.editId.value = e.id;
  els.label.value = e.label || "";
  els.make.value = e.make || "";
  els.model.value = e.model || "";
  els.trim.value = e.trim || "";
  els.color.value = e.color || "";
  els.yearMin.value = e.yearMin ?? "";
  els.yearMax.value = e.yearMax ?? "";
  els.priceMax.value = e.priceMax ?? "";
  els.mileageMax.value = e.mileageMax ?? "";
  els.features.value = (e.features || []).join(", ");
  els.formTitle.textContent = "Edit search";
  els.saveBtn.textContent = "Save changes";
  els.cancelBtn.style.display = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function criteriaTags(e) {
  const tags = [];
  if (e.make) tags.push(e.make);
  if (e.model) tags.push(e.model);
  if (e.trim) tags.push(e.trim);
  if (e.color) tags.push("🎨 " + e.color);
  if (e.yearMin || e.yearMax) tags.push(`${e.yearMin ?? "…"}–${e.yearMax ?? "…"}`);
  if (e.priceMax) tags.push("≤ $" + Number(e.priceMax).toLocaleString());
  if (e.mileageMax) tags.push("≤ " + Number(e.mileageMax).toLocaleString() + " mi");
  (e.features || []).forEach((f) => tags.push("✓ " + f));
  return tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("");
}

async function loadList() {
  const entries = await fetch("/api/watchlist").then((r) => r.json());
  els.count.textContent = `(${entries.length})`;
  els.empty.hidden = entries.length > 0;
  els.list.innerHTML = entries.map((e) => `
    <div class="dealer" data-id="${esc(e.id)}">
      <div class="info">
        <div class="name">${esc(e.displayLabel || e.label || "Search")}</div>
        <div class="tags">${criteriaTags(e)}</div>
      </div>
      <div class="controls">
        <button class="btn small act-edit">Edit</button>
        <button class="btn danger small act-del">Delete</button>
      </div>
    </div>`).join("");
}

// --- events ---------------------------------------------------------------

els.cancelBtn.addEventListener("click", resetForm);

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearNotice();
  const payload = formToPayload();
  const id = els.editId.value;
  els.saveBtn.disabled = true;
  try {
    const res = await fetch(id ? `/api/watchlist/${id}` : "/api/watchlist", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { notify(data.error || "Save failed.", "err"); return; }
    notify(id ? "Search updated." : "Added to your watchlist.", "ok");
    resetForm();
    await loadList();
  } catch (err) {
    notify("Network error: " + err.message, "err");
  } finally {
    els.saveBtn.disabled = false;
  }
});

els.list.addEventListener("click", async (e) => {
  const card = e.target.closest(".dealer");
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.classList.contains("act-del")) {
    if (!confirm("Remove this search from your watchlist?")) return;
    await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
    await loadList();
  } else if (e.target.classList.contains("act-edit")) {
    const entry = await fetch(`/api/watchlist/${id}`).then((r) => r.json());
    fillForm(entry);
  }
});

loadList();
