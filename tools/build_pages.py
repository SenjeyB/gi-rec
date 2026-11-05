#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_pages.py

Статические страницы для поисковиков: сайт — одностраничное приложение, и
Google видит в нём одну страницу почти без текста. Здесь из тех же данных
собираются обычные HTML-страницы на двух языках:

  {lang}/                          — каталог: все персонажи, ссылки на разделы
  {lang}/characters/<key>/         — лучшие отряды персонажа и его частые союзники
  {lang}/best-teams/               — лучшие отряды по DPS
  {lang}/abyss/                    — текущие Витая Бездна (12 этаж) и Мрачный натиск
  sitemap.xml

Отряды выбираются так же, как в приложении по умолчанию: 5★ на C0, 4★ на C6,
без 5★ оружия. Даты на страницах — из самих данных, поэтому повторный запуск
без новых данных даёт те же файлы и не порождает коммитов.

Использование:  python tools/build_pages.py
"""

import os
import json
import html
import re
import shutil
import hashlib
import urllib.parse
from collections import Counter, defaultdict
from typing import Dict, List, Optional

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("GIREC_SITE") or os.path.dirname(ROOT)
BASE_URL = "https://senjeyb.github.io/gi-rec/"
LANGS = ("en", "ru")
KQM_DB = "https://db.kqm.gg/database"
TOP_PER_CHAR = 20
TOP_OVERALL = 100

UI = {
    "en": {
        "site": "GI-Rec",
        "tagline": "Genshin Impact teams for your account",
        "open_app": "Open GI-Rec",
        "open_char": "Open {name} in GI-Rec",
        "catalog": "Characters",
        "best": "Best teams",
        "abyss": "Abyss & Onslaught",
        "char_h1": "Best {name} teams",
        "char_title": "Best {name} teams in Genshin Impact by DPS — GI-Rec",
        "char_desc": "Top {n} {name} teams in Genshin Impact ranked by DPS, with weapons and artifact sets. Best: {top} — {dps} DPS.",
        "char_desc_empty": "{name} in Genshin Impact: teams, weapons and artifact sets. Open GI-Rec to choose constellations and equipment.",
        "char_meta": "{stars}★ · {element} · {weapon} · {n} teams in the database · best DPS {dps}",
        "char_meta_empty": "{stars}★ · {element} · {weapon} · {n} teams",
        "no_teams": "No teams match the default filters.",
        "top_teams": "Top teams",
        "teammates": "Most common teammates",
        "teammates_n": "{n} teams",
        "same_element": "Other {element} characters",
        "note": "Default view: 5★ characters at C0, 4★ at C6, no gacha 5★ weapons. Other constellations and weapons are in the app.",
        "kqms": "KQMS",
        "best_h1": "Best Genshin Impact teams by DPS",
        "best_title": "Best Genshin Impact teams by DPS — GI-Rec",
        "best_desc": "Top {n} Genshin Impact teams ranked by DPS from KQM simulations and real Stygian Onslaught clears, with weapons and artifact sets.",
        "abyss_h1": "Spiral Abyss Floor 12 and Stygian Onslaught",
        "abyss_title": "Spiral Abyss Floor 12 enemies ({dates}) and Stygian Onslaught bosses — GI-Rec",
        "abyss_desc": "Current Spiral Abyss Floor 12 enemies by chamber, Ley Line Disorder and Stygian Onslaught bosses with their advantages. Build teams for them in GI-Rec.",
        "abyss_cycle": "Spiral Abyss, Floor 12 · {dates}",
        "first_half": "First half", "second_half": "Second half",
        "chamber": "Chamber {n}", "level": "Lv. {n}", "then": "then",
        "disorder": "Ley Line Disorder", "res": "RES",
        "onslaught": "Stygian Onslaught · {dates}",
        "battlefield": "Battlefield {n}", "advantage": "Advantage",
        "build_teams": "Build teams for this cycle",
        "hub_title": "GI-Rec — best Genshin Impact teams for every character",
        "hub_desc": "Best teams for every Genshin Impact character ranked by DPS, with weapons and artifact sets. Find teammates and recommendations for your account.",
        "hub_intro": "Teams for every character, ranked by DPS, with weapons and artifact sets. The app also tells you who to pull next based on the characters you own.",
        "made_by": "Made by", "teams_from": "Simulation data from", "community": "and community submissions",
        "data_from": "Data from {date}",
        "home": "Home",
        "other_lang": "Русский",
        "search": "Search by name",
        "nothing": "No characters match the filters.",
        "filters": "Filters",
        "dps": "DPS",
    },
    "ru": {
        "site": "GI-Rec",
        "tagline": "отряды Genshin Impact под ваш аккаунт",
        "open_app": "Открыть GI-Rec",
        "open_char": "Открыть в GI-Rec",
        "catalog": "Персонажи",
        "best": "Лучшие отряды",
        "abyss": "Бездна и Натиск",
        "char_h1": "Лучшие отряды: {name}",
        "char_title": "{name}: лучшие отряды в Genshin Impact по DPS — GI-Rec",
        "char_desc": "Топ-{n} отрядов с персонажем {name} в Genshin Impact по DPS: состав, оружие и сеты артефактов. Лучший: {top} — {dps} DPS.",
        "char_desc_empty": "{name} в Genshin Impact: отряды, оружие и сеты артефактов. Выберите созвездия и снаряжение в приложении GI-Rec.",
        "char_meta": "{stars}★ · {element} · {weapon} · отрядов в базе: {n} · лучший DPS {dps}",
        "char_meta_empty": "{stars}★ · {element} · {weapon} · отрядов: {n}",
        "no_teams": "Нет отрядов для стандартных фильтров.",
        "top_teams": "Лучшие отряды",
        "teammates": "Чаще всего в отряде с",
        "teammates_n": "отрядов: {n}",
        "same_element": "Другие персонажи: {element}",
        "note": "Вид по умолчанию: 5★ персонажи на C0, 4★ на C6, без гача 5★ оружия. Другие созвездия и оружие — в приложении.",
        "kqms": "KQMS",
        "best_h1": "Лучшие отряды Genshin Impact по DPS",
        "best_title": "Лучшие отряды Genshin Impact по DPS — GI-Rec",
        "best_desc": "Топ-{n} отрядов Genshin Impact по DPS из симуляций KQM и реальных прохождений Мрачного натиска, с оружием и сетами артефактов.",
        "abyss_h1": "Витая Бездна, 12 этаж, и Мрачный натиск",
        "abyss_title": "Витая Бездна 12 этаж: враги ({dates}) и боссы Мрачного натиска — GI-Rec",
        "abyss_desc": "Враги текущей Витой Бездны на 12 этаже по залам, аномалии и боссы Мрачного натиска с преимуществами. Соберите под них отряды в GI-Rec.",
        "abyss_cycle": "Витая Бездна, 12 этаж · {dates}",
        "first_half": "Первая половина", "second_half": "Вторая половина",
        "chamber": "Зал {n}", "level": "ур. {n}", "then": "затем",
        "disorder": "Аномалия", "res": "Сопр.",
        "onslaught": "Мрачный натиск · {dates}",
        "battlefield": "Поле боя {n}", "advantage": "Преимущество",
        "build_teams": "Собрать отряды на этот цикл",
        "hub_title": "GI-Rec — лучшие отряды Genshin Impact для каждого персонажа",
        "hub_desc": "Лучшие отряды для каждого персонажа Genshin Impact по DPS: оружие, сеты артефактов, союзники и рекомендации под ваш аккаунт.",
        "hub_intro": "Отряды для каждого персонажа по DPS, с оружием и сетами артефактов. В приложении — ещё и рекомендации, кого крутить, под ваших персонажей.",
        "made_by": "Сделал", "teams_from": "Симуляции из", "community": "и от сообщества",
        "data_from": "Данные от {date}",
        "home": "Главная",
        "other_lang": "English",
        "search": "Поиск по имени",
        "nothing": "Под фильтры никто не подошёл.",
        "filters": "Фильтры",
        "dps": "DPS",
    },
}
ELEMENT_ORDER = ["pyro", "hydro", "anemo", "electro", "dendro", "cryo", "geo"]


def asset_version(name: str) -> str:
    """Версия файла по содержимому: ссылки вида pages.css?v=… не дают браузеру
    взять из кэша старые стили к новой странице."""
    with open(os.path.join(SITE, name), "rb") as f:
        return hashlib.sha1(f.read().replace(b"\r\n", b"\n")).hexdigest()[:10]


def esc(s) -> str:
    return html.escape(str(s), quote=True)


def dps_text(build: dict) -> str:
    """DPS сборки; у реальных прохождений Натиска это оценка (HP босса / время)."""
    return ("~" if build.get("origin") == "clear" else "") + fmt_dps(build["dps"])


def fmt_dps(n: float) -> str:
    return f"{int(round(n)):,}".replace(",", " ")


def load(path: str):
    with open(os.path.join(SITE, path), "r", encoding="utf-8") as f:
        return json.load(f)


def write(path: str, text: str) -> bool:
    """Пишет файл, только если содержимое изменилось."""
    full = os.path.join(SITE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    if os.path.exists(full):
        with open(full, "r", encoding="utf-8") as f:
            if f.read() == text:
                return False
    with open(full, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return True


class Data:
    def __init__(self):
        self.names = load("names.json")
        self.aliases = load("data/character-aliases.json")
        self.db = load("data/db.json")
        self.labels = {lang: load(f"data/names.{lang}.json") for lang in LANGS}
        self.i18n = {lang: load(f"i18n/{lang}.json") for lang in LANGS}
        try:
            self.content = load("data/content.json")
        except Exception:  # noqa: BLE001
            self.content = None
        self.updated = (self.db.get("generated") or "")[:10]
        d = self.db["dict"]
        self.chars, self.weapons, self.sets = d["chars"], d["weapons"], d["sets"]
        self.teams = self.pick_teams()
        self.catalog_chars = sorted({k for team in self.teams for k in team["chars"] if k in self.names})
        self.by_char: Dict[str, List[dict]] = defaultdict(list, {k: [] for k in self.catalog_chars})
        for t in self.pick_teams(exclude_runs=True, exclude_assumed=True):
            for k in t["chars"]:
                self.by_char[k].append(t)

    def five_star(self, key: str) -> bool:
        return (self.names.get(key) or {}).get("stars", 0) >= 3

    def rarity(self, key: str) -> int:
        """Редкость для показа. stars в names.json — категория (1 — бесплатные),
        и Путешественник там среди бесплатных, хотя в игре он 5★."""
        if key.startswith(("lumine", "aether")):
            return 5
        return 5 if self.five_star(key) else 4

    def pick_teams(self, exclude_runs: bool = False, exclude_assumed: bool = False) -> List[dict]:
        """Как в приложении по умолчанию: первая (самая сильная) сборка, где 5★
        на C0, 4★ на C6 (то есть без ограничений) и нет 5★ оружия."""
        meta = self.db.get("weaponMeta") or []
        out = []
        for ti, t in enumerate(self.db["teams"]):
            keys = [self.chars[i] for i in t["chars"]]
            for bi, b in enumerate(t["builds"]):
                if exclude_runs and b.get("origin") == "clear":
                    continue
                if exclude_assumed and b.get("assumed"):
                    continue
                ok = True
                for k, m in zip(keys, b["members"]):
                    if self.five_star(k) and m["cons"] > 0:
                        ok = False
                    w = m.get("weapon")
                    if (w is not None and w < len(meta) and (meta[w] or {}).get("rarity") == 5
                            and not meta[w].get("free")):
                        ok = False
                if ok:
                    out.append({"chars": keys, "build": b, "dps": b["dps"],
                                "teamIndex": ti, "buildIndex": bi})
                    break
        out.sort(key=lambda x: -x["dps"])
        return out

    # подписи
    def char(self, lang: str, key: str) -> str:
        return self.labels[lang]["chars"].get(key) or (self.names.get(key) or {}).get("name") or key

    def search_names(self, lang: str, key: str) -> List[str]:
        return list(dict.fromkeys([self.char(lang, key)] + self.aliases.get(lang, {}).get(key, [])))

    def keywords(self, lang: str, keys) -> List[str]:
        base = (["GI-Rec", "Genshin Impact", "Геншин Импакт", "отряды", "DPS"] if lang == "ru"
                else ["GI-Rec", "Genshin Impact", "best teams", "team compositions", "DPS"])
        return list(dict.fromkeys(base + [s for k in keys for s in self.search_names(lang, k)]))

    def weapon(self, lang: str, key: str) -> str:
        return self.labels[lang]["weapons"].get(key) or key

    def set_name(self, lang: str, key: str) -> str:
        return self.labels[lang]["sets"].get(key) or key

    def element(self, lang: str, el: str) -> str:
        return (self.i18n[lang].get("element") or {}).get(el, el.title())

    def weapon_type(self, lang: str, wt: str) -> str:
        return (self.i18n[lang].get("weaponType") or {}).get(wt, wt.title())


# ------------------------------------------------------------- разметка

def page(data: Data, lang: str, path: str, depth: int, title: str, desc: str, body: str,
         crumbs: Optional[List[tuple]] = None, keywords: Optional[List[str]] = None,
         character: Optional[str] = None) -> str:
    """path — адрес страницы от корня сайта без языка ('' | 'characters/x/' | ...)."""
    up = "../" * depth
    ui = UI[lang]
    url = f"{BASE_URL}{lang}/{path}"
    other = "ru" if lang == "en" else "en"
    alt = "".join(
        f'\n  <link rel="alternate" hreflang="{l}" href="{BASE_URL}{l}/{path}">' for l in LANGS)
    ld = ""
    if crumbs:
        items = [{"@type": "ListItem", "position": i + 1, "name": n, "item": u}
                 for i, (n, u) in enumerate(crumbs)]
        ld = ('\n  <script type="application/ld+json">' +
              json.dumps({"@context": "https://schema.org", "@type": "BreadcrumbList",
                          "itemListElement": items}, ensure_ascii=False) + "</script>")
    if character:
        about = {"@context": "https://schema.org", "@type": "WebPage", "url": url,
                 "name": title, "inLanguage": lang,
                 "about": {"@type": "Thing", "name": data.char(lang, character),
                           "alternateName": data.search_names(lang, character)[1:]}}
        ld += '\n  <script type="application/ld+json">' + json.dumps(about, ensure_ascii=False) + "</script>"
    keyword_meta = (f'\n  <meta name="keywords" content="{esc(", ".join(keywords))}">'
                    if keywords else "")
    team_assets = ""
    if 'class="pg-team-card"' in body:
        team_assets = (f'\n  <link rel="stylesheet" href="{up}teamdetail.css?v={asset_version("teamdetail.css")}">'
                       f'\n  <script type="module" src="{up}js/staticteams.js?v={asset_version("js/staticteams.js")}"></script>')
    nav = (f'<a href="{up}{lang}/characters/">{esc(ui["catalog"])}</a>'
           f'<a href="{up}{lang}/best-teams/">{esc(ui["best"])}</a>'
           f'<a href="{up}{lang}/abyss/">{esc(ui["abyss"])}</a>'
           f'<a class="pg-lang" href="{up}{other}/{path}" hreflang="{other}">{esc(ui["other_lang"])}</a>')
    return f"""<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">{keyword_meta}
  <link rel="canonical" href="{url}">{alt}
  <link rel="alternate" hreflang="x-default" href="{BASE_URL}en/{path}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="{url}">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:image" content="{BASE_URL}preview.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#071129">
  <link rel="icon" href="{BASE_URL}assets/favicon.png" type="image/png" sizes="64x64">
  <link rel="apple-touch-icon" href="{BASE_URL}assets/apple-touch-icon.png">
  <link rel="stylesheet" href="{up}pages.css?v={asset_version("pages.css")}">{team_assets}{ld}
