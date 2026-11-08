import unittest

from build_db import localized_char_names


class LocalizedNamesTest(unittest.TestCase):
    def setUp(self):
        self.names = {
            "mitya": {"name": "Mitya", "nameRu": "Митя"},
            "valeriy": {"name": "Valeriy", "nameRu": "Валерий"},
            "ayaka": {"name": "Ayaka"},
            "luminecryo": {"name": "MC (Cryo)"},
        }
        self.aliases = {**{key: key for key in self.names}, "kamisatoayaka": "ayaka"}

    def test_local_russian_names_override_english_names_in_source(self):
        source = {"mitya": "Mitya", "valeriy": "Valeriy", "kamisatoayaka": "Аяка"}
        chars = localized_char_names(self.names, self.aliases, source, "ru")
        self.assertEqual(chars, {"mitya": "Митя", "valeriy": "Валерий", "ayaka": "Аяка", "luminecryo": "ГГ (Крио)"})

    def test_english_names_and_missing_source_fallback_are_preserved(self):
        chars = localized_char_names(self.names, self.aliases, {"kamisatoayaka": "Kamisato Ayaka"}, "en")
        self.assertEqual(chars, {"mitya": "Mitya", "valeriy": "Valeriy", "ayaka": "Kamisato Ayaka", "luminecryo": "MC (Cryo)"})


if __name__ == "__main__":
    unittest.main()
