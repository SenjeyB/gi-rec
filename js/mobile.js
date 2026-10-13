// Мобильная раскладка: на телефоне сайдбар уезжает в выдвижную панель, а под
// контентом появляется нижняя навигация. На десктопе всё это скрыто и ничего
// не меняется — разметка одна, различается только CSS.

import { t, onChange as onLangChange } from "./i18n.js";

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

export function init() {
  const toggle = document.getElementById("drawer-toggle");
  const backdrop = document.getElementById("drawer-backdrop");

  toggle?.addEventListener("click", () => setDrawer(!drawerOpen));
  backdrop?.addEventListener("click", () => setDrawer(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawerOpen) setDrawer(false);
  });

  // выбор персонажа внутри панели не должен её закрывать, а переход по виду — должен
  window.addEventListener("hashchange", () => { setDrawer(false); syncActive(); });

  // при возврате на десктоп панель не должна остаться «открытой»
  const mq = window.matchMedia(MQ);
  const onChange = () => { if (!mq.matches) setDrawer(false); };
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else mq.addListener(onChange);

  buildBottomNav();
  onLangChange(buildBottomNav);
}
