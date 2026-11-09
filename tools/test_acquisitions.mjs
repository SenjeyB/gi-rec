import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionPlan, weaponAcquisitions, affordableTeams, buildDifferences, comparisonBaseline } from "../js/acquisitions.js";

const names = { mavuika: { stars: 4 }, furina: { stars: 4 }, bennett: { stars: 2 }, luminecryo: { stars: 1 } };
const slot = (char, cons = 0, weapon = null, refine = 1) => ({ char, cons, weapon, refine, fiveStar: !!weapon });
const all = { characters: true, constellations: true, weapons: true };

test("existing C0 to C2 costs two acquisitions, never one", () => {
  const team = { build: [slot("mavuika", 2)] };
  const inventory = { characters: { mavuika: { cons: 0 } } };
  const plan = acquisitionPlan(team, inventory, names, all);
  assert.equal(plan.cost, 2);
  assert.deepEqual(plan.constellations, [{ char: "mavuika", from: 0, to: 2, cost: 2 }]);
  assert.equal(acquisitionPlan(team, inventory, names, { characters: true }), null);
});

test("a new C2 character costs three; missing four-star constellations are free", () => {
  const plan = acquisitionPlan({ build: [slot("mavuika", 2), slot("bennett", 6)] }, {}, names, all);
  assert.equal(plan.cost, 4);
  assert.equal(plan.constellations.length, 1);
  assert.equal(acquisitionPlan({ build: [slot("mavuika")] }, {}, names, { ...all, characters: false }), null);
});

test("Traveler constellations and free five-star weapon refinements do not use the budget", () => {
  const plan = acquisitionPlan({ build: [{ ...slot("luminecryo", 6, "exaiphanesblade", 5), freeWeapon: true }] },
    { characters: { luminecryo: { cons: 0 } } }, names, {});
  assert.equal(plan.cost, 0);
});

test("owned higher constellations never require extra copies", () => {
  assert.equal(acquisitionPlan({ build: [slot("furina", 1)] }, { characters: { furina: { cons: 6 } } }, names, {}).cost, 0);
});

test("three simultaneous weapon slots cannot share one owned copy", () => {
  const slots = ["mavuika", "furina", "bennett"].map(char => slot(char, 0, "sword", 1));
  const result = weaponAcquisitions(slots, [5]);
  assert.equal(result.cost, 2);
  assert.equal(result.changes.length, 2);
  assert(result.changes.every(x => x.from === 0 && x.to === 1));
});

test("refinement costs account for existing refinement without splitting items", () => {
  assert.equal(weaponAcquisitions([slot("mavuika", 0, "sword", 3)], [1]).cost, 2);
  assert.equal(weaponAcquisitions([slot("mavuika", 0, "sword", 5)], []).cost, 5);
  assert.equal(weaponAcquisitions([slot("mavuika", 0, "sword", 5), slot("furina", 0, "sword", 1)], [5]).cost, 1);
  assert.equal(weaponAcquisitions([slot("mavuika", 0, "sword", 5), slot("furina", 0, "sword", 4)], [4, 1]).cost, 4);
});

test("weapon suggestions are opt-in and already-owned weapons remain usable", () => {
  const team = { build: [slot("mavuika", 0, "sword", 1)] };
  const inventory = { characters: { mavuika: { cons: 0 } }, weapons: {} };
  assert.equal(acquisitionPlan(team, inventory, names, {}), null);
  assert.equal(acquisitionPlan(team, { ...inventory, weapons: { sword: [1] } }, names, {}).cost, 0);
  assert.equal(acquisitionPlan(team, inventory, names, all).cost, 1);
});

test("budget filtering retains affordable alternatives and deduplicates artifact variants", () => {
  const teams = [
    { chars: ["mavuika"], dps: 200000, build: [slot("mavuika", 6)] },
    { chars: ["mavuika"], dps: 150000, build: [slot("mavuika", 2)] },
    { chars: ["mavuika"], dps: 140000, build: [slot("mavuika", 2)] },
    { chars: ["mavuika"], dps: 100000, build: [slot("mavuika", 0)] },
  ];
  const got = affordableTeams(teams, { characters: { mavuika: { cons: 0 } } }, names, all, 2);
  assert.deepEqual(got.map(t => t.dps), [150000, 100000]);
  assert.deepEqual(got.map(t => t.acquisition.cost), [2, 0]);
});

