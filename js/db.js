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
//               их на R1; «только мои» дополнительно требует, чтобы оружие лежало
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
  return build.members.map((m, i) => ({
    char: db.dict.chars[team.chars[i]],
    cons: m.cons,
    weapon: weaponKey(m.weapon),
    refine: m.refine,
    fiveStar: isFiveStar(m.weapon),
    sets: (m.sets || []).map(([si, pieces]) => ({ key: db.dict.sets[si], pieces })),
    // main и subs подгружаются отдельно: см. loadDetails()
  }));
}

/**
 * @param {object} opts
 *  - cons:        {charKey: число} созвездия из инвентаря
 *  - weapons:     {weaponKey: [рефайн каждой копии]} своё 5★ оружие
 *  - allowFiveStar: пускать сборки с 5★ оружием (только R1)
 *  - onlyMyWeapons: из них оставлять лишь те, где всё 5★ оружие есть у игрока
 * @returns {Array} отряды с выбранной сборкой, отсортированные по DPS
 */
export function query(opts = {}) {
  if (!db) return [];
  const invCons = opts.cons || {};
  const invWeapons = opts.weapons || {};
  const allowFive = !!opts.allowFiveStar;
  const onlyMine = !!opts.onlyMyWeapons;
  // «Полное соответствие» KQMS = созвездия и артефакты по стандарту одновременно
  const needFull = !!opts.kqmFull;
  const needArt = !!opts.kqmArt;
  const strict = !!opts.strictCons;

  const capFor = (charKey) => {
    const base = baseCap[charKey] === undefined ? 6 : baseCap[charKey];
    const own = invCons[charKey];
    if (own === undefined) return base;
    // В строгом режиме (сборщик, подсказки) у 5* берём ровно то созвездие, что
    // указал игрок: там важно, соберётся ли отряд на самом деле. Четвёрки не
    // трогаем — в симах они на C6, а в инвентаре созвездия им не выставляются,
    // и строгий потолок вычистил бы почти всё.
    const fiveStar = base < 6;
    if (strict && fiveStar) return own;
    return Math.max(base, own);
  };

  const out = [];
  for (let teamIndex = 0; teamIndex < db.teams.length; teamIndex++) {
    const team = db.teams[teamIndex];
    const charKeys = team.chars.map((i) => db.dict.chars[i]);
    let best = null;
    let bestIndex = -1;

    for (let bi = 0; bi < team.builds.length; bi++) {
      const build = team.builds[bi];
      if (needFull && !(build.kqmCons && build.kqmArt)) continue;
      if (needArt && !build.kqmArt) continue;
      let ok = true;
      const needed = onlyMine ? {} : null;     // ключ -> рефайны, которые требует сборка
      for (let i = 0; i < build.members.length; i++) {
        const m = build.members[i];
        if (m.cons > capFor(charKeys[i])) { ok = false; break; }
        if (isFiveStar(m.weapon)) {
          if (!allowFive || m.refine !== 1) { ok = false; break; }
          if (needed) (needed[weaponKey(m.weapon)] ||= []).push(m.refine);
        }
      }
      if (ok && needed && !haveCopies(needed, invWeapons)) ok = false;
      if (!ok) continue;
      // сборки внутри отряда уже отсортированы по убыванию DPS
      best = build;
      bestIndex = bi;
      break;
    }
    if (!best) continue;

    out.push({
      teamIndex,
      buildIndex: bestIndex,
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

/**
 * Хватает ли у игрока копий. Оружие одно на персонажа, поэтому отряд с двумя
 * одинаковыми легендарками требует двух копий. Копия подходит, если её рефайн
 * не ниже требуемого; сопоставляем жадно — старшие требования к старшим копиям.
 * owned: ключ -> массив рефайнов копий (или число копий — старый формат).
 */
export function haveCopies(needed, owned) {
  for (const [key, refines] of Object.entries(needed)) {
    let have = owned[key];
    if (have == null) return false;
    if (typeof have === "number") have = Array(have).fill(5);
    if (!Array.isArray(have)) have = [Number(have.refine) || 1];
    if (have.length < refines.length) return false;
    const need = refines.slice().sort((a, b) => b - a);
    const got = have.slice().sort((a, b) => b - a);
    for (let i = 0; i < need.length; i++) if (got[i] < need[i]) return false;
  }
  return true;
}

/** Сколько отрядов добавит включение 5★ оружия — для подсказки в настройках. */
export function countWithFiveStar(opts = {}) {
  const base = query({ ...opts, allowFiveStar: false }).length;
  const withR1 = query({ ...opts, allowFiveStar: true }).length;
  return { base, withR1, extra: withR1 - base };
}

// ------------------------------------------------- подробные статы артефактов

const shardCache = new Map();      // номер шарда -> данные
const shardPending = new Map();    // чтобы не качать один файл дважды

async function loadShard(n) {
  if (shardCache.has(n)) return shardCache.get(n);
  if (shardPending.has(n)) return shardPending.get(n);
  const task = fetch(`data/details/${n}.json`, { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((data) => { shardCache.set(n, data); shardPending.delete(n); return data; });
  shardPending.set(n, task);
  return task;
}

/**
 * Догружает мейн-статы и роллы сабстатов для конкретной сборки отряда.
 * @returns {Promise<Array|null>} по слоту: {main:[...], subs:[{stat,rolls}]}
 */
export async function loadDetails(teamIndex, buildIndex) {
  if (!db || teamIndex == null || buildIndex == null || buildIndex < 0) return null;
  const size = db.shardSize || 250;
  const shard = await loadShard(Math.floor(teamIndex / size));
  const builds = shard[String(teamIndex)];
  const entry = builds && builds[buildIndex];
  if (!entry) return null;
  const order = db.dict.subOrder || [];
  return entry.members.map((m) => ({
    main: (m.main || []).map((si) => db.dict.stats[si]),
    subs: order.map((stat, k) => ({ stat, rolls: (m.subs || [])[k] || 0 })),
  }));
}
