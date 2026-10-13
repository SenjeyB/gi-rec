// Аккаунт игрока: персонажи с созвездиями и свои 5★ пушки.
// Живёт только в localStorage этого браузера, никуда не отправляется.
//
// Внутри всё идентифицируется ключами из names.json ("hutao", "kamisatoayaka"
// тут НЕ используется — только короткий ключ, он же имя файла картинки).
// Старый формат хранил отображаемые имена ("Hu Tao") — миграция ниже.

const KEY = "girec.inventory";
const LEGACY_KEY = "ownedSelection";
const VERSION = 1;

let names = {};          // ключ -> {name, element, weapon, stars, cons?}
let displayToKey = {};
let state = { version: VERSION, characters: {}, weapons: {} };
const listeners = new Set();

/** Минимальная конста: у персонажей с "cons":1 в names.json C1 — это база, ниже не опускаем. */
export function minCons(charKey) {
  const entry = names[charKey];
  return entry && entry.cons ? entry.cons : 0;
}

/** 5★ персонаж (включая стандартных) — только им имеет смысл крутить созвездия. */
export function isFiveStar(charKey) {
  const entry = names[charKey];
  return !!entry && (entry.stars || 0) >= 3;
}

export function displayName(charKey) {
  const entry = names[charKey];
  return (entry && entry.name) || charKey;
}

export function keyOfDisplay(display) {
  return displayToKey[display];
}

function clampCons(charKey, value) {
  const lo = minCons(charKey);
  const hi = isFiveStar(charKey) ? 6 : 6;
  const n = Number.isFinite(value) ? Math.round(value) : lo;
  return Math.min(hi, Math.max(lo, n));
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch { return null; }
}

function migrateLegacy() {
  // ownedSelection — массив отображаемых имён, созвездий там не было
  let list;
  try { list = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]"); } catch { list = []; }
  const characters = {};
  if (Array.isArray(list)) {
    for (const disp of list) {
      const k = displayToKey[disp];
      if (k) characters[k] = { cons: minCons(k) };
    }
  }
  return { version: VERSION, characters, weapons: {} };
}

function normalize(raw) {
  const out = { version: VERSION, characters: {}, weapons: {} };
  const chars = (raw && raw.characters) || {};
  for (const k of Object.keys(chars)) {
    if (!names[k]) continue;                     // персонаж пропал из names.json
    const v = chars[k] || {};
    out.characters[k] = { cons: clampCons(k, Number(v.cons)) };
  }
  const weps = (raw && raw.weapons) || {};
  for (const k of Object.keys(weps)) {
    const v = weps[k] || {};
    const r = Number(v.refine);
    out.weapons[k] = { refine: Math.min(5, Math.max(1, Number.isFinite(r) ? Math.round(r) : 1)) };
  }
  return out;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    // Зеркалим список во старый ключ, чтобы существующие вьюхи в app.js,
    // которые читают ownedSelection по отображаемым именам, продолжали работать.
    localStorage.setItem(LEGACY_KEY, JSON.stringify(ownedDisplayNames()));
  } catch { /* переполнение или приватный режим — молча живём в памяти */ }
}

function emit() {
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.error("account listener failed", e); }
  }
}

function changed() { persist(); emit(); }

// ------------------------------------------------------------------ чтение

export function ownedCharacters() {
  return Object.keys(state.characters).sort();
}

export function ownedDisplayNames() {
  return ownedCharacters().map(displayName);
}

export function hasCharacter(charKey) {
  return Object.prototype.hasOwnProperty.call(state.characters, charKey);
}

export function consOf(charKey) {
  const rec = state.characters[charKey];
  return rec ? rec.cons : minCons(charKey);
}

export function ownedWeapons() {
  return Object.keys(state.weapons).sort();
}

export function hasWeapon(weaponKey) {
  return Object.prototype.hasOwnProperty.call(state.weapons, weaponKey);
}

export function refineOf(weaponKey) {
  const rec = state.weapons[weaponKey];
  return rec ? rec.refine : 1;
}

export function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

export function counts() {
  return {
    chars: Object.keys(state.characters).length,
    weapons: Object.keys(state.weapons).length,
  };
}

// ------------------------------------------------------------------ запись

export function setCharacter(charKey, owned, cons) {
  if (!names[charKey]) return;
  if (owned) {
    const next = cons === undefined ? consOf(charKey) : cons;
    state.characters[charKey] = { cons: clampCons(charKey, Number(next)) };
  } else {
    delete state.characters[charKey];
  }
  changed();
}

export function toggleCharacter(charKey) {
  setCharacter(charKey, !hasCharacter(charKey));
}

export function setCons(charKey, cons) {
  if (!hasCharacter(charKey)) return;
  state.characters[charKey] = { cons: clampCons(charKey, Number(cons)) };
  changed();
}

export function bumpCons(charKey, delta) {
  if (!hasCharacter(charKey)) return;
  setCons(charKey, consOf(charKey) + delta);
}

export function setWeapon(weaponKey, owned, refine) {
  if (owned) {
    const r = refine === undefined ? refineOf(weaponKey) : refine;
    state.weapons[weaponKey] = { refine: Math.min(5, Math.max(1, Math.round(Number(r) || 1))) };
  } else {
    delete state.weapons[weaponKey];
  }
  changed();
}

export function toggleWeapon(weaponKey) {
  setWeapon(weaponKey, !hasWeapon(weaponKey));
}

export function setRefine(weaponKey, refine) {
  if (!hasWeapon(weaponKey)) return;
  setWeapon(weaponKey, true, refine);
}

/** Заменяет аккаунт целиком (импорт из GOOD). */
export function replace(next) {
  state = normalize(next);
  changed();
}

/** Массово выставить список персонажей (макро-кнопки), созвездия — минимальные. */
export function setCharacterSet(charKeys) {
  const chars = {};
  for (const k of charKeys) {
    if (!names[k]) continue;
    chars[k] = { cons: hasCharacter(k) ? consOf(k) : minCons(k) };
  }
  state.characters = chars;
  changed();
}

export function reset() {
  state = { version: VERSION, characters: {}, weapons: {} };
  changed();
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ------------------------------------------------------------------- старт

/** names — разобранный names.json. Вызывать один раз до рендера. */
export function init(namesJson) {
  names = namesJson || {};
  displayToKey = {};
  for (const k of Object.keys(names)) {
    const disp = (names[k] && names[k].name) || k;
    if (!(disp in displayToKey)) displayToKey[disp] = k;
  }

  const stored = read();
  state = stored ? normalize(stored) : migrateLegacy();
  // Миграцию сразу закрепляем, чтобы второй раз не пересчитывать
  if (!stored) persist();

  // Другая вкладка могла поменять аккаунт
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    const fresh = read();
    if (fresh) { state = normalize(fresh); emit(); }
  });

  return state;
}
