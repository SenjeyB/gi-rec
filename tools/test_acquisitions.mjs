import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionPlan, weaponAcquisitions, affordableTeams } from "../js/acquisitions.js";

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

test("upgrades refer to the best available baseline with the same composition and artifact sets", () => {
  const teams = [
    { chars: ["mavuika"], dps: 200000, build: withSets([slot("mavuika", 2)]) },
    { chars: ["mavuika"], dps: 100000, build: withSets([slot("mavuika")]) },
    { chars: ["mavuika"], dps: 120000, build: withSets([slot("mavuika")]) },
    { chars: ["mavuika"], dps: 180000, build: [{ ...slot("mavuika"), sets: [{ key: "other", pieces: 4 }] }] },
  ];
  const result = affordableTeams(teams, { characters: { mavuika: { cons: 0 } } }, names, all, 2);
  const upgrade = result.find(team => team.acquisition.cost === 2);
  assert.equal(upgrade.comparison.baseline.dps, 120000);
});

test("comparisons do not use Boss Runs, different sets, or assumptions as verified baselines", () => {
  const cases = [
    { origin: "clear" },
    { assumed: true },
    { build: [{ ...slot("mavuika"), sets: [{ key: "other", pieces: 4 }] }] },
  ];
  for (const extra of cases) {
    const target = { chars: ["mavuika"], dps: 200000, build: withSets([slot("mavuika", 2)]) };
    const baseline = { chars: ["mavuika"], dps: 100000, build: withSets([slot("mavuika")]), ...extra };
    const result = affordableTeams([target, baseline], { characters: { mavuika: { cons: 0 } } }, names, all, 2);
    assert.equal(result.find(team => team.acquisition.cost === 2).comparison.baseline, null);
  }
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
