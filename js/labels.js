import { lang, t } from "./i18n.js";

const EMPTY = { chars: {}, weapons: {}, sets: {} };
const cache = new Map();
let keyByDisplay = {};

export async function load(code) {
  if (cache.has(code)) return cache.get(code);
  try {
    const resp = await fetch(`data/names.${code}.json`, { cache: "no-cache" });
    if (!resp.ok) throw new Error(String(resp.status));
    const data = await resp.json();
    cache.set(code, data);
    return data;
  } catch {
    cache.set(code, EMPTY);
    return EMPTY;
  }
}

const current = () => cache.get(lang()) || EMPTY;

export async function init(names) {
  keyByDisplay = {};
  for (const [key, entry] of Object.entries(names || {})) {
    const disp = (entry && entry.name) || key;
    if (!(disp in keyByDisplay)) keyByDisplay[disp] = key;
  }
  await load(lang());
}

export function charLabel(keyOrDisplay) {
  if (!keyOrDisplay) return "";
  const { chars } = current();
  const key = chars[keyOrDisplay] ? keyOrDisplay : keyByDisplay[keyOrDisplay];
  return (key && chars[key]) || keyOrDisplay;
}

export function weaponLabel(key) {
  return (key && current().weapons[key]) || key || "";
}

export function setLabel(key) {
  return (key && current().sets[key]) || key || "";
}

export function statLabel(stat) {
  if (!stat) return "";
  const key = `stats.${stat.replace("%", "Pct")}`;
  const s = t(key);
  return s === key ? stat.toUpperCase() : s;
}
