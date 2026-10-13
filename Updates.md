## Upcoming features:
- Saving your own teams

## 2.4.0 (2026/10/13)
- **5★ weapons at any refinement.** The “Allow 5★ weapons” checkbox is replaced by a “5★ weapons” choice: “None”, “R1 only” and “Any refinement”. This brings in C6R5 builds — for example, teams with C6 Mavuika: the database only has them with R5 weapons, so they never showed up, even with “Any” constellations. “Any” constellations together with “Any refinement” unlock all 4223 teams in the database.
- The refinement of your own 5★ weapons now counts: if you have an R5 copy, R5 builds show up in “R1 only” mode and in the team builder.
- **Fixed artifact stats in team details.** Some sims list artifact stats as a single total, main stats and substats combined. These used to show up as a long list of “main stats” with no substats; they are now shown as total stats with values.
- Fixed the HP% main stat being labelled ATK% — this affected about 6000 artifacts.
- Fixed stats missing entirely for about 1000 characters whose rotation used a short name (yoi, bina).
- Substats from builds taken from real accounts show exact values: rolls can be fractional, e.g. “CRIT DMG 71.5% (10.8)”.
- With the stats fixed, there are now 4303 fully KQMS-compliant builds instead of 3563.
- “Any, up to C6” renamed to “Any”.
- Team stats can no longer come from a stale browser cache after a database update.

## 2.3.0 (2026/10/13)
- **Teams at any constellation.** A new “Constellations” setting offers “Standard (5★ C0, 4★ C6)”, “With my constellations” (the previous behaviour) and “Any, up to C6”. “Any” unlocks teams that only exist at high constellations: +111 teams, +150 with 5★ weapons.
- **Every build of a team.** An expanded team now lists all of its builds from the database, with constellations, weapons and DPS. Builds above the standard are marked, and any of them can be opened to see its stats. 819 teams have more than one build.
- Fixed “All teams” in Best Teams still showing only your characters at your constellations. It now really shows every team, with missing characters highlighted.
- Fixed the inventory cards on phones: the constellation and refinement buttons no longer spill out of the card, the remove button no longer covers the icon, and rows line up.

## 2.2.1 (2026/10/13)
- KQM renamed to **KQMS** (KQM Standards).
- The “constellations” badge is replaced by **“full compliance”**: it turns green only when both constellations and artifacts follow the standard. The filter under Advanced works the same way.
- A character whose C1 is free but who sits at C0 in a team now counts as standard. Such teams used to be wrongly flagged — there are now 2.3× more fully compliant teams.
- Fixed filter labels under “Your characters” not switching language.

## 2.2.0 (2026/10/13)
- **Character window.** Clicking a character in the tier list, or a card in recommendations, opens a window with a large portrait, rarity, element, weapon type, whether you own them, their best DPS, and all of their teams page by page.
- **5★ weapons are tracked as copies, like the in-game inventory.** Instead of ticking a weapon, you add it one copy at a time from a picker. A team that needs two of the same 5★ weapon needs two copies. GOOD import carries over every copy too.
- **Search and filters in the inventory**: characters can be narrowed by ownership, rarity, element and weapon type, and search works in either language. Weapons have their own search and type filter.
- **Filter sheet on phones.** Filters and settings moved off the page into a sheet behind a “Filters” button, which shows how many filters are active.
- **Substats show real values**: “CRIT DMG 66.2% (10)”, with the number of rolls in brackets.
- **Team builder and suggestions follow your inventory strictly**: only teams that actually come together on your constellations are shown, and you must own every 5★ weapon they use.
- **Pagination** in recommendations, best teams and the character window. The “Squads to show on expand” setting is no longer needed and was removed.
- **Team details load on demand.** Artifact stats no longer ship with the main database — they are fetched when you expand a team. The initial download is about a third smaller.
- Characters are identified by an internal key rather than their name, so your saved selection no longer depends on the interface language.
- Filter labels are translated: elements and weapon types.
- Removed redundant explanatory text from the interface.
- The update list is translated and kept as a separate file per language.

