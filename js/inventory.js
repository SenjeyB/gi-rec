// Раздел «Инвентарь»: персонажи с созвездиями и своё 5★ оружие.
//
// Оружие хранится копиями, как в игровом инвентаре: одинаковых может быть
// несколько, и отряд, где два персонажа держат одну и ту же легендарку,
// требует двух копий. Поэтому оружие не «отмечается», а добавляется по одному
// экземпляру через окно выбора.

import * as store from "./store.js";
import { t, onChange as onLangChange } from "./i18n.js";
import { charLabel, weaponLabel } from "./labels.js";
import { openSheet } from "./sheet.js";

const ELEMENTS = ["pyro", "hydro", "anemo", "electro", "dendro", "cryo", "geo"];
const WEAPON_TYPES = ["sword", "claymore", "polearm", "bow", "catalyst"];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const elementIcon = (e) => `filters/Element_${cap(e)}.png`;
const typeIcon = (w) => `filters/Class-${w}.png`;

let names = {};
let refs = { fiveStars: {} };
let host = null;

const ui = {
  tab: "characters",
  charSearch: "",
  charOwned: "all",        // all | owned | missing
  charRarity: null,        // 5 | 4
  charElement: null,
  charWeapon: null,
  weaponSearch: "",
  weaponType: null,
  pickSearch: "",
  pickType: null,
  pickInTeams: false,
};

// Изменения, сделанные прямо здесь, применяем точечно, а не полной перерисовкой:
// иначе список прыгал наверх при каждом клике.
let localEdit = false;
function local(fn) {
  localEdit = true;
  try { fn(); } finally { localEdit = false; }
}

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

function button(cls, text) {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
}

/** Ряд чипов-переключателей. Повторный клик по активному снимает выбор, если clearable. */
function chipRow(items, active, onPick, label) {
  const row = el("div", "inv-chips");
  if (label) row.setAttribute("aria-label", label);
  for (const item of items) {
    const chip = button("inv-chip");
    if (item.icon) chip.appendChild(icon(item.icon, item.title || item.label || "", "inv-chip-icon"));
    if (item.label) chip.appendChild(el("span", null, item.label));
    if (item.title) chip.title = item.title;
    const on = item.value === active;
    chip.classList.toggle("is-active", on);
    chip.setAttribute("aria-pressed", String(on));
    chip.addEventListener("click", () => onPick(on && item.clearable ? null : item.value));
    row.appendChild(chip);
  }
  return row;
}

