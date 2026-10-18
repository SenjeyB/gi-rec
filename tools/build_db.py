#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_db.py

Собирает базу отрядов для gi-rec из KQM Sim Database.
Эндпоинт: GET https://db.kqm.gg/api/db?q=<urlencoded JSON>
где JSON = {"query": {...}, "limit": N, "skip": M, "sort": {...}}

ВАЖНО про новый API (бывший simpact.app, он умер — 404):
у него allowlist полей и операторов. Разрешены только
  поля:      summary.mode, summary.target_count, summary.char_names,
             summary.mean_dps_per_target, summary.sim_duration.mean,
             description, submitter, accepted_tags, create_date
  операторы: $in $nin $ne $gt $gte $lt $lte $and $or $regex $options
Запрещены summary.team (и все вложенные), $size, $not, $elemMatch, $exists.
Поэтому фильтровать по созвездиям и оружию на сервере больше НЕЛЬЗЯ —
качаем всё и фильтруем локально. Это и к лучшему: для тогла «отряды на R1
легендарках» и для фильтра по своим пушкам всё равно нужен полный набор.

Выход:
  gi-rec/data/db.json    — структурированная база (отряды -> сборки -> персонажи)
  gi-rec/data/refs.json  — справочник оружия/сетов/персонажей для UI
  gi-rec/teams.json      — старый плоский формат, только с флагом --legacy

Использование:
  py build_db.py                 # скачать и собрать всё
  py build_db.py --icons         # ещё и скачать иконки оружия/сетов
  py build_db.py --cache x.jsonl # работать с локальным кэшем, не дёргая API
"""

import os
import glob
import re
import json
import time
import argparse
import datetime
import urllib.parse
import urllib.request
import urllib.error
from typing import Dict, List, Tuple, Optional

API_URL = "https://db.kqm.gg/api/db"
SIM_URL = "https://db.kqm.gg/db/{id}"
PAGE_LIMIT = 100          # жёсткий максимум API, больше -> 400 "Invalid page."

YATTA_BASE = "https://gi.yatta.moe/api/v2"
YATTA = YATTA_BASE + "/en"
GCSIM_CHARS = "https://raw.githubusercontent.com/genshinsim/gcsim/main/pkg/shortcut/character.dm.go"

ROOT = os.path.dirname(os.path.abspath(__file__))
# скрипт лежит в gi-rec/tools/ — сайт уровнем выше
SITE = os.environ.get("GIREC_SITE") or os.path.dirname(ROOT)
DATA = os.path.join(SITE, "data")
IN_CI = os.environ.get("GITHUB_ACTIONS") == "true"


def ci_warning(msg: str) -> None:
    """В GitHub Actions предупреждение видно на странице запуска."""
    print(f"::warning::{msg}" if IN_CI else f"ВНИМАНИЕ: {msg}")


def write_json(path: str, obj, **dump) -> bool:
    """Пишет файл, только если содержимое изменилось: иначе автообновление
    коммитило бы каждый запуск. Возвращает True, если файл переписан."""
    text = json.dumps(obj, ensure_ascii=False, **dump)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            if f.read() == text:
                return False
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return True


def same_except_generated(path: str, obj: dict) -> Optional[str]:
    """Если старый файл совпадает с obj во всём, кроме метки generated, —
    возвращает старую метку: тогда база не считается новой."""
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            old = json.load(f)
    except Exception:  # noqa: BLE001
        return None
    a = {k: v for k, v in old.items() if k != "generated"}
    b = {k: v for k, v in obj.items() if k != "generated"}
    return old.get("generated") if a == b else None

LANGS = ("en", "ru")
# Статы артефактов выносим из основной базы в шарды: они нужны только когда
# игрок раскрывает карточку отряда, а весят больше самой базы.
SHARD_SIZE = 250

# --- стандарт KQM (compendium.keqingmains.com) -------------------------------
# Артефакты: 40 роллов сабстатов — 20 фиксированных (по 2 на каждый из 10 статов)
# плюс 20 распределяемых. Ниже — цена одного ролла для 5* артефакта.
KQM_ROLL = {
    "def%": 0.062, "def": 19.68, "hp": 253.94, "hp%": 0.0496, "atk": 16.54,
    "atk%": 0.0496, "er": 0.0551, "em": 19.82, "cr": 0.0331, "cd": 0.0662,
}
SUB_KEYS = set(KQM_ROLL)
# фиксированный порядок для компактного хранения в db.json
SUB_ORDER = ["hp", "hp%", "atk", "atk%", "def", "def%", "er", "em", "cr", "cd"]
# Мейн-статы 5* артефакта 20 уровня. Цветок (hp) и перо (atk) фиксированы; по
# значению остальных считаем, сколько деталей отдано под стат (em=561 — три).
MAIN_VALUE = {
    "hp": 4780.0, "atk": 311.0, "hp%": 0.466, "atk%": 0.466, "def%": 0.583,
    "em": 186.5, "er": 0.518, "cr": 0.311, "cd": 0.622, "heal": 0.359,
}
ELEMENTAL_GOBLETS = ("pyro", "hydro", "electro", "cryo", "anemo", "geo", "dendro", "phys")
for _el in ELEMENTAL_GOBLETS:
    MAIN_VALUE.setdefault(_el + "%", 0.583 if _el == "phys" else 0.466)
# стат=значение, возможно с множителями: cr=0.0331*8, def=19.68*2*0.84, atk%=.099
STAT_RE = re.compile(r"([a-z]+%?)\s*=\s*(-?[0-9]*\.?[0-9]+(?:\s*\*\s*-?[0-9]*\.?[0-9]+)*)", re.I)


# ---------------------------------------------------------------- утилиты

def slug(s: str) -> str:
    """Ключ в стиле gcsim: только строчные буквы и цифры."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def http(url: str, tries: int = 5, timeout: int = 120) -> bytes:
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:120]
            last = f"HTTP {e.code}: {body}"
            if e.code == 400:            # осмысленная ошибка валидации — не ретраим
                raise RuntimeError(f"{last}\nURL: {url[:200]}")
        except Exception as e:           # noqa: BLE001 — сеть, ретраим
            last = str(e)
        if attempt < tries - 1:
            time.sleep(2.0 * (attempt + 1))
    raise RuntimeError(f"не удалось скачать {url[:120]}: {last}")


