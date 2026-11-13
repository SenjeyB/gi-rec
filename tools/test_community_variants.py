import copy
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from import_community_sims import workbook_links, workbook_variants


class CommunityVariantsTest(unittest.TestCase):
    url = "https://sim.kqm.gg/sh/example"
    names = {"valeriy": {"nameRu": "Валерий"}, "mitya": {"nameRu": "Митя"},
             "diona": {"nameRu": "Диона"}, "alyosha": {"name": "Alyosha"}}

    def simulation(self):
        return {"key": "community-base", "dps": 200000, "id": None, "simulator": "sim",
                "config": "\n".join(f"{key} char lvl=90/90 cons={0 if key == 'mitya' else 6} talent=10,10,10;" for key in self.names),
                "chars": list(self.names), "assumed": False,
                "team": [{"name": key, "cons": 0 if key == "mitya" else 6,
                          "weapon": "favoniussword", "refine": 5, "sets": {"noblesseoblige": 4},
                          "main": ["atk%", "atk%", "cr"], "subs": {"em": 2}, "mods": {}, "kqmArt": True}
                         for key in self.names]}

    def workbook(self, folder, notes):
        rows = []
        for index, note in enumerate(notes, 3):
            link = f'<c r="E{index}" t="inlineStr"><is><t>{self.url}</t></is></c>' if index != 4 else ""
            rows.append(f'<row r="{index}">{link}<c r="G{index}" t="inlineStr"><is><t>{escape(note)}</t></is></c></row>')
        path = Path(folder) / "teams.xlsx"
        with zipfile.ZipFile(path, "w") as book:
            book.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Отряды" sheetId="1" r:id="rId1"/></sheets></workbook>')
            book.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
            book.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>' + "".join(rows) + '</sheetData><hyperlinks><hyperlink ref="E4" r:id="h1"/></hyperlinks></worksheet>')
            book.writestr("xl/worksheets/_rels/sheet1.xml.rels", f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="h1" Target="{self.url}" TargetMode="External"/></Relationships>')
        return path

    def test_variants_keep_equipment_and_stats_and_change_only_reported_constellation_and_dps(self):
        base = self.simulation()
        before = copy.deepcopy(base)
        with tempfile.TemporaryDirectory() as folder:
            path = self.workbook(folder, ["Валерий с2 190.1к", "Диона с5 147.1к", "Алёша С2 150400", "Митя C1 127,9k"])
            self.assertEqual(workbook_links(path), [self.url])
            variants = workbook_variants(path, {self.url: base}, self.names)
            self.assertEqual([sim["dps"] for sim in variants], [190100, 147100, 150400, 127900])
            for sim, key, cons in zip(variants, ["valeriy", "diona", "alyosha", "mitya"], [2, 5, 2, 1]):
                expected = copy.deepcopy(base["team"])
                next(m for m in expected if m["name"] == key)["cons"] = cons
                self.assertEqual(sim["team"], expected)
                self.assertIn(f"{key} char lvl=90/90 cons={cons} ", sim["config"])
                self.assertFalse(sim["assumed"])
                self.assertNotIn("reconstructed", sim)
                self.assertNotEqual(sim["key"], base["key"])
                self.assertEqual(sim["reportedVariant"]["base"], base["key"])
            self.assertEqual(base, before)
            self.assertEqual(variants, workbook_variants(path, {self.url: base}, self.names))

    def test_variant_rejects_a_character_outside_the_team(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.workbook(folder, ["Нахида C2 190к"])
            with self.assertRaisesRegex(ValueError, "variant character is not in the base team"):
                workbook_variants(path, {self.url: self.simulation()}, self.names)

    def test_variant_rejects_a_missing_parent(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.workbook(folder, ["Валерий C2 190к"])
            with self.assertRaisesRegex(ValueError, "one available base simulation"):
                workbook_variants(path, {}, self.names)

    def test_unrelated_notes_do_not_create_variants(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.workbook(folder, ["Смена оружия не требуется"])
            self.assertEqual(workbook_variants(path, {self.url: self.simulation()}, self.names), [])


if __name__ == "__main__":
    unittest.main()
