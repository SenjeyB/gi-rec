import * as i18n from "./i18n.js";
import * as store from "./store.js";
import * as draft from "./draft.js";
import * as db from "./db.js";
import * as labels from "./labels.js";
import { mount as mountInventory } from "./inventory.js";
import { parseGood, looksLikeGood } from "./good.js";
import * as mobile from "./mobile.js";
import * as tour from "./tour.js";
import { start as startApp } from "../app.js";

const GITHUB_ISSUES = "https://github.com/SenjeyB/gi-rec/issues/new/choose";
const SETTINGS_KEY = "girec.filters";

let names = {};
let refs = null;
let app = null;

const DEFAULTS = { fiveStar: "none", kqmFull: false, kqmArt: false, consMode: "mine", source: "all" };
const SOURCES = ["all", "kqm", "real"];
const settings = { ...DEFAULTS };
const FIVE_MODES = ["none", "r1", "any", "mine"];

let content = null;

async function loadJSON(path) {
  const resp = await fetch(path, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`${path}: ${resp.status}`);
  return resp.json();
}

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    let five = FIVE_MODES.includes(raw.fiveStar) ? raw.fiveStar : (raw.allowFiveStar ? "r1" : "none");
    if (raw.onlyMyWeapons && five !== "none") five = "mine";
    settings.fiveStar = five;
    settings.kqmFull = !!(raw.kqmFull ?? raw.kqmCons);
    settings.kqmArt = !!raw.kqmArt;
    settings.consMode = ["standard", "mine", "any"].includes(raw.consMode) ? raw.consMode : "mine";
    settings.source = SOURCES.includes(raw.source) ? raw.source : "all";
  } catch {}
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

function ownedCons() {
  const cons = {};
  for (const k of draft.characters()) cons[k] = draft.consOf(k);
  return cons;
}

function currentTeams() {
  return db.query({
    cons: ownedCons(),
    weapons: store.weaponCopies(),
    consMode: settings.consMode,
    fiveStar: settings.fiveStar,
    kqmFull: settings.kqmFull,
    kqmArt: settings.kqmArt,
    source: settings.source,
  });
}

function strictTeams(weapons) {
  return db.query({
    cons: ownedCons(),
    weapons: weapons || store.weaponCopies(),
    consMode: "mine",
    fiveStar: "mine",
    kqmFull: settings.kqmFull,
    kqmArt: settings.kqmArt,
    source: settings.source,
  });
}

function baseTeams() {
  return db.query({
    weapons: settings.fiveStar === "mine" ? store.weaponCopies() : {},
    consMode: settings.consMode === "any" ? "any" : "standard",
    fiveStar: settings.fiveStar,
    kqmFull: settings.kqmFull,
    kqmArt: settings.kqmArt,
    source: settings.source,
  });
}

function refresh() {
  if (!app) return;
  app.refreshTeams(currentTeams(), strictTeams(), baseTeams());
  updateFilterHint();
}

function updateFilterHint() {
}

function wireSettings() {
  const five = document.getElementById("five-mode");
  if (five) {
    five.value = settings.fiveStar;
    five.addEventListener("change", () => {
      settings.fiveStar = five.value;
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
  const sourceSel = document.getElementById("source-mode");
  if (sourceSel) {
    sourceSel.value = settings.source;
    sourceSel.addEventListener("change", () => {
      settings.source = sourceSel.value;
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
      const sm = document.getElementById("source-mode");
      if (sm) sm.value = settings.source;
      for (const [id, key] of [["kqm-full", "kqmFull"], ["kqm-art", "kqmArt"]]) {
        const box = document.getElementById(id);
        if (box) box.checked = settings[key];
      }
      saveSettings();
      refresh();
    });
  }
}

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

function bridge() {
  draft.onChange(() => refresh());
}

function isFirstVisit() {
  try {
    if (localStorage.getItem("girec.seeded")) return false;
  } catch { return false; }
  return store.counts().chars === 0;
}

function seedDefaults() {
  try {
    if (localStorage.getItem("girec.seeded")) return;
    localStorage.setItem("girec.seeded", "1");
  } catch { return; }
  if (store.counts().chars > 0) return;
  store.setCharacterSet(Object.keys(names).filter((k) => (names[k] || {}).stars === 1));
  try {
    if (!localStorage.getItem("settingMode")) localStorage.setItem("settingMode", "2");
  } catch {}
}

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

async function boot() {
  await i18n.init();
  loadSettings();

  names = await loadJSON("names.json");
  const info = await db.init(names);
  refs = db.references();
  console.info(`gi-rec: база от ${info.generated} — ${info.teams} отрядов, ${info.builds} сборок`);

  await labels.init(names);
  i18n.addLoader(labels.load);
  store.init(names);
  const firstVisit = isFirstVisit();
  seedDefaults();
  draft.init(names);
  bridge();
  try { content = await loadJSON("data/content.json"); } catch { content = null; }
  app = await startApp({
    names, refs, content,
    teams: currentTeams(), strictTeams: strictTeams(), baseTeams: baseTeams(),
    strictWith: (weapons) => strictTeams(weapons),
    weaponCopies: () => store.weaponCopies(),
  });

  buildLangSwitcher();
  wireSettings();
  wireFeedback();
  wireImport();
  wireInventoryView();
  mobile.init();
  updateFilterHint();
  tour.init({ auto: firstVisit && !new URLSearchParams(location.search).has("char") });

  i18n.onChange(() => {
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
