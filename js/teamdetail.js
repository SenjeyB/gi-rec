// Подробная карточка отряда: крупные портреты, оружие, сеты, статы артефактов
// и соответствие стандарту KQM. Раскрывается под строкой отряда по клику.

import { t } from "./i18n.js";
import { charLabel, weaponLabel, setLabel, statLabel } from "./labels.js";
import { loadDetails } from "./db.js";

// Цена одного ролла сабстата по стандарту KQM (5★ артефакт). В базе хранится
// число роллов, реальное значение — роллы × цена ролла.
const ROLL_VALUE = {
  "hp": 253.94, "hp%": 0.0496, "atk": 16.54, "atk%": 0.0496, "def": 19.68,
  "def%": 0.062, "er": 0.0551, "em": 19.82, "cr": 0.0331, "cd": 0.0662,
};
const PERCENT = new Set(["hp%", "atk%", "def%", "er", "cr", "cd"]);

function subValue(stat, rolls) {
  const v = (ROLL_VALUE[stat] || 0) * rolls;
  return PERCENT.has(stat) ? `${(v * 100).toFixed(1)}%` : String(Math.round(v));
}

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

// Две метки KQMS. «Полное соответствие» требует и созвездий, и артефактов по
// стандарту, поэтому зелёной бывает только вместе с «артефактами».
function kqmBadge(okCons, okArt) {
  const okFull = !!(okCons && okArt);
  const wrap = el("div", "td-kqm");
  for (const [ok, labelKey, hintKey] of [
    [okFull, "team.kqmFull", "team.kqmFullHint"],
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

function memberBlock(slot, stats) {
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
  if (stats && stats.main && stats.main.length) {
    const box = el("div", "td-stats");
    box.appendChild(el("div", "td-stats-title", t("team.mainStats")));
    const line = el("div", "td-mains");
    for (const st of stats.main) line.appendChild(el("span", "td-main", statLabel(st)));
    box.appendChild(line);
    card.appendChild(box);
  }

  // сабстаты — показываем только то, что реально прокачано сверх базовых двух роллов
  const subs = ((stats && stats.subs) || []).filter((s) => s.rolls > 0);
  if (subs.length) {
    const box = el("div", "td-stats");
    box.appendChild(el("div", "td-stats-title", t("team.substats")));
    const grid = el("div", "td-subs");
    for (const s of subs.slice().sort((a, b) => b.rolls - a.rolls)) {
      const row = el("div", "td-sub" + (s.rolls > 2 ? " is-rolled" : ""));
      row.appendChild(el("span", "td-sub-name", statLabel(s.stat)));
      // значение стата, а число роллов — в скобках рядом
      const val = el("span", "td-sub-rolls", subValue(s.stat, s.rolls));
      val.appendChild(el("span", "td-sub-count", ` (${s.rolls})`));
      row.appendChild(val);
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
export async function buildPanel(team) {
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
  panel.appendChild(grid);

  // статы артефактов лежат отдельными файлами и качаются только сейчас
  const stats = await loadDetails(team.teamIndex, team.buildIndex);
  (team.build || []).forEach((slot, i) => {
    grid.appendChild(memberBlock(slot, stats && stats[i]));
  });

  return panel;
}

/** Переключает панель под строкой отряда. */
export async function toggleDetail(row, team) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList.contains("team-detail")) {
    existing.remove();
    row.classList.remove("is-open");
    return false;
  }
  // одновременно открыта только одна панель — так список не разъезжается
  for (const open of document.querySelectorAll(".team-detail")) open.remove();
  for (const r of document.querySelectorAll(".team-row.is-open")) r.classList.remove("is-open");

  row.classList.add("is-open");
  const panel = await buildPanel(team);
  // пока качались статы, строку могли закрыть или перерисовать
  if (!row.isConnected || !row.classList.contains("is-open")) return false;
  row.after(panel);
  return true;
}