def fetch_json(url: str) -> dict:
    return json.loads(http(url).decode("utf-8"))


# ---------------------------------------------------------- загрузка симов

def fetch_page(query: dict, limit: int, skip: int) -> List[dict]:
    payload = {"query": query, "limit": limit, "skip": skip, "sort": {"create_date": -1}}
    url = API_URL + "?q=" + urllib.parse.quote(json.dumps(payload, ensure_ascii=False))
    return fetch_json(url).get("data") or []


def _stat_values(text: str) -> List[Tuple[str, float]]:
    """Пары (стат, значение) из «add stats ...»; множители перемножаем."""
    out = []
    for stat, expr in STAT_RE.findall(text):
        v = 1.0
        for part in expr.split("*"):
            v *= float(part)
        out.append((stat.lower(), v))
    return out


def _main_pieces(found: List[Tuple[str, float]]) -> Optional[List[str]]:
    """Если строка — мейн-статы (цветок, перо и до трёх деталей песок/кубок/корона),
    возвращает статы песка, кубка и короны. Иначе None: это сабстаты или сумма
    всех статов артефактов разом."""
    hp = [v for s, v in found if s == "hp"]
    atk = [v for s, v in found if s == "atk"]
    if hp or atk:
        # цветок и перо: 5* (4780/311) или 4* (3571/232); больше — уже сумма с сабами
        if len(hp) != 1 or len(atk) != 1 or not (3000 <= hp[0] <= 4800 and 200 <= atk[0] <= 312):
            return None
    pieces: List[str] = []
    for stat, v in found:
        if stat in ("hp", "atk"):
            continue
        base = MAIN_VALUE.get(stat)
        if base is None:                  # плоская защита и т.п. мейном не бывает
            return None
        n = int(round(v / base))
        if n > 3:                         # опечатка в единицах (cr=31.1) — одна деталь
            n = 1
        if n < 1 or v < 0.7 * base * n:   # 4* мейн ~0.75 от 5*, сабы гораздо меньше
            return None
        pieces += [stat] * n
    return pieces if len(pieces) <= 3 else None


def _rolls(stat: str, value: float) -> float:
    """Число роллов по цене KQM; у живых аккаунтов выходит дробным."""
    r = round(value / KQM_ROLL[stat], 1)
    return max(r, 0.0)


