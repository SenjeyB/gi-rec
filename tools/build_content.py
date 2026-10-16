#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_content.py

Текущий цикл Витой Бездны (12 этаж) и Мрачного натиска для вкладки «Сборка
отряда» в gi-rec. Источник — вики Genshin Impact на Fandom (MediaWiki API):
  Spiral Abyss/Floors/<дата>      — враги по залам и половинам, аномалии
  Stygian Onslaught/<дата>        — три босса и их преимущества
Иконки врагов берутся из отрендеренной страницы вики (те же, что видит
читатель) и кладутся в gi-rec/enemies/. Русские названия врагов — из игровых
данных yatta.moe, а если там нет — из таблицы Other Languages на вики.

Выход:
  gi-rec/data/content.json
  gi-rec/enemies/<id>.png

Использование:
  python tools/build_content.py            # текущий цикл (по сегодняшней дате)
  python tools/build_content.py --date 2026-10-20
  python tools/build_content.py --force-icons
"""

import os
import html
import re
import sys
import json
import time
import argparse
import datetime
import urllib.parse
import urllib.request
from typing import Dict, List, Optional, Tuple

WIKI = "https://genshin-impact.fandom.com"
API = WIKI + "/api.php"
YATTA = "https://gi.yatta.moe/api/v2"
UA = "gi-rec-content/1.0 (fan site https://senjeyb.github.io/gi-rec)"

ROOT = os.path.dirname(os.path.abspath(__file__))
# скрипт лежит в gi-rec/tools/ — сайт уровнем выше
SITE = os.environ.get("GIREC_SITE") or os.path.dirname(ROOT)
IN_CI = os.environ.get("GITHUB_ACTIONS") == "true"
OUT = os.path.join(SITE, "data", "content.json")
ICONS = os.path.join(SITE, "enemies")

# Префиксы усиленных версий «местных легенд» в Бездне и Натиске
LEGEND_PREFIXES = ("Battle-Hardened ", "Veteran ")

# Игровые названия реакций на русском. Проверены по русским текстам талантов
# (yatta.moe); чего здесь нет — остаётся по-английски, а скрипт предупредит.
REACTION_RU = {
    "Swirl": "Рассеивание",
    "Stellar-Swirl": "Звёздное рассеивание",
    "Stellar Swirl": "Звёздное рассеивание",
    "Electro-Charged": "Заряжен",
    "Lunar-Charged": "Лунный заряд",
    "Lunar-Bloom": "Лунная бутонизация",
    "Lunar-Crystallize": "Лунный кристалл",
    "Overloaded": "Перегрузка",
    "Burning": "Горение",
    "Bloom": "Бутонизация",
    "Burgeon": "Вегетация",
    "Hyperbloom": "Цветение",
    "Quicken": "Стимуляция",
    "Aggravate": "Обострение",
    "Spread": "Разрастание",
}
ELEMENT_RU = {
    "Anemo": "Анемо", "Cryo": "Крио", "Dendro": "Дендро", "Electro": "Электро",
    "Geo": "Гео", "Hydro": "Гидро", "Pyro": "Пиро", "Physical": "Физический",
}
# Метки преимуществ в Натиске (перевод — из Other Languages на вики)
TAG_RU = {
    "Stellar Glimmer": "Звёздный блеск",
}

# Игровые данные (выгрузка AnimeGameData): описания уровней сложности Натиска
# на английском и русском — ровно те тексты, что показывает игра.
AGD = "https://raw.githubusercontent.com/DimbreathBot/AnimeGameData/main"
TEXTMAPS = {
    "en": ["TextMapEN", "TextMap_MediumEN"],
    "ru": ["TextMapRU_0", "TextMapRU_1", "TextMap_MediumRU_0", "TextMap_MediumRU_1"],
}
# {SPRITE_PRESET#N} в текстах — иконки стихий; сверено с вики по прошлым циклам
SPRITE_ELEMENT = {
    "11001": "cryo", "11002": "hydro", "11003": "pyro", "11004": "electro",
    "11005": "anemo", "11006": "geo", "11007": "dendro",
}
# строка про награды за Всплеск флуктуаций — не усложнение, её не показываем
SKIP_RULES = {"UI_ACTIVITY_LEYLINEC_CHALLENGE_LIMIT_FLOWER"}

warnings: List[str] = []


def warn(msg: str) -> None:
    warnings.append(msg)
    # в GitHub Actions предупреждение видно на странице запуска
    print(("::warning::" if IN_CI else "  ! ") + msg)


# ------------------------------------------------------------------ сеть

def http(url: str, tries: int = 4) -> bytes:
    last = None
    for attempt in range(tries):
        try:
            # CDN картинок вики отвечает 403 без Referer с самой вики
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": WIKI + "/"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read()
        except Exception as e:      # сеть бывает капризной — пробуем ещё раз
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"не удалось скачать {url[:140]}: {last}")


def api(**params) -> dict:
    params.setdefault("format", "json")
    params.setdefault("formatversion", "2")
    return json.loads(http(API + "?" + urllib.parse.urlencode(params)).decode("utf-8"))


def wikitext(page: str) -> Tuple[str, str]:
    """(текст страницы, итоговый заголовок после редиректов)."""
    p = api(action="parse", page=page, prop="wikitext", redirects=1).get("parse") or {}
    return p.get("wikitext") or "", p.get("title") or page


def rendered(page: str) -> str:
    p = api(action="parse", page=page, prop="text").get("parse") or {}
    return p.get("text") or ""


def subpages(prefix: str) -> List[str]:
    res = api(action="query", list="allpages", apprefix=prefix, aplimit="500")
    return [p["title"] for p in res["query"]["allpages"]]


# ------------------------------------------------------------- разбор вики

def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def clean(s: str) -> str:
    """Снимает вики-разметку со строки."""
    s = re.sub(r"\{\{Color\|[^|}]*\|([^}]*)\}\}", r"\1", s)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\{\{[^}]*\}\}", "", s)
    s = s.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", s).strip()


def template_params(text: str, name: str) -> Dict[str, str]:
    """Параметры первого вхождения шаблона {{name ...}} (без вложенных)."""
    i = text.find("{{" + name)
    if i < 0:
        return {}
    depth, j = 0, i
    while j < len(text):
        if text.startswith("{{", j):
            depth += 1
            j += 2
            continue
        if text.startswith("}}", j):
            depth -= 1
            j += 2
            if depth == 0:
                break
            continue
        j += 1
    body = text[i + 2 + len(name):j - 2]
    out: Dict[str, str] = {}
    for part in re.split(r"\n\s*\|", "\n" + body):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip().lstrip("|").strip()] = v.strip()
    return out


def icon_map(html: str) -> Dict[str, str]:
    """alt картинки -> URL иконки (вики грузит лениво, адрес лежит в data-src)."""
    out: Dict[str, str] = {}
    for tag in re.findall(r"<img [^>]*>", html):
        alt = re.search(r'alt="([^"]*)"', tag)
        src = re.search(r'data-src="([^"]+)"', tag) or re.search(r'src="(https?://[^"]+)"', tag)
        if alt and src and alt.group(1) and alt.group(1) not in out:
            out[alt.group(1).replace("&#039;", "'").replace("&amp;", "&")] = src.group(1).replace("&amp;", "&")
    return out


def parse_enemy_list(s: str) -> List[List[dict]]:
    """«A*9// B; C*2» -> волны -> [{name, count}]."""
    waves = []
    for wave in s.split("//"):
        items = []
        for part in wave.split(";"):
            part = clean(part)
            if not part:
                continue
            m = re.match(r"(.+?)\s*\*\s*(\d+)$", part)
            name, count = (m.group(1).strip(), int(m.group(2))) if m else (part, 1)
            items.append({"name": name, "count": count})
        if items:
            waves.append(items)
    return waves


