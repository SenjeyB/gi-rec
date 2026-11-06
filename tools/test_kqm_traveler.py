import unittest

from build_db import build


class TravelerKQMSTest(unittest.TestCase):
    def simulation(self, traveler="luminecryo", cons=0, refine=3):
        chars = [traveler, "sucrose", "fischl", "bennett"]
        return {"id": None, "chars": chars, "dps": 100000,
                "team": [{"name": key, "cons": cons if key == traveler else 6,
                          "weapon": "exaiphanesblade" if key == traveler else "favonius",
                          "refine": refine, "sets": {}, "kqmArt": True}
                         for key in chars]}

    def result(self, sim, traveler_stars=1):
        names = {key: {"stars": traveler_stars if i == 0 else 2}
                 for i, key in enumerate(sim["chars"])}
        weapons = {"exaiphanesblade": {"rarity": 5, "free": True},
                   "favonius": {"rarity": 4}, "paidlegendary": {"rarity": 5}}
        db, *_ = build([sim], {key: key for key in names}, weapons, names)
        return db["teams"][0]["builds"][0]

    def test_all_traveler_forms_constellations_and_free_weapon_refinements(self):
        for prefix in ("lumine", "aether", "traveler"):
            for element in ("anemo", "geo", "electro", "dendro", "hydro", "pyro", "cryo"):
                for cons in range(7):
                    for refine in range(1, 6):
                        with self.subTest(prefix=prefix, element=element, cons=cons, refine=refine):
                            sim = self.simulation(prefix + element, cons, refine)
                            result = self.result(sim)
                            self.assertTrue(result["kqmCons"])
                            self.assertTrue(result["kqmArt"])

    def test_traveler_exception_does_not_depend_on_rarity_category(self):
        self.assertTrue(self.result(self.simulation(cons=4), traveler_stars=4)["kqmCons"])

    def test_non_free_five_star_weapon_still_fails(self):
        sim = self.simulation()
        sim["team"][0]["weapon"] = "paidlegendary"
        self.assertFalse(self.result(sim)["kqmCons"])

    def test_other_characters_still_need_standard_constellations(self):
        sim = self.simulation()
        sim["team"][1]["cons"] = 5
        self.assertFalse(self.result(sim)["kqmCons"])

    def test_artifact_compliance_remains_independent(self):
        sim = self.simulation()
        sim["team"][0]["kqmArt"] = False
        result = self.result(sim)
        self.assertTrue(result["kqmCons"])
        self.assertFalse(result["kqmArt"])


if __name__ == "__main__":
    unittest.main()
