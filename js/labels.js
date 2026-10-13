// Локализованные подписи для персонажей, оружия, сетов и статов.
//
// Важно: внутренние идентификаторы остаются английскими. app.js опознаёт
// персонажей по английскому display-имени (selected, keyByDisplay, ключи
// localStorage), и переводить их «в лоб» значило бы сломать сохранённый выбор
// при каждой смене языка. Поэтому здесь только подписи поверх тех же ключей.

import { lang, t } from "./i18n.js";

const cache = new Map();          // lang -> {chars, weapons, sets}
let current = { chars: {}, weapons: {}, sets: {} };
let keyByDisplay = {};            // английское имя -> ключ names.json

async function loadFor(code) {
  if (cache.has(code)) return cache.get(code);
  try {
    const resp = await fetch(`data/names.${code}.json`, { cache: "no-cache" });
    if (!resp.ok) throw new Error(String(resp.status));
    const data = await resp.json();
    cache.set(code, data);
    return data;
  } catch {
    const empty = { chars: {}, weapons: {}, sets: {} };
    cache.set(code, empty);
    return empty;
  }
}

/** names — names.json; нужен, чтобы находить ключ по английскому имени. */
export async function init(names) {
  keyByDisplay = {};
  for (const [key, entry] of Object.entries(names || {})) {
    const disp = (entry && entry.name) || key;
    if (!(disp in keyByDisplay)) keyByDisplay[disp] = key;
  }
  current = await loadFor(lang());
}

export async function reload() {
  current = await loadFor(lang());
}

/** Подпись персонажа. Принимает и ключ (hutao), и английское имя (Hu Tao). */
export function charLabel(keyOrDisplay) {
  if (!keyOrDisplay) return "";
  const key = current.chars[keyOrDisplay] ? keyOrDisplay : keyByDisplay[keyOrDisplay];
  return (key && current.chars[key]) || keyOrDisplay;
}

export function weaponLabel(key) {
  return (key && current.weapons[key]) || key || "";
}

export function setLabel(key) {
  return (key && current.sets[key]) || key || "";
}

/** Подпись стата артефакта: atk% -> «ATK%» / «Сила атаки %». */
export function statLabel(stat) {
  if (!stat) return "";
  const key = `stats.${stat.replace("%", "Pct")}`;
  const s = t(key);
  return s === key ? stat.toUpperCase() : s;
}