def disorder_ru(text: str) -> Optional[str]:
    """Переводит типовые формулировки аномалий; None — если формулировка новая."""
    t = text.strip().rstrip(".")
    m = re.match(r"All party members gain an? (\d+)% (\w+) DMG Bonus$", t)
    if m and m.group(2) in ELEMENT_RU:
        return f"Бонус {ELEMENT_RU[m.group(2)]} урона +{m.group(1)}% всему отряду"
    m = re.match(r"Characters' (.+)$", t)
    if m:
        parts = []
        for clause in re.split(r",? and |, ", m.group(1)):
            c = re.match(r"(.+?) DMG (?:is )?increased by (\d+)%$", clause.strip())
            if not c or c.group(1) not in REACTION_RU:
                return None
            parts.append(f"{REACTION_RU[c.group(1)]}: урон +{c.group(2)}%")
        return "; ".join(parts)
    return None


# ------------------------------------------------------------- враги

RES_KEYS = {"pyro": "pyro", "hydro": "hydro", "dendro": "dendro", "electro": "electro",
            "anemo": "anemo", "cryo": "cryo", "geo": "geo", "phys": "phys", "physical": "phys"}


RES_TYPES = ("pyro", "hydro", "dendro", "electro", "anemo", "cryo", "geo", "phys")

# Подписи состояний на вики. Игровые термины — официальный перевод из игры
# (режимы автоматона, куувяки, импульс потока, элементальные кольца); названия
# вроде «Stunned» придумала вики — их переводим описательно.
STATE_RU = {
    "Stunned": "Оглушён",
    "Paralyzed": "Парализован",
    "Beginning of Fight": "В начале боя",
    "Sweeper Mode": "Режим зачистки",
    "Counterstrike Mode": "Режим контрудара",
    "During Entrance Animation or Elemental Rings": "Во время появления и элементальных колец",
    "During kuuvahki connection": "Во время связи с куувяки",
}


