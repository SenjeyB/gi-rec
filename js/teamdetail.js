// Подробная карточка отряда: крупные портреты, оружие, сеты, статы артефактов
// и соответствие стандарту KQM. Раскрывается под строкой отряда по клику.

import { t } from "./i18n.js";
import { charLabel, weaponLabel, setLabel, statLabel } from "./labels.js";

const SIM_URL = "https://db.kqm.gg/db/";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function icon(src, alt, cls) {
  const img = new Image();
  img.loading = "lazy";
  img.decoding = "async";
  img.src = src;
  img.alt = alt || "";
  if (cls) img.className = cls;
  img.onerror = () => { img.style.visibility = "hidden"; };
  return img;
}

function kqmBadge(okCons, okArt) {
  const wrap = el("div", "td-kqm");
  for (const [ok, labelKey, hintKey] of [
    [okCons, "team.kqmCons", "team.kqmConsHint"],
    [okArt, "team.kqmArt", "team.kqmArtHint"],
  ]) {
    const b = el("span", `td-flag${ok ? " is-ok" : ""}`);
    b.appendChild(el("span", "td-flag-mark", ok ? "✓" : "✕"));
    b.appendChild(el("span", null, t(labelKey)));
    b.title = `${t(hintKey)}${ok ? "" : " — " + t("team.notKqm")}`;
    wrap.appendChild(b);
  }
  return wrap;
}

function memberBlock(slot, keyByDisplay) {
  const card = el("div", "td-member");

  const head = el("div", "td-member-head");
  const portrait = el("div", "td-portrait");
  portrait.appendChild(icon(`characters/${slot.char}.png`, charLabel(slot.char), "td-avatar"));
  portrait.appendChild(el("span", "cons-badge", `C${slot.cons}`));
  head.appendChild(portrait);
  head.appendChild(el("div", "td-member-name", charLabel(slot.char)));
  card.appendChild(head);

  // оружие
  if (slot.weapon) {
    const row = el("div", "td-row");
    const w = el("div", `td-icon${slot.fiveStar ? " is-five" : ""}`);
    w.appendChild(icon(`weapons/${slot.weapon}.png`, "", ""));
    row.appendChild(w);
    const txt = el("div", "td-row-text");
    txt.appendChild(el("div", "td-row-title", weaponLabel(slot.weapon)));
    txt.appendChild(el("div", "td-row-sub", `R${slot.refine}`));
    row.appendChild(txt);
    card.appendChild(row);
  }

  // сеты
  if (slot.sets && slot.sets.length) {
    for (const s of slot.sets) {
      const row = el("div", "td-row");
      const i = el("div", "td-icon");
      i.appendChild(icon(`sets/${s.key}.png`, "", ""));
      row.appendChild(i);
      const txt = el("div", "td-row-text");
      txt.appendChild(el("div", "td-row-title", setLabel(s.key)));
      txt.appendChild(el("div", "td-row-sub", `×${s.pieces}`));
      row.appendChild(txt);
      card.appendChild(row);
    }
  } else {
    card.appendChild(el("div", "td-row td-muted", t("team.noSet")));
  }

  // мейн-статы: песок, кубок, корона
  if (slot.main && slot.main.length) {
    const box = el("div", "td-stats");
    box.appendChild(el("div", "td-stats-title", t("team.mainStats")));
    const line = el("div", "td-mains");
    for (const st of slot.main) line.appendChild(el("span", "td-main", statLabel(st)));
    box.appendChild(line);
    card.appendChild(box);
  }

  // сабстаты — показываем только то, что реально прокачано сверх базовых двух роллов
  const subs = (slot.subs || []).filter((s) => s.rolls > 0);
  if (subs.length) {
    const box = el("div", "td-stats");
    box.appendChild(el("div", "td-stats-title", t("team.substats")));
    const grid = el("div", "td-subs");
    for (const s of subs.slice().sort((a, b) => b.rolls - a.rolls)) {
      const row = el("div", "td-sub" + (s.rolls > 2 ? " is-rolled" : ""));
      row.appendChild(el("span", "td-sub-name", statLabel(s.stat)));
      row.appendChild(el("span", "td-sub-rolls", String(s.rolls)));
      grid.appendChild(row);
    }
    box.appendChild(grid);
    card.appendChild(box);
  }

  return card;
}

/**
 * Собирает панель подробностей.
 * @param {object} team запись из js/db.js (нужны build, dps, sims, src, kqm*)
 */
export function buildPanel(team) {
  const panel = el("div", "team-detail");

  const head = el("div", "td-head");
  head.appendChild(el("div", "td-title", t("team.details")));
  head.appendChild(kqmBadge(team.kqmCons, team.kqmArt));

  const meta = el("div", "td-meta");
  if (team.sims) meta.appendChild(el("span", "td-meta-item", t("team.sims", { n: team.sims })));
  if (team.src) {
    const a = el("a", "td-src", t("team.source"));
    a.href = SIM_URL + team.src;
    a.target = "_blank";
    a.rel = "noopener";
    meta.appendChild(a);
  }
  head.appendChild(meta);
  panel.appendChild(head);

  const grid = el("div", "td-members");
  for (const slot of team.build || []) grid.appendChild(memberBlock(slot));
  panel.appendChild(grid);

  return panel;
}

/** Переключает панель под строкой отряда. */
export function toggleDetail(row, team) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList.contains("team-detail")) {
    existing.remove();
    row.classList.remove("is-open");
    return false;
  }
  // одновременно открыта только одна панель — так список не разъезжается
  for (const open of document.querySelectorAll(".team-detail")) open.remove();
  for (const r of document.querySelectorAll(".team-row.is-open")) r.classList.remove("is-open");

  const panel = buildPanel(team);
  row.after(panel);
  row.classList.add("is-open");
  return true;
}
