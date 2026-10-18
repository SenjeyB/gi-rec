// Слой данных поверх data/db.json.
//
// В базе каждый отряд хранит все найденные сборки (созвездия + оружие с рефайном
// + сеты). Здесь мы под текущий инвентарь и настройки выбираем одну сборку на
// отряд и отдаём список в том виде, который понимает app.js.
//
// Правила отбора:
//   созвездия — потолок по умолчанию (5★ на C0, 4★ без ограничений — в симах
//               они обычно C6). Если персонаж есть в
//               инвентаре и его созвездие выше потолка, потолок поднимается — свои
//               созвездия только открывают сборки, но никогда не отнимают.
//   5★ оружие — режим none отбрасывает такие сборки целиком, r1 пускает их на R1,
//               any — на любом пробуждении, mine — только то, что лежит в
//               инвентаре: копий хватает и пробуждение не выше, чем у своей копии.

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
    baseCap[k] = (e.stars || 0) >= 3 ? 0 : 6;
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

/** Персонажи, у которых в базе есть хоть один отряд. */
export function charactersInDb() {
  const out = new Set();
  if (!db) return out;
  for (const t of db.teams) for (const i of t.chars) out.add(db.dict.chars[i]);
  return out;
}

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
 *  - fiveStar:    "none" | "r1" | "any" | "mine" — сборки с 5★ оружием
 *                 (allowFiveStar: true — старое имя для "r1")
 *  - onlyMyWeapons: старый флаг, то же, что fiveStar "mine"
 * @returns {Array} отряды с выбранной сборкой, отсортированные по DPS
 */
export function query(opts = {}) {
  if (!db) return [];
  const invCons = opts.cons || {};
  const invWeapons = opts.weapons || {};
  const fiveMode = opts.onlyMyWeapons ? "mine" : (opts.fiveStar || (opts.allowFiveStar ? "r1" : "none"));
  const allowFive = fiveMode !== "none";
  // «Только моё»: оружие должно лежать в инвентаре — и по числу копий, и по
  // пробуждению (сборку на R5 закрывает только своя копия R5)
  const onlyMine = fiveMode === "mine";
  const refineCap = fiveMode === "r1" ? 1 : 5;
  // «Полное соответствие» KQMS = созвездия и артефакты по стандарту одновременно
  const needFull = !!opts.kqmFull;
  const needArt = !!opts.kqmArt;
  const strict = !!opts.strictCons;
  // Потолок созвездий: standard — у всех стандарт (5★ C0, 4★ C6),
  // инвентарь не учитывается; mine — свои созвездия поднимают потолок; any — любые
  // сборки до C6. Сборки на повышенных созвездиях в базе есть всегда, вопрос
  // только в том, какую из них показывать.
  const consMode = opts.consMode || "mine";

  const capFor = (charKey) => {
    const base = baseCap[charKey] === undefined ? 6 : baseCap[charKey];
    if (consMode === "any" && !strict) return 6;
    if (consMode === "standard" && !strict) return base;
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
          const key = weaponKey(m.weapon);
          if (!allowFive || m.refine > refineCap) { ok = false; break; }
          if (needed) (needed[key] ||= []).push(m.refine);
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
function ownedRefines(have) {
  if (have == null) return [];
  if (typeof have === "number") return Array(have).fill(5);
  if (!Array.isArray(have)) return [Number(have.refine) || 1];
  return have;
}

export function haveCopies(needed, owned) {
  for (const [key, refines] of Object.entries(needed)) {
    const have = ownedRefines(owned[key]);
    if (!have.length) return false;
    if (have.length < refines.length) return false;
    const need = refines.slice().sort((a, b) => b - a);
    const got = have.slice().sort((a, b) => b - a);
    for (let i = 0; i < need.length; i++) if (got[i] < need[i]) return false;
  }
  return true;
}

/** Какие копии 5★ оружия занимает сборка: ключ -> рефайны. */
export function copiesNeeded(build) {
  const need = {};
  for (const m of build || []) {
    if (m && m.fiveStar && m.weapon) (need[m.weapon] ||= []).push(m.refine || 1);
  }
  return need;
}

/**
 * Копии, которые останутся после того, как сборка заберёт свои. Каждому
 * требованию отдаём самую слабую подходящую копию, начиная со старших
 * требований, — так сильные копии остаются другим отрядам.
 * Возвращает null, если копий не хватает.
 */
export function subtractCopies(owned, needed) {
  const out = {};
  for (const [k, v] of Object.entries(owned || {})) out[k] = ownedRefines(v).slice();
  for (const [key, refines] of Object.entries(needed || {})) {
    const have = (out[key] || []).slice().sort((a, b) => a - b);
    for (const r of refines.slice().sort((a, b) => b - a)) {
      const i = have.findIndex((x) => x >= r);
      if (i < 0) return null;
      have.splice(i, 1);
    }
    out[key] = have;
  }
  return out;
}

// ------------------------------------------------- подробные статы артефактов

const shardCache = new Map();      // номер шарда -> данные
const shardPending = new Map();    // чтобы не качать один файл дважды

async function loadShard(n) {
  if (shardCache.has(n)) return shardCache.get(n);
  if (shardPending.has(n)) return shardPending.get(n);
  // Шард привязан к версии базы: после пересборки индексы отрядов сдвигаются, и
  // закэшированный старый шард показал бы статы чужого отряда.
  const v = encodeURIComponent(db.generated || "");
  const task = fetch(`data/details/${n}.json?v=${v}`, { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((data) => { shardCache.set(n, data); shardPending.delete(n); return data; });
  shardPending.set(n, task);
  return task;
}

/**
 * Догружает мейн-статы и роллы сабстатов для конкретной сборки отряда.
 * @returns {Promise<Array|null>} по слоту: {main:[...], subs:[{stat,rolls}], total}
 *   rolls у живых аккаунтов дробные; total — [{stat,value}], если сим дал только
 *   сумму статов артефактов без разбивки на основные и дополнительные.
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
    total: m.tot ? m.tot.map(([si, value]) => ({ stat: db.dict.stats[si], value })) : null,
  }));
}

/**
 * Все сборки отряда без фильтров — для сравнения в карточке: сколько даёт C2
 * или C6 относительно стандарта. Порядок — по убыванию DPS, как в базе.
 */
export function teamBuilds(teamIndex) {
  if (!db || !db.teams[teamIndex]) return [];
  const team = db.teams[teamIndex];
  const charKeys = team.chars.map((i) => db.dict.chars[i]);
  return team.builds.map((b, bi) => ({
    teamIndex,
    buildIndex: bi,
    chars: charKeys,
    dps: b.dps,
    sims: b.sims,
    src: b.src,
    kqmCons: !!b.kqmCons,
    kqmArt: !!b.kqmArt,
    build: expandBuild(team, b),
    aboveStandard: b.members.some((m, i) => m.cons > (baseCap[charKeys[i]] ?? 6)),
  }));
}
