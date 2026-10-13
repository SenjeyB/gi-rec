// Слой данных поверх data/db.json.
//
// В базе каждый отряд хранит все найденные сборки (созвездия + оружие с рефайном
// + сеты). Здесь мы под текущий инвентарь и настройки выбираем одну сборку на
// отряд и отдаём список в том виде, который понимает app.js.
//
// Правила отбора:
//   созвездия — потолок по умолчанию (5★ на C0, или C1 если в names.json cons:1;
//               4★ без ограничений, они в симах обычно C6). Если персонаж есть в
//               инвентаре и его созвездие выше потолка, потолок поднимается — свои
//               созвездия только открывают сборки, но никогда не отнимают.
//   5★ оружие — по умолчанию сборки с ним отбрасываются целиком; тогл разрешает
//               их на R1; «только мои» дополнительно требует, чтобы пушка лежала
//               в инвентаре с рефайном не ниже, чем в симе.

let db = null;
let refs = null;
let names = {};
let baseCap = {};          // ключ персонажа -> потолок созвездий по умолчанию

async function loadJSON(path) {
  const resp = await fetch(path, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`${path}: ${resp.status}`);
  return resp.json();
}

export async function init(namesJson) {
  names = namesJson || {};
  baseCap = {};
  for (const k of Object.keys(names)) {
    const e = names[k] || {};
    baseCap[k] = (e.stars || 0) >= 3 ? (e.cons ? e.cons : 0) : 6;
  }
  [db, refs] = await Promise.all([
    loadJSON("data/db.json"),
    loadJSON("data/refs.json"),
  ]);
  return { teams: db.teams.length, builds: db.stats.builds, generated: db.generated };
}

export function ready() { return !!db; }
export function meta() { return db ? { ...db.stats, generated: db.generated } : null; }
export function references() { return refs; }

/** Ключ оружия по индексу в словаре базы. */
export function weaponKey(idx) {
  return idx == null ? null : db.dict.weapons[idx];
}
export function setKey(idx) { return db.dict.sets[idx]; }

function isFiveStar(weaponIdx) {
  if (weaponIdx == null) return false;
  const m = db.weaponMeta[weaponIdx];
  return !!m && m.rarity === 5;
}

/** Разворачивает сборку в удобный для рендера вид. */
function expandBuild(team, build) {
  const order = db.dict.subOrder || [];
  return build.members.map((m, i) => ({
    char: db.dict.chars[team.chars[i]],
    cons: m.cons,
    weapon: weaponKey(m.weapon),
    refine: m.refine,
    fiveStar: isFiveStar(m.weapon),
    sets: (m.sets || []).map(([si, pieces]) => ({ key: db.dict.sets[si], pieces })),
    // мейн-статы песка, кубка и короны; цветок и перо фиксированы и не хранятся
    main: (m.main || []).map((si) => db.dict.stats[si]),
    // роллы сабстатов в порядке dict.subOrder
    subs: order.map((stat, k) => ({ stat, rolls: (m.subs || [])[k] || 0 })),
  }));
}

/**
 * @param {object} opts
 *  - cons:        {charKey: число} созвездия из инвентаря
 *  - weapons:     {weaponKey: рефайн} свои 5★ пушки
 *  - allowFiveStar: пускать сборки с 5★ оружием (только R1)
 *  - onlyMyWeapons: из них оставлять лишь те, где все 5★ пушки свои
 * @returns {Array} отряды с выбранной сборкой, отсортированные по DPS
 */
export function query(opts = {}) {
  if (!db) return [];
  const invCons = opts.cons || {};
  const invWeapons = opts.weapons || {};
  const allowFive = !!opts.allowFiveStar;
  const onlyMine = !!opts.onlyMyWeapons;
  const needCons = !!opts.kqmCons;
  const needArt = !!opts.kqmArt;

  const capFor = (charKey) => {
    const base = baseCap[charKey] === undefined ? 6 : baseCap[charKey];
    const own = invCons[charKey];
    // свои созвездия только поднимают потолок, иначе игрок без C6 на четвёрках
    // потерял бы почти все отряды
    return own === undefined ? base : Math.max(base, own);
  };

  const out = [];
  for (const team of db.teams) {
    const charKeys = team.chars.map((i) => db.dict.chars[i]);
    let best = null;

    for (const build of team.builds) {
      if (needCons && !build.kqmCons) continue;
      if (needArt && !build.kqmArt) continue;
      let ok = true;
      for (let i = 0; i < build.members.length; i++) {
        const m = build.members[i];
        if (m.cons > capFor(charKeys[i])) { ok = false; break; }
        if (isFiveStar(m.weapon)) {
          if (!allowFive || m.refine !== 1) { ok = false; break; }
          if (onlyMine) {
            const key = weaponKey(m.weapon);
            if (!(key in invWeapons)) { ok = false; break; }
          }
        }
      }
      if (!ok) continue;
      // сборки внутри отряда уже отсортированы по убыванию DPS
      best = build;
      break;
    }
    if (!best) continue;

    out.push({
      chars: charKeys,
      display: charKeys.map((k) => (names[k] && names[k].name) || k),
      dps: best.dps,
      sims: best.sims,
      src: best.src,
      kqmCons: !!best.kqmCons,
      kqmArt: !!best.kqmArt,
      build: expandBuild(team, best),
      buildCount: team.builds.length,
    });
  }
  out.sort((a, b) => b.dps - a.dps);
  return out;
}

/** Сколько отрядов добавит включение 5★ оружия — для подсказки в настройках. */
export function countWithFiveStar(opts = {}) {
  const base = query({ ...opts, allowFiveStar: false }).length;
  const withR1 = query({ ...opts, allowFiveStar: true }).length;
  return { base, withR1, extra: withR1 - base };
}
