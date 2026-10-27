# GI-Rec

Genshin Impact Recommendations service.

- Teams come from the KQM sim database: https://db.kqm.gg/database
- Real Stygian Onslaught clears and training dummy runs come from https://www.stygian.moe (a one-time export, used with the authors' permission; `tools/stygian_snapshot.json`). A clear's DPS is an estimate: boss HP / clear time, shown as ~DPS. Clears made with third-party tools, cheese strategies and teams of fewer than 4 characters are skipped; 4★ characters count as C6
- Constellations are filters: by default 5★ at C0, 4★ at C6; your inventory or the "Any" setting can raise them
- Builds are checked against KQM Standards (constellations and artifacts)
- Current Spiral Abyss and Stygian Onslaught enemies come from the Genshin Impact wiki: https://genshin-impact.fandom.com
- Stygian Onslaught difficulty details (boss forms, mechanics, rules) come from the game data mirror: https://github.com/DimbreathBot/AnimeGameData

Current link: https://senjeyb.github.io/gi-rec/

Hosted by Github Pages

## Data updates

Data is refreshed by GitHub Actions (`.github/workflows/update-data.yml`):

- daily — Spiral Abyss and Stygian Onslaught (`tools/build_content.py`)
- weekly — the team database (`tools/build_db.py`)

After that, `tools/build_pages.py` rebuilds static pages for search engines (`en/`, `ru/`: a catalog, a page per character, best teams, the current Abyss and Onslaught) and `sitemap.xml`.

A commit is made only when the data actually changes. To run it by hand: Actions → Update data → Run workflow.
Locally: `python tools/build_content.py`, `python tools/build_db.py --icons` (needs Pillow for icons).

New characters still need a manual entry in `names.json` and a portrait in `characters/`; the workflow
prints a warning when the sims contain characters it doesn't know.
