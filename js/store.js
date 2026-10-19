const KEY = "girec.inventory";
const LEGACY_KEY = "ownedSelection";
const VERSION = 2;

let names = {};
let displayToKey = {};
let state = { version: VERSION, characters: {}, weapons: [] };
const listeners = new Set();

export function isFiveStar(charKey) {
  const entry = names[charKey];
  return !!entry && (entry.stars || 0) >= 3;
}

export function groupKeys(group) {
  const want = { free: [1], four: [1, 2], standard: [3] }[group];
  return Object.keys(names).filter((k) => !want || want.includes((names[k] || {}).stars));
}

export function displayName(charKey) {
  const entry = names[charKey];
  return (entry && entry.name) || charKey;
}

export function keyOfDisplay(display) {
  return displayToKey[display];
}

function clampCons(value) {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.min(6, Math.max(0, n));
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
  let list;
  try { list = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]"); } catch { list = []; }
  const characters = {};
  if (Array.isArray(list)) {
    for (const item of list) {
      const k = names[item] ? item : displayToKey[item];
      if (k) characters[k] = { cons: 0 };
    }
  }
  return { version: VERSION, characters, weapons: [] };
}

const clampRefine = (r) => {
  const n = Number(r);
  return Math.min(5, Math.max(1, Number.isFinite(n) ? Math.round(n) : 1));
};

let idSeq = 0;
function newId() {
  idSeq += 1;
  return `w${Date.now().toString(36)}${idSeq.toString(36)}`;
}

function normalize(raw) {
  const out = { version: VERSION, characters: {}, weapons: [] };
  const chars = (raw && raw.characters) || {};
  for (const k of Object.keys(chars)) {
    if (!names[k]) continue;
    const v = chars[k] || {};
    out.characters[k] = { cons: clampCons(Number(v.cons)) };
  }
  const weps = raw && raw.weapons;
  if (Array.isArray(weps)) {
    for (const item of weps) {
      if (!item || !item.key) continue;
      out.weapons.push({ id: item.id || newId(), key: String(item.key), refine: clampRefine(item.refine) });
    }
  } else if (weps && typeof weps === "object") {
    for (const k of Object.keys(weps)) {
      out.weapons.push({ id: newId(), key: k, refine: clampRefine((weps[k] || {}).refine) });
    }
  }
  return out;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    localStorage.setItem(LEGACY_KEY, JSON.stringify(ownedCharacters()));
  } catch {}
}

function emit() {
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.error("account listener failed", e); }
  }
}

function changed() { persist(); emit(); }

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
  return rec ? rec.cons : 0;
}

export function weaponItems() {
  return state.weapons.map((w) => ({ ...w }));
}

export function ownedWeapons() {
  return [...new Set(state.weapons.map((w) => w.key))].sort();
}

export function weaponCopies() {
  const out = {};
  for (const w of state.weapons) (out[w.key] ||= []).push(w.refine);
  return out;
}

export function copiesOf(weaponKey) {
  return state.weapons.filter((w) => w.key === weaponKey).length;
}

export function hasWeapon(weaponKey) {
  return state.weapons.some((w) => w.key === weaponKey);
}

export function refineOf(weaponKey) {
  let best = 0;
  for (const w of state.weapons) if (w.key === weaponKey && w.refine > best) best = w.refine;
  return best || 1;
}

export function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

export function counts() {
  return {
    chars: Object.keys(state.characters).length,
    weapons: state.weapons.length,
  };
}

export function setCharacter(charKey, owned, cons) {
  if (!names[charKey]) return;
  if (owned) {
    const next = cons === undefined ? consOf(charKey) : cons;
    state.characters[charKey] = { cons: clampCons(Number(next)) };
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
  state.characters[charKey] = { cons: clampCons(Number(cons)) };
  changed();
}

export function bumpCons(charKey, delta) {
  if (!hasCharacter(charKey)) return;
  setCons(charKey, consOf(charKey) + delta);
}

export function addWeapon(weaponKey, refine = 1) {
  const item = { id: newId(), key: String(weaponKey), refine: clampRefine(refine) };
  state.weapons.push(item);
  changed();
  return item.id;
}

export function removeWeapon(id) {
  const before = state.weapons.length;
  state.weapons = state.weapons.filter((w) => w.id !== id);
  if (state.weapons.length !== before) changed();
}

export function setItemRefine(id, refine) {
  const item = state.weapons.find((w) => w.id === id);
  if (!item) return;
  item.refine = clampRefine(refine);
  changed();
}

export function replace(next) {
  state = normalize(next);
  changed();
}

export function setCharacterSet(charKeys) {
  const chars = {};
  for (const k of charKeys) {
    if (!names[k]) continue;
    chars[k] = { cons: hasCharacter(k) ? consOf(k) : 0 };
  }
  state.characters = chars;
  changed();
}

export function setCharacters(charMap) {
  const chars = {};
  for (const [k, c] of Object.entries(charMap || {})) {
    if (names[k]) chars[k] = { cons: clampCons(Number(c)) };
  }
  state.characters = chars;
  changed();
}

export function reset() {
  state = { version: VERSION, characters: {}, weapons: [] };
  changed();
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function init(namesJson) {
  names = namesJson || {};
  displayToKey = {};
  for (const k of Object.keys(names)) {
    const disp = (names[k] && names[k].name) || k;
    if (!(disp in displayToKey)) displayToKey[disp] = k;
  }

  const stored = read();
  state = stored ? normalize(stored) : migrateLegacy();
  if (!stored) persist();

  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    const fresh = read();
    if (fresh) { state = normalize(fresh); emit(); }
  });

  return state;
}
