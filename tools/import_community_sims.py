import argparse
import json
import math
import posixpath
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_db import (MAIN_VALUE, SUB_KEYS, _rolls, _stat_values,
                      build_char_index, kqm_artifacts, load_names)

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
STAT_ORDER = ["", "def%", "def", "hp", "hp%", "atk", "atk%", "er", "em", "cr", "cd",
              "heal", "pyro%", "hydro%", "cryo%", "electro%", "anemo%", "geo%",
              "dendro%", "phys%", "atkspd%", "dmg%", "", "base_hp", "base_atk", "base_def"]


def first_sheet_links(path):
    with zipfile.ZipFile(path) as book:
        wb = ET.fromstring(book.read("xl/workbook.xml"))
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))}
        target = rels[wb.find("s:sheets/s:sheet", NS).get(RID)]
        sheet_path = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
        sheet = ET.fromstring(book.read(sheet_path))
        rel_path = posixpath.dirname(sheet_path) + "/_rels/" + posixpath.basename(sheet_path) + ".rels"
        sheet_rels = ({r.get("Id"): r.get("Target") for r in ET.fromstring(book.read(rel_path))}
                      if rel_path in book.namelist() else {})
        strings = (["".join(si.itertext()) for si in ET.fromstring(book.read("xl/sharedStrings.xml"))]
                   if "xl/sharedStrings.xml" in book.namelist() else [])
        candidates = [sheet_rels.get(h.get(RID), "") for h in sheet.findall("s:hyperlinks/s:hyperlink", NS)]
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
        if (url.scheme == "https" and url.hostname in ("wfpsim.com", "www.wfpsim.com")
                and url.path.startswith("/sh/")):
            clean = urllib.parse.urlunsplit((url.scheme, url.netloc, url.path.rstrip("/"), "", ""))
            if clean not in out:
                out.append(clean)
    return out


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
        matches = [k for k in member_keys if len(who) >= 4 and k.startswith(who)]
        if len(matches) == 1:
            return matches[0]
        raise ValueError(f"Unknown or ambiguous config alias: {who}")

    slots = {k: {"main": [], "subs": defaultdict(float), "mods": defaultdict(float),
                 "sum": defaultdict(float)} for k in member_keys}
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
        if {s for s, _ in values} == SUB_KEYS:
            for stat, value in values:
                slot["subs"][stat] += value
            continue
        pieces, extras = [], []
        for stat, value in values:
            if (stat == "hp" and abs(value - 4780) < 0.001) or (stat == "atk" and abs(value - 311) < 0.001):
                continue
            base = MAIN_VALUE.get(stat)
            n = round(value / base) if base else 0
            tolerance = 0.51 * max(n, 1) if stat == "em" else 0.001
            if 1 <= n <= 3 and abs(value - n * base) < tolerance:
                pieces += [stat] * n
            else:
                extras.append((stat, value))
        if len(pieces) == 3 and not slot["main"]:
            slot["main"] = pieces
            values = extras
        for stat, value in values:
            slot["mods"][stat] += value

    team = []
    for member, key in zip(members, member_keys):
        slot = slots[key]
        if len(slot["main"]) != 3 or set(slot["subs"]) != SUB_KEYS:
            raise ValueError(f"Incomplete artifact stats for {key}")
        for stat, value in zip(STAT_ORDER, member.get("stats") or []):
            if stat and abs(value - slot["sum"].get(stat, 0)) > 0.005:
                raise ValueError(f"Config/result stat mismatch for {key}: {stat}")
        if any(stat not in STAT_ORDER for stat in slot["sum"]):
            raise ValueError(f"Unknown stat for {key}")
        subs = {s: _rolls(s, v) for s, v in slot["subs"].items()}
        weapon = member.get("weapon") or {}
        talents = member.get("talents") or {}
        team.append({
            "name": key, "element": member.get("element"), "cons": int(member.get("cons") or 0),
            "weapon": weapon.get("name"), "refine": int(weapon.get("refine") or 1),
            "sets": member.get("sets") or {}, "main": slot["main"], "subs": subs,
            "mods": {s: round(v, 6) for s, v in sorted(slot["mods"].items())},
            "kqmArt": kqm_artifacts(subs), "lvl": member.get("level"),
            "talents": [talents.get(k) for k in ("attack", "skill", "burst")],
        })
    fingerprint = sha256((config + "\n" + repr(dps)).encode("utf-8")).hexdigest()[:20]
    return {"id": None, "key": "community-" + fingerprint, "simulator": "wfpsim",
            "simVersion": result.get("sim_version"), "mode": result.get("mode"), "targets": 1,
            "chars": member_keys, "dps": dps, "dur": (statistics.get("duration") or {}).get("mean"),
            "iterations": statistics.get("iterations"), "team": team,
            "config": re.sub(r'https?://\S+', "[link removed]", config)}


def main():
    parser = argparse.ArgumentParser(description="Import simulation builds from the first worksheet")
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("community_sims.json"))
    args = parser.parse_args()
    links = first_sheet_links(args.workbook)
    if not links:
        raise ValueError("The first worksheet contains no supported simulation links")
    names = load_names()
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda url: read_result(url, args.cache), links))
    sims = [normalize_result(result, names) for result in results]
    if len({s["key"] for s in sims}) != len(sims):
        raise ValueError("Duplicate simulation payloads")
    snapshot = {"version": 1, "simulations": sims}
    text = json.dumps(snapshot, ensure_ascii=False, indent=1) + "\n"
    if not args.output.exists() or args.output.read_text(encoding="utf-8") != text:
        args.output.write_text(text, encoding="utf-8")
    compliant = sum(all(m["kqmArt"] for m in s["team"]) for s in sims)
    print(f"Imported {len(sims)} simulations; KQMS artifacts: {compliant}/{len(sims)}")


if __name__ == "__main__":
    main()