def _finish_slot(slot: dict) -> None:
    """Раскладывает строки «add stats» персонажа на мейны, сабы или итог.

    Встречаются три записи: мейны и сабы отдельными строками (сабы бывают одной
    строкой KQM base*N, реальными числами или построчно на каждый артефакт), либо
    одна строка с суммой всех статов артефактов — её на мейны и сабы честно не
    разложить, поэтому она хранится как итог."""
    main: List[str] = []
    rest: Dict[str, float] = {}
    has_main = False
    for found in slot.pop("lines", []):
        pieces = _main_pieces(found)
        if pieces is not None:
            main += pieces
            has_main = True
            continue
        for stat, v in found:
            rest[stat] = rest.get(stat, 0.0) + v
    slot["main"], slot["subs"], slot["total"] = [], {}, None
    if has_main:
        slot["main"] = main
        slot["subs"] = {k: _rolls(k, v) for k, v in rest.items() if k in KQM_ROLL}
    elif rest:
        slot["total"] = {k: round(v, 4) for k, v in rest.items()}


def parse_config(cfg: str) -> Dict[str, dict]:
    """Разбирает текст gcsim-конфига: мейн-статы и сабстаты по персонажам.

    Имя персонажа в конфиге может быть алиасом (raiden вместо raidenshogun),
    поэтому ключи возвращаются как есть — сопоставление делает вызывающий.
    """
    out: Dict[str, dict] = {}
    for raw in (cfg or "").split("\n"):
        line = raw.split("#", 1)[0].strip().rstrip(";").strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) < 2:
            continue
        who, rest = parts[0].lower(), parts[1]
        slot = out.setdefault(who, {"lines": [], "lvl": None, "talents": None})

        if rest.startswith("char "):
            m = re.search(r"lvl\s*=\s*(\d+)", rest)
            if m:
                slot["lvl"] = int(m.group(1))
            m = re.search(r"talent\s*=\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", rest)
            if m:
                slot["talents"] = [int(x) for x in m.groups()]
        elif rest.startswith("add stats"):
            slot["lines"].append(_stat_values(rest[len("add stats"):]))
    for slot in out.values():
        _finish_slot(slot)
    return out


def kqm_artifacts(subs: Dict[str, float]) -> bool:
    """40 роллов ровной ценой KQM, присутствуют все десять статов, у каждого ≥ 2."""
    if not subs or set(subs) != SUB_KEYS:
        return False
    if any(abs(n - round(n)) > 0.05 for n in subs.values()):
        return False
    return round(sum(subs.values())) == 40 and all(n >= 2 for n in subs.values())


def slim(entry: dict, alias: Optional[Dict[str, str]] = None) -> dict:
    """Оставляем только нужное: stats/snapshot — огромные массивы, они не нужны.
    Конфиг разбираем сразу и храним результат, а не исходный текст."""
    s = entry.get("summary") or {}
    cfg = parse_config(entry.get("config") or "")
    # в конфиге персонаж может быть записан алиасом (raiden вместо raidenshogun)
    # Ротация тоже может звать персонажа алиасом (yoi skill) — такой слот пустой и
    # не должен затирать слот со статами, записанный под полным именем.
    def has_stats(sl: dict) -> bool:
        return bool(sl.get("main") or sl.get("subs") or sl.get("total"))

    canon_cfg = {}
    for who, slot in cfg.items():
        canon = (alias or {}).get(who, who)
        cur = canon_cfg.get(canon)
        if cur is None or (has_stats(slot) and not has_stats(cur)):
            canon_cfg[canon] = slot
        canon_cfg.setdefault(who, slot)

    team = []
    for m in (s.get("team") or []):
        name = m.get("name")
        slot = canon_cfg.get((name or "").lower()) or {}
        subs = slot.get("subs") or {}
        team.append({
            "name": name,
            "element": m.get("element"),
            "cons": int(m.get("cons") or 0),
            "weapon": (m.get("weapon") or {}).get("name"),
            "refine": int((m.get("weapon") or {}).get("refine") or 1),
            "sets": m.get("sets") or {},
            "main": list(slot.get("main") or []),
            "subs": subs,
            "total": slot.get("total"),
            "kqmArt": kqm_artifacts(subs),
            "talents": slot.get("talents"),
            "lvl": slot.get("lvl"),
        })

    return {
        "id": entry.get("_id"),
        "created": entry.get("create_date"),
        "desc": entry.get("description"),
        "by": entry.get("submitter"),
        "mode": s.get("mode"),
        "targets": s.get("target_count"),
        "chars": s.get("char_names") or [],
        "dps": s.get("mean_dps_per_target") or 0,
        "dur": (s.get("sim_duration") or {}).get("mean"),
        "team": team,
    }


