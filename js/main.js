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

const settings = { allowFiveStar: false, onlyMyWeapons: false, kqmCons: false, kqmArt: false };

async function loadJSON(path) {
  const resp = await fetch(path, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`${path}: ${resp.status}`);
  return resp.json();
}

// ------------------------------------------------------------------ настройки

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    settings.allowFiveStar = !!raw.allowFiveStar;
    settings.onlyMyWeapons = !!raw.onlyMyWeapons;
    settings.kqmCons = !!raw.kqmCons;
    settings.kqmArt = !!raw.kqmArt;
  } catch { /* нет сохранённых — остаются значения по умолчанию */ }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* не критично */ }
}

/** Текущий срез отрядов под инвентарь и настройки. */
function currentTeams() {
  const cons = {};
  for (const k of store.ownedCharacters()) cons[k] = store.consOf(k);
  const weapons = {};
  for (const k of store.ownedWeapons()) weapons[k] = store.refineOf(k);
  return db.query({
    cons,
    weapons,
    allowFiveStar: settings.allowFiveStar,
    onlyMyWeapons: settings.onlyMyWeapons,
    kqmCons: settings.kqmCons,
    kqmArt: settings.kqmArt,
  });
}

function refresh() {
  if (!app) return;
  app.refreshTeams(currentTeams());
  updateFilterHint();
}

function updateFilterHint() {
  const host = document.getElementById("five-star-hint");
  if (!host) return;
  host.textContent = settings.allowFiveStar
    ? i18n.t("settings.allowFiveStarHint")
    : "";
}

function wireSettings() {
  const five = document.getElementById("allow-five-star");
  const mine = document.getElementById("only-my-weapons");
  if (five) {
    five.checked = settings.allowFiveStar;
    five.addEventListener("change", () => {
      settings.allowFiveStar = five.checked;
      if (mine) mine.disabled = !settings.allowFiveStar;
      saveSettings();
      refresh();
    });
  }
  for (const [id, key] of [["kqm-cons", "kqmCons"], ["kqm-art", "kqmArt"]]) {
    const box = document.getElementById(id);
    if (!box) continue;
    box.checked = settings[key];
    box.addEventListener("change", () => {
      settings[key] = box.checked;
      saveSettings();
      refresh();
    });
  }
  const reset = document.getElementById("reset-filters");
  if (reset) {
    reset.addEventListener("click", () => {
      Object.assign(settings, { allowFiveStar: false, onlyMyWeapons: false, kqmCons: false, kqmArt: false });
      saveSettings();
      for (const [id, key] of [["allow-five-star", "allowFiveStar"], ["only-my-weapons", "onlyMyWeapons"],
                               ["kqm-cons", "kqmCons"], ["kqm-art", "kqmArt"]]) {
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
    mine.disabled = !settings.allowFiveStar;
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
  window.addEventListener("girec:owned-changed", () => {
    if (syncing) return;
    syncing = true;
    try {
      let list = [];
      try { list = JSON.parse(localStorage.getItem("ownedSelection") || "[]"); } catch { list = []; }
      const keys = [];
      for (const disp of Array.isArray(list) ? list : []) {
        const k = store.keyOfDisplay(disp);
        if (k) keys.push(k);
      }
      store.setCharacterSet(keys);
      if (app) app.refreshTeams(currentTeams());
    } finally { syncing = false; }
  });
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

  app = await startApp({ names, teams: currentTeams(), refs });

  bridge();
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
