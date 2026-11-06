import argparse
import json
import math
import posixpath
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_db import (MAIN_VALUE, STAT_RE, SUB_KEYS, _rolls, _stat_values, audit_community_sim,
                      build_char_index, kqm_artifacts, load_names)

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
STAT_ORDER = ["", "def%", "def", "hp", "hp%", "atk", "atk%", "er", "em", "cr", "cd",
              "heal", "pyro%", "hydro%", "cryo%", "electro%", "anemo%", "geo%",
              "dendro%", "phys%", "atkspd%", "dmg%", "", "base_hp", "base_atk", "base_def"]
SHARE_HOSTS = {"wfpsim.com", "www.wfpsim.com", "sim.kqm.gg", "gcsim.app"}
FOUR_STAR_MAIN = {"hp%": 0.348, "atk%": 0.348, "def%": 0.435, "em": 139.3,
                  "er": 0.387, "cr": 0.232, "cd": 0.464, "heal": 0.268,
                  **{s: 0.348 for s in ("pyro%", "hydro%", "cryo%", "electro%", "anemo%", "geo%", "dendro%")},
                  "phys%": 0.435}


def workbook_links(path, sheet_names=None, first_only=False):
    with zipfile.ZipFile(path) as book:
        wb = ET.fromstring(book.read("xl/workbook.xml"))
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))}
        strings = (["".join(si.itertext()) for si in ET.fromstring(book.read("xl/sharedStrings.xml"))]
                   if "xl/sharedStrings.xml" in book.namelist() else [])
        candidates = []
        sheets = wb.findall("s:sheets/s:sheet", NS)
        if first_only:
            sheets = sheets[:1]
        if sheet_names:
            missing = set(sheet_names) - {s.get("name") for s in sheets}
            if missing:
                raise ValueError(f"Worksheet not found: {', '.join(sorted(missing))}")
            sheets = [s for s in sheets if s.get("name") in sheet_names]
        for selected in sheets:
            target = rels[selected.get(RID)]
            sheet_path = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
            sheet = ET.fromstring(book.read(sheet_path))
            rel_path = posixpath.dirname(sheet_path) + "/_rels/" + posixpath.basename(sheet_path) + ".rels"
            sheet_rels = ({r.get("Id"): r.get("Target") for r in ET.fromstring(book.read(rel_path))}
                          if rel_path in book.namelist() else {})
            candidates += [sheet_rels.get(h.get(RID), "") for h in sheet.findall("s:hyperlinks/s:hyperlink", NS)]
            for c in sheet.findall("s:sheetData/s:row/s:c", NS):
                value = c.findtext("s:v", "", NS)
                if c.get("t") == "s":
                    value = strings[int(value)] if value else ""
                elif c.get("t") == "inlineStr":
                    value = "".join(c.find("s:is", NS).itertext())
                candidates += re.findall(r'https://[^\s"<>]+', value + " " + c.findtext("s:f", "", NS))
    out = []
    for candidate in candidates:
        url = urllib.parse.urlsplit(candidate)
        if (url.scheme == "https" and url.hostname in SHARE_HOSTS
                and url.path.startswith("/sh/")):
            clean_path = url.path.rstrip("/").rstrip(").,;]")
            clean = urllib.parse.urlunsplit((url.scheme, url.netloc, clean_path, "", ""))
            if clean not in out:
                out.append(clean)
    return out


def first_sheet_links(path):
    return workbook_links(path, first_only=True)


