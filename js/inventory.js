// Раздел «Инвентарь»: персонажи с созвездиями и свои 5★ пушки.
// Полноценная замена быстрого списка в сайдбаре.

import * as store from "./store.js";
import { t, onChange as onLangChange } from "./i18n.js";

const ELEMENTS = ["pyro", "hydro", "anemo", "electro", "dendro", "cryo", "geo"];
const WEAPON_TYPES = ["sword", "claymore", "polearm", "bow", "catalyst"];

let names = {};
let refs = { fiveStars: {} };
let host = null;

const ui = {
  tab: "characters",
  charSearch: "",
  charOwned: "all",      // all | owned | missing
  charElement: null,
  weaponSearch: "",
  weaponOwned: "all",
  weaponType: null,
};

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function icon(src, alt, cls) {
  const img = new Image();
  img.loading = "lazy";
  img.decoding = "async";
  img.src = src;
  img.alt = alt || "";
  if (cls) img.className = cls;
  img.onerror = () => { img.style.visibility = "hidden"; };
  return img;
}

/** Кнопки-переключатели вида «Все / Есть / Нет» и фильтров по элементу/типу. */
function chipRow(items, active, onPick, label) {
  const row = el("div", "inv-chips");
  if (label) row.setAttribute("aria-label", label);
  for (const item of items) {
    const chip = el("button", "inv-chip");
    chip.type = "button";
    if (item.icon) chip.appendChild(icon(item.icon, item.label, "inv-chip-icon"));
    if (item.label) chip.appendChild(el("span", null, item.label));
    if (item.value === active) chip.classList.add("is-active");
    chip.addEventListener("click", () => onPick(item.value === active && item.clearable ? null : item.value));
    row.appendChild(chip);
  }
  return row;
}

function stepper(value, min, max, onChange, fmt) {
  const box = el("div", "inv-stepper");
  const dec = el("button", "inv-step", "−");
  dec.type = "button";
  dec.disabled = value <= min;
  dec.addEventListener("click", (e) => { e.stopPropagation(); onChange(value - 1); });

  const out = el("span", "inv-step-value", fmt(value));

  const inc = el("button", "inv-step", "+");
  inc.type = "button";
  inc.disabled = value >= max;
  inc.addEventListener("click", (e) => { e.stopPropagation(); onChange(value + 1); });

  box.append(dec, out, inc);
  return box;
}

// ------------------------------------------------------------- персонажи

