const traveler = key => /^(lumine|aether|traveler)/.test(key);

export function weaponAcquisitions(required, owned) {
  const need = required.slice().sort((a, b) => b.refine - a.refine);
  const have = (owned || []).slice().sort((a, b) => b - a).slice(0, need.length);
  const memo = new Map();
  function solve(index, used) {
    if (index === need.length) return { cost: 0, changes: [] };
    const key = `${index}:${used}`;
    if (memo.has(key)) return memo.get(key);
    const slot = need[index];
    const tail = solve(index + 1, used);
    let best = { cost: slot.refine + tail.cost,
      changes: [{ char: slot.char, weapon: slot.weapon, from: 0, to: slot.refine, cost: slot.refine }, ...tail.changes] };
    for (let i = 0; i < have.length; i++) {
      if (used & (1 << i)) continue;
      const cost = Math.max(0, slot.refine - have[i]);
      const next = solve(index + 1, used | (1 << i));
      if (cost + next.cost <= best.cost) {
        best = { cost: cost + next.cost, changes: [...(cost ? [
          { char: slot.char, weapon: slot.weapon, from: have[i], to: slot.refine, cost },
        ] : []), ...next.changes] };
      }
    }
    memo.set(key, best);
    return best;
  }
  return solve(0, 0);
}

export function acquisitionPlan(team, inventory, names, options = {}) {
  const characters = [], constellations = [], weapons = [];
  const required = {}, weaponComparison = {};
  for (const slot of team.build || []) {
    const key = slot.char;
    const have = inventory.characters?.[key];
    const five = (names[key]?.stars || 0) >= 3 && !traveler(key);
    if (have === undefined) {
      if (options.characters === false) return null;
      characters.push({ char: key, to: slot.cons, cost: 1 });
    }
    const from = have?.cons || 0;
    if (five && slot.cons > from) {
      if (!options.constellations) return null;
      constellations.push({ char: key, from, to: slot.cons, cost: slot.cons - from });
    }
    if (slot.fiveStar && !slot.freeWeapon && slot.weapon) (required[slot.weapon] ||= []).push(slot);
  }
  for (const [key, slots] of Object.entries(required)) {
    const additions = weaponAcquisitions(slots, inventory.weapons?.[key] || []);
    if (additions.cost && !options.weapons) return null;
    weapons.push(...additions.changes);
    if (additions.cost) weaponComparison[key] = {
      owned: (inventory.weapons?.[key] || []).slice(),
      required: slots.map(slot => slot.refine),
    };
  }
  const cost = [...characters, ...constellations, ...weapons].reduce((sum, item) => sum + item.cost, 0);
  const signature = JSON.stringify({
    characters: characters.map(x => x.char).sort(),
    constellations: constellations.map(x => [x.char, x.from, x.to]).sort(),
    weapons: weapons.map(x => [x.weapon, x.from, x.to]).sort(),
  });
  return { characters, constellations, weapons, cost, signature, weaponComparison };
}

function comparisonKey(team) {
  if (team.origin || !team.build?.length) return null;
  return JSON.stringify([!!team.assumed, team.build.map(slot => slot.char).sort()]);
}

export function buildDifferences(baseline, team) {
  const previous = new Map((baseline.build || []).map(slot => [slot.char, slot]));
  return (team.build || []).flatMap(slot => {
    const before = previous.get(slot.char);
    if (!before) return [];
    const cons = before.cons !== slot.cons ? { from: before.cons, to: slot.cons } : null;
    const weapon = before.weapon !== slot.weapon || before.refine !== slot.refine ? {
      from: { key: before.weapon, refine: before.refine },
      to: { key: slot.weapon, refine: slot.refine },
    } : null;
    return cons || weapon ? [{ char: slot.char, cons, weapon }] : [];
  });
}

export function affordableTeams(teams, inventory, names, options, budget) {
  const unique = new Map();
  const baselines = new Map();
  for (const team of teams) {
    const acquisition = acquisitionPlan(team, inventory, names, options);
    if (!acquisition || acquisition.cost > budget) continue;
    if (!acquisition.constellations.length && !acquisition.weapons.length) {
      const baseKey = comparisonKey(team);
      if (baseKey && (!baselines.has(baseKey) || team.dps > baselines.get(baseKey).dps)) baselines.set(baseKey, { ...team, acquisition });
    }
    const composition = team.chars || team.members || [];
    const key = composition.slice().sort().join(",") + acquisition.signature;
    const previous = unique.get(key);
    if (!previous || team.dps > previous.dps) unique.set(key, { ...team, acquisition });
  }
  const candidates = [...unique.values()];
  return candidates.flatMap(team => {
    if (!team.acquisition.constellations.length && !team.acquisition.weapons.length) return [team];
    const key = comparisonKey(team);
    const baseline = key ? baselines.get(key) : null;
    if (baseline && team.dps <= baseline.dps) return [];
    return [{ ...team, comparison: { baseline: baseline || null, changes: baseline ? buildDifferences(baseline, team) : [] } }];
  }).sort((a, b) => b.dps - a.dps);
}
