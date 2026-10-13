// Окно персонажа: кто это, есть ли он у игрока, и все его отряды под текущие
// настройки — страницами. Открывается из тир-листа (один персонаж) и из
// рекомендаций (там персонажей, которых не хватает, может быть несколько).

import { t } from "./i18n.js";
import { charLabel } from "./labels.js";
import * as store from "./store.js";
import { openSheet } from "./sheet.js";

const PAGE = 10;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function img(src, cls) {
  const i = new Image();
  i.loading = "lazy";
  i.decoding = "async";
  i.src = src;
  i.alt = "";
  if (cls) i.className = cls;
  i.onerror = () => { i.style.visibility = "hidden"; };
  return i;
}

const fmt = (n) => Math.round(n || 0).toLocaleString("en-US").replace(/,/g, " ");

function infoCard(key, names, teams) {
  const e = names[key] || {};
  const five = (e.stars || 0) >= 3;
  const card = el("div", "cw-char");

  const portrait = el("div", `cw-portrait${five ? " is-five" : ""}`);
  portrait.appendChild(img(`characters/${key}.png`, "cw-avatar"));
  card.appendChild(portrait);

  const info = el("div", "cw-info");
  info.appendChild(el("div", "cw-name", charLabel(key)));
  info.appendChild(el("div", `cw-stars${five ? " is-five" : ""}`, five ? "★★★★★" : "★★★★"));

  const tags = el("div", "cw-tags");
  if (e.element) {
    const tag = el("span", "cw-tag");
    tag.appendChild(img(`filters/Element_${cap(e.element)}.png`, "cw-tag-icon"));
    tag.appendChild(el("span", null, t(`element.${e.element}`)));
    tags.appendChild(tag);
  }
  if (e.weapon) {
    const tag = el("span", "cw-tag");
    tag.appendChild(img(`filters/Class-${e.weapon}.png`, "cw-tag-icon"));
    tag.appendChild(el("span", null, t(`weaponType.${e.weapon}`)));
    tags.appendChild(tag);
  }
  info.appendChild(tags);

  const owned = store.hasCharacter(key);
  const status = el("div", `cw-status${owned ? " is-owned" : ""}`);
  status.textContent = owned
    ? (five ? t("char.ownedCons", { n: store.consOf(key) }) : t("char.owned"))
    : t("char.notOwned");
  info.appendChild(status);

  const withChar = teams.filter((tm) => tm.members.includes(key));
  if (withChar.length) {
    info.appendChild(el("div", "cw-best", t("char.bestDps", { value: fmt(withChar[0].dps) })));
  }
  card.appendChild(info);
  return card;
}

/**
 * @param {object} o
 *   chars   — ключи персонажей, о ком окно
 *   teams   — отряды, уже отсортированные по DPS
 *   names   — names.json
 *   teamRow — (team) => HTMLElement, строка отряда (рисует app.js, чтобы вид совпадал)
 */
export function openCharacterWindow({ chars, teams, names, teamRow }) {
  const sheet = openSheet({
    title: chars.map((k) => charLabel(k)).join(" + "),
    className: "sheet-wide cw-sheet",
  });

  const head = el("div", "cw-head");
  for (const key of chars) head.appendChild(infoCard(key, names, teams));
  sheet.body.appendChild(head);

  const listHead = el("div", "cw-list-head", t("char.teams", { n: teams.length }));
  sheet.body.appendChild(listHead);

  const list = el("div", "cw-list");
  sheet.body.appendChild(list);

  if (!teams.length) {
    list.appendChild(el("div", "small muted", t("char.noTeams")));
    return sheet;
  }

  let shown = 0;
  const more = el("button", "macro-btn more-btn");
  more.type = "button";
  const page = () => {
    const slice = teams.slice(shown, shown + PAGE);
    for (const team of slice) list.insertBefore(teamRow(team), more);
    shown += slice.length;
    if (shown >= teams.length) more.remove();
    else more.textContent = t("views.showMore", { n: teams.length - shown });
  };
  more.addEventListener("click", page);
  list.appendChild(more);
  page();
  return sheet;
}