## 2.1.0 (2026/10/13)
- **Russian character, weapon and artifact names.** The whole interface now switches language, not just the labels around it. Search accepts either language.
- **Team details.** Click a team to expand a panel with large portraits, weapons, artifact sets, artifact main stats and substat rolls, plus a link to the source simulation.
- **KQM standard.** Every build is checked against the [KQM calculation standard](https://compendium.keqingmains.com/): constellations (5★ at C0 or a forced C1, 4★ at C6) and artifacts (40 substat rolls, at least 2 of each). Both are shown on the team panel and can be used as filters under Advanced.
- Constellations are now shown per team from that team's own build, instead of a fixed C1 badge on the character everywhere.
- Character names in team cards are no longer boxed — the owned/missing colour moved to the card frame itself.
- Weapon refinement is shown for R1 too, not only R2+.
- **Phone layout.** Settings and your roster moved into a drawer behind the ☰ button, views moved to a bottom bar, and the content now gets the whole screen.
- Fixed the inventory jumping back to the top on every click.
- Fixed the page and roster losing their scroll position when switching language.

## 2.0.1 (2026/10/13)
- Fixed the layout on phones: the page no longer scrolls sideways. The header now wraps, the sidebar stops forcing its own width, and recommendation cards stack instead of sitting side by side.
- Buttons, chips and filters are now at least 38px tall on touch devices, and the interface is no longer scaled down to 90% there.

## 2.0.0 (2026/10/13)
- **Inventory** — a new section where you mark the characters you own, set their constellations, and list your 5★ weapons. Everything is stored in your browser only.
- **Weapons and artifact sets** are now shown for every character in a team. Characters running a 2+2 split show both sets; characters with no set show only the weapon.
- **5★ weapon teams** can be enabled with a toggle. Only R1 is allowed, since that is what a single banner pull gives you (+26 teams). "Only my 5★ weapons" narrows them down to the ones you actually have.
- **English / Russian interface** with a language switcher in the header. The language is picked from your browser on the first visit and remembered afterwards.
- **Feedback button** linking to GitHub Issues.
- Import from GOOD now reads constellations and 5★ weapons, not just the character list.
- Moved to the new KQM sim database — the old host went offline. Teams are rebuilt from 5606 simulations (3989 teams, 4015 with 5★ weapons enabled).
- Team data reworked into a proper database: every team now keeps all of its known builds, so constellations and weapons are filters rather than a fixed assumption. Each build links back to its source simulation.
- Fixed teams with the Traveler being listed twice, once per gender.
- Removed `teams.json`. The site reads `data/db.json` now; the old flat file carried no build information and is no longer generated by default.

## 1.7.3 (2026/09/23)
- Jahoda added
- Added new teams (3981 total)

## 1.7.2 (2026/09/13)
- Added new teams (3951 total) and characters
- Fixed list of C1 characters from "To Temper Thyself and Journey Far" event (including Standart characters now)
- UI tweaks

## 1.7.1 (2026/07/24)
- Performance UI fixes

## 1.7.0 (2026/07/23)
- Manual team builder
- C1 characters from free constalations event
- Character searching in filters
- More teams and new characters (3500+ teams total)
- Overall overhaul

## 1.6.1
- Random bug fixed

## 1.6.0
- New tier list types added (All Characters, Owned Only)
- Changed how flexibility tier list is calculated
- New team
- UI tweaks

## 1.5.1
- Google search engine indexation
- New teams added

## 1.5.0
- Additional tier list sorting mode based more on character flexibility
- Dahlia teams added
- Nefer added (unavailable)
- More new teams added (3500+ total)
- "Upcoming features" section
- UI tweaks

## 1.4.0
- Best Teams mode
- Quick character pre-sets
- All characters w/o teams temporary disabled
- Team Suggestions -> Team Builder
- Flins added (unavailable)
- UI Tweaks
- A lot of new teams added

## 1.3.1
- UI Tweaks
- New teams added

## 1.3.0
- Import characters from GOOD
- New teams added

## 1.2.0
- Temporary logo added
- Character filters added

## 1.1.2
- New teams added

## 1.1.1
- New teams added
- Varesa teams added

## 1.1.0
- New UI for team suggestions mode
- Added support for 3 teams to build

## 1.0.1
- UI adjustments

## 1.0.0
- Initial release.
- Note: Some characters currently have no available squads. The squads list will be expanded over time, as will the characters list.