test("characters, constellations and weapons share a single exact limit", () => {
  const team = { chars: ["mavuika"], dps: 150000, build: [slot("mavuika", 2, "sword", 1)] };
  assert.equal(acquisitionPlan(team, {}, names, all).cost, 4);
  assert.equal(affordableTeams([team], {}, names, all, 3).length, 0);
  assert.equal(affordableTeams([team], {}, names, all, 4).length, 1);
});

test("planning does not modify the user's inventory", () => {
  const inventory = { characters: { mavuika: { cons: 0 } }, weapons: { sword: [1] } };
  const before = structuredClone(inventory);
  acquisitionPlan({ build: [slot("mavuika", 2, "sword", 3)] }, inventory, names, all);
  assert.deepEqual(inventory, before);
});

const withSets = build => build.map(member => ({ ...member, sets: [{ key: "set", pieces: 4 }] }));

test("upgrades refer to the best available baseline of the same composition regardless of artifacts", () => {
  const teams = [
    { chars: ["mavuika"], dps: 200000, build: withSets([slot("mavuika", 2)]) },
    { chars: ["mavuika"], dps: 100000, build: withSets([slot("mavuika")]) },
    { chars: ["mavuika"], dps: 120000, build: withSets([slot("mavuika")]) },
    { chars: ["mavuika"], dps: 180000, build: [{ ...slot("mavuika"), sets: [{ key: "other", pieces: 4 }] }] },
  ];
  const result = affordableTeams(teams, { characters: { mavuika: { cons: 0 } } }, names, all, 2);
  const upgrade = result.find(team => team.acquisition.cost === 2);
  assert.equal(upgrade.comparison.baseline.dps, 180000);
});

test("comparisons do not use Boss Runs, different characters, or assumptions as verified baselines", () => {
  const cases = [
    { origin: "clear" },
    { origin: "dummy" },
    { assumed: true },
    { chars: ["furina"], build: withSets([slot("furina")]) },
  ];
  for (const extra of cases) {
    const target = { chars: ["mavuika"], dps: 200000, build: withSets([slot("mavuika", 2)]) };
    const baseline = { chars: ["mavuika"], dps: 100000, build: withSets([slot("mavuika")]), ...extra };
    const result = affordableTeams([target, baseline], { characters: { mavuika: { cons: 0 } } }, names, all, 2);
    assert.equal(result.find(team => team.acquisition.cost === 2).comparison.baseline, null);
  }
});

test("artifact data is not required for a composition baseline", () => {
  const teams = [
    { chars: ["mavuika"], dps: 200000, build: withSets([slot("mavuika", 2)]) },
    { chars: ["mavuika"], dps: 100000, build: [slot("mavuika")] },
  ];
  const result = affordableTeams(teams, { characters: { mavuika: { cons: 0 } } }, names, all, 2);
  assert.equal(result.find(team => team.acquisition.cost === 2).comparison.baseline.dps, 100000);
});

test("recommendations do not spend extra acquisitions for a weaker comparable build", () => {
  const teams = [
    { chars: ["mavuika"], dps: 90000, build: withSets([slot("mavuika", 2)]) },
    { chars: ["mavuika"], dps: 100000, build: withSets([slot("mavuika")]) },
  ];
  assert.equal(affordableTeams(teams, { characters: { mavuika: { cons: 0 } } }, names, all, 2).length, 1);
});

test("weapon comparisons retain owned and required copies, including allocated copies", () => {
  const team = { build: [slot("mavuika", 0, "sword"), slot("furina", 0, "sword"), slot("bennett", 6, "sword")] };
  const inventory = { characters: { mavuika: { cons: 0 }, furina: { cons: 0 }, bennett: { cons: 6 } }, weapons: { sword: [5] } };
  const plan = acquisitionPlan(team, inventory, names, all);
  assert.equal(plan.cost, 2);
  assert.deepEqual(plan.weaponComparison.sword, { owned: [5], required: [1, 1, 1] });
});

