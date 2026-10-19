// Локализация. Словари лежат в i18n/<lang>.json, ключи с точками: "nav.account".
//
// Разметка переводится атрибутами:
//   <h2 data-i18n="account.title"></h2>
//   <input data-i18n-attr="placeholder:account.search, aria-label:roster.searchLabel">
//   <span data-i18n="account.summary" data-i18n-vars='{"chars":12,"weapons":3}'></span>
//
// Язык: сохранённый выбор -> язык браузера -> en.

const SUPPORTED = ["en", "ru"];
const FALLBACK = "en";
const STORAGE_KEY = "girec.lang";

const dicts = new Map();
let current = FALLBACK;
const listeners = new Set();

function detect() {
  // ?lang=ru в адресе — ссылка со статической страницы на нужном языке
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q && SUPPORTED.includes(q)) {
      try { localStorage.setItem(STORAGE_KEY, q); } catch { /* не критично */ }
      return q;
    }
  } catch { /* нет location — тесты */ }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch { /* приватный режим — просто идём дальше */ }

  const prefs = (navigator.languages && navigator.languages.length)
    ? navigator.languages
    : [navigator.language || navigator.userLanguage || FALLBACK];
  for (const raw of prefs) {
    const tag = String(raw || "").toLowerCase();
    const base = tag.split("-")[0];
    if (SUPPORTED.includes(tag)) return tag;
    if (SUPPORTED.includes(base)) return base;
  }
  return FALLBACK;
}

async function loadDict(lang) {
  if (dicts.has(lang)) return dicts.get(lang);
  const resp = await fetch(`i18n/${lang}.json`, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`i18n/${lang}.json: ${resp.status}`);
  const dict = await resp.json();
  dicts.set(lang, dict);
  return dict;
}

function lookup(dict, path) {
  let node = dict;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Перевод по ключу. {vars} подставляются по имени; отсутствующий ключ возвращается как есть. */
export function t(path, vars) {
  let s = lookup(dicts.get(current) || {}, path);
  if (s === undefined) s = lookup(dicts.get(FALLBACK) || {}, path);
  if (s === undefined) return path;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function lang() { return current; }
export function supported() { return [...SUPPORTED]; }

/** Подписка на смену языка. Возвращает функцию отписки. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Переводит дерево (по умолчанию весь документ). */
export function apply(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    let vars;
    const rawVars = el.getAttribute("data-i18n-vars");
    if (rawVars) {
      try { vars = JSON.parse(rawVars); } catch { vars = undefined; }
    }
    el.textContent = t(el.getAttribute("data-i18n"), vars);
  }
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    // формат: "placeholder:ключ, aria-label:другой.ключ"
    for (const pair of el.getAttribute("data-i18n-attr").split(",")) {
      const idx = pair.indexOf(":");
      if (idx < 0) continue;
      const attr = pair.slice(0, idx).trim();
      const key = pair.slice(idx + 1).trim();
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
  if (root === document) {
    document.documentElement.lang = current;
    const title = t("app.pageTitle");
    if (title !== "app.pageTitle") document.title = title;
    const desc = t("app.metaDescription");
    const meta = document.querySelector('meta[name="description"]');
    if (meta && desc !== "app.metaDescription") meta.setAttribute("content", desc);
  }
}

/** Меняет язык, догружает словарь, перерисовывает разметку и уведомляет подписчиков. */
export async function setLang(next) {
  if (!SUPPORTED.includes(next)) return;
  await loadDict(next);
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* не критично */ }
  apply();
  for (const fn of listeners) {
    try { fn(current); } catch (e) { console.error("i18n listener failed", e); }
  }
}

/** Грузит fallback + выбранный язык и переводит страницу. Вызывать один раз на старте. */
export async function init() {
  const want = detect();
  await loadDict(FALLBACK);
  if (want !== FALLBACK) {
    try { await loadDict(want); } catch { /* нет словаря — остаёмся на fallback */ }
  }
  current = dicts.has(want) ? want : FALLBACK;
  apply();
  return current;
}