def state_ru(label: str) -> Optional[str]:
    if label in STATE_RU:
        return STATE_RU[label]
    m = re.fullmatch(r"<\s*(\d+) Flow Momentum", label)
    if m:
        return f"Импульс потока < {m.group(1)}"
    return None


def _num(v: str):
    v = clean(html.unescape(v)).replace("\u2212", "-").lower()
    if v.startswith("immune") or v in ("∞", "inf"):
        return "immune"
    m = re.match(r"^(-?\d+(?:\.\d+)?)\s*%?$", v)
    if not m:
        return None
    f = float(m.group(1))
    return int(f) if f == int(f) else f


def _compact(values: dict) -> dict:
    """{все: X, кроме: {...}} — так состояние читается одной строкой."""
    counts: Dict[str, int] = {}
    for v in values.values():
        counts[str(v)] = counts.get(str(v), 0) + 1
    common = max(counts, key=counts.get)
    mode = next(v for v in values.values() if str(v) == common)
    return {"all": mode, "diff": {k: v for k, v in values.items() if str(v) != common}}


def parse_res(text: str, legend: bool):
    """Сопротивления из {{Enemy Stats}} на странице врага.
    Возвращает (базовые, состояния): базовые — только отличные от обычных 10%;
    состояния (res2, res3… — «оглушён», «режим зачистки» и т.п.) — как меняются
    сопротивления в них. У «Бывалых» статы лежат в отдельном разделе."""
    if not text:
        return {}, []
    block = text
    if legend:
        m = re.search(r"==+\s*Battle-Hardened\s*==+([\s\S]*?)(?=\n==[^=]|\Z)", text)
        if m and "{{Enemy Stats" in m.group(1):
            block = m.group(1)
    params = template_params(block, "Enemy Stats")
    if not params:
        return {}, []

    def values(suffix: str, fallback: dict) -> dict:
        g = _num(params.get("resglobal" + suffix, "")) if params.get("resglobal" + suffix) else None
        out = {el: (g if g is not None else fallback[el]) for el in RES_TYPES}
        for k, v in params.items():
            m = re.fullmatch(r"([a-z]+)_res" + suffix, k)
            if m and m.group(1) in RES_KEYS:
                val = _num(v)
                if val is not None:
                    out[RES_KEYS[m.group(1)]] = val
        return out

    base = values("", {el: 10 for el in RES_TYPES})
    states = []
    for n in range(2, 7):
        label = params.get(f"res{n}")
        if not label:
            continue
        en = re.sub(r"\s+", " ", clean(html.unescape(label.replace("<br>", " ").replace("<br/>", " ")))).strip()
        en = en.replace("<nowiki><</nowiki>", "<")
        ru = state_ru(en)
        if ru is None:
            warn(f"подпись состояния без перевода: {en}")
        states.append({"label": {"en": en, "ru": ru or en}, "res": _compact(values(str(n), base))})
    return {k: v for k, v in base.items() if v != 10}, states


