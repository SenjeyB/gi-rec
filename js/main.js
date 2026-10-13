// Точка входа. Поднимает локализацию, инвентарь и базу отрядов, затем запускает
// вьюхи из app.js. Всё асинхронное закончено до первого рендера, поэтому страница
// сразу рисуется на нужном языке и с отрядами под текущий инвентарь.

import * as i18n from "./i18n.js";
import * as store from "./store.js";
import * as db from "./db.js";
import * as labels from "./labels.js";
import { mount as mountInventory } from "./inventory.js";
import { parseGood, looksLikeGood } from "./good.js";
import * as mobile from "./mobile.js";
import { start as startApp } from "../app.js";

const GITHUB_ISSUES = "https://github.com/SenjeyB/gi-rec/issues/new/choose";
const SETTINGS_KEY = "girec.filters";

let names = {};
let refs = null;
let app = null;
let syncing = false;

const DEFAULTS = { fiveStar: "none", onlyMyWeapons: false, kqmFull: false, kqmArt: false, consMode: "mine" };
const settings = { ...DEFAULTS };

async function loadJSON(path) {
  const resp = await fetch(path, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`${path}: ${resp.status}`);
  return resp.json();
}

// ------------------------------------------------------------------ настройки

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    // до 2.4.0 был тогл allowFiveStar (только R1)
    settings.fiveStar = ["none", "r1", "any"].includes(raw.fiveStar) ? raw.fiveStar
      : (raw.allowFiveStar ? "r1" : "none");
    settings.onlyMyWeapons = !!raw.onlyMyWeapons;
    // до 2.2.1 фильтр назывался kqmCons и проверял только созвездия
    settings.kqmFull = !!(raw.kqmFull ?? raw.kqmCons);
    settings.kqmArt = !!raw.kqmArt;
    settings.consMode = ["standard", "mine", "any"].includes(raw.consMode) ? raw.consMode : "mine";
  } catch { /* нет сохранённых — остаются значения по умолчанию */ }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* не критично */ }
}

/** Текущий срез отрядов под инвентарь и настройки. */
function currentTeams() {
  const cons = {};
  for (const k of store.ownedCharacters()) cons[k] = store.consOf(k);
  const weapons = store.weaponCopies();   // ключ -> рефайны всех копий
  return db.query({
    cons,
    weapons,
    consMode: settings.consMode,
    fiveStar: settings.fiveStar,
    onlyMyWeapons: settings.onlyMyWeapons,
    kqmFull: settings.kqmFull,
    kqmArt: settings.kqmArt,
  });
}

/** Строгий срез для сборщика и подсказок: отряд должен реально собираться на
 *  том, что есть у игрока. Созвездия берём как выставлено, а 5* оружие обязано
 *  лежать в инвентаре — даже если в общих настройках «только мои» выключено.
 *  В общем списке это было бы лишним: там показываются и те, кого ещё нет. */
function strictTeams() {
  const cons = {};
  for (const k of store.ownedCharacters()) cons[k] = store.consOf(k);
  const weapons = store.weaponCopies();   // ключ -> рефайны всех копий
  return db.query({
    cons, weapons, strictCons: true,
    fiveStar: settings.fiveStar,
    onlyMyWeapons: true,
    kqmFull: settings.kqmFull,
    kqmArt: settings.kqmArt,
  });
}

/** Срез без учёта инвентаря: у всех стандартные созвездия. Явные фильтры из
 *  настроек (5★, KQMS, «только моё оружие») при этом действуют. */
function baseTeams() {
  return db.query({
    weapons: settings.onlyMyWeapons ? store.weaponCopies() : {},
    consMode: settings.consMode === "any" ? "any" : "standard",
    fiveStar: settings.fiveStar,
    onlyMyWeapons: settings.onlyMyWeapons,
    kqmFull: settings.kqmFull,
    kqmArt: settings.kqmArt,
  });
}

function refresh() {
  if (!app) return;
  app.refreshTeams(currentTeams(), strictTeams(), baseTeams());
  updateFilterHint();
}

