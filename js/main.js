import * as i18n from "./i18n.js";
import * as store from "./store.js";
import * as draft from "./draft.js";
import * as db from "./db.js";
import * as labels from "./labels.js";
import { mount as mountInventory } from "./inventory.js";
import { parseGood, looksLikeGood } from "./good.js";
import * as mobile from "./mobile.js";
import * as tour from "./tour.js";
import { openSheet } from "./sheet.js";
import { affordableTeams } from "./acquisitions.js";
import { start as startApp } from "../app.js";

const GITHUB_ISSUES = "https://github.com/SenjeyB/gi-rec/issues/new/choose";
const SETTINGS_KEY = "girec.filters";

let names = {};
let aliases = {};
let refs = null;
let app = null;

const DEFAULTS = { fiveStar: "none", kqmFull: false, kqmArt: false, consMode: "mine", showAssumed: true, showBossRuns: true,
  suggestCharacters: true, suggestConstellations: false, suggestWeapons: false };
const settings = { ...DEFAULTS };
const FIVE_MODES = ["none", "r1", "any", "mine"];

let content = null;

async function loadJSON(path) {
  const resp = await fetch(path, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`${path}: ${resp.status}`);
  return resp.json();
}

function updateKeywords() {
  const meta = document.querySelector('meta[name="keywords"]');
  if (!meta) return;
  const code = i18n.lang();
  const terms = code === "ru"
    ? ["GI-Rec", "Genshin Impact", "Геншин Импакт", "Геншин", "отряды", "DPS"]
    : ["GI-Rec", "Genshin Impact", "best teams", "team builder", "DPS"];
  for (const key of Object.keys(names)) terms.push(labels.charLabel(key), ...(aliases[code]?.[key] || []));
  meta.content = [...new Set(terms)].join(", ");
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
    settings.showAssumed = raw.showAssumed !== false;
    settings.showBossRuns = raw.showBossRuns ?? (raw.source !== "kqm");
    settings.suggestCharacters = raw.suggestCharacters !== false;
    settings.suggestConstellations = !!raw.suggestConstellations;
    settings.suggestWeapons = !!raw.suggestWeapons;
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
  const pool = db.query({
    allBuilds: true, consMode: "any", fiveStar: "any",
    kqmFull: settings.kqmFull,
    kqmArt: settings.kqmArt,
    showAssumed: settings.showAssumed, showBossRuns: settings.showBossRuns,
  });
  return affordableTeams(pool, {
    characters: Object.fromEntries(Object.entries(ownedCons()).map(([key, cons]) => [key, { cons }])),
    weapons: store.weaponCopies(),
  }, names, recommendationOptions(), Infinity);
}

function recommendationOptions() {
  return { characters: settings.suggestCharacters, constellations: settings.suggestConstellations, weapons: settings.suggestWeapons };
}

function strictTeams(weapons) {
  return db.query({
    cons: ownedCons(),
    weapons: weapons || store.weaponCopies(),
    consMode: "mine",
    fiveStar: "mine",
    kqmFull: settings.kqmFull,
    kqmArt: settings.kqmArt,
    showAssumed: settings.showAssumed, showBossRuns: settings.showBossRuns,
  });
}

function baseTeams() {
  return db.query({
    weapons: settings.fiveStar === "mine" ? store.weaponCopies() : {},
    consMode: settings.consMode === "any" ? "any" : "standard",
    fiveStar: settings.fiveStar,
    kqmFull: settings.kqmFull,
    kqmArt: settings.kqmArt,
    showAssumed: settings.showAssumed, showBossRuns: settings.showBossRuns,
  });
}

function refresh() {
  if (!app) return;
  app.refreshTeams(currentTeams(), strictTeams(), baseTeams());
  updateFilterHint();
}