def read_result(url, cache):
    parts = urllib.parse.urlsplit(url)
    key = parts.path.rsplit("/", 1)[1]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", key):
        raise ValueError("Invalid share key")
    path = cache / (key + ".json") if cache else None
    if path and path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    endpoint = urllib.parse.urlunsplit((parts.scheme, parts.netloc, "/api/share/" + key, "", ""))
    for attempt in range(3):
        try:
            req = urllib.request.Request(endpoint, headers={"User-Agent": "gi-rec-import/1.0"})
            with urllib.request.urlopen(req, timeout=40) as response:
                raw = response.read()
            result = json.loads(raw)
            if path:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            return result
        except urllib.error.HTTPError as error:
            if error.code in (404, 410) or attempt == 2:
                raise
            time.sleep(attempt + 1)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def normalize_result(result, names):
    members = result.get("character_details") or []
    targets = result.get("target_details") or []
    statistics = result.get("statistics") or {}
    if len(members) != 4 or len(targets) != 1:
        raise ValueError("Import requires four characters and one target")
    dps = (statistics.get("dps") or {}).get("mean")
    if not isinstance(dps, (int, float)) or not math.isfinite(dps) or dps <= 0:
        raise ValueError("Missing positive mean DPS")
    index = build_char_index(names, {})
    member_keys = [index.get(m["name"], m["name"]) for m in members]
    if len(set(member_keys)) != 4 or any(k not in names for k in member_keys):
        raise ValueError("Unknown or duplicate character")

    def canonical(who):
        key = index.get(who, who)
        if key in member_keys:
            return key
        matches = [k for k in member_keys if len(who) >= 3 and k.startswith(who)]
        if len(matches) == 1:
            return matches[0]
        raise ValueError(f"Unknown or ambiguous config alias: {who}")

    slots = {k: {"main": [], "subs": defaultdict(float), "mods": defaultdict(float),
                 "sum": defaultdict(float), "rollCounts": defaultdict(float)} for k in member_keys}
    config = result.get("config_file") or ""
    for raw in config.splitlines():
        line = re.split(r"#|//", raw, maxsplit=1)[0].strip()
        match = re.match(r"(\w+)\s+add\s+stats\s+(.+)", line)
        if not match:
            continue
        slot = slots[canonical(match[1].lower())]
        values = _stat_values(match[2])
        for stat, value in values:
            slot["sum"][stat] += value
        stat_keys = {s for s, _ in values}
        if stat_keys == SUB_KEYS or (stat_keys <= SUB_KEYS and len(stat_keys) >= 5 and {"cr", "cd"} <= stat_keys):
            for stat, value in values:
                slot["subs"][stat] += value
            for stat, expr in STAT_RE.findall(match[2]):
                factors = [float(v) for v in expr.split("*")]
                count = math.prod(v for v in factors[1:] if v >= 1) if len(factors) > 1 else _rolls(stat, factors[0])
                slot["rollCounts"][stat] += count
            continue
        pieces, extras = [], []
        for stat, value in values:
            if (stat == "hp" and min(abs(value - n) for n in (4780, 3571)) < 0.001
                    or stat == "atk" and min(abs(value - n) for n in (311, 232)) < 0.001):
                continue
            matched = False
            bases = [MAIN_VALUE.get(stat), FOUR_STAR_MAIN.get(stat)]
            if stat not in ("hp", "atk") and MAIN_VALUE.get(stat):
                bases.append(MAIN_VALUE[stat] * 0.75)
            for base in filter(None, bases):
                n = round(value / base)
                tolerance = 0.51 * max(n, 1) if stat == "em" else 0.001
                if 1 <= n <= 3 and abs(value - n * base) < tolerance:
                    pieces += [stat] * n
                    matched = True
                    break
            if not matched:
                extras.append((stat, value))
        if len(pieces) == 3 and not slot["main"]:
            slot["main"] = pieces
            values = extras
        for stat, value in values:
            slot["mods"][stat] += value

    team = []
    for member, key in zip(members, member_keys):
        slot = slots[key]
        if len(slot["main"]) not in (0, 3):
            raise ValueError(f"Ambiguous artifact main stats for {key}")
        for stat, value in zip(STAT_ORDER, member.get("stats") or []):
            if stat and abs(value - slot["sum"].get(stat, 0)) > 0.005:
                raise ValueError(f"Config/result stat mismatch for {key}: {stat}")
        if any(abs(v) > 0.005 for v in (member.get("stats") or [])[len(STAT_ORDER):]):
            raise ValueError(f"Unsupported result stat for {key}")
        if any(stat not in STAT_ORDER for stat in slot["sum"]):
            raise ValueError(f"Unknown stat for {key}")
        subs = {s: _rolls(s, v) for s, v in slot["subs"].items()}
        total = None
        if not slot["main"]:
            if slot["subs"]:
                total = {s: round(v, 6) for s, v in sorted(slot["subs"].items())}
            else:
                total = {s: round(v, 6) for s, v in sorted(slot["sum"].items())}
                slot["mods"] = {}
            subs = {}
        weapon = member.get("weapon") or {}
        talents = member.get("talents") or {}
        team.append({
            "name": key, "element": member.get("element"), "cons": int(member.get("cons") or 0),
            "weapon": weapon.get("name"), "refine": int(weapon.get("refine") or 1),
            "sets": member.get("sets") or {}, "main": slot["main"], "subs": subs,
            "subValues": {s: round(v, 6) for s, v in sorted(slot["subs"].items())} if slot["main"] else {},
            "rollCounts": {s: round(v, 1) for s, v in sorted(slot["rollCounts"].items())
                           if slot["main"] and abs(v - subs.get(s, 0)) > 0.05},
            "total": total,
            "mods": {s: round(v, 6) for s, v in sorted(slot["mods"].items())},
            "kqmArt": kqm_artifacts(subs), "lvl": member.get("level"),
            "talents": [talents.get(k) for k in ("attack", "skill", "burst")],
        })
    fingerprint = sha256((config + "\n" + repr(dps)).encode("utf-8")).hexdigest()[:20]
    return audit_community_sim({"id": None, "key": "community-" + fingerprint, "simulator": "sim",
            "simVersion": result.get("sim_version"), "mode": result.get("mode"), "targets": 1,
            "chars": member_keys, "dps": dps, "dur": (statistics.get("duration") or {}).get("mean"),
            "iterations": statistics.get("iterations"), "team": team,
            "config": re.sub(r'https?://\S+', "[link removed]", config)})


