import unittest
from html.parser import HTMLParser

from build_pages import Data, LANGS, TOP_OVERALL, best_page


class TeamCards(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.cards = []
        self.body = {}
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "body":
            self.body = attrs
        if tag == "details" and "pg-team-card" in attrs.get("class", "").split():
            self.cards.append(attrs)


class StaticTeamsTest(unittest.TestCase):
    def test_exclusions_select_verified_alternative_for_same_team(self):
        data = Data.__new__(Data)
        data.chars = ["a", "b", "c", "d"]
        data.names = {key: {"stars": 4} for key in data.chars}
        members = [{"cons": 0, "weapon": None} for _ in data.chars]
        data.db = {"teams": [{"chars": [0, 1, 2, 3], "builds": [
            {"dps": 300000, "members": members, "assumed": True},
            {"dps": 200000, "members": members, "origin": "clear"},
            {"dps": 100000, "members": members},
        ]}]}
        self.assertEqual(data.pick_teams()[0]["buildIndex"], 0)
        self.assertEqual(data.pick_teams(exclude_runs=True, exclude_assumed=True)[0]["buildIndex"], 2)

    def test_best_pages_exclude_runs_and_assumptions_including_expanded_variants(self):
        data = Data()
        expected = [(team["teamIndex"], team["buildIndex"])
                    for team in data.verified_teams[:TOP_OVERALL]]
        self.assertTrue(expected)
        for lang in LANGS:
            with self.subTest(lang=lang):
                html = TeamCards(best_page(data, lang))
                actual = [(int(card["data-team-index"]), int(card["data-build-index"]))
                          for card in html.cards]
                self.assertEqual(actual, expected)
                self.assertEqual(html.body["data-exclude-boss-runs"], "true")
                self.assertEqual(html.body["data-exclude-assumed"], "true")
                for ti, bi in actual:
                    build = data.db["teams"][ti]["builds"][bi]
                    self.assertFalse(build.get("assumed"))
                    self.assertNotEqual(build.get("origin"), "clear")


if __name__ == "__main__":
    unittest.main()
