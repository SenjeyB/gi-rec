import unittest

from build_db import SUB_KEYS, kqm_artifacts


class KqmArtifactBudgetTest(unittest.TestCase):
    def distribution(self, total):
        stats = {key: 2 for key in SUB_KEYS}
        stats["cr"] += total - 20
        return stats

    def test_five_star_budget_allows_one_roll_error(self):
        for total in (39, 40, 41):
            self.assertTrue(kqm_artifacts(self.distribution(total)))
        for total in (38, 42):
            self.assertFalse(kqm_artifacts(self.distribution(total)))

    def test_instructor_uses_32_rolls_instead_of_40(self):
        counts = self.distribution(32)
        subs = {key: round(value * 0.8, 1) for key, value in counts.items()}
        self.assertTrue(kqm_artifacts(subs, {"instructor": 4}, counts))
        self.assertFalse(kqm_artifacts(subs))
        self.assertFalse(kqm_artifacts({key: n * 0.8 for key, n in self.distribution(34).items()}, {"instructor": 4}, self.distribution(34)))

    def test_mixed_rarity_average_is_recognized_without_count_expressions(self):
        subs = {key: round(value * 0.84, 1) for key, value in self.distribution(32).items()}
        self.assertTrue(kqm_artifacts(subs, {"instructor": 4}))

    def test_bonus_stats_cannot_increase_the_artifact_roll_budget(self):
        counts = self.distribution(32)
        subs = {key: round(value * 0.8, 1) for key, value in counts.items()}
        subs["em"] += 3
        self.assertFalse(kqm_artifacts(subs, {"instructor": 4}, counts))


if __name__ == "__main__":
    unittest.main()
