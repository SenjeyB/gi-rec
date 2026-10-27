let db = null;
let refs = null;
let names = {};
let baseCap = {};

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

export function charactersInDb() {
  const out = new Set();
  if (!db) return out;
  for (const t of db.teams) for (const i of t.chars) out.add(db.dict.chars[i]);
  return out;
}

export function weaponKey(idx) {
  return idx == null ? null : db.dict.weapons[idx];
}
export function setKey(idx) { return db.dict.sets[idx]; }

function isFiveStar(weaponIdx) {
  if (weaponIdx == null) return false;
  const m = db.weaponMeta[weaponIdx];
  return !!m && m.rarity === 5;
}

function expandBuild(team, build) {
  return build.members.map((m, i) => ({
    char: db.dict.chars[team.chars[i]],
    cons: m.cons,
    weapon: weaponKey(m.weapon),
    refine: m.refine,
    fiveStar: isFiveStar(m.weapon),
    sets: (m.sets || []).map(([si, pieces]) => ({ key: db.dict.sets[si], pieces })),
  }));
}

export function query(opts = {}) {
  if (!db) return [];
  const invCons = opts.cons || {};
  const invWeapons = opts.weapons || {};
  const fiveMode = opts.onlyMyWeapons ? "mine" : (opts.fiveStar || (opts.allowFiveStar ? "r1" : "none"));
  const allowFive = fiveMode !== "none";
  const onlyMine = fiveMode === "mine";
  const refineCap = fiveMode === "r1" ? 1 : 5;
  const needFull = !!opts.kqmFull;
  const needArt = !!opts.kqmArt;
  const strict = !!opts.strictCons;
  const consMode = opts.consMode || "mine";
  const source = opts.source || "all";

  const capFor = (charKey) => {
    const base = baseCap[charKey] === undefined ? 6 : baseCap[charKey];
    if (consMode === "any" && !strict) return 6;
    if (consMode === "standard" && !strict) return base;
    const own = invCons[charKey];
    if (own === undefined) return base;
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
      if (source === "kqm" && build.origin) continue;
      if (source === "real" && !build.origin) continue;
      if (needFull && !(build.kqmCons && build.kqmArt)) continue;
      if (needArt && !build.kqmArt) continue;
      let ok = true;
      const needed = onlyMine ? {} : null;
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
      origin: best.origin || null,
      kqmCons: !!best.kqmCons,
      kqmArt: !!best.kqmArt,
      build: expandBuild(team, best),
      buildCount: team.builds.length,
    });
  }
  out.sort((a, b) => b.dps - a.dps);
  return out;
}

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

export function copiesNeeded(build) {
  const need = {};
  for (const m of build || []) {
    if (m && m.fiveStar && m.weapon) (need[m.weapon] ||= []).push(m.refine || 1);
  }
  return need;
}

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

const shardCache = new Map();
const shardPending = new Map();

async function loadShard(n) {
  if (shardCache.has(n)) return shardCache.get(n);
  if (shardPending.has(n)) return shardPending.get(n);
  const v = encodeURIComponent(db.generated || "");
  const task = fetch(`data/details/${n}.json?v=${v}`, { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((data) => { shardCache.set(n, data); shardPending.delete(n); return data; });
  shardPending.set(n, task);
  return task;
}

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
    origin: b.origin || null,
    kqmCons: !!b.kqmCons,
    kqmArt: !!b.kqmArt,
    build: expandBuild(team, b),
    aboveStandard: b.members.some((m, i) => m.cons > (baseCap[charKeys[i]] ?? 6)),
  }));
}
