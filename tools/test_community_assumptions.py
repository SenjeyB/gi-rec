import copy
import unittest

from build_db import SUB_KEYS, audit_community_sim


class CommunityAssumptionsTest(unittest.TestCase):
    def simulation(self):
        subs = {key: 2 for key in SUB_KEYS}
        subs.update({"atk%": 6, "em": 6, "cr": 8, "cd": 8})
        return {"simVersion": "859270fe6e133da958d9fb01b88b128952c10bb3", "dps": 193317,
                "config": "vesna add stats atk%=0.32 em=135; //крафт р5",
                "team": [{"name": name, "weapon": weapon, "refine": refine,
                          "subs": dict(subs), "mods": {}, "kqmArt": True}
                         for name, weapon, refine in [("vesna", "ironsting", 5),
                                                      ("odette", "exaiphanesblade", 3),
                                                      ("faruzan", "favoniuswarbow", 5),
                                                      ("vodyanitsa", "thrillingtalesofdragonslayers", 5)]]}

    def test_weapon_compensation_preserves_artifact_budget(self):
        sim = self.simulation()
        sim["team"][0]["mods"] = {"atk%": 0.32, "em": 135}
        before = copy.deepcopy(sim)
        audit_community_sim(sim)
        self.assertEqual(sim["team"][0]["weapon"], "emberwell")
        self.assertTrue(all(m["kqmArt"] for m in sim["team"]))
        self.assertEqual(sim["team"][0]["subs"], before["team"][0]["subs"])
        self.assertEqual(sim["team"][0]["mods"], before["team"][0]["mods"])
        self.assertEqual(sim["dps"], before["dps"])

    def test_extra_artifact_stats_cannot_hide_behind_weapon_compensation(self):
        sim = self.simulation()
        sim["team"][0]["mods"] = {"atk%": 0.32, "em": 154.82}
        audit_community_sim(sim)
        self.assertEqual(sim["team"][0]["unverifiedModifiers"], {"em": 19.82})
        self.assertFalse(sim["team"][0]["kqmArt"])

    def test_over_budget_fails_even_with_verified_weapon(self):
        sim = self.simulation()
        sim["team"][0]["mods"] = {"atk%": 0.32, "em": 135}
        sim["team"][0]["subs"]["em"] += 1
        audit_community_sim(sim)
        self.assertFalse(sim["team"][0]["kqmArt"])

    def test_party_bonus_requires_a_source_in_the_team(self):
        sim = self.simulation()
        sim["team"][1]["mods"] = {"em": 101}
        audit_community_sim(sim)
        self.assertFalse(sim["team"][1]["kqmArt"])
        sim["team"][2].update(weapon="theviridescenthunt", refine=1, mods={"er": 0.2})
        audit_community_sim(sim)
        self.assertEqual(sim["team"][2]["weapon"], "breezebornerefrain")
        self.assertTrue(sim["team"][1]["kqmArt"])

    def test_event_refinement_comes_from_explicit_equipment_assumption(self):
        sim = self.simulation()
        sim["config"] = "odette add stats em=208; //ивент р5"
        sim["team"][1].update(weapon="lionsroar", refine=1, mods={"em": 208})
        audit_community_sim(sim)
        member = sim["team"][1]
        self.assertEqual((member["weapon"], member["refine"]), ("silverlight", 5))
        self.assertEqual(member["weaponProxy"], {"weapon": "lionsroar", "refine": 1})

    def test_native_weapon_does_not_justify_a_second_copy_of_its_bonus(self):
        sim = self.simulation()
        sim["simVersion"] = "0d2fce5ef2d2aa7a254ad023c85c6250544ec9ff"
        sim["config"] = "yae add stats em=218; //крафт р5"
        sim["team"][0].update(name="yaemiko", weapon="echoesoftheheart", mods={"em": 218})
        audit_community_sim(sim)
        self.assertFalse(sim["team"][0]["kqmArt"])

    def test_unknown_revision_is_not_approved_by_a_legacy_rule(self):
        sim = self.simulation()
        sim["simVersion"] = "unreviewed-model"
        sim["team"][0]["mods"] = {"atk%": 0.32, "em": 135}
        audit_community_sim(sim)
        self.assertEqual(sim["team"][0]["weapon"], "ironsting")
        self.assertFalse(sim["team"][0]["kqmArt"])

    def test_reaudit_keeps_original_equipment_and_does_not_duplicate_bonuses(self):
        sim = self.simulation()
        sim["team"][0]["mods"] = {"atk%": 0.32, "em": 236}
        sim["team"][2].update(weapon="theviridescenthunt", refine=1, mods={"er": 0.2, "em": 101})
        audit_community_sim(sim)
        once = copy.deepcopy(sim)
        audit_community_sim(sim)
        self.assertEqual(sim, once)


if __name__ == "__main__":
    unittest.main()