class Enemies:
    """Реестр врагов: id -> названия и иконка. Русские названия — из yatta
    (игровые данные), иначе из Other Languages на вики."""

    def __init__(self, cache: Optional[Dict[str, dict]] = None):
        self.items: Dict[str, dict] = {}
        self._yatta_ru: Optional[Dict[str, str]] = None
        # враги из прошлого запуска: сопротивления и подсказки не пересчитываем
        self.cache = cache or {}
        self._pages: Dict[str, Tuple[str, str]] = {}

    def page(self, name: str) -> Tuple[str, str]:
        """Страница вики (с редиректами), по одной загрузке на запуск."""
        if name not in self._pages:
            try:
                self._pages[name] = wikitext(name)
            except Exception:  # noqa: BLE001
                self._pages[name] = ("", name)
        return self._pages[name]

    def yatta_ru(self) -> Dict[str, str]:
        if self._yatta_ru is None:
            en = json.loads(http(f"{YATTA}/en/monster"))["data"]["items"]
            ru = json.loads(http(f"{YATTA}/ru/monster"))["data"]["items"]
            self._yatta_ru = {}
            for k, v in en.items():
                r = ru.get(k)
                if v.get("name") and r and r.get("name"):
                    self._yatta_ru.setdefault(v["name"], r["name"])
        return self._yatta_ru

    def resolve_ru(self, full: str, base: str) -> Optional[str]:
        """Игровое русское название. Усиленные версии на вики — редиректы на
        страницу самой местной легенды (Battle-Hardened Lightkeeper -> Sigurd),
        поэтому идём по редиректу полного имени."""
        y = self.yatta_ru()
        if full in y:
            return y[full]
        if base in y:
            return y[base]
        text, title = self.page(full)
        if not text:
            return None
        plain = re.sub(r"\s*\(Local Legend\)$", "", title)
        if title in y or plain in y:
            return y.get(title) or y.get(plain)
        return self.other_languages_ru(text, title)

    def wiki_ru(self, name: str) -> Optional[str]:
        try:
            text, title = wikitext(name)
        except Exception:
            return None
        return self.other_languages_ru(text, title)

    def other_languages_ru(self, text: str, name: str) -> Optional[str]:
        m = re.search(r"\{\{Other Languages([\s\S]*?)\n\}\}", text) or \
            re.search(r"\{\{Other Languages([^}]*)\}\}", text)
        if not m:
            return None
        body = m.group(1)
        ru = re.search(r"\|\s*ru\s*=\s*(.+)", body)
        if ru:
            return clean(ru.group(1)) or None
        # {{Other Languages|Churin}} или {{Other Languages|Transclude = Sigurd}}
        ref = re.search(r"\|\s*(?:Transclude\s*=\s*)?([^|=}\n]+)", body)
        if ref and ref.group(1).strip() != name:
            return self.wiki_ru(ref.group(1).strip())
        return None

    def add(self, full_name: str, icon_url: Optional[str]) -> dict:
        legend = full_name.startswith(LEGEND_PREFIXES)
        base = full_name
        for p in LEGEND_PREFIXES:
            if base.startswith(p):
                base = base[len(p):]
        eid = slug(full_name)
        if eid in self.items:
            return {"id": eid}
        # В начале цикла у нового врага на вики бывает заглушка вместо иконки.
        # Её не сохраняем: без файла следующий ежедневный запуск попробует снова.
        if icon_url and re.search(r"unknown|placeholder|no[_ ]?image", icon_url, re.I):
            warn(f"у «{full_name}» на вики пока заглушка вместо иконки")
            icon_url = None
        ru = self.resolve_ru(full_name, base)
        if not ru:
            warn(f"нет русского названия для «{full_name}» — останется английское")
        # en — точное игровое название (с Battle-Hardened); в русском префикса
        # нет, вместо него сайт ставит метку «Местная легенда»
        item = {"en": full_name, "ru": ru or base, "legend": legend, "src": icon_url}
        cached = self.cache.get(eid) or {}
        if "res" in cached and "resStates" in cached:
            item["res"], item["resStates"] = cached["res"], cached["resStates"]
        else:
            item["res"], item["resStates"] = parse_res(self.page(full_name)[0], legend)
        if "tip" in cached:
            item["tip"] = cached["tip"]
        # варианты имени для поиска подсказки в игровых данных (служебное поле)
        title = self.page(full_name)[1] if "tip" not in cached else full_name
        item["_names"] = list(dict.fromkeys([
            full_name, base, title, re.sub(r"\s*\(Local Legend\)$", "", title)]))
        self.items[eid] = item
        if not icon_url:
            warn(f"нет иконки для «{full_name}»")
        return {"id": eid}

    def download_icons(self, force: bool) -> None:
        os.makedirs(ICONS, exist_ok=True)
        for eid, e in self.items.items():
            e.pop("_names", None)
            src = e.pop("src", None)
            path = os.path.join(ICONS, eid + ".png")
            e["icon"] = f"enemies/{eid}.png" if (src or os.path.exists(path)) else None
            if not src or (os.path.exists(path) and not force):
                continue
            # вики отдаёт превью нужной ширины; 128px хватает и на ретину
            url = re.sub(r"/scale-to-width-down/\d+", "/scale-to-width-down/128", src)
            if "/scale-to-width-down/" not in url:
                url = url.replace("/revision/latest", "/revision/latest/scale-to-width-down/128")
            # без format=original CDN отдаёт WebP
            url += ("&" if "?" in url else "?") + "format=original"
            data = http(url)
            if not data.startswith(b"\x89PNG"):
                warn(f"иконка «{e['en']}» пришла не PNG — пропускаю")
                e["icon"] = None
                continue
            with open(path, "wb") as f:
                f.write(data)


# ---------------------------------------------------------- Витая Бездна

def pick_cycle(titles: List[str], prefix: str, today: datetime.date) -> Optional[str]:
    """Последняя страница цикла, начавшегося не позже сегодняшнего дня."""
    best = None
    for t in titles:
        m = re.fullmatch(re.escape(prefix) + r"(\d{4}-\d{2}-\d{2})", t)
        if not m:
            continue
        d = datetime.date.fromisoformat(m.group(1))
        if d <= today and (best is None or d > best[0]):
            best = (d, t)
    return best[1] if best else None