function searchBox(value, onInput) {
  const input = el("input", "inv-search");
  input.type = "search";
  input.placeholder = t("inventory.search");
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function stepper(value, min, max, onChange, fmt, minNote) {
  const box = el("div", "inv-stepper");
  const dec = button("inv-step", "−");
  dec.disabled = value <= min;
  if (dec.disabled && minNote) dec.title = minNote;
  dec.addEventListener("click", (e) => { e.stopPropagation(); onChange(value - 1); });
  const out = el("span", "inv-step-value", fmt(value));
  const inc = button("inv-step", "+");
  inc.disabled = value >= max;
  inc.addEventListener("click", (e) => { e.stopPropagation(); onChange(value + 1); });
  box.append(dec, out, inc);
  return box;
}

/** Перерисовывает сетку, не теряя прокрутку. */
function fillGrid(grid, nodes, emptyText) {
  const keep = grid.scrollTop;
  grid.innerHTML = "";
  if (!nodes.length) grid.appendChild(el("div", "small muted inv-empty", emptyText));
  for (const n of nodes) grid.appendChild(n);
  grid.scrollTop = keep;
}

function updateCounts() {
  if (!host) return;
  const c = store.counts();
  const tabs = host.querySelectorAll(".inv-tab .inv-tab-count");
  if (tabs[0]) tabs[0].textContent = String(c.chars);
  if (tabs[1]) tabs[1].textContent = String(c.weapons);
}

const matches = (q, ...hay) => !q || hay.some((h) => String(h || "").toLowerCase().includes(q));

// ------------------------------------------------------------- персонажи

function characterList() {
  const q = ui.charSearch.trim().toLowerCase();
  return Object.keys(names)
    .filter((k) => {
      const e = names[k];
      if (!e) return false;
      const owned = store.hasCharacter(k);
      if (ui.charOwned === "owned" && !owned) return false;
      if (ui.charOwned === "missing" && owned) return false;
      const five = (e.stars || 0) >= 3;
      if (ui.charRarity === 5 && !five) return false;
      if (ui.charRarity === 4 && five) return false;
      if (ui.charElement && e.element !== ui.charElement) return false;
      if (ui.charWeapon && e.weapon !== ui.charWeapon) return false;
      // ищем по подписи текущего языка и по английскому имени
      return matches(q, charLabel(k), e.name, k);
    })
    .sort((a, b) => {
      const sa = (names[a].stars || 0) >= 3 ? 1 : 0;
      const sb = (names[b].stars || 0) >= 3 ? 1 : 0;
      if (sa !== sb) return sb - sa;                        // сначала 5★
      return charLabel(a).localeCompare(charLabel(b));
    });
}

function characterCard(key) {
  const entry = names[key];
  const owned = store.hasCharacter(key);
  const card = el("div", `inv-card${owned ? " is-owned" : ""}`);
  card.dataset.key = key;

  const top = button("inv-card-main");
  top.setAttribute("aria-pressed", String(owned));
  top.title = owned ? t("inventory.owned") : t("inventory.notOwned");
  top.appendChild(icon(`characters/${key}.png`, charLabel(key), "inv-portrait"));
  top.appendChild(el("div", "inv-card-name", charLabel(key)));
  if (entry.element) top.appendChild(icon(elementIcon(entry.element), "", "inv-element"));
  top.addEventListener("click", () => {
    local(() => store.toggleCharacter(key));
    card.replaceWith(characterCard(key));
    updateCounts();
  });
  card.appendChild(top);

  if (owned && store.isFiveStar(key)) {
    const min = store.minCons(key);
    const row = el("div", "inv-card-foot");
    // минимум (бесплатный C1) виден по заблокированной «−»; отдельный бейдж
    // рядом со степпером на телефоне не помещался в карточку
    row.appendChild(stepper(store.consOf(key), min, 6,
      (v) => {
        local(() => store.setCons(key, v));
        card.replaceWith(characterCard(key));
      },
      (v) => `${t("inventory.consShort")}${v}`,
      min > 0 ? t("inventory.minC1Note") : ""));
    card.appendChild(row);
  }
  return card;
}

function renderCharacters(container) {
  const controls = el("div", "inv-controls");
  const grid = el("div", "inv-grid");
  const refill = () => fillGrid(grid, characterList().map(characterCard), t("inventory.notFound"));
  const rebuild = () => { container.innerHTML = ""; renderCharacters(container); };

  controls.appendChild(searchBox(ui.charSearch, (v) => { ui.charSearch = v; refill(); }));
  controls.appendChild(chipRow([
    { value: "all", label: t("inventory.filterAll") },
    { value: "owned", label: t("inventory.filterOwned") },
    { value: "missing", label: t("inventory.filterMissing") },
  ], ui.charOwned, (v) => { ui.charOwned = v || "all"; rebuild(); }));
  controls.appendChild(chipRow([
    { value: 5, label: "5★", clearable: true },
    { value: 4, label: "4★", clearable: true },
  ], ui.charRarity, (v) => { ui.charRarity = v; rebuild(); }));
  controls.appendChild(chipRow(
    ELEMENTS.map((e) => ({ value: e, clearable: true, icon: elementIcon(e), title: t(`element.${e}`) })),
    ui.charElement, (v) => { ui.charElement = v; rebuild(); }));
  controls.appendChild(chipRow(
    WEAPON_TYPES.map((w) => ({ value: w, clearable: true, icon: typeIcon(w), title: t(`weaponType.${w}`) })),
    ui.charWeapon, (v) => { ui.charWeapon = v; rebuild(); }));

  container.appendChild(controls);
  container.appendChild(grid);
  refill();
}

// ---------------------------------------------------------------- оружие

const catalog = () => refs.fiveStars || {};
const wName = (key) => weaponLabel(key) || (catalog()[key] || {}).name || key;

function ownedCopies() {
  const q = ui.weaponSearch.trim().toLowerCase();
  return store.weaponItems()
    .filter((item) => {
      const meta = catalog()[item.key] || {};
      if (ui.weaponType && meta.type !== ui.weaponType) return false;
      return matches(q, wName(item.key), meta.name, item.key);
    })
    // одинаковые копии держим рядом, как в игровом инвентаре
    .sort((a, b) => wName(a.key).localeCompare(wName(b.key)) || b.refine - a.refine);
}

function copyCard(item, onChanged) {
  const card = el("div", "inv-card inv-card-weapon is-owned");
  card.dataset.id = item.id;

  const top = el("div", "inv-card-main inv-card-static");
  top.appendChild(icon(`weapons/${item.key}.png`, wName(item.key), "inv-portrait"));
  top.appendChild(el("div", "inv-card-name", wName(item.key)));
  const remove = button("inv-remove", "✕");
  remove.title = t("inventory.remove");
  remove.setAttribute("aria-label", `${t("inventory.remove")}: ${wName(item.key)}`);
  remove.addEventListener("click", () => {
    local(() => store.removeWeapon(item.id));
    onChanged();
  });
  top.appendChild(remove);
  card.appendChild(top);

  const row = el("div", "inv-card-foot");
  row.appendChild(stepper(item.refine, 1, 5,
    (v) => {
      local(() => store.setItemRefine(item.id, v));
      card.replaceWith(copyCard({ ...item, refine: v }, onChanged));
    },
    (v) => `R${v}`));
  card.appendChild(row);
  return card;
}

function renderWeapons(container) {
  const controls = el("div", "inv-controls");
  const grid = el("div", "inv-grid");
  const summary = el("div", "inv-summary small muted");

  const refill = () => {
    fillGrid(grid, ownedCopies().map((it) => copyCard(it, refill)),
      store.counts().weapons ? t("inventory.notFound") : t("inventory.noWeaponsYet"));
    summary.textContent = t("inventory.copies", { n: store.counts().weapons });
    updateCounts();
  };
  const rebuild = () => { container.innerHTML = ""; renderWeapons(container); };

  const add = button("inv-btn inv-btn-primary", `+ ${t("inventory.addWeapon")}`);
  add.addEventListener("click", () => openPicker(refill));

  controls.appendChild(add);
  controls.appendChild(searchBox(ui.weaponSearch, (v) => { ui.weaponSearch = v; refill(); }));
  controls.appendChild(chipRow(
    WEAPON_TYPES.map((w) => ({ value: w, clearable: true, icon: typeIcon(w), title: t(`weaponType.${w}`) })),
    ui.weaponType, (v) => { ui.weaponType = v; rebuild(); }));

  container.appendChild(controls);
  container.appendChild(summary);
  container.appendChild(grid);
  refill();
}

/** Окно выбора: весь каталог 5★, клик добавляет одну копию. Окно не закрывается,
 *  чтобы можно было накидать несколько штук подряд. */
function openPicker(onAdded) {
  const sheet = openSheet({ title: t("inventory.addWeapon"), className: "sheet-wide" });
  const controls = el("div", "inv-controls");
  const grid = el("div", "inv-grid inv-grid-picker");
  const toast = el("div", "inv-toast");
  toast.setAttribute("role", "status");
  let toastTimer = null;

  const list = () => {
    const q = ui.pickSearch.trim().toLowerCase();
    return Object.keys(catalog())
      .filter((k) => {
        const w = catalog()[k];
        if (ui.pickType && w.type !== ui.pickType) return false;
        if (ui.pickInTeams && !w.inDb) return false;
        return matches(q, wName(k), w.name, k);
      })
      .sort((a, b) => wName(a).localeCompare(wName(b)));
  };

  const pickCard = (key) => {
    const w = catalog()[key] || {};
    const n = store.copiesOf(key);
    const card = button(`inv-card inv-card-weapon inv-pick${n ? " is-owned" : ""}`);
    card.appendChild(icon(`weapons/${key}.png`, wName(key), "inv-portrait"));
    card.appendChild(el("div", "inv-card-name", wName(key)));
    if (n) card.appendChild(el("span", "inv-count", `×${n}`));
    if (!w.inDb) {
      const mark = el("span", "inv-nodb", "·");
      mark.title = t("inventory.weaponsNotInDb");
      card.appendChild(mark);
    }
    card.addEventListener("click", () => {
      local(() => store.addWeapon(key, 1));
      card.replaceWith(pickCard(key));
      toast.textContent = t("inventory.added", { name: wName(key) });
      toast.classList.add("is-on");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("is-on"), 1400);
      onAdded();
    });
    return card;
  };

  const refill = () => fillGrid(grid, list().map(pickCard), t("inventory.notFound"));
  const rebuild = () => { sheet.body.innerHTML = ""; build(); };

  function build() {
    controls.innerHTML = "";
    controls.appendChild(searchBox(ui.pickSearch, (v) => { ui.pickSearch = v; refill(); }));
    controls.appendChild(chipRow(
      WEAPON_TYPES.map((w) => ({ value: w, clearable: true, icon: typeIcon(w), title: t(`weaponType.${w}`) })),
      ui.pickType, (v) => { ui.pickType = v; rebuild(); }));
    controls.appendChild(chipRow([
      { value: true, label: t("inventory.inTeamsOnly"), clearable: true },
    ], ui.pickInTeams || null, (v) => { ui.pickInTeams = !!v; rebuild(); }));
    sheet.body.append(controls, grid, toast);
    refill();
  }
  build();

  const done = button("inv-btn inv-btn-primary", t("inventory.done"));
  done.addEventListener("click", () => sheet.close());
  sheet.footer.hidden = false;
  sheet.footer.appendChild(done);
}