const huTaoBaseline = { chars: ["hutao", "yelan", "kazuha", "bennett"], dps: 76724, build: [
  { ...slot("hutao", 0, "balladofthefjords"), fiveStar: false },
  { ...slot("yelan", 0, "favoniuswarbow", 5), fiveStar: false },
  { ...slot("kazuha", 0, "favoniussword", 3), fiveStar: false },
  { ...slot("bennett", 6, "thealleyflash"), fiveStar: false },
] };
const huTaoUpgrade = { chars: huTaoBaseline.chars, dps: 106623, build: [
  slot("hutao", 1, "staffofthescarletsands"),
  slot("yelan", 2, "elegyfortheend"),
  { ...slot("kazuha", 0, "xiphosmoonlight"), fiveStar: false },
  huTaoBaseline.build[3],
] };
const huTaoNames = { hutao: { stars: 4 }, yelan: { stars: 4 }, kazuha: { stars: 4 }, bennett: { stars: 2 } };

test("Hu Tao's C1 proposal also charges for Yelan C2 and both missing five-star weapons", () => {
  const inventory = { characters: { hutao: { cons: 0 }, yelan: { cons: 0 }, kazuha: { cons: 0 }, bennett: { cons: 6 } } };
  assert.equal(acquisitionPlan(huTaoUpgrade, inventory, huTaoNames, all).cost, 5);
  assert(!affordableTeams([huTaoBaseline, huTaoUpgrade], inventory, huTaoNames, all, 4).some(team => team.dps === 106623));
  assert(affordableTeams([huTaoBaseline, huTaoUpgrade], inventory, huTaoNames, all, 5).some(team => team.dps === 106623));
});

test("owned Yelan C2 and weapons require explicit comparison allowances when only Hu Tao C1 is proposed", () => {
  const inventory = {
    characters: { hutao: { cons: 0 }, yelan: { cons: 2 }, kazuha: { cons: 0 }, bennett: { cons: 6 } },
    weapons: { staffofthescarletsands: [1], elegyfortheend: [1] },
  };
  const result = affordableTeams([huTaoBaseline, huTaoUpgrade], inventory, huTaoNames, all, 1);
  const upgrade = result.find(team => team.dps === 106623);
  assert.equal(upgrade.acquisition.cost, 1);
  assert.equal(upgrade.acquisition.weapons.length, 0);
  assert.equal(upgrade.comparison.baseline, null);
  assert.equal(comparisonBaseline(upgrade, upgrade.comparison.baselines, { otherConstellations: true }), null);
  assert.equal(comparisonBaseline(upgrade, upgrade.comparison.baselines, { otherWeapons: true }), null);
  const baseline = comparisonBaseline(upgrade, upgrade.comparison.baselines, { otherConstellations: true, otherWeapons: true });
  assert.equal(baseline.dps, 76724);
  assert.deepEqual(buildDifferences(baseline, upgrade).map(change => [change.char, change.cons, change.weapon?.to.key]), [
    ["hutao", { from: 0, to: 1 }, "staffofthescarletsands"],
    ["yelan", { from: 0, to: 2 }, "elegyfortheend"],
    ["kazuha", null, "xiphosmoonlight"],
  ]);
});

test("weapon comparisons keep already-owned support weapons and refinements unchanged by default", () => {
  const characterNames = { ...huTaoNames, mona: { stars: 4 }, fischl: { stars: 2 } };
  const fourStar = (char, cons, weapon, refine = 1) => ({ ...slot(char, cons, weapon, refine), fiveStar: false });
  const target = { chars: ["hutao", "yelan", "mona", "fischl"], dps: 177579, build: [
    slot("hutao", 1, "staffofhoma"), slot("yelan", 0, "elegyfortheend"),
    fourStar("mona", 4, "favoniuscodex", 5), slot("fischl", 6, "skywardharp"),
  ] };
  const matching = { ...target, dps: 120000, build: [fourStar("hutao", 1, "balladofthefjords"), ...target.build.slice(1)] };
  const unrelated = { ...target, dps: 129877, build: [
    fourStar("hutao", 1, "balladofthefjords"), fourStar("yelan", 0, "favoniuswarbow", 4),
    fourStar("mona", 4, "favoniuscodex", 3), fourStar("fischl", 6, "thestringless", 5),
  ] };
  const inventory = {
    characters: { hutao: { cons: 1 }, yelan: { cons: 0 }, mona: { cons: 4 }, fischl: { cons: 6 } },
    weapons: { elegyfortheend: [1], skywardharp: [1] },
  };
  const result = affordableTeams([target, unrelated, matching], inventory, characterNames, all, 1);
  const upgrade = result.find(team => team.dps === target.dps);
  assert.equal(upgrade.acquisition.cost, 1);
  assert.equal(upgrade.comparison.baseline.dps, 120000);
  assert.equal(comparisonBaseline(upgrade, upgrade.comparison.baselines, { otherWeapons: true }).dps, 129877);
});