def build_abyss(today: datetime.date, enemies: Enemies) -> Optional[dict]:
    title = pick_cycle(subpages("Spiral Abyss/Floors/"), "Spiral Abyss/Floors/", today)
    if not title:
        warn("не нашёл страницу текущего цикла Бездны")
        return None
    print(f"Бездна: {title}")
    text, _ = wikitext(title)
    icons = icon_map(rendered(title))
    head = template_params(text, "Abyssal Moon Spire")
    start, end = head.get("start"), head.get("end")

    sec = re.search(r"===\s*Floor 12\s*===([\s\S]*?)(?:\n==[^=]|\Z)", text)
    if not sec:
        warn("на странице нет 12 этажа")
        return None
    body = sec.group(1)

    disorder = {"all": [], "first": [], "second": []}
    for line in re.findall(r"^\*\*\s*(.+)$", body, re.M):
        half = "all"
        if "First Half" in line:
            half = "first"
        elif "Second Half" in line:
            half = "second"
        en = clean(re.sub(r"^\{\{Color\|[^}]*\}\}\s*:?\s*", "", line))
        en = re.sub(r"^(First|Second) Half\s*:\s*", "", en)
        # русский текст потом берётся из игры (plan_disorder); шаблонный
        # перевод — запасной вариант, если игровой строки не нашлось
        disorder[half].append({"en": en, "ru": disorder_ru(en) or en})

    params = template_params(body, "Domain Enemies")
    chambers = []
    for n in (1, 2, 3):
        halves = []
        for h in (1, 2):
            waves = parse_enemy_list(params.get(f"enemies{n}_{h}", ""))
            halves.append([[dict(enemies.add(e["name"], icons.get(e["name"])), count=e["count"])
                            for e in wave] for wave in waves])
        chambers.append({
            "n": n,
            "level": int(params.get(f"level{n}") or 0) or None,
            "first": halves[0],
            "second": halves[1],
        })
    return {
        "start": start, "end": end,
        "floor": 12,
        "source": WIKI + "/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
        "disorder": disorder,
        "chambers": chambers,
    }


# ------------------------------------------------------- Мрачный натиск

def build_onslaught(today: datetime.date, enemies: Enemies) -> Optional[dict]:
    titles = [t for t in subpages("Stygian Onslaught/") if t.count("/") == 1]
    title = pick_cycle(titles, "Stygian Onslaught/", today)
    if not title:
        warn("не нашёл страницу текущего Натиска")
        return None
    print(f"Натиск: {title}")
    text, _ = wikitext(title)
    icons = icon_map(rendered(title))
    ev = template_params(text, "Event")
    start = (ev.get("time_start") or "")[:10] or None
    end = (ev.get("time_end") or "")[:10] or None

    bosses = []
    for row in re.findall(r"!\s*Battlefield\s*\d+\s*\n\|([\s\S]*?)(?=\n\|-|\n\|\})", text):
        m = re.search(r"\{\{Enemy\|([^}|]+)", row)
        if not m:
            continue
        name = m.group(1).strip()
        elements, tags = [], []
        for adv in re.findall(r"Advantage:\s*(.+)", row):
            els = re.findall(r"\{\{Element\|(\w+)", adv)
            elements += [e.lower() for e in els]
            rest = clean(re.sub(r"\{\{Element\|[^}]*\}\}", "", adv))
            rest = re.sub(r"\s*(Elemental\s+)?Characters?$", "", rest).strip()
            if rest:
                if rest not in TAG_RU:
                    warn(f"метка преимущества без перевода: {rest}")
                tags.append({"en": rest, "ru": TAG_RU.get(rest, rest)})
        bosses.append(dict(enemies.add(name, icons.get(name)), elements=elements, tags=tags))
    if len(bosses) != 3:
        warn(f"в Натиске нашлось боссов: {len(bosses)} (ожидалось 3)")
    return {
        "start": start, "end": end,
        "source": WIKI + "/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
        "bosses": bosses,
    }


# ------------------------------------------- Натиск: уровни сложности из игры