function updateFilterHint() {
  // пояснение под тоглом 5★ убрано по просьбе: оно дублировало подпись
}

function wireSettings() {
  const five = document.getElementById("five-mode");
  const mine = document.getElementById("only-my-weapons");
  if (five) {
    five.value = settings.fiveStar;
    five.addEventListener("change", () => {
      settings.fiveStar = five.value;
      if (mine) mine.disabled = settings.fiveStar === "none";
      saveSettings();
      refresh();
    });
  }
  for (const [id, key] of [["kqm-full", "kqmFull"], ["kqm-art", "kqmArt"]]) {
    const box = document.getElementById(id);
    if (!box) continue;
    box.checked = settings[key];
    box.addEventListener("change", () => {
      settings[key] = box.checked;
      saveSettings();
      refresh();
    });
  }
  const consSel = document.getElementById("cons-mode");
  if (consSel) {
    consSel.value = settings.consMode;
    consSel.addEventListener("change", () => {
      settings.consMode = consSel.value;
      saveSettings();
      refresh();
    });
  }
  const reset = document.getElementById("reset-filters");
  if (reset) {
    reset.addEventListener("click", () => {
      Object.assign(settings, DEFAULTS);
      const cm = document.getElementById("cons-mode");
      if (cm) cm.value = settings.consMode;
      const fm = document.getElementById("five-mode");
      if (fm) fm.value = settings.fiveStar;
      saveSettings();
      for (const [id, key] of [["only-my-weapons", "onlyMyWeapons"],
                               ["kqm-full", "kqmFull"], ["kqm-art", "kqmArt"]]) {
        const box = document.getElementById(id);
        if (box) box.checked = settings[key];
      }
      const m = document.getElementById("only-my-weapons");
      if (m) m.disabled = true;
      refresh();
    });
  }
  if (mine) {
    mine.checked = settings.onlyMyWeapons;
    mine.disabled = settings.fiveStar === "none";
    mine.addEventListener("change", () => {
      settings.onlyMyWeapons = mine.checked;
      saveSettings();
      refresh();
    });
  }
}

// ------------------------------------------------------------ переключатель языка

function buildLangSwitcher() {
  const host = document.getElementById("lang-switch");
  if (!host) return;
  host.innerHTML = "";
  host.setAttribute("aria-label", i18n.t("lang.switch"));
  for (const code of i18n.supported()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lang-btn" + (code === i18n.lang() ? " is-active" : "");
    btn.textContent = code.toUpperCase();
    btn.title = i18n.t(`lang.${code}`);
    btn.addEventListener("click", () => i18n.setLang(code));
    host.appendChild(btn);
  }
}

// ------------------------------------------------------------------ фидбек

function wireFeedback() {
  const open = document.getElementById("open-feedback");
  const modal = document.getElementById("feedback-modal");
  if (!open || !modal) return;
  const close = () => { modal.hidden = true; };
  open.addEventListener("click", () => { modal.hidden = false; });
  modal.querySelector("[data-feedback-close]")?.addEventListener("click", close);
  modal.querySelector(".modal-backdrop")?.addEventListener("click", close);
  modal.querySelector("[data-feedback-cancel]")?.addEventListener("click", close);
  modal.querySelector("[data-feedback-proceed]")?.addEventListener("click", () => {
    window.open(GITHUB_ISSUES, "_blank", "noopener");
    close();
  });
}

// ------------------------------------------------------------- вид «Инвентарь»

function wireInventoryView() {
  const section = document.getElementById("inventory-view");
  const container = document.getElementById("inventory-content");
  if (!section || !container) return;

  mountInventory(container, names, refs);

  const viewContainer = document.getElementById("view-container");
  const sync = () => {
    const isInventory = location.hash === "#inventory";
    section.hidden = !isInventory;
    if (viewContainer) viewContainer.hidden = isInventory;
    for (const link of document.querySelectorAll(".side-nav .nav-link")) {
      link.classList.toggle("active", link.getAttribute("href") === location.hash);
    }
  };
  window.addEventListener("hashchange", sync);
  sync();
}