test("purchased constellations and refinements compare from the actual owned level", () => {
  const target = { chars: ["mavuika"], dps: 200000, build: [slot("mavuika", 2, "sword", 3)] };
  const baselines = [
    { chars: target.chars, dps: 150000, build: [slot("mavuika", 0, "sword", 2)] },
    { chars: target.chars, dps: 160000, build: [slot("mavuika", 1, "sword", 1)] },
    { chars: target.chars, dps: 140000, build: [slot("mavuika", 1, "sword", 2)] },
  ];
  const result = affordableTeams([target, ...baselines], { characters: { mavuika: { cons: 1 } }, weapons: { sword: [2] } }, names, all, 2);
  const upgrade = result.find(team => team.dps === 200000);
  assert.equal(upgrade.comparison.baseline.dps, 140000);
  assert.equal(comparisonBaseline(upgrade, upgrade.comparison.baselines, { otherWeapons: true, otherConstellations: true }).dps, 140000);
});

test("Nefer's C1 Dummy test compares to C0 without artifact data and separately from simulations or boss runs", () => {
  const characterNames = { nefer: { stars: 4 }, columbina: { stars: 4 }, lauma: { stars: 4 }, sucrose: { stars: 2 } };
  const build = ["nefer", "columbina", "lauma", "sucrose"].map((char, i) => ({
    ...slot(char, i === 3 ? 6 : 0, ["dawningfrost", "favoniuscodex", "etherlightspindlelute", "sacrificialfragments"][i], 5), fiveStar: false,
  }));
  const baseline = { chars: build.map(member => member.char), origin: "dummy", dps: 193385, build };
  const target = { ...baseline, dps: 239580, build: [{ ...build[0], cons: 1 }, ...build.slice(1)] };
  const pool = [target, { ...baseline, origin: null, dps: 260000 }, { ...baseline, origin: "clear", dps: 300000 }, baseline];
  const inventory = { characters: Object.fromEntries(build.map(member => [member.char, { cons: member.cons }])) };
  const upgrade = affordableTeams(pool, inventory, characterNames, all, 1).find(team => team.dps === 239580);
  assert.equal(upgrade.comparison.baseline.origin, "dummy");
  assert.equal(upgrade.comparison.baseline.dps, 193385);
  assert.deepEqual(upgrade.comparison.changes, [{ char: "nefer", cons: { from: 0, to: 1 }, weapon: null }]);
});

test("a Dummy test has no baseline when only a simulation or boss run is available", () => {
  for (const origin of [null, "clear"]) {
    const target = { chars: ["mavuika"], origin: "dummy", dps: 200000, build: [slot("mavuika", 1)] };
    const baseline = { ...target, origin, dps: 100000, build: [slot("mavuika")] };
    const upgrade = affordableTeams([target, baseline], { characters: { mavuika: { cons: 0 } } }, names, all, 1).find(team => team.dps === 200000);
    assert.equal(upgrade.comparison.baseline, null);
  }
});

test("build differences match character keys, preserve refinement decreases, and ignore artifacts", () => {
  const baseline = { build: [slot("mavuika", 0, "sword", 5), slot("furina")] };
  const target = { build: withSets([slot("furina"), slot("mavuika", 0, "sword", 3)]) };
  assert.deepEqual(buildDifferences(baseline, target), [{ char: "mavuika", cons: null, weapon: {
    from: { key: "sword", refine: 5 }, to: { key: "sword", refine: 3 },
  } }]);
});
