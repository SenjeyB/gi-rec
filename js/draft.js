// Быстрые настройки инвентаря (левый блок): черновик персонажей и созвездий.
//
// Отряды на всех вкладках считаются по черновику — можно прикинуть «а если бы
// у меня была ещё Фурина», не трогая инвентарь. «Сохранить» переносит черновик
// в инвентарь, «Откатить» возвращает его к инвентарю. Любое изменение самого
// инвентаря (раздел «Инвентарь», импорт GOOD, другая вкладка) черновик сбрасывает.
// Оружие черновик не трогает — оно всегда из инвентаря.

import * as store from "./store.js";

const KEY = "girec.draft";

let chars = new Set();
let cons = {};
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ chars: [...chars], cons }));
  } catch { /* приватный режим — живём в памяти */ }
}

function emit() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error("draft listener failed", e); }
  }
}

function changed() { persist(); emit(); }

function fromStore() {
  chars = new Set(store.ownedCharacters());
  cons = {};
  for (const k of chars) cons[k] = store.consOf(k);
}

const clamp = (n) => Math.min(6, Math.max(0, Number.isFinite(n) ? Math.round(n) : 0));

// ------------------------------------------------------------------ чтение

export function characters() { return [...chars]; }
export function has(key) { return chars.has(key); }
export function consOf(key) { return cons[key] ?? 0; }

/** Отличается ли черновик от инвентаря. */
export function isDirty() {
  const saved = store.ownedCharacters();
  if (saved.length !== chars.size) return true;
  for (const k of saved) {
    if (!chars.has(k) || consOf(k) !== store.consOf(k)) return true;
  }
  return false;
}

// ------------------------------------------------------------------ запись

export function toggle(key) {
  if (chars.has(key)) { chars.delete(key); delete cons[key]; }
  else { chars.add(key); cons[key] = store.hasCharacter(key) ? store.consOf(key) : 0; }
  changed();
}

/** Добавить группу (быстрые кнопки «Все 4★» и т.п.); созвездия не сбрасываются. */
export function addAll(keys) {
  for (const k of keys) {
    if (chars.has(k)) continue;
    chars.add(k);
    cons[k] = store.hasCharacter(k) ? store.consOf(k) : 0;
  }
  changed();
}

export function clear() {
  chars = new Set();
  cons = {};
  changed();
}

export function setCons(key, value) {
  if (!chars.has(key)) return;
  cons[key] = clamp(Number(value));
  changed();
}

/** Перенести черновик в инвентарь. Инвентарь сообщит об изменении, и черновик
 *  пересоберётся из него — то есть совпадёт сам с собой. */
export function save() {
  const map = {};
  for (const k of chars) map[k] = consOf(k);
  store.setCharacters(map);
}

/** Вернуть черновик к инвентарю. */
export function rollback() {
  fromStore();
  changed();
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Вызывать после store.init(). */
export function init(names) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { saved = null; }
  if (saved && Array.isArray(saved.chars)) {
    chars = new Set(saved.chars.filter((k) => names[k]));
    cons = {};
    for (const k of chars) cons[k] = clamp(Number((saved.cons || {})[k]));
  } else {
    fromStore();
    persist();
  }
  // правка инвентаря напрямую откатывает быстрые настройки
  store.onChange(() => { fromStore(); changed(); });
}
