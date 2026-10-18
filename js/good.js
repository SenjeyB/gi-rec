// Импорт аккаунта из GOOD (Genshin Optimizer / Good Open Object Description).
//
// Формат:
//   { "format":"GOOD", "version":2, "source":"...",
//     "characters":[{"key":"HuTao","level":90,"constellation":1,...}],
//     "weapons":[{"key":"StaffOfHoma","refinement":1,"location":"HuTao",...}] }
//
// Ключи в GOOD — PascalCase ("HuTao", "KamisatoAyaka", "TravelerAnemo").
// Приводим их к ключам names.json через charAliases из refs.json, чтобы
// знание об алиасах жило в одном месте — в генераторе базы.

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * @param {object} good       разобранный GOOD JSON
 * @param {object} names      names.json
 * @param {object} refs       refs.json (нужны charAliases и fiveStars)
 * @returns {{account:{version:number,characters:object,weapons:object},
 *            stats:{chars:number,weapons:number},
 *            unknown:{characters:string[],weapons:string[]}}}
 */
export function parseGood(good, names, refs) {
  const aliases = (refs && refs.charAliases) || {};
  const fiveStars = (refs && refs.fiveStars) || {};

  // ключ names.json -> он же; плюс отображаемое имя и алиасы
  const charIndex = {};
  for (const k of Object.keys(names)) {
    charIndex[k] = k;
    charIndex[slug(k)] = k;
    const disp = names[k] && names[k].name;
    if (disp) charIndex[slug(disp)] = k;
  }
  for (const a of Object.keys(aliases)) charIndex[slug(a)] = aliases[a];

  const weaponIndex = {};
  for (const k of Object.keys(fiveStars)) {
    weaponIndex[slug(k)] = k;
    const nm = fiveStars[k] && fiveStars[k].name;
    if (nm) weaponIndex[slug(nm)] = k;
  }

  const characters = {};
  const weapons = [];   // каждая запись GOOD — отдельная копия оружия
  const unknownChars = new Set();
  const unknownWeapons = new Set();

  function addCharacter(rawKey, cons) {
    const id = charIndex[slug(rawKey)];
    if (!id) { if (rawKey) unknownChars.add(String(rawKey)); return; }
    const n = Number(cons);
    const value = Math.min(6, Math.max(0, Number.isFinite(n) ? Math.round(n) : 0));
    // ГГ разных элементов мапятся в один ключ — берём максимальную консту
    const prev = characters[id];
    characters[id] = { cons: prev ? Math.max(prev.cons, value) : value };
  }

  function addWeapon(rawKey, refine) {
    const id = weaponIndex[slug(rawKey)];
    if (!id) return;                       // не 5★ или неизвестное — просто пропускаем
    const n = Number(refine);
    const value = Math.min(5, Math.max(1, Number.isFinite(n) ? Math.round(n) : 1));
    // не схлопываем одинаковые: две Хомы — это две копии, и отряд с двумя
    // владельцами Хомы должен найтись
    weapons.push({ key: id, refine: value });
  }

  // --- персонажи -----------------------------------------------------------
  if (Array.isArray(good.characters)) {
    for (const ch of good.characters) {
      if (!ch) continue;
      addCharacter(ch.key || ch.name || ch.characterName || ch.displayName, ch.constellation);
    }
  }
  // старый вариант GOOD: объект вида {"HuTao": {...}}
  if (good.charactersByKey && typeof good.charactersByKey === "object") {
    for (const k of Object.keys(good.charactersByKey)) {
      const ch = good.charactersByKey[k] || {};
      addCharacter(ch.key || k, ch.constellation);
    }
  }

  // --- оружие --------------------------------------------------------------
  if (Array.isArray(good.weapons)) {
    for (const w of good.weapons) {
      if (!w) continue;
      addWeapon(w.key || w.name, w.refinement);
    }
  }
  if (good.weaponsByKey && typeof good.weaponsByKey === "object") {
    for (const k of Object.keys(good.weaponsByKey)) {
      const w = good.weaponsByKey[k] || {};
      addWeapon(w.key || k, w.refinement);
    }
  }

  return {
    account: { version: 2, characters, weapons },
    stats: { chars: Object.keys(characters).length, weapons: weapons.length },
    unknown: {
      characters: [...unknownChars].sort(),
      weapons: [...unknownWeapons].sort(),
    },
  };
}

/** Похоже ли это вообще на GOOD-экспорт. */
export function looksLikeGood(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (String(obj.format || "").toUpperCase() === "GOOD") return true;
  return Array.isArray(obj.characters) || Array.isArray(obj.weapons)
    || !!obj.charactersByKey || !!obj.weaponsByKey;
}
