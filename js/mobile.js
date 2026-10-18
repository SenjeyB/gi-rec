// Мобильная раскладка: на телефоне сайдбар уезжает в выдвижную панель, а под
// контентом появляется нижняя навигация. На десктопе всё это скрыто и ничего
// не меняется — разметка одна, различается только CSS.

import { t, onChange as onLangChange } from "./i18n.js";
import { openSheet } from "./sheet.js";

const MQ = "(max-width: 640px)";
const VIEWS = [
  ["#recommendations", "nav.recommendations", "★"],
  ["#tierlist", "nav.tierlist", "≡"],
  ["#team-builder", "nav.teamBuilder", "⚒"],
  ["#best-teams", "nav.bestTeams", "⌁"],
  ["#inventory", "nav.inventory", "☰"],
];

let drawerOpen = false;

function setDrawer(open) {
  drawerOpen = open;
  document.body.classList.toggle("drawer-open", open);
  // класс вешаем и на сам сайдбар: потомковый селектор от body в этой вёрстке
  // почему-то проигрывал базовому правилу, а так всё однозначно
  document.querySelector(".sidebar")?.classList.toggle("is-open", open);
  const btn = document.getElementById("drawer-toggle");
  if (btn) btn.setAttribute("aria-expanded", String(open));
  const backdrop = document.getElementById("drawer-backdrop");
  if (backdrop) backdrop.hidden = !open;
}

function buildBottomNav() {
  const host = document.getElementById("mobile-nav");
  if (!host) return;
  host.innerHTML = "";
  for (const [hash, key, glyph] of VIEWS) {
    const a = document.createElement("a");
    a.className = "mnav-item";
    a.href = hash;
    a.appendChild(Object.assign(document.createElement("span"), {
      className: "mnav-glyph", textContent: glyph,
    }));
    a.appendChild(Object.assign(document.createElement("span"), {
      className: "mnav-label", textContent: t(key),
    }));
    a.addEventListener("click", () => setDrawer(false));
    host.appendChild(a);
  }
  syncActive();
}

function syncActive() {
  const hash = location.hash || "#recommendations";
  for (const a of document.querySelectorAll(".mnav-item")) {
    a.classList.toggle("is-active", a.getAttribute("href") === hash);
  }
}

// ------------------------------------------------------------ шторка фильтров
// На телефоне фильтры вида (#view-controls) и карточка настроек со страницы
// убраны, а по кнопке «Фильтры» переезжают в шторку. Переносим сами узлы, а не
// копии: обработчики остаются на месте, а вид при перерисовке пишет прямо в
// #view-controls — где бы тот сейчас ни находился.
let filterSheet = null;

function moveInto(node, target) {
  const mark = document.createComment("filters-home");
  node.parentNode.insertBefore(mark, node);
  target.appendChild(node);
  return () => { if (mark.parentNode) { mark.parentNode.insertBefore(node, mark); mark.remove(); } };
}

function activeFilterCount() {
  let n = document.querySelectorAll("#view-controls .filter-chip.selected, #view-controls .char-filter-chosen .anchor-chip").length;
  n += document.querySelectorAll("#settings-card input[type=checkbox]:checked").length;
  for (const sel of document.querySelectorAll("#settings-card select[data-default]")) {
    if (sel.value !== sel.dataset.default) n++;
  }
  return n;
}

function updateFab() {
  const fab = document.getElementById("filters-fab");
  if (!fab) return;
  const badge = fab.querySelector(".filters-fab-count");
  const n = activeFilterCount();
  if (badge) { badge.hidden = n === 0; badge.textContent = String(n); }
  // в инвентаре свои фильтры — общая кнопка там не нужна
  fab.hidden = location.hash === "#inventory";
}

function openFilters() {
  if (filterSheet) return;
  setDrawer(false);
  const controls = document.getElementById("view-controls");
  const settingsCard = document.getElementById("settings-card");
  const sheet = openSheet({
    title: t("filters.title"),
    className: "filters-sheet",
    onClose: () => { restore.forEach((fn) => fn()); filterSheet = null; updateFab(); },
  });
  const restore = [];
  if (controls) restore.push(moveInto(controls, sheet.body));
  if (settingsCard) restore.push(moveInto(settingsCard, sheet.body));
  const done = document.createElement("button");
  done.type = "button";
  done.className = "inv-btn inv-btn-primary";
  done.textContent = t("inventory.done");
  done.addEventListener("click", () => sheet.close());
  sheet.footer.hidden = false;
  sheet.footer.appendChild(done);
  filterSheet = sheet;
}

export function init() {
  const toggle = document.getElementById("drawer-toggle");
  const backdrop = document.getElementById("drawer-backdrop");

  toggle?.addEventListener("click", () => setDrawer(!drawerOpen));
  backdrop?.addEventListener("click", () => setDrawer(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawerOpen) setDrawer(false);
  });

  // выбор персонажа внутри панели не должен её закрывать, а переход по виду — должен
  window.addEventListener("hashchange", () => {
    setDrawer(false);
    if (filterSheet) filterSheet.close();
    syncActive();
    updateFab();
  });

  document.getElementById("filters-fab")?.addEventListener("click", openFilters);
  // Счётчик активных фильтров на кнопке. Слушатель на document срабатывает уже
  // после обработчика чипа (всплытие), когда вид перерисован, поэтому считаем
  // сразу. requestAnimationFrame тут не годится: в фоновой вкладке браузер его
  // придерживает, и счётчик отставал на клик.
  document.addEventListener("click", updateFab);
  document.addEventListener("change", updateFab);

  // при возврате на десктоп панель не должна остаться «открытой»
  const mq = window.matchMedia(MQ);
  const onChange = () => {
    if (!mq.matches) { setDrawer(false); if (filterSheet) filterSheet.close(); }
  };
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else mq.addListener(onChange);

  buildBottomNav();
  onLangChange(buildBottomNav);
  updateFab();
}