def normalize_sim(s: dict) -> dict:
    """Приводит запись к форме slim(). Кэши, снятые раньше, могли хранить
    оружие вложенным объектом {"name":..., "refine":...} — разворачиваем."""
    for m in s.get("team") or []:
        w = m.get("weapon")
        if isinstance(w, dict):
            m["weapon"] = w.get("name")
            m.setdefault("refine", int(w.get("refine") or 1))
        m["cons"] = int(m.get("cons") or 0)
        m["refine"] = int(m.get("refine") or 1)
        m["sets"] = m.get("sets") or {}
        m["total"] = m.get("total") or None
    s["chars"] = s.get("chars") or []
    s["dps"] = s.get("dps") or 0
    return s


def fetch_all_sims(alias: Optional[Dict[str, str]] = None, pause: float = 0.12) -> List[dict]:
    # только TTK-симы (mode==2) против одной цели; размер отряда отфильтруем локально,
    # потому что $size новый API не принимает
    query = {"summary.mode": 2, "summary.target_count": 1}
    out: List[dict] = []
    skip = 0
    while True:
        page = fetch_page(query, PAGE_LIMIT, skip)
        out.extend(slim(e, alias) for e in page)
        if skip % 1000 == 0:
            print(f"  skip={skip}: всего {len(out)}", flush=True)
        if len(page) < PAGE_LIMIT:
            break
        skip += PAGE_LIMIT
        time.sleep(pause)
    return out


# -------------------------------------------------------------- справочники

def load_refs() -> Tuple[Dict[str, dict], Dict[str, dict], Dict[str, str]]:
    """Оружие и сеты из игровых данных + алиасы персонажей из gcsim."""
    weapons = {}
    for v in fetch_json(f"{YATTA}/weapon")["data"]["items"].values():
        # скины оружия (Serpent Devourer - Sublimation и т.п.) — не оружие из
        # инвентаря, в каталоге им делать нечего
        if v.get("isWeaponSkin"):
            continue
        wtype = (v.get("type") or "").replace("WEAPON_", "").replace("_ONE_HAND", "").lower()
        if wtype == "pole":          # в names.json тип копейщиков называется polearm
            wtype = "polearm"
        weapons[slug(v["name"])] = {
            "name": v["name"],
            "rarity": v.get("rank"),
            "type": wtype or None,
            "icon": v.get("icon"),
        }
    sets = {}
    for v in fetch_json(f"{YATTA}/reliquary")["data"]["items"].values():
        sets[slug(v["name"])] = {"name": v["name"], "icon": v.get("icon")}

    cgo = http(GCSIM_CHARS).decode("utf-8")
    alias = {a: g.lower() for a, g in re.findall(r'"([a-z0-9]+)"\s*:\s*keys\.([A-Za-z0-9_]+)', cgo)}
    return weapons, sets, alias


def load_localized() -> Dict[str, Dict[str, Dict[str, str]]]:
    """Локализованные названия: lang -> {'chars'|'weapons'|'sets'} -> ключ -> имя.

    Ключи те же, что в базе (slug английского имени), поэтому подписи можно
    менять на лету, не трогая внутренние идентификаторы.
    """
    out: Dict[str, Dict[str, Dict[str, str]]] = {}
    for lang in LANGS:
        bucket = {"chars": {}, "weapons": {}, "sets": {}}
        en_chars = fetch_json(f"{YATTA_BASE}/en/avatar")["data"]["items"]
        loc_chars = fetch_json(f"{YATTA_BASE}/{lang}/avatar")["data"]["items"]
        for cid, v in en_chars.items():
            loc = loc_chars.get(cid)
            if loc:
                bucket["chars"][slug(v["name"])] = loc["name"]
        for kind, path in (("weapons", "weapon"), ("sets", "reliquary")):
            en_items = fetch_json(f"{YATTA_BASE}/en/{path}")["data"]["items"]
            loc_items = fetch_json(f"{YATTA_BASE}/{lang}/{path}")["data"]["items"]
            for wid, v in en_items.items():
                loc = loc_items.get(wid)
                if loc:
                    bucket[kind][slug(v["name"])] = loc["name"]
        out[lang] = bucket
        print(f"  {lang}: персонажей {len(bucket['chars'])}, "
              f"оружия {len(bucket['weapons'])}, сетов {len(bucket['sets'])}")
    return out