DATE_RE = re.compile(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$")


def agd_json(path: str):
    return json.loads(http(f"{AGD}/{path}").decode("utf-8"))


def game_text(raw: str, sprites_ok: List[bool]) -> str:
    """Игровая разметка -> упрощённая для сайта: {hl}..{/hl} — выделенный
    текст, {el:pyro} — иконка стихии, перенос строки — \\n. Неизвестный
    спрайт (иконка реакции и т.п.) помечает текст как непригодный."""
    def sprite(m):
        el = SPRITE_ELEMENT.get(m.group(1))
        if not el:
            sprites_ok[0] = False
            return ""
        return "{el:" + el + "}"
    t = raw.replace("\\n", "\n")
    t = re.sub(r"\{SPRITE_PRESET#(\d+)\}", sprite, t)
    # золотой, жёлтый (подсказки) и красный — выделение в игре; прочие цвета
    # (серый разделитель) — обычный текст
    t = re.sub(r"<color=#(?:FFD780|FFE14B|FF5E41)\w*>(.*?)</color>", r"{hl}\1{/hl}", t, flags=re.I | re.S)
    t = re.sub(r"</?[a-zA-Z][^>]*>", "", t)
    return re.sub(r"[ \t]+", " ", t).strip()


class TextMaps:
    """Только нужные строки из огромных TextMap: файлы читаются по одному."""

    def __init__(self, hashes):
        self.want = {str(h) for h in hashes if h}
        self.text = {"en": {}, "ru": {}}

    def load(self):
        for lang, files in TEXTMAPS.items():
            for name in files:
                data = agd_json(f"TextMap/{name}.json")
                for h in self.want:
                    if h in data and h not in self.text[lang]:
                        self.text[lang][h] = data[h]
                del data

    def get(self, h) -> Optional[dict]:
        en, ru = self.text["en"].get(str(h)), self.text["ru"].get(str(h))
        if not en:
            return None
        return {"en": en, "ru": ru or en}


class GameText:
    """Общий загрузчик игровых текстов: всё нужное регистрируется заранее,
    а ~190 МБ TextMap качаются один раз — при первом обращении."""

    def __init__(self):
        self.want = set()
        self.tm: Optional[TextMaps] = None

    def need(self, hashes) -> None:
        self.want.update(str(h) for h in hashes if h)

    def get(self, h) -> Optional[dict]:
        if self.tm is None:
            print(f"  Скачиваю тексты игры ({len(self.want)} строк)...")
            self.tm = TextMaps(self.want)
            self.tm.load()
        return self.tm.get(h)


def build_onslaught_details(onslaught: dict, enemies: Enemies, old: Optional[dict],
                            gt: "GameText") -> Optional[dict]:
    """Шесть уровней сложности: правила уровня, уровень врагов, лимит времени
    и для каждого босса — форма, преимущества и механики. Поля в выгрузке
    обфусцированы и переименовываются от версии к версии, поэтому ищем их
    по содержимому, а не по именам."""
    chal = agd_json("ExcelBinOutput/LeyLineChallengeExcelConfigData.json")
    cur = None
    for c in chal:
        dates = sorted(v for v in c.values() if isinstance(v, str) and DATE_RE.match(v))
        if len(dates) >= 2 and dates[0][:10] == onslaught.get("start"):
            cur = (c, dates)
    if not cur:
        warn("в игровых данных нет текущего цикла Натиска (выгрузка ещё не обновилась?)")
        return None
    c, dates = cur
    level_ids = c.get("levelIdList") or next(
        (v for v in c.values() if isinstance(v, list) and len(v) == 6 and all(isinstance(x, int) for x in v)), None)
    key = f"{dates[0]}|{','.join(map(str, level_ids or []))}"
    if old and old.get("key") == key:
        return old                                   # цикл тот же — тяжёлые TextMap не качаем

    levels = {x["id"]: x for x in agd_json("ExcelBinOutput/LeyLineLevelExcelConfigData.json")}
    configs = {x["id"]: x for x in agd_json("ExcelBinOutput/LeyLineLevelConfigExcelConfigData.json")}
    diffs = agd_json("ExcelBinOutput/LeyLineDifficultyExcelConfigData.json")
    manual = {m["textMapId"]: m["textMapContentTextMapHash"]
              for m in agd_json("ExcelBinOutput/ManualTextMapConfigData.json") if "textMapId" in m}

    def int_lists(obj):
        return [v for v in obj.values() if isinstance(v, list) and v and all(isinstance(x, int) for x in v)]

    plan = []
    hashes = set()
    for n, lid in enumerate(level_ids, start=1):
        lv = levels.get(lid) or {}
        cfg_ids = next((v for v in int_lists(lv) if all(x in configs for x in v)), [])
        timers = [v for v in int_lists(lv) if len(v) == 1 and v is not cfg_ids and v[0] <= 1000]
        diff = next((d for d in diffs if d.get("id") == n), {})
        # строковых списков два: id текстов правил и имена иконок медалей —
        # правила те, что находятся в ManualTextMap
        rule_ids = next((v for v in diff.values() if isinstance(v, list)
                         and any(isinstance(x, str) and x in manual for x in v)), [])
        rules = [r for r in rule_ids if r and r in manual and r not in SKIP_RULES]
        plan.append((n, lv, cfg_ids, timers, diff, rules))
        hashes.add(diff.get("nameTextMapHash"))
        hashes.update(manual.get(r) for r in rules)
        for cid in cfg_ids:
            cfg = configs[cid]
            hashes.add(cfg.get("levelNameTextMapHash"))
            for arr in int_lists(cfg):
                hashes.update(arr)
    gt.need(hashes)
    tm = gt

    def classify(cfg):
        """Массивы хэшей в конфиге поля боя: 3 — преимущества, 5 — названия
        механик (короткие), их полные описания (длинные) и краткие пересказы."""
        adv, fives = None, []
        for arr in int_lists(cfg):
            texts = [tm.get(h) for h in arr]
            if not any(texts):
                continue
            if len(arr) == 3:
                adv = texts
            elif len(arr) == 5:
                lens = [len(t["en"]) for t in texts if t]
                fives.append((sum(lens) / len(lens), texts))
        fives.sort(key=lambda x: x[0])
        titles = fives[0][1] if fives else []
        full = fives[-1][1] if len(fives) >= 2 else []
        return adv, titles, full

    def both(t, ok):
        return {"en": game_text(t["en"], ok), "ru": game_text(t["ru"], ok)}

    out = []
    bosses = onslaught.get("bosses") or []
    for n, lv, cfg_ids, timers, diff, rules in plan:
        name = tm.get(diff.get("nameTextMapHash"))
        entry = {
            "id": n,
            "name": name and {"en": name["en"], "ru": name["ru"]},
            # в игре показывается уровень на 1 больше reviseLevel (40/70/.../110)
            "level": (lv.get("reviseLevel") + 1) if isinstance(lv.get("reviseLevel"), int) else None,
            "timeLimit": (timers[0][0] or None) if timers else None,
            "rules": [],
            "bosses": [],
        }
        for r in rules:
            t = tm.get(manual.get(r))
            if t:
                entry["rules"].append(both(t, [True]))
        for i, cid in enumerate(cfg_ids):
            cfg = configs[cid]
            form = tm.get(cfg.get("levelNameTextMapHash"))
            wiki_en = enemies.items.get(bosses[i]["id"], {}).get("en", "") if i < len(bosses) else ""
            if form and wiki_en and slug(wiki_en) not in slug(form["en"]):
                warn(f"Натиск: босс {i + 1} в игре «{form['en']}», на вики «{wiki_en}» — пропускаю детали")
                return None
            adv, titles, full = classify(cfg)
            ok = [True]
            advantage = both(adv[0], ok) if adv and adv[0] else None
            if not ok[0]:
                warn(f"Натиск: в преимуществах «{form and form['en']}» неизвестная иконка — оставляю общие")
                advantage = None
            mech = []
            for k, title in enumerate(titles):
                if not title or k >= len(full) or not full[k]:
                    continue
                mech.append({"title": both(title, [True]), "text": both(full[k], [True])})
            entry["bosses"].append({
                "form": form and {"en": form["en"].strip(), "ru": form["ru"].strip()},
                "advantage": advantage,
                "mechanics": mech,
            })
        out.append(entry)
    return {"key": key, "difficulties": out}


# ------------------------------------- подсказки о врагах и аномалии из игры

def plan_tips(enemies: Enemies, gt: GameText):
    """Официальные подсказки о врагах из игрового архива (CODEX_ENEMY): там
    механики врага и чем их ломать — стихии, барьеры, реакции. Ищем по
    английскому названию; уже найденные (или точно отсутствующие) берутся
    из прошлого запуска."""
    todo = [e for e in enemies.items.values() if "tip" not in e]
    if not todo:
        return None
    tips = [t for t in agd_json("ExcelBinOutput/PushTipsConfigData.json") if t.get("codexType") == "CODEX_ENEMY"]
    tut = {x["id"]: x for x in agd_json("ExcelBinOutput/TutorialExcelConfigData.json")}
    det = {x["id"]: x for x in agd_json("ExcelBinOutput/TutorialDetailExcelConfigData.json")}

    entries = []
    for t in tips:
        tu = tut.get(t.get("tutorialId")) or {}
        ids = tu.get("detailIdList") or next(
            (v for v in tu.values() if isinstance(v, list) and v and all(x in det for x in v)), [])
        descs = []
        for i in ids:
            d = det.get(i) or {}
            h = d.get("descriptTextMapHash") or next(
                (v for k, v in d.items() if k.endswith("TextMapHash") and isinstance(v, int)), None)
            if h:
                descs.append(h)
        entries.append((t.get("titleTextMapHash"), descs))
        gt.need([t.get("titleTextMapHash")] + descs)

    def finish():
        by_title = {}
        for th, descs in entries:
            title = gt.get(th)
            if title and descs:
                by_title.setdefault(title["en"].strip(), descs)
        for e in todo:
            descs = next((by_title[n] for n in e.get("_names", []) if n in by_title), None)
            texts = [x for x in (gt.get(d) for d in descs or []) if x]
            if not texts:
                e["tip"] = None
                continue
            ok = [True]
            e["tip"] = {"en": game_text("\n".join(x["en"] for x in texts), ok),
                        "ru": game_text("\n".join(x["ru"] for x in texts), ok)}
    return finish


def plan_disorder(abyss: Optional[dict], old_abyss: Optional[dict], gt: GameText):
    """Русский текст аномалий — официальный из игры: строку ищем по точному
    английскому тексту с вики. Тот же цикл — переводы прошлого запуска."""
    if not abyss:
        return None
    lines = [d for half in abyss["disorder"].values() for d in half]
    if old_abyss and old_abyss.get("start") == abyss.get("start"):
        prev = {d["en"]: d for half in (old_abyss.get("disorder") or {}).values() for d in half}
        for d in lines:
            o = prev.get(d["en"])
            if o and o.get("src"):
                d["ru"], d["src"] = o["ru"], o["src"]
    todo = [d for d in lines if not d.get("src")]
    if not todo:
        return None
    ents = [e for e in agd_json("ExcelBinOutput/DungeonLevelEntityConfigData.json") if e.get("descTextMapHash")]
    gt.need(e["descTextMapHash"] for e in ents)

    def norm(s: str) -> str:
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip().rstrip(".").lower()

    def finish():
        table = {}
        for e in ents:
            t = gt.get(e["descTextMapHash"])
            if t:
                table.setdefault(norm(t["en"]), t["ru"])
        for d in todo:
            ru = table.get(norm(d["en"]))
            if ru:
                d["ru"] = re.sub(r"\{/?hl\}", "", game_text(ru, [True]))
                d["src"] = "game"
            else:
                d["src"] = "pattern"
                if disorder_ru(d["en"]) is None:
                    warn(f"аномалия без перевода: {d['en']}")
    return finish


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="считать сегодняшней эту дату (YYYY-MM-DD)")
    ap.add_argument("--force-icons", action="store_true", help="перекачать иконки")
    args = ap.parse_args()
    today = (datetime.date.fromisoformat(args.date) if args.date
             else datetime.datetime.now(datetime.timezone.utc).date())

    old = None
    if os.path.exists(OUT):
        try:
            with open(OUT, "r", encoding="utf-8") as f:
                old = json.load(f)
        except Exception:  # noqa: BLE001
            old = None

    enemies = Enemies(cache=(old or {}).get("enemies"))
    abyss = build_abyss(today, enemies)
    onslaught = build_onslaught(today, enemies)

    # Игровые тексты (подсказки о врагах, аномалии, уровни Натиска): каждый
    # этап регистрирует нужные строки, а TextMap качаются один раз и только
    # если хоть что-то новое. Сбой этапа не ломает остальное — он повторится
    # при следующем запуске.
    gt = GameText()
    finishers = []
    for name, plan in (("аномалии", lambda: plan_disorder(abyss, (old or {}).get("abyss"), gt)),
                       ("подсказки", lambda: plan_tips(enemies, gt))):
        try:
            f = plan()
            if f:
                finishers.append((name, f))
        except Exception as e:  # noqa: BLE001
            warn(f"{name}: не удалось подготовить: {e}")

    # Если раздел не разобрался (вики недоступна, страница нового цикла ещё
    # пустая), оставляем прежний — лучше старый цикл, чем пустая вкладка.
    items = dict(enemies.items)
    for key, fresh in (("abyss", abyss), ("onslaught", onslaught)):
        if fresh is None and old and old.get(key):
            warn(f"{key}: оставляю данные прошлого запуска")
            for ref in _refs(old[key]):
                if ref in (old.get("enemies") or {}):
                    items.setdefault(ref, old["enemies"][ref])
    # Уровни сложности Натиска из игровых данных. Сбой здесь не должен ломать
    # остальное: тогда остаются детали прошлого запуска (если цикл тот же).
    old_ons = (old or {}).get("onslaught") or {}
    if onslaught is not None:
        old_details = old_ons.get("details") if old_ons.get("start") == onslaught.get("start") else None
        try:
            details = build_onslaught_details(onslaught, enemies, old_details, gt)
        except Exception as e:  # noqa: BLE001
            warn(f"Натиск: не удалось собрать уровни сложности: {e}")
            details = old_details
        if details:
            onslaught["details"] = details
    for name, f in finishers:
        try:
            f()
        except Exception as e:  # noqa: BLE001
            warn(f"{name}: не удалось получить тексты игры: {e}")
    enemies.download_icons(args.force_icons)
    items.update({k: v for k, v in enemies.items.items()})

    data = {
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "abyss": abyss if abyss is not None else (old or {}).get("abyss"),
        "onslaught": onslaught if onslaught is not None else old_ons or None,
        "enemies": items,
    }
    # Цикл не сменился — файл не трогаем, иначе автообновление коммитило бы
    # каждый день ради одной метки generated
    if old and {k: v for k, v in old.items() if k != "generated"} == \
            {k: v for k, v in data.items() if k != "generated"}:
        print(f"content.json: без изменений (предупреждений: {len(warnings)})")
        return 0
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"Записано: {OUT} (врагов: {len(items)}, предупреждений: {len(warnings)})")
    return 0


def _refs(section: dict) -> List[str]:
    """id всех врагов, на которых ссылается раздел content.json."""
    out = []
    for ch in section.get("chambers") or []:
        for half in ("first", "second"):
            for wave in ch.get(half) or []:
                out += [e["id"] for e in wave]
    out += [b["id"] for b in section.get("bosses") or []]
    return out


if __name__ == "__main__":
    sys.exit(main())