def main():
    parser = argparse.ArgumentParser(description="Append simulation builds from Excel workbooks")
    parser.add_argument("workbook", type=Path, nargs="+")
    parser.add_argument("--sheet", action="append", help="only read the selected worksheet (repeatable)")
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--skip-unavailable", action="store_true", help="skip shares that return HTTP 404 or 410")
    parser.add_argument("--supplement", type=Path, action="append", default=[], help="additional normalized reconstructed builds")
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("community_sims.json"))
    args = parser.parse_args()
    links = list(dict.fromkeys(url for path in args.workbook for url in workbook_links(path, args.sheet)))
    if not links:
        raise ValueError("The selected worksheets contain no supported simulation links")
    names = load_names()
    def download(url):
        try:
            return read_result(url, args.cache)
        except urllib.error.HTTPError as error:
            if args.skip_unavailable and error.code in (404, 410):
                print(f"Unavailable share: {urllib.parse.urlsplit(url).path.rsplit('/', 1)[1]}")
                return None
            raise
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(download, links))
    eligible = [r for r in results if r and len(r.get("character_details") or []) == 4]
    sims = [normalize_result(result, names) for result in eligible]
    for path in args.supplement:
        for extra in json.loads(path.read_text(encoding="utf-8")):
            if (not extra.get("reconstructed") or len(extra.get("chars") or []) != 4
                    or {m.get("name") for m in extra.get("team") or []} != set(extra["chars"])
                    or not math.isfinite(extra.get("dps", 0)) or extra["dps"] <= 0):
                raise ValueError("Invalid reconstructed build")
            for member in extra["team"]:
                if member["name"] not in names or not 0 <= member["cons"] <= 6 or not 1 <= member["refine"] <= 5:
                    raise ValueError("Invalid reconstructed equipment or constellation")
                member["kqmArt"] = kqm_artifacts(member.get("subs") or {})
            extra["id"], extra["simulator"] = None, "sim"
            sims.append(extra)
    previous = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {"version": 1, "simulations": []}
    if previous.get("version") != 1:
        raise ValueError("Unsupported simulation snapshot version")
    merged = {s["key"]: {**s, "simulator": "sim"} for s in previous["simulations"]}
    added = sum(s["key"] not in merged for s in {s["key"]: s for s in sims}.values())
    for sim in sims:
        if merged.get(sim["key"], {}).get("assumed") is False:
            sim["assumed"] = False
        merged[sim["key"]] = sim
    for sim in merged.values():
        audit_community_sim(sim)
    snapshot = {"version": 1, "simulations": list(merged.values())}
    text = json.dumps(snapshot, ensure_ascii=False, indent=1) + "\n"
    if not args.output.exists() or args.output.read_text(encoding="utf-8") != text:
        args.output.write_text(text, encoding="utf-8", newline="\n")
    compliant = sum(all(m["kqmArt"] for m in s["team"]) for s in sims)
    small = sum(r is not None and len(r.get("character_details") or []) != 4 for r in results)
    print(f"Read {len(sims)} builds; added {added}; total {len(merged)}; ignored non-four-character teams: {small}; KQMS artifacts: {compliant}/{len(sims)}")


if __name__ == "__main__":
    main()