// ------------------------------------------------------------------ каркас

function render() {
  if (!host) return;
  const keepScroll = host.querySelector(".inv-grid")?.scrollTop || 0;
  host.innerHTML = "";

  const head = el("div", "inv-head");

  const c = store.counts();
  const tabs = el("div", "inv-tabs");
  for (const [id, labelKey] of [["characters", "inventory.tabCharacters"], ["weapons", "inventory.tabWeapons"]]) {
    const btn = button(`inv-tab${ui.tab === id ? " is-active" : ""}`, t(labelKey));
    btn.appendChild(el("span", "inv-tab-count", String(id === "characters" ? c.chars : c.weapons)));
    btn.addEventListener("click", () => { ui.tab = id; render(); });
    tabs.appendChild(btn);
  }
  head.appendChild(tabs);

  const actions = el("div", "inv-actions");
  const importBtn = button("inv-btn", t("inventory.importGood"));
  importBtn.addEventListener("click", () => document.getElementById("open-import")?.click());

  const exportBtn = button("inv-btn", t("inventory.exportJson"));
  exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(store.snapshot(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "girec-inventory.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const resetBtn = button("inv-btn inv-btn-danger", t("inventory.reset"));
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
  const grid = host.querySelector(".inv-grid");
  if (grid && keepScroll) grid.scrollTop = keepScroll;
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
  store.onChange(() => {
    if (localEdit) { updateCounts(); return; }
    if (host && host.isConnected) render();
  });
  onLangChange(() => { if (host && host.isConnected) render(); });
  render();
}

export function refresh() { render(); }
