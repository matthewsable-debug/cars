// Dealer management client: submit new dealer websites, edit/enable/disable/
// delete existing ones, and test-scrape a config before saving.

const $ = (id) => document.getElementById(id);
const els = {
  form: $("dealerForm"), formTitle: $("formTitle"), editId: $("editId"),
  name: $("name"), type: $("type"), url: $("url"), urlField: $("urlField"),
  enabled: $("enabled"), advanced: $("advanced"),
  s_card: $("s_card"), s_title: $("s_title"), s_price: $("s_price"),
  s_mileage: $("s_mileage"), s_link: $("s_link"), s_image: $("s_image"),
  p_param: $("p_param"), p_max: $("p_max"),
  saveBtn: $("saveBtn"), testBtn: $("testBtn"), cancelBtn: $("cancelBtn"),
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

// Show/hide URL + selectors depending on dealer type.
function syncTypeUI() {
  const isWeb = els.type.value === "html" || els.type.value === "browser";
  els.urlField.style.display = isWeb ? "" : "none";
  els.advanced.style.display = isWeb ? "" : "none";
}

// Gather the form into a dealer payload.
function formToPayload() {
  const payload = {
    name: els.name.value.trim(),
    type: els.type.value,
    enabled: els.enabled.checked,
  };
  if (els.type.value === "html" || els.type.value === "browser") {
    payload.url = els.url.value.trim();
    const sel = {};
    if (els.s_card.value.trim()) sel.card = els.s_card.value.trim();
    if (els.s_title.value.trim()) sel.title = { sel: els.s_title.value.trim() };
    if (els.s_price.value.trim()) sel.price = { sel: els.s_price.value.trim() };
    if (els.s_mileage.value.trim()) sel.mileage = { sel: els.s_mileage.value.trim() };
    if (els.s_link.value.trim()) sel.link = { sel: els.s_link.value.trim(), attr: "href" };
    if (els.s_image.value.trim()) sel.image = { sel: els.s_image.value.trim(), attr: "src" };
    if (els.s_card.value.trim()) {
      // Only send selectors if a card selector is provided; otherwise defaults apply.
      sel.year = { sel: els.s_title.value.trim() || els.s_card.value.trim(), regex: "(19|20)\\d{2}" };
      payload.selectors = sel;
    }
    if (els.p_param.value.trim() || els.p_max.value) {
      payload.pagination = {
        param: els.p_param.value.trim() || "?page={page}",
        maxPages: Number(els.p_max.value) || 1,
      };
    }
  }
  return payload;
}

function resetForm() {
  els.form.reset();
  els.editId.value = "";
  els.enabled.checked = true;
  els.formTitle.textContent = "Add a dealer";
  els.saveBtn.textContent = "Add dealer";
  els.cancelBtn.style.display = "none";
  clearNotice();
  syncTypeUI();
}

function fillForm(d) {
  els.editId.value = d.id;
  els.name.value = d.name || "";
  els.type.value = d.type || "html";
  els.url.value = d.url || "";
  els.enabled.checked = d.enabled !== false;
  const s = d.selectors || {};
  els.s_card.value = s.card || "";
  els.s_title.value = s.title?.sel || "";
  els.s_price.value = s.price?.sel || "";
  els.s_mileage.value = s.mileage?.sel || "";
  els.s_link.value = s.link?.sel || "";
  els.s_image.value = s.image?.sel || "";
  els.p_param.value = d.pagination?.param || "";
  els.p_max.value = d.pagination?.maxPages || "";
  els.formTitle.textContent = "Edit dealer";
  els.saveBtn.textContent = "Save changes";
  els.cancelBtn.style.display = "";
  if (s.card) els.advanced.open = true;
  syncTypeUI();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadList() {
  const dealers = await fetch("/api/dealers").then((r) => r.json());
  els.count.textContent = `(${dealers.length})`;
  els.empty.hidden = dealers.length > 0;
  els.list.innerHTML = dealers.map(dealerCard).join("");
}

function dealerCard(d) {
  const on = d.enabled !== false;
  return `<div class="dealer" data-id="${esc(d.id)}">
    <div class="info">
      <div class="name">${esc(d.name)}</div>
      ${d.url ? `<div class="url">${esc(d.url)}</div>` : `<div class="url">Generated demo inventory</div>`}
      ${d.inventoryUrl && d.inventoryUrl !== d.url ? `<div class="url">↳ inventory: ${esc(d.inventoryUrl)}</div>` : ""}
      <div class="tags">
        <span class="tag type">${esc(d.type)}</span>
        <span class="tag ${on ? "on" : "off"}">${on ? "enabled" : "disabled"}</span>
      </div>
    </div>
    <div class="controls">
      <label class="switch"><input type="checkbox" class="toggle" ${on ? "checked" : ""}> On</label>
      <button class="btn subtle small act-test">Test</button>
      <button class="btn small act-edit">Edit</button>
      <button class="btn danger small act-del">Delete</button>
    </div>
  </div>`;
}

// --- events ---------------------------------------------------------------

els.type.addEventListener("change", syncTypeUI);
els.cancelBtn.addEventListener("click", resetForm);

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearNotice();
  const payload = formToPayload();
  const id = els.editId.value;
  els.saveBtn.disabled = true;
  try {
    const res = await fetch(id ? `/api/dealers/${id}` : "/api/dealers", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { notify(data.error || "Save failed.", "err"); return; }
    notify(id ? "Dealer updated." : "Dealer added.", "ok");
    resetForm();
    await loadList();
  } catch (err) {
    notify("Network error: " + err.message, "err");
  } finally {
    els.saveBtn.disabled = false;
  }
});

els.testBtn.addEventListener("click", async () => {
  clearNotice();
  const payload = formToPayload();
  if ((payload.type === "html" || payload.type === "browser") && !payload.url) { notify("Enter a URL to test.", "err"); return; }
  els.testBtn.disabled = true;
  els.testBtn.textContent = "Testing…";
  try {
    const data = await fetch("/api/dealers/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    if (data.error) { notify("Test failed: " + data.error, "err"); return; }
    const found = data.inventoryUrl ? ` (inventory: ${data.inventoryUrl})` : "";
    if (!data.count) { notify(`Reached the site${found} but found 0 available vehicles — try adjusting selectors.`, "err"); return; }
    const first = data.sample[0];
    const via = data.method === "json" ? " via JSON feed" : "";
    notify(`Found ${data.count} available vehicle(s)${via}${found}. First: ${first.title || "(untitled)"}${first.price ? " — $" + first.price.toLocaleString() : ""}.`, "ok");
  } catch (err) {
    notify("Network error: " + err.message, "err");
  } finally {
    els.testBtn.disabled = false;
    els.testBtn.textContent = "Test scrape";
  }
});

els.list.addEventListener("click", async (e) => {
  const card = e.target.closest(".dealer");
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.classList.contains("act-del")) {
    if (!confirm("Delete this dealer?")) return;
    await fetch(`/api/dealers/${id}`, { method: "DELETE" });
    await loadList();
  } else if (e.target.classList.contains("act-edit")) {
    const d = await fetch(`/api/dealers/${id}`).then((r) => r.json());
    fillForm(d);
  } else if (e.target.classList.contains("act-test")) {
    e.target.disabled = true; e.target.textContent = "…";
    const data = await fetch("/api/dealers/test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).then((r) => r.json());
    e.target.disabled = false; e.target.textContent = "Test";
    if (data.error) notify(`${id}: test failed — ${data.error}`, "err");
    else notify(`${id}: found ${data.count} vehicle(s).`, data.count ? "ok" : "err");
  }
});

els.list.addEventListener("change", async (e) => {
  if (!e.target.classList.contains("toggle")) return;
  const card = e.target.closest(".dealer");
  const id = card.dataset.id;
  await fetch(`/api/dealers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: e.target.checked }),
  });
  await loadList();
});

syncTypeUI();
loadList();