</head>
<body data-team-load-error="{esc(data.i18n[lang]['team']['loadError'])}" data-exclude-boss-runs="{str(path.startswith('characters/')).lower()}" data-exclude-assumed="{str(path.startswith('characters/')).lower()}">
  <header class="pg-header">
    <a class="pg-brand" href="{up}?lang={lang}" aria-label="{esc(ui['open_app'])}"><img src="{up}assets/logo.png" alt="" width="28" height="28"><span>GI-Rec</span></a>
    <nav class="pg-nav">{nav}</nav>
    <a class="pg-cta" href="{up}?lang={lang}">{esc(ui["open_app"])}</a>
  </header>
  <main class="pg-main">
{body}
  </main>
  <footer class="pg-footer">
    <div>{esc(ui["made_by"])} <strong>SenjeyB</strong> · {esc(ui["teams_from"])} <a href="{KQM_DB}" rel="noopener">db.kqm.gg/database</a> {esc(ui["community"])}</div>
    <div>{esc(ui["data_from"].format(date=data.updated))}</div>
  </footer>
</body>
</html>
"""


def member_html(data: Data, lang: str, key: str, m: dict, up: str, link: bool = True) -> str:
    name = esc(data.char(lang, key))
    w = m.get("weapon")
    weapon = ""
    if w is not None:
        wk = data.weapons[w]
        weapon = f'<span class="pg-weapon">{esc(data.weapon(lang, wk))} R{m.get("refine", 1)}</span>'
    sets = " + ".join(
        f'{esc(data.set_name(lang, data.sets[si]))} ×{n}' for si, n in (m.get("sets") or []))
    sets_html = f'<span class="pg-sets">{sets}</span>' if sets else ""
    img = f'<img src="{up}characters/{key}.png" alt="{name}" width="44" height="44" loading="lazy">'
    title = (f'<a href="{up}{lang}/characters/{key}/">{name}</a>' if link else name)
    return (f'<span class="pg-member">{img}<span class="pg-member-text">'
            f'<span class="pg-member-name">{title} <span class="pg-cons">C{m["cons"]}</span></span>'
            f'{weapon}{sets_html}</span></span>')


def team_html(data: Data, lang: str, t: dict, up: str, rank: int) -> str:
    b = t["build"]
    members = "".join(member_html(data, lang, k, m, up) for k, m in zip(t["chars"], b["members"]))
    kqms = f'<span class="pg-badge">{UI[lang]["kqms"]}</span>' if b.get("kqmCons") and b.get("kqmArt") else ""
    if b.get("origin") == "clear":
        kqms += f'<span class="boss-run-badge">{esc(data.i18n[lang]["team"]["bossRun"])}</span>'
    if b.get("assumed"):
        kqms += f'<span class="assumed-badge">⚑ {esc(data.i18n[lang]["team"]["assumed"])}</span>'
    src = b.get("src") or ""
    if b.get("origin"):
        href = ("https://www.youtube.com/watch?v=" + urllib.parse.quote(src[3:], safe="") if src.startswith("yt:")
                else "https://www.bilibili.com/video/" + urllib.parse.quote(src[3:], safe="") if src.startswith("bb:")
                else src if re.match(r"^https?://", src) else "")
    else:
        href = "https://db.kqm.gg/db/" + urllib.parse.quote(src, safe="") if src else ""
    label = data.i18n[lang]["team"]["video" if b.get("origin") else "source"]
    source = (f'<a class="pg-source" href="{esc(href)}" target="_blank" rel="noopener noreferrer">{esc(label)}</a>'
              if href else "")
    return (f'<li><details class="pg-team-card" data-team-index="{t["teamIndex"]}" '
            f'data-build-index="{t["buildIndex"]}" data-db-version="{esc(data.db["generated"])}" '
            f'data-build-key="{esc(b.get("key") or "")}" '
            f'data-chars="{esc(",".join(t["chars"]))}" data-src="{esc(src)}">'
            f'<summary class="pg-team"><span class="pg-rank">{rank}</span>'
            f'<span class="pg-members">{members}</span>'
            f'<span class="pg-dps">{dps_text(b)}<small>{UI[lang]["dps"]}</small>{kqms}{source}</span></summary>'
            f'<div class="pg-team-expanded"><div class="pg-team-fallback">{source}</div></div></details></li>')


def team_names(data: Data, lang: str, t: dict) -> str:
    return ", ".join(data.char(lang, k) for k in t["chars"])


# ------------------------------------------------------------- страницы

def char_page(data: Data, lang: str, key: str) -> str:
    ui, up = UI[lang], "../../../"
    teams = data.by_char[key]
    entry = data.names.get(key) or {}
    name = data.char(lang, key)
    stars = data.rarity(key)
    top = teams[0] if teams else None
    meta = ui["char_meta" if top else "char_meta_empty"].format(stars=stars, element=data.element(lang, entry.get("element", "")),
                                  weapon=data.weapon_type(lang, entry.get("weapon", "")),
                                  n=len(teams), dps=dps_text(top["build"]) if top else "")
    rows = "\n".join(team_html(data, lang, t, up, i + 1) for i, t in enumerate(teams[:TOP_PER_CHAR]))
    if not rows:
        rows = f'<li class="pg-note">{esc(ui["no_teams"])}</li>'

    mates = Counter(k for t in teams for k in t["chars"] if k != key)
    mates_html = "".join(
        f'<li><a href="{up}{lang}/characters/{k}/"><img src="{up}characters/{k}.png" alt="" width="32" height="32" loading="lazy">'
        f'{esc(data.char(lang, k))}</a><span>{esc(ui["teammates_n"].format(n=c))}</span></li>'
        for k, c in mates.most_common(10) if data.by_char.get(k))

    el = entry.get("element", "")
    same = sorted((k for k in data.by_char if k != key and (data.names.get(k) or {}).get("element") == el),
                  key=lambda k: data.char(lang, k))
    same_html = "".join(char_card(data, lang, k, up, small=True) for k in same)

    body = f"""    <nav class="pg-crumbs"><a href="{up}{lang}/characters/">{esc(ui["catalog"])}</a> / <span>{esc(name)}</span></nav>
    <div class="pg-hero">
      <img src="{up}characters/{key}.png" alt="{esc(name)}" width="96" height="96">
      <div>
        <h1>{esc(ui["char_h1"].format(name=name))}</h1>
        <p class="pg-sub">{esc(meta)}</p>
        <a class="pg-btn" href="{up}?lang={lang}&amp;char={key}#tier-list">{esc(ui["open_char"].format(name=name))}</a>
      </div>
    </div>
    <h2>{esc(ui["top_teams"])}</h2>
    <ol class="pg-teams">
{rows}
    </ol>
    <p class="pg-note">{esc(ui["note"])}</p>
    <h2>{esc(ui["teammates"])}</h2>
    <ul class="pg-mates">{mates_html}</ul>
    <h2>{esc(ui["same_element"].format(element=data.element(lang, el)))}</h2>
    <div class="pg-grid pg-grid-small">{same_html}</div>"""
    title = ui["char_title"].format(name=name)
    desc = (ui["char_desc"].format(n=min(TOP_PER_CHAR, len(teams)), name=name,
                                  top=team_names(data, lang, top), dps=dps_text(top["build"]))
            if top else ui["char_desc_empty"].format(name=name))
    crumbs = [(ui["catalog"], f"{BASE_URL}{lang}/characters/"), (name, f"{BASE_URL}{lang}/characters/{key}/")]
    return page(data, lang, f"characters/{key}/", 3, title, desc, body, crumbs,
                keywords=data.keywords(lang, [key]), character=key)


def best_page(data: Data, lang: str) -> str:
    ui, up = UI[lang], "../../"
    rows = "\n".join(team_html(data, lang, t, up, i + 1) for i, t in enumerate(data.teams[:TOP_OVERALL]))
    body = f"""    <h1>{esc(ui["best_h1"])}</h1>
    <p class="pg-sub">{esc(ui["note"])}</p>
    <ol class="pg-teams">
{rows}
    </ol>"""
    return page(data, lang, "best-teams/", 2, ui["best_title"],
                ui["best_desc"].format(n=TOP_OVERALL), body)


def dates(a: Optional[str], b: Optional[str], lang: str) -> str:
    def d(x):
        if not x:
            return "?"
        y, m, day = x.split("-")
        return f"{int(day)}.{m}.{y}" if lang == "ru" else f"{y}-{m}-{day}"
    return f"{d(a)} – {d(b)}"


def enemy_name(data: Data, lang: str, eid: str) -> str:
    e = ((data.content or {}).get("enemies") or {}).get(eid) or {}
    return e.get(lang) or e.get("en") or eid


def res_text(data: Data, lang: str, res: dict) -> str:
    parts = []
    for el, v in (res or {}).items():
        if el == "phys":
            label = "Физ." if lang == "ru" else "Phys."
        else:
            label = data.element(lang, el)
        parts.append(f"{label} {v}%" if v != "immune" else f"{label} ∞")
    return ", ".join(parts)


def abyss_page(data: Data, lang: str) -> Optional[str]:
    c = data.content or {}
    ab, ons = c.get("abyss"), c.get("onslaught")
    if not ab:
        return None
    ui, up = UI[lang], "../../"
    enemies = c.get("enemies") or {}
    out = [f'    <h1>{esc(ui["abyss_h1"])}</h1>',
           f'    <a class="pg-btn" href="{up}?lang={lang}#team-builder">{esc(ui["build_teams"])}</a>',
           f'    <h2>{esc(ui["abyss_cycle"].format(dates=dates(ab.get("start"), ab.get("end"), lang)))}</h2>']
    for half, label in (("first", ui["first_half"]), ("second", ui["second_half"])):
        out.append(f'    <h3>{esc(label)}</h3>\n    <div class="pg-rooms">')
        for ch in ab.get("chambers") or []:
            waves = []
            for wave in ch.get(half) or []:
                items = []
                for ref in wave:
                    e = enemies.get(ref["id"]) or {}
                    img = (f'<img src="{up}{esc(e["icon"])}" alt="" width="40" height="40" loading="lazy">'
                           if e.get("icon") else "")
                    cnt = f' ×{ref["count"]}' if ref.get("count", 1) > 1 else ""
                    res = res_text(data, lang, e.get("res"))
                    res_html = f'<small>{esc(ui["res"])}: {esc(res)}</small>' if res else ""
                    items.append(f'<li>{img}<span>{esc(enemy_name(data, lang, ref["id"]))}{cnt}{res_html}</span></li>')
                waves.append(f'<ul class="pg-enemies">{"".join(items)}</ul>')
            then = f'<div class="pg-then">{esc(ui["then"])}</div>'
            room = ui["chamber"].format(n="12-%s" % ch["n"])
            level = ui["level"].format(n=ch.get("level"))
            out.append(f'      <section class="pg-room"><h4>{esc(room)} · {esc(level)}</h4>'
                       f'{then.join(waves)}</section>')
        out.append("    </div>")
        dis = (ab.get("disorder") or {}).get("all", []) + (ab.get("disorder") or {}).get(half, [])
        if dis:
            out.append(f'    <p class="pg-note"><b>{esc(ui["disorder"])}:</b> '
                       f'{esc("; ".join(d.get(lang) or d.get("en") for d in dis))}</p>')
    if ons and ons.get("bosses"):
        out.append(f'    <h2>{esc(ui["onslaught"].format(dates=dates(ons.get("start"), ons.get("end"), lang)))}</h2>')
        out.append('    <ol class="pg-bosses">')
        for i, b in enumerate(ons["bosses"]):
            e = enemies.get(b["id"]) or {}
            img = (f'<img src="{up}{esc(e["icon"])}" alt="" width="48" height="48" loading="lazy">'
                   if e.get("icon") else "")
            adv = [data.element(lang, el) for el in b.get("elements") or []]
            adv += [t.get(lang) or t.get("en") for t in b.get("tags") or []]
            adv_html = f'<small>{esc(ui["advantage"])}: {esc(", ".join(adv))}</small>' if adv else ""
            out.append(f'      <li>{img}<span><b>{esc(ui["battlefield"].format(n=i + 1))}:</b> '
                       f'{esc(enemy_name(data, lang, b["id"]))}{adv_html}</span></li>')
        out.append("    </ol>")
    title = ui["abyss_title"].format(dates=dates(ab.get("start"), ab.get("end"), lang))
    return page(data, lang, "abyss/", 2, title, ui["abyss_desc"], "\n".join(out))


WEAPON_ORDER = ["sword", "claymore", "polearm", "bow", "catalyst"]


def cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def char_card(data: Data, lang: str, key: str, up: str, small: bool = False) -> str:
    """Карточка: портрет на фоне цвета редкости, в углах — стихия и тип оружия."""
    entry = data.names.get(key) or {}
    el, wt = entry.get("element", ""), entry.get("weapon", "")
    rarity = data.rarity(key)
    name = data.char(lang, key)
    other = data.char("en" if lang == "ru" else "ru", key)
    size = 48 if small else 64
    icons = ""
    if el:
        icons += (f'<img class="pg-char-el" src="{up}filters/Element_{cap(el)}.png" '
                  f'alt="{esc(data.element(lang, el))}" title="{esc(data.element(lang, el))}" width="20" height="20">')
    if wt:
        icons += (f'<img class="pg-char-wt" src="{up}filters/Class-{wt}.png" '
                  f'alt="{esc(data.weapon_type(lang, wt))}" title="{esc(data.weapon_type(lang, wt))}" width="20" height="20">')
    return (f'<a class="pg-char r{rarity}{" is-small" if small else ""}" href="{up}{lang}/characters/{key}/" '
            f'data-el="{esc(el)}" data-wt="{esc(wt)}" data-r="{rarity}" '
            f'data-q="{esc(" ".join(data.search_names(lang, key) + data.search_names("en" if lang == "ru" else "ru", key) + [key]).lower())}">'
            f'<span class="pg-char-pic"><img src="{up}characters/{key}.png" alt="" width="{size}" height="{size}" loading="lazy">{icons}</span>'
            f'<span class="pg-char-name">{esc(name)}</span><span class="pg-stars">{"★" * rarity}</span></a>')


def filter_bar(data: Data, lang: str, up: str) -> str:
    ui = UI[lang]
    els = "".join(
        f'<button type="button" class="pg-chip" data-group="el" data-value="{el}" title="{esc(data.element(lang, el))}">'
        f'<img src="{up}filters/Element_{cap(el)}.png" alt="" width="18" height="18">{esc(data.element(lang, el))}</button>'
        for el in ELEMENT_ORDER)
    wts = "".join(
        f'<button type="button" class="pg-chip" data-group="wt" data-value="{wt}" title="{esc(data.weapon_type(lang, wt))}">'
        f'<img src="{up}filters/Class-{wt}.png" alt="" width="18" height="18">{esc(data.weapon_type(lang, wt))}</button>'
        for wt in WEAPON_ORDER)
    rs = "".join(f'<button type="button" class="pg-chip pg-chip-r{r}" data-group="r" data-value="{r}">{r}★</button>'
                 for r in (5, 4))
    return f"""    <div class="pg-filters" aria-label="{esc(ui["filters"])}">
      <input class="pg-search" type="search" placeholder="{esc(ui["search"])}" aria-label="{esc(ui["search"])}" autocomplete="off">
      <div class="pg-chips">{els}</div>
      <div class="pg-chips">{wts}{rs}</div>
    </div>
    <p class="pg-empty" hidden>{esc(ui["nothing"])}</p>"""


def hub_page(data: Data, lang: str) -> str:
    """Каталог персонажей: {lang}/characters/."""
    ui, up = UI[lang], "../../"
    groups = defaultdict(list)
    for k in data.by_char:
        groups[(data.names.get(k) or {}).get("element", "")].append(k)
    sections = []
    for el in ELEMENT_ORDER + sorted(set(groups) - set(ELEMENT_ORDER)):
        keys = sorted(groups.get(el) or [], key=lambda k: data.char(lang, k))
        if not keys:
            continue
        cards = "".join(char_card(data, lang, k, up) for k in keys)
        sections.append(f'    <section class="pg-section"><h2>{esc(data.element(lang, el))}</h2>\n'
                        f'    <div class="pg-grid">{cards}</div></section>')
    body = f"""    <h1>{esc(ui["site"])} — {esc(ui["tagline"])}</h1>
    <p class="pg-sub">{esc(ui["hub_intro"])}</p>
    <p class="pg-actions"><a class="pg-btn" href="{up}?lang={lang}">{esc(ui["open_app"])}</a>
      <a class="pg-btn pg-btn-ghost" href="{up}{lang}/best-teams/">{esc(ui["best"])}</a>
      <a class="pg-btn pg-btn-ghost" href="{up}{lang}/abyss/">{esc(ui["abyss"])}</a></p>
{filter_bar(data, lang, up)}
{chr(10).join(sections)}
    <script src="{up}pages.js?v={asset_version("pages.js")}" defer></script>"""
    return page(data, lang, "characters/", 2, ui["hub_title"], ui["hub_desc"], body,
                keywords=data.keywords(lang, data.by_char))


def redirect_page(lang: str) -> str:
    """{lang}/ — старый адрес каталога: отправляем на {lang}/characters/."""
    target = f"{BASE_URL}{lang}/characters/"
    return f"""<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8">
  <title>GI-Rec</title>
  <meta name="robots" content="noindex">
  <link rel="canonical" href="{target}">
  <meta http-equiv="refresh" content="0; url=characters/">