function characterList() {
  const q = ui.charSearch.trim().toLowerCase();
  return Object.keys(names)
    .filter((k) => {
      const entry = names[k];
      if (!entry) return false;
      if (ui.charElement && entry.element !== ui.charElement) return false;
      const owned = store.hasCharacter(k);
      if (ui.charOwned === "owned" && !owned) return false;
      if (ui.charOwned === "missing" && owned) return false;
      if (q) {
        const hay = `${k} ${entry.name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const sa = names[a].stars || 0, sb = names[b].stars || 0;
      if (sa !== sb) return sb - sa;                       // сначала 5★
      return (names[a].name || a).localeCompare(names[b].name || b);
    });
}

function characterCard(key) {
  const entry = names[key];
  const owned = store.hasCharacter(key);
  const card = el("div", `inv-card${owned ? " is-owned" : ""}`);
  card.dataset.key = key;

  const top = el("button", "inv-card-main");
  top.type = "button";
  top.setAttribute("aria-pressed", String(owned));
  top.title = owned ? t("inventory.owned") : t("inventory.notOwned");
  top.appendChild(icon(`characters/${key}.png`, entry.name || key, "inv-portrait"));
  const nameRow = el("div", "inv-card-name", entry.name || key);
  top.appendChild(nameRow);
  if (entry.element) {
    top.appendChild(icon(`filters/Element_${entry.element.charAt(0).toUpperCase()}${entry.element.slice(1)}.png`,
      entry.element, "inv-element"));
  }
  top.addEventListener("click", () => {
    store.toggleCharacter(key);
  });
  card.appendChild(top);

  if (owned && store.isFiveStar(key)) {
    const min = store.minCons(key);
    const cons = store.consOf(key);
    const row = el("div", "inv-card-foot");
    row.appendChild(stepper(cons, min, 6, (v) => store.setCons(key, v), (v) => `${t("inventory.consShort")}${v}`));
    if (min > 0) {
      const badge = el("span", "inv-min-badge", `${t("inventory.consShort")}${min}`);
      badge.title = t("inventory.minC1Note");
      row.appendChild(badge);
    }
    card.appendChild(row);
  }
  return card;
}

function renderCharacters(container) {
  container.innerHTML = "";

  const controls = el("div", "inv-controls");
  const search = el("input", "inv-search");
  search.type = "search";
  search.placeholder = t("inventory.search");
  search.value = ui.charSearch;
  search.addEventListener("input", () => {
    ui.charSearch = search.value;
    renderGrid();
  });
  controls.appendChild(search);

  controls.appendChild(chipRow([
    { value: "all", label: t("inventory.filterAll") },
    { value: "owned", label: t("inventory.filterOwned") },
    { value: "missing", label: t("inventory.filterMissing") },
  ], ui.charOwned, (v) => { ui.charOwned = v || "all"; render(); }));

  controls.appendChild(chipRow(
    ELEMENTS.map((e) => ({
      value: e, clearable: true,
      icon: `filters/Element_${e.charAt(0).toUpperCase()}${e.slice(1)}.png`,
    })),
    ui.charElement,
    (v) => { ui.charElement = v; render(); },
  ));
  container.appendChild(controls);

  container.appendChild(el("p", "inv-hint small", t("inventory.charactersHint")));

  const grid = el("div", "inv-grid");
  container.appendChild(grid);

  function renderGrid() {
    grid.innerHTML = "";
    const list = characterList();
    if (!list.length) {
      grid.appendChild(el("div", "small muted", t("inventory.empty")));
      return;
    }
    for (const key of list) grid.appendChild(characterCard(key));
  }
  renderGrid();
}

// ---------------------------------------------------------------- оружие

function weaponList() {
  const q = ui.weaponSearch.trim().toLowerCase();
  const all = refs.fiveStars || {};
  return Object.keys(all)
    .filter((k) => {
      const w = all[k];
      if (ui.weaponType && w.type !== ui.weaponType) return false;
      const owned = store.hasWeapon(k);
      if (ui.weaponOwned === "owned" && !owned) return false;
      if (ui.weaponOwned === "missing" && owned) return false;
      if (q && !`${k} ${w.name || ""}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => (all[a].name || a).localeCompare(all[b].name || b));
}

function weaponCard(key) {
  const w = refs.fiveStars[key] || {};
  const owned = store.hasWeapon(key);
  const card = el("div", `inv-card inv-card-weapon${owned ? " is-owned" : ""}`);

  const top = el("button", "inv-card-main");
  top.type = "button";
  top.setAttribute("aria-pressed", String(owned));
  top.appendChild(icon(`weapons/${key}.png`, w.name || key, "inv-portrait"));
  top.appendChild(el("div", "inv-card-name", w.name || key));
  if (!w.inDb) {
    const mark = el("span", "inv-nodb", "·");
    mark.title = t("inventory.weaponsNotInDb");
    top.appendChild(mark);
  }
  top.addEventListener("click", () => store.toggleWeapon(key));
  card.appendChild(top);

  if (owned) {
    const row = el("div", "inv-card-foot");
    row.appendChild(stepper(store.refineOf(key), 1, 5,
      (v) => store.setRefine(key, v), (v) => `R${v}`));
    card.appendChild(row);
  }
  return card;
}

function renderWeapons(container) {
  container.innerHTML = "";

  const controls = el("div", "inv-controls");
  const search = el("input", "inv-search");
  search.type = "search";
  search.placeholder = t("inventory.search");
  search.value = ui.weaponSearch;
  search.addEventListener("input", () => { ui.weaponSearch = search.value; renderGrid(); });
  controls.appendChild(search);

  controls.appendChild(chipRow([
    { value: "all", label: t("inventory.filterAll") },
    { value: "owned", label: t("inventory.filterOwned") },
    { value: "missing", label: t("inventory.filterMissing") },
  ], ui.weaponOwned, (v) => { ui.weaponOwned = v || "all"; render(); }));

  controls.appendChild(chipRow(
    WEAPON_TYPES.map((ty) => ({ value: ty, clearable: true, icon: `filters/Class-${ty === "polearm" ? "polearm" : ty}.png` })),
    ui.weaponType,
    (v) => { ui.weaponType = v; render(); },
  ));
  container.appendChild(controls);

  container.appendChild(el("p", "inv-hint small", t("inventory.weaponsHint")));

  const grid = el("div", "inv-grid");
  container.appendChild(grid);

  function renderGrid() {
    grid.innerHTML = "";
    const list = weaponList();
    if (!list.length) {
      grid.appendChild(el("div", "small muted", t("inventory.empty")));
      return;
    }
    for (const key of list) grid.appendChild(weaponCard(key));
  }
  renderGrid();
}

// ------------------------------------------------------------------ каркас

function render() {
  if (!host) return;
  host.innerHTML = "";

  const head = el("div", "inv-head");
  head.appendChild(el("p", "inv-hint small", t("inventory.hint")));

  const c = store.counts();
  const tabs = el("div", "inv-tabs");
  for (const [id, labelKey] of [["characters", "inventory.tabCharacters"], ["weapons", "inventory.tabWeapons"]]) {
    const btn = el("button", `inv-tab${ui.tab === id ? " is-active" : ""}`);
    btn.type = "button";
    btn.textContent = t(labelKey);
    const badge = el("span", "inv-tab-count", String(id === "characters" ? c.chars : c.weapons));
    btn.appendChild(badge);
    btn.addEventListener("click", () => { ui.tab = id; render(); });
    tabs.appendChild(btn);
  }
  head.appendChild(tabs);

  const actions = el("div", "inv-actions");
  const importBtn = el("button", "inv-btn", t("inventory.importGood"));
  importBtn.type = "button";
  importBtn.addEventListener("click", () => {
    document.getElementById("open-import")?.click();
  });

  const exportBtn = el("button", "inv-btn", t("inventory.exportJson"));
  exportBtn.type = "button";
  exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(store.snapshot(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "girec-inventory.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const resetBtn = el("button", "inv-btn inv-btn-danger", t("inventory.reset"));
  resetBtn.type = "button";
  resetBtn.addEventListener("click", () => {
    if (confirm(t("inventory.resetConfirm"))) store.reset();
  });

  actions.append(importBtn, exportBtn, resetBtn);
  head.appendChild(actions);
  host.appendChild(head);

  const body = el("div", "inv-body");
  host.appendChild(body);
  if (ui.tab === "characters") renderCharacters(body);
  else renderWeapons(body);
}

/**
 * @param {HTMLElement} container куда рендерить
 * @param {object} namesJson     names.json
 * @param {object} refsJson      refs.json
 */
export function mount(container, namesJson, refsJson) {
  host = container;
  names = namesJson || {};
  refs = refsJson || { fiveStars: {} };
  store.onChange(() => { if (host && host.isConnected) render(); });
  onLangChange(() => { if (host && host.isConnected) render(); });
  render();
}

export function refresh() { render(); }