def load_names() -> Dict[str, dict]:
    with open(os.path.join(SITE, "names.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def build_char_index(names: Dict[str, dict], alias: Dict[str, str]) -> Dict[str, str]:
    """canonical ключ из API -> ключ в names.json (он же имя файла картинки)."""
    idx: Dict[str, str] = {}
    for short, v in names.items():
        idx[short] = short
        idx.setdefault(slug(v.get("name") or short), short)
        canon = alias.get(short)
        if canon:
            idx.setdefault(canon, short)
    # Итто: в names.json имя сокращено ("Itto"), канон — aratakiitto
    idx.setdefault("aratakiitto", "itto")
    # Путешественник: API отдаёт оба пола, в names.json обычно только lumine*.
    # GOOD-экспорты пишут его как TravelerAnemo и т.п.
    for k in list(idx):
        for prefix in ("lumine", "aether"):
            if k.startswith(prefix):
                rest = k[len(prefix):]
                idx.setdefault("lumine" + rest, idx[k])
                idx.setdefault("aether" + rest, idx[k])
                idx.setdefault("traveler" + rest, idx[k])
    return idx


# ----------------------------------------------------------------- сборка

def cons_cap(names: Dict[str, dict]) -> Dict[str, int]:
    """Базовый потолок созвездий: 5* — C0, 4* не ограничены (в симах они обычно C6)."""
    cap = {}
    for short, v in names.items():
        cap[short] = 0 if (v.get("stars") or 0) >= 3 else 6
    return cap


class Interner:
    def __init__(self):
        self.items: List[str] = []
        self._idx: Dict[str, int] = {}

    def __call__(self, key: str) -> int:
        if key not in self._idx:
            self._idx[key] = len(self.items)
            self.items.append(key)
        return self._idx[key]


def _compact(x: float):
    """1.0 -> 1, 10.8 -> 10.8: целые роллы пишем без дробной части."""
    x = round(float(x or 0), 1)
    return int(x) if x == int(x) else x


def build(sims: List[dict], char_idx: Dict[str, str], weapons: Dict[str, dict],
          names: Optional[Dict[str, dict]] = None):
    """Группируем по составу -> по уникальной сборке; DPS усредняем внутри сборки."""
    unknown_chars, unknown_weapons = set(), set()

    def ckey(api_name: str) -> str:
        k = char_idx.get(api_name)
        if k is None:
            unknown_chars.add(api_name)
            return api_name
        return k

    full = [s for s in sims if len(s["chars"]) == 4 and len(s["team"]) == 4]

    # состав -> подпись сборки -> агрегат
    comps: Dict[Tuple[str, ...], dict] = {}
    for s in full:
        members = []
        for m in s["team"]:
            w = m["weapon"] or ""
            if w and w not in weapons:
                unknown_weapons.add(w)
            members.append({
                "char": ckey(m["name"]),
                "cons": m["cons"],
                "weapon": w,
                "refine": m["refine"],
                "sets": sorted(m["sets"].items()),
                "main": list(m.get("main") or []),
                "subs": dict(m.get("subs") or {}),
                "total": dict(m.get("total") or {}),
                "kqmArt": bool(m.get("kqmArt")),
            })
        order = [ckey(n) for n in s["chars"]]
        comp = tuple(sorted(order))
        slot = comps.setdefault(comp, {"order": order, "builds": {}})
        # Порядок персонажей внутри сборки выравниваем по порядку состава, а не по
        # порядку в этом симе: иначе members разъедутся с chars у тех сборок, чьи
        # симы перечисляли персонажей иначе, и сборка склеится не с тем персонажем.
        ref_order = slot["order"]
        members.sort(key=lambda m: ref_order.index(m["char"]) if m["char"] in ref_order else 99)

        sig = tuple((m["char"], m["cons"], m["weapon"], m["refine"], tuple(m["sets"]),
                     tuple(m["main"]), tuple(sorted(m["subs"].items())),
                     tuple(sorted(m["total"].items()))) for m in members)
        agg = slot["builds"].setdefault(sig, {"members": members, "dps": [], "ids": []})
        agg["dps"].append(s["dps"])
        agg["ids"].append(s["id"])

    ch_i, w_i, s_i, st_i = Interner(), Interner(), Interner(), Interner()

    def kqm_cons_ok(char_key: str, cons: int) -> bool:
        """Созвездия по стандарту KQMS: 5* на C0, 4* на C6."""
        entry = (names or {}).get(char_key) or {}
        if (entry.get("stars") or 0) >= 3:
            return cons == 0
        return cons == 6
    teams = []
    stats_by_team = []
    n_builds = 0
    for comp, slot in comps.items():
        order = slot["order"]
        out_builds = []
        out_stats = []
        for agg in slot["builds"].values():
            vals = agg["dps"]
            # члены отряда уже в порядке order
            mem = []
            stats_mem = []
            for m in agg["members"]:
                mem.append({
                    "cons": m["cons"],
                    "weapon": w_i(m["weapon"]) if m["weapon"] else None,
                    "refine": m["refine"],
                    "sets": [[s_i(k), n] for k, n in m["sets"]],
                })
                if m["total"]:
                    # сим дал только сумму статов артефактов — храним её как есть
                    stats_mem.append({"main": [], "subs": [],
                                      "tot": [[st_i(k), v] for k, v in sorted(m["total"].items())]})
                else:
                    stats_mem.append({
                        "main": [st_i(x) for x in m["main"]],
                        # роллы сабстатов в порядке SUB_ORDER; дробные — у живых аккаунтов
                        "subs": [_compact(m["subs"].get(k, 0)) for k in SUB_ORDER],
                    })
            out_builds.append({
                "dps": int(round(sum(vals) / len(vals))),
                "sims": len(vals),
                "src": agg["ids"][0],
                # стандарт KQM: созвездия и артефакты проверяются независимо
                "kqmCons": all(kqm_cons_ok(m["char"], m["cons"]) for m in agg["members"]),
                "kqmArt": all(m["kqmArt"] for m in agg["members"]),
                "members": mem,
            })
            out_stats.append({"members": stats_mem})
            n_builds += 1
        order_idx = sorted(range(len(out_builds)), key=lambda i: -out_builds[i]["dps"])
        out_builds = [out_builds[i] for i in order_idx]
        out_stats = [out_stats[i] for i in order_idx]
        teams.append({"chars": [ch_i(c) for c in order], "builds": out_builds})
        stats_by_team.append(out_stats)

    # отряды сортируем по лучшей сборке; статы переставляем тем же порядком
    team_order = sorted(range(len(teams)), key=lambda i: -teams[i]["builds"][0]["dps"])
    teams = [teams[i] for i in team_order]
    stats_by_team = [stats_by_team[i] for i in team_order]

    wmeta = []
    for wkey in w_i.items:
        info = weapons.get(wkey) or {}
        wmeta.append({"rarity": info.get("rarity"), "type": info.get("type")})

    db = {
        "version": 2,
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {"api": API_URL, "sim": SIM_URL},
        "stats": {"sims": len(full), "teams": len(teams), "builds": n_builds},
        "dict": {"chars": ch_i.items, "weapons": w_i.items, "sets": s_i.items,
                 "stats": st_i.items, "subOrder": SUB_ORDER},
        "weaponMeta": wmeta,
        "teams": teams,
    }
    return db, stats_by_team, full, unknown_chars, unknown_weapons


def legacy_teams(db: dict, cap: Dict[str, int]) -> List[dict]:
    """teams.json в старом формате: базовый вид (потолок созвездий + без 5* оружия),
    один отряд = одна запись, DPS — лучшая подходящая сборка."""
    chars = db["dict"]["chars"]
    wmeta = db["weaponMeta"]
    names = load_names()
    disp = {k: (v.get("name") or k) for k, v in names.items()}

    out = []
    for t in db["teams"]:
        keys = [chars[i] for i in t["chars"]]
        best = None
        for b in t["builds"]:
            ok = True
            for ckey, m in zip(keys, b["members"]):
                if m["cons"] > cap.get(ckey, 6):
                    ok = False
                    break
                w = m["weapon"]
                if w is not None and wmeta[w]["rarity"] == 5:
                    ok = False
                    break
            if ok:
                best = b if best is None or b["dps"] > best["dps"] else best
        if best is None:
            continue
        card = {f"character_{i+1}": disp.get(k, k) for i, k in enumerate(keys)}
        card["DPS"] = best["dps"]
        out.append(card)
    out.sort(key=lambda c: c["DPS"], reverse=True)
    return out


# ------------------------------------------------------------------ иконки

def download_icons(refs: dict, weapons: Dict[str, dict], sets: Dict[str, dict], size: int = 64):
    from PIL import Image
    import io

    # оружие: то, что встретилось в симах, плюс весь каталог 5* для раздела «Аккаунт»
    want_weapons = sorted(set(refs["weapons"]) | set(refs["fiveStars"]))
    # у оружия ассеты лежат в /assets/UI/, у артефактов — в /assets/UI/reliquary/
    jobs = [
        ("weapons", want_weapons, weapons, ""),
        ("sets", list(refs["sets"]), sets, "reliquary/"),
    ]
    for folder, used, ref, prefix in jobs:
        dest = os.path.join(SITE, folder)
        os.makedirs(dest, exist_ok=True)
        done = skipped = failed = 0
        for key in used:
            if not key:
                continue
            path = os.path.join(dest, f"{key}.png")
            if os.path.exists(path):
                skipped += 1
                continue
            icon = (ref.get(key) or {}).get("icon")
            if not icon:
                failed += 1
                continue
            try:
                raw = http(f"https://gi.yatta.moe/assets/UI/{prefix}{icon}.png", tries=3, timeout=40)
                img = Image.open(io.BytesIO(raw)).convert("RGBA")
                img.thumbnail((size, size), Image.LANCZOS)
                img.save(path, "PNG", optimize=True)
                done += 1
            except Exception as e:  # noqa: BLE001
                print(f"    ! {key}: {str(e)[:70]}")
                failed += 1
            time.sleep(0.05)
        print(f"  {folder}: скачано {done}, уже было {skipped}, ошибок {failed}")


# -------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="Сборка базы отрядов gi-rec из db.kqm.gg")
    ap.add_argument("--cache", help="читать симы из локального .jsonl вместо API")
    ap.add_argument("--save-cache", help="сохранить скачанные симы в .jsonl")
    ap.add_argument("--icons", action="store_true", help="скачать иконки оружия и сетов")
    # С 2.0 сайт читает только data/db.json. teams.json остался как совместимость
    # для внешних потребителей и по умолчанию больше не пишется: он на 600 КБ и
    # давал дифф на 30 тысяч строк при каждом обновлении данных.
    ap.add_argument("--legacy", action="store_true", help="дополнительно записать старый teams.json")
    args = ap.parse_args()

    print("Справочники (оружие, сеты, алиасы gcsim)...")
    weapons, sets, alias = load_refs()
    names = load_names()
    char_idx = build_char_index(names, alias)
    cap = cons_cap(names)

    if args.cache:
        print(f"Симы из кэша {args.cache}")
        with open(args.cache, "r", encoding="utf-8") as f:
            sims = [normalize_sim(json.loads(l)) for l in f if l.strip()]
    else:
        print("Загрузка симов с", API_URL)
        sims = fetch_all_sims(alias)
    print(f"Симов получено: {len(sims)}")

    if args.save_cache:
        with open(args.save_cache, "w", encoding="utf-8") as f:
            for s in sims:
                f.write(json.dumps(s, ensure_ascii=False) + "\n")
        print("Кэш сохранён в", args.save_cache)

    db, stats_by_team, full, unknown_chars, unknown_weapons = build(sims, char_idx, weapons, names)
    print(f"Отрядов: {db['stats']['teams']}, сборок: {db['stats']['builds']} (из {len(full)} полных симов)")

    os.makedirs(DATA, exist_ok=True)
    db["shardSize"] = SHARD_SIZE
    # Метка generated — версия базы (по ней фронт версионирует шарды статов).
    # Если отряды не изменились, оставляем старую: файлы остаются байт-в-байт.
    kept = same_except_generated(os.path.join(DATA, "db.json"), db)
    if kept:
        db["generated"] = kept
    changed = write_json(os.path.join(DATA, "db.json"), db, separators=(",", ":"))
    print("db.json: " + ("обновлён" if changed else "без изменений"))

    # Статы артефактов — отдельными файлами по SHARD_SIZE отрядов. Карточку
    # отряда открывают редко, и тащить их в основной загрузке незачем.
    details = os.path.join(DATA, "details")
    os.makedirs(details, exist_ok=True)
    shards = 0
    written = set()
    for start in range(0, len(stats_by_team), SHARD_SIZE):
        chunk = {str(start + i): v for i, v in enumerate(stats_by_team[start:start + SHARD_SIZE])}
        path = os.path.join(details, f"{start // SHARD_SIZE}.json")
        write_json(path, chunk, separators=(",", ":"))
        written.add(os.path.abspath(path))
        shards += 1
    # шардов могло стать меньше — лишние убираем
    for old in glob.glob(os.path.join(details, "*.json")):
        if os.path.abspath(old) not in written:
            os.remove(old)
    total = sum(os.path.getsize(os.path.join(details, f"{i}.json")) for i in range(shards))
    print(f"Статы артефактов: {shards} файлов, всего {total/1024:.0f} KB")

    # В разделе «Аккаунт» игрок отмечает свои легендарки, поэтому каталог 5*
    # берём целиком из игровых данных, а не только то, что встретилось в симах.
    used = {k for k in db["dict"]["weapons"] if k}
    five_stars = {
        k: {**v, "inDb": k in used}
        for k, v in sorted(weapons.items(), key=lambda kv: kv[1]["name"])
        if v.get("rarity") == 5
    }
    refs = {
        "generated": db["generated"],
        # used — множество: без сортировки порядок ключей менялся бы от запуска к запуску
        "weapons": {k: weapons[k] for k in sorted(used) if k in weapons},
        "fiveStars": five_stars,
        "sets": {k: sets[k] for k in db["dict"]["sets"] if k in sets},
        # алиас -> ключ names.json; фронту нужен для импорта GOOD, где персонажи
        # записаны как HuTao / KamisatoAyaka / TravelerAnemo
        "charAliases": {a: k for a, k in sorted(char_idx.items()) if a != k},
    }
    write_json(os.path.join(DATA, "refs.json"), refs, indent=1)

    print("Локализованные названия...")
    localized = load_localized()
    # ГГ у yatta одной записью «Traveler», а у нас по одному ключу на стихию
    ELEM_RU = {"anemo": "Анемо", "cryo": "Крио", "geo": "Гео", "electro": "Электро",
               "dendro": "Дендро", "hydro": "Гидро", "pyro": "Пиро"}
    for lang, bucket in localized.items():
        # ключи яtta — slug английского имени (kamisatoayaka); в names.json ключи
        # короткие (ayaka), поэтому переводим через ту же карту алиасов
        chars = {}
        for slug_key, label in bucket["chars"].items():
            own = char_idx.get(slug_key)
            if own:
                chars[own] = label
        for key, entry in names.items():
            if key in chars:
                continue
            m = re.match(r"^(?:lumine|aether)(\w+)$", key)
            if m:
                elem = m.group(1)
                chars[key] = (f"ГГ ({ELEM_RU.get(elem, elem.title())})" if lang == "ru"
                              else entry.get("name") or key)
        bucket["chars"] = chars
        # оставляем только то, что реально встречается на сайте
        trimmed = {
            "chars": {k: v for k, v in sorted(bucket["chars"].items()) if k in names},
            "weapons": {k: v for k, v in sorted(bucket["weapons"].items())
                        if k in refs["weapons"] or k in refs["fiveStars"]},
            "sets": {k: v for k, v in sorted(bucket["sets"].items()) if k in refs["sets"]},
        }
        path = os.path.join(DATA, f"names.{lang}.json")
        write_json(path, trimmed, indent=1)
        print(f"  names.{lang}.json: персонажей {len(trimmed['chars'])}, "
              f"оружия {len(trimmed['weapons'])}, сетов {len(trimmed['sets'])}")

    if args.legacy:
        legacy = legacy_teams(db, cap)
        with open(os.path.join(SITE, "teams.json"), "w", encoding="utf-8") as f:
            json.dump(legacy, f, ensure_ascii=False, indent=2)
        print(f"teams.json (legacy): {len(legacy)} отрядов")

    if args.icons:
        print("Иконки...")
        download_icons(refs, weapons, sets)

    # Новых персонажей сайт не покажет, пока их нет в names.json и characters/ —
    # это правится руками, поэтому в CI выводим заметное предупреждение.
    for label, items in (("персонажей", unknown_chars), ("оружия", unknown_weapons)):
        if items:
            ci_warning(f"неизвестные ключи {label}: {', '.join(sorted(items))}")

    for name in ("data/db.json", "data/refs.json", "teams.json"):
        p = os.path.join(SITE, name)
        if os.path.exists(p):
            print(f"  {name}: {os.path.getsize(p)/1024:.0f} KB")


if __name__ == "__main__":
    main()