function updateFilterHint() {
  const view = location.hash || "#recommendations";
  const inventory = view === "#inventory";
  const best = view === "#best-teams";
  const available = best && document.getElementById("best-teams-mode")?.value === "available";
  const fromInventory = view === "#team-builder" || available;
  const recommendations = view === "#recommendations" || view === "#tierlist";
  const showField = (id, show) => {
    const input = document.getElementById(id);
    const label = document.querySelector(`label[for="${id}"]`);
    if (input) input.hidden = !show;
    if (label) label.hidden = !show;
  };
  showField("mode", recommendations);
  showField("cons-mode", best && !available);
  showField("five-mode", best && !available);
  const proposals = document.getElementById("recommendation-options");
  if (proposals) proposals.hidden = !recommendations;
  for (const id of ["suggest-constellations", "suggest-weapons"]) {
    const input = document.getElementById(id);
    if (input) input.closest("label").hidden = settings.kqmFull;
  }
  const cons = document.getElementById("cons-mode");
  if (cons) {
    const mine = cons.querySelector('option[value="mine"]');
    if (mine) mine.hidden = best;
    cons.dataset.default = best ? "standard" : "mine";
    cons.value = best && settings.consMode === "mine" ? "standard" : settings.consMode;
  }
  const card = document.getElementById("settings-card");
  if (card) {
    card.hidden = inventory;
    card.classList.toggle("inventory-filters", fromInventory);
    if (fromInventory) card.querySelector("details").open = true;
  }
  const artifact = document.getElementById("kqm-art");
  if (artifact) artifact.closest("label").hidden = settings.kqmFull;
  const bossRuns = document.getElementById("show-boss-runs");
  if (bossRuns) bossRuns.closest("label").hidden = settings.kqmFull || settings.kqmArt;
  const quickInventory = !inventory && !(best && !available);
  const roster = document.getElementById("roster-card");
  if (roster) roster.hidden = !quickInventory;
  const drawer = document.getElementById("drawer-toggle");
  if (drawer) drawer.hidden = !quickInventory;
  document.body.dataset.quickInventory = String(quickInventory);
  mobile.refreshFilters?.();
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
  for (const [id, key] of [["kqm-full", "kqmFull"], ["kqm-art", "kqmArt"], ["show-assumed", "showAssumed"], ["show-boss-runs", "showBossRuns"],
    ["suggest-characters", "suggestCharacters"], ["suggest-constellations", "suggestConstellations"], ["suggest-weapons", "suggestWeapons"]]) {
    const box = document.getElementById(id);
    if (!box) continue;
    box.checked = settings[key];
    box.addEventListener("change", () => {
      settings[key] = box.checked;
      if (location.hash === "#tierlist" && ((["suggestConstellations", "suggestWeapons"].includes(key) && box.checked)
          || (key === "suggestCharacters" && !box.checked))) {
        try {
          if (!localStorage.getItem("tierDisplayMode") || localStorage.getItem("tierDisplayMode") === "not-owned") localStorage.setItem("tierDisplayMode", "all");
        } catch {}
      }
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
      const keys = ["kqmFull", "kqmArt", "showAssumed", "showBossRuns"];
      if (location.hash === "#best-teams") keys.push("consMode", "fiveStar");
      if (["#recommendations", "#tierlist"].includes(location.hash)) keys.push("suggestCharacters", "suggestConstellations", "suggestWeapons");
      for (const key of keys) settings[key] = DEFAULTS[key];
      app?.resetFilters?.();
      const cm = document.getElementById("cons-mode");
      if (cm) cm.value = settings.consMode;
      const fm = document.getElementById("five-mode");
      if (fm) fm.value = settings.fiveStar;
      for (const [id, key] of [["kqm-full", "kqmFull"], ["kqm-art", "kqmArt"], ["show-assumed", "showAssumed"], ["show-boss-runs", "showBossRuns"],
        ["suggest-characters", "suggestCharacters"], ["suggest-constellations", "suggestConstellations"], ["suggest-weapons", "suggestWeapons"]]) {
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

function wireTeamSubmission() {
  const open = document.getElementById("open-team-submission");
  if (!open) return;
  let active;
  open.addEventListener("click", () => {
    if (active) return;
    const sheet = openSheet({
      title: i18n.t("submission.title"),
      className: "team-submission",
      onClose() { active = null; open.focus({ preventScroll: true }); },
    });
    active = sheet;
    const title = sheet.panel.querySelector(".sheet-title");
    title.id = "team-submission-title";
    title.dataset.i18n = "submission.title";
    sheet.panel.setAttribute("aria-labelledby", title.id);
    sheet.panel.querySelector(".sheet-close").dataset.i18nAttr = "aria-label:common.close";
    const intro = document.createElement("p");
    intro.dataset.i18n = "submission.intro";
    const rules = document.createElement("ol");
    rules.className = "submission-rules";
    for (const key of ["simulation", "dummy"]) {
      const item = document.createElement("li");
      item.dataset.i18n = `submission.${key}`;
      rules.appendChild(item);
    }
    sheet.body.append(intro, rules);
    const link = document.createElement("a");
    link.className = "nav-link submission-proceed";
    link.href = "https://forms.gle/XnnbDkTDDvTGccCMA";
    link.target = "_blank";
    link.rel = "noopener";
    link.dataset.i18n = "submission.openForm";
    sheet.footer.hidden = false;
    sheet.footer.appendChild(link);
    i18n.apply(sheet.panel);
  });
}

function wireHeaderMenu() {
  const menu = document.getElementById("header-more");
  if (!menu) return;
  menu.addEventListener("click", (event) => {
    if (event.target.closest(".header-more-menu a, .header-more-menu button")) menu.open = false;
  });
  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
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
    document.querySelector(".app-container")?.classList.toggle("is-inventory", isInventory);
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

  [names, aliases] = await Promise.all([
    loadJSON("names.json"),
    loadJSON("data/character-aliases.json").catch(() => ({})),
  ]);
  const info = await db.init(names);
  refs = db.references();
  console.info(`gi-rec: база от ${info.generated} — ${info.teams} отрядов, ${info.builds} сборок`);

  await labels.init(names);
  updateKeywords();
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
    detailOptions: () => ({ excludeAssumed: !settings.showAssumed, excludeBossRuns: !settings.showBossRuns }),
    recommendationOptions,
    weaponCopies: () => store.weaponCopies(),
  });

  buildLangSwitcher();
  wireSettings();
  wireFeedback();
  wireTeamSubmission();
  wireHeaderMenu();
  wireImport();
  wireInventoryView();
  mobile.init();
  updateFilterHint();
  tour.init({ auto: firstVisit && !new URLSearchParams(location.search).has("char") });
  window.addEventListener("hashchange", updateFilterHint);
  document.addEventListener("girec:view-filters", updateFilterHint);

  i18n.onChange(() => {
    updateKeywords();
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
