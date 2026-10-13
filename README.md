# GI-Rec

Genshin Impact Recommendations service.

- Teams come from the KQM sim database: https://db.kqm.gg/database
- Constellations are filters: by default 5★ at C0 (or a free C1), 4★ at C6; your inventory or the "Any" setting can raise them
- Builds are checked against KQM Standards (constellations and artifacts)
- Current Spiral Abyss and Stygian Onslaught enemies come from the Genshin Impact wiki: https://genshin-impact.fandom.com
- Stygian Onslaught difficulty details (boss forms, mechanics, rules) come from the game data mirror: https://github.com/DimbreathBot/AnimeGameData

Current link: https://senjeyb.github.io/gi-rec/

Hosted by Github Pages

## Data updates

Data is refreshed by GitHub Actions (`.github/workflows/update-data.yml`):

- daily — Spiral Abyss and Stygian Onslaught (`tools/build_content.py`)
- weekly — the team database (`tools/build_db.py`)

A commit is made only when the data actually changes. To run it by hand: Actions → Update data → Run workflow.
Locally: `python tools/build_content.py`, `python tools/build_db.py --icons` (needs Pillow for icons).

New characters still need a manual entry in `names.json` and a portrait in `characters/`; the workflow
prints a warning when the sims contain characters it doesn't know.