// --------------------------------------------------- синхронизация с app.js

function bridge() {
  // инвентарь поменялся здесь -> app.js перечитывает выбор, отряды пересобираются
  store.onChange(() => {
    if (syncing) return;
    syncing = true;
    try {
      window.dispatchEvent(new CustomEvent("girec:inventory-changed"));
      refresh();
    } finally { syncing = false; }
  });

  // выбор поменялся в сайдбаре app.js -> подтягиваем в инвентарь, созвездия не теряем
  window.addEventListener("girec:owned-changed", syncFromLegacy);
}

function syncFromLegacy() {
  if (syncing) return;
  syncing = true;
  try {
    let list = [];
    try { list = JSON.parse(localStorage.getItem("ownedSelection") || "[]"); } catch { list = []; }
    // app.js с 2.2 кладёт сюда ключи; на всякий случай принимаем и старые имена
    const keys = [];
    for (const item of Array.isArray(list) ? list : []) {
      keys.push(store.keyOfDisplay(item) || item);
    }
    store.setCharacterSet(keys);
    if (app) app.refreshTeams(currentTeams(), strictTeams(), baseTeams());
  } finally { syncing = false; }
}

// ------------------------------------------------------------- импорт GOOD

function wireImport() {
  const statusEl = document.getElementById("good-status");
  const say = (msg, ok) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle("ok", !!ok);
  };

  const handle = (text) => {
    if (!text || !text.trim()) { say(i18n.t("import.empty")); return; }
    let obj;
    try { obj = JSON.parse(text); } catch { say(i18n.t("import.invalidJson")); return; }
    if (!looksLikeGood(obj)) { say(i18n.t("import.notGood")); return; }

    const res = parseGood(obj, names, refs);
    if (!res.stats.chars && !res.stats.weapons) { say(i18n.t("import.none")); return; }
    store.replace(res.account);
    say(i18n.t("import.done", res.stats), true);
    if (res.unknown.characters.length) {
      console.info("GOOD import — unrecognized characters:", res.unknown.characters);
    }
    const modal = document.getElementById("import-modal");
    if (modal) modal.hidden = true;
  };

  document.getElementById("import-paste")?.addEventListener("click",
    () => handle(document.getElementById("good-text")?.value || ""));
  document.getElementById("import-clipboard")?.addEventListener("click", async () => {
    try { handle(await navigator.clipboard.readText()); }
    catch { say(i18n.t("import.clipboardDenied")); }
  });
  const file = document.getElementById("good-file");
  file?.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    if (!f) { say(i18n.t("import.noFile")); return; }
    handle(await f.text());
  });
}

// --------------------------------------------------------------------- старт

async function boot() {
  await i18n.init();
  loadSettings();

  names = await loadJSON("names.json");
  const info = await db.init(names);
  refs = db.references();
  console.info(`gi-rec: база от ${info.generated} — ${info.teams} отрядов, ${info.builds} сборок`);

  await labels.init(names);
  store.init(names);

  // Мост поднимаем до старта вьюх: app.js при первом запуске сам проставляет
  // набор по умолчанию и сразу шлёт girec:owned-changed — если слушателя ещё нет,
  // инвентарь останется пустым, пока пользователь что-нибудь не тронет.
  bridge();
  app = await startApp({ names, teams: currentTeams(), strictTeams: strictTeams(), baseTeams: baseTeams(), refs });

  // и подтягиваем то, что app.js успел записать до появления слушателя
  syncFromLegacy();
  buildLangSwitcher();
  wireSettings();
  wireFeedback();
  wireImport();
  wireInventoryView();
  mobile.init();
  updateFilterHint();

  i18n.onChange(async () => {
    await labels.reload();
    buildLangSwitcher();
    updateFilterHint();
    if (app) app.rerender();
  });
}

boot().catch((e) => {
  console.error("girec boot failed", e);
  const host = document.getElementById("view-content");
  if (host) host.textContent = "Failed to load data.";
});