</head>
<body><a href="characters/">{target}</a></body>
</html>
"""


# ------------------------------------------------------------- sitemap

def sitemap(data: Data, paths: List[tuple]) -> str:
    rows = []
    for path, lastmod in paths:
        alts = "".join(
            f'\n    <xhtml:link rel="alternate" hreflang="{l}" href="{BASE_URL}{l}/{path}"/>' for l in LANGS)
        for lang in LANGS:
            rows.append(f"  <url>\n    <loc>{BASE_URL}{lang}/{path}</loc>\n    <lastmod>{lastmod}</lastmod>{alts}\n  </url>")
    app_alts = (f'\n    <xhtml:link rel="alternate" hreflang="en" href="{BASE_URL}"/>'
                f'\n    <xhtml:link rel="alternate" hreflang="ru" href="{BASE_URL}?lang=ru"/>')
    rows.insert(0, f"  <url>\n    <loc>{BASE_URL}</loc>\n    <lastmod>{data.updated}</lastmod>{app_alts}\n  </url>")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
            'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + "\n".join(rows) + "\n</urlset>\n")


def stamp_app_styles(data: Data) -> int:
    """Та же версия по содержимому для styles.css основного приложения."""
    path = os.path.join(SITE, "index.html")
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    fresh = text
    for css in ("styles.css", "teamdetail.css"):
        fresh = re.sub(r'href="' + re.escape(css) + r'(\?v=[0-9a-f]+)?"',
                       f'href="{css}?v={asset_version(css)}"', fresh)
    fresh = re.sub(r'<meta name="keywords" content="[^"]*">',
                   f'<meta name="keywords" content="{esc(", ".join(data.keywords("en", data.names)))}">', fresh)
    return int(write("index.html", fresh))


def main() -> int:
    data = Data()
    changed = 0
    written = set()
    abyss_date = max(filter(None, [((data.content or {}).get("abyss") or {}).get("start"),
                                   ((data.content or {}).get("onslaught") or {}).get("start")]),
                     default=data.updated)
    paths = [("characters/", data.updated), ("best-teams/", data.updated)]
    if (data.content or {}).get("abyss"):
        paths.append(("abyss/", abyss_date))
    chars = data.catalog_chars
    paths += [(f"characters/{k}/", data.updated) for k in chars]

    for lang in LANGS:
        pages = {"": redirect_page(lang), "characters/": hub_page(data, lang),
                 "best-teams/": best_page(data, lang)}
        ab = abyss_page(data, lang)
        if ab:
            pages["abyss/"] = ab
        for k in chars:
            pages[f"characters/{k}/"] = char_page(data, lang, k)
        for path, text in pages.items():
            rel = f"{lang}/{path}index.html"
            written.add(os.path.normpath(os.path.join(SITE, rel)))
            changed += write(rel, text)
        # персонаж пропал из выдачи — его страница больше не нужна
        cdir = os.path.join(SITE, lang, "characters")
        if os.path.isdir(cdir):
            for k in os.listdir(cdir):
                if k not in chars and os.path.isdir(os.path.join(cdir, k)):
                    shutil.rmtree(os.path.join(cdir, k))
                    changed += 1
    changed += write("sitemap.xml", sitemap(data, paths))
    # запасной sitemap: простой список адресов, его Google тоже принимает
    urls = [BASE_URL] + [f"{BASE_URL}{lang}/{path}" for path, _ in paths for lang in LANGS]
    changed += write("sitemap.txt", "\n".join(urls) + "\n")
    changed += stamp_app_styles(data)
    print(f"Страниц: {len(written)} (+ sitemap.xml), изменено файлов: {changed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
