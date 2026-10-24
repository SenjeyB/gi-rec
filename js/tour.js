import { t, onChange as onLangChange } from "./i18n.js";

const KEY = "girec.tour";
const mobile = window.matchMedia("(max-width: 640px)");

const STEPS = [
  { id: "welcome" },
  { id: "roster", desktop: "#roster-card", mobile: "#drawer-toggle" },
  { id: "import", desktop: "#open-import", mobile: false },
  { id: "modes", desktop: ".side-nav", mobile: "#mobile-nav" },
  { id: "settings", desktop: "#settings-card", mobile: "#filters-fab" },
  { id: "results", desktop: ["#suggestions .squad", "#view-content"] },
  { id: "done", desktop: "#open-tour" },
];

let root = null;
let spot = null;
let card = null;
let steps = [];
let index = 0;
let lastFocus = null;
let frame = 0;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function seen() {
  try { return !!localStorage.getItem(KEY); } catch { return true; }
}

function markSeen() {
  try { localStorage.setItem(KEY, "done"); } catch {}
}

function activeSteps() {
  return STEPS.filter((s) => !(mobile.matches && s.mobile === false));
}

function target(step) {
  const sel = mobile.matches && step.mobile ? step.mobile : step.desktop;
  for (const s of [].concat(sel || [])) {
    const node = document.querySelector(s);
    if (node && node.getClientRects().length) return node;
  }
  return null;
}

function text(id) {
  if (mobile.matches) {
    const key = `tour.${id}.textMobile`;
    const s = t(key);
    if (s !== key) return s;
  }
  return t(`tour.${id}.text`);
}

function place() {
  frame = 0;
  if (!root) return;
  const node = target(steps[index]);
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;

  if (!node) {
    root.classList.add("is-center");
    spot.hidden = true;
    card.style.left = `${Math.max(16, (vw - cw) / 2)}px`;
    card.style.top = `${Math.max(16, (vh - ch) / 2)}px`;
    return;
  }

  root.classList.remove("is-center");
  spot.hidden = false;
  const r = node.getBoundingClientRect();
  const pad = 6;
  const gap = 14;
  const left = clamp(r.left - pad, 4, vw - 4);
  const top = clamp(r.top - pad, 4, vh - 4);
  const right = clamp(r.right + pad, 4, vw - 4);
  const bottom = clamp(r.bottom + pad, 4, vh - 4);
  Object.assign(spot.style, {
    left: `${left}px`, top: `${top}px`,
    width: `${right - left}px`, height: `${bottom - top}px`,
  });

  const spots = [
    { x: right + gap, y: top, ok: right + gap + cw <= vw - 8 },
    { x: left, y: bottom + gap, ok: bottom + gap + ch <= vh - 8 },
    { x: left, y: top - gap - ch, ok: top - gap - ch >= 8 },
    { x: left - gap - cw, y: top, ok: left - gap - cw >= 8 },
  ];
  const pos = spots.find((p) => p.ok) || { x: (vw - cw) / 2, y: vh - ch - 16 };
  card.style.left = `${clamp(pos.x, 8, vw - cw - 8)}px`;
  card.style.top = `${clamp(pos.y, 8, vh - ch - 8)}px`;
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(place);
}

function render() {
  const step = steps[index];
  const last = index === steps.length - 1;
  card.innerHTML = "";

  const dots = el("div", "tour-dots");
  dots.setAttribute("aria-label", t("tour.progress", { n: index + 1, total: steps.length }));
  steps.forEach((_, i) => dots.appendChild(el("span", `tour-dot${i === index ? " is-on" : ""}`)));
  card.appendChild(dots);

  const title = el("h2", "tour-title", t(`tour.${step.id}.title`));
  title.id = "tour-title";
  card.appendChild(title);
  card.appendChild(el("p", "tour-text", text(step.id)));

  const actions = el("div", "tour-actions");
  if (!last) {
    const skip = el("button", "tour-skip", t("tour.skip"));
    skip.type = "button";
    skip.addEventListener("click", finish);
    actions.appendChild(skip);
  }
  actions.appendChild(el("span", "tour-spacer"));
  if (index > 0) {
    const back = el("button", "macro-btn tour-back", t("tour.back"));
    back.type = "button";
    back.addEventListener("click", () => go(index - 1));
    actions.appendChild(back);
  }
  const next = el("button", "tour-next", t(last ? "tour.finish" : "tour.next"));
  next.type = "button";
  next.addEventListener("click", () => (last ? finish() : go(index + 1)));
  actions.appendChild(next);
  card.appendChild(actions);

  const node = target(step);
  if (node) node.scrollIntoView({ block: node.offsetHeight > window.innerHeight * 0.7 ? "start" : "center", inline: "nearest" });
  place();
  next.focus({ preventScroll: true });
}

function go(i) {
  index = clamp(i, 0, steps.length - 1);
  render();
}

function onKey(e) {
  if (!root) return;
  if (e.key === "Escape") { e.preventDefault(); finish(); return; }
  if (e.key === "ArrowRight") { e.preventDefault(); if (index < steps.length - 1) go(index + 1); return; }
  if (e.key === "ArrowLeft") { e.preventDefault(); if (index > 0) go(index - 1); return; }
  if (e.key === "Tab") {
    const buttons = [...card.querySelectorAll("button")];
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement);
    const nextAt = e.shiftKey ? (at <= 0 ? buttons.length - 1 : at - 1) : (at + 1) % buttons.length;
    e.preventDefault();
    buttons[nextAt].focus();
  }
}

function onViewport() {
  if (!root) return;
  const fresh = activeSteps();
  if (fresh.length !== steps.length) {
    const id = steps[index].id;
    steps = fresh;
    const at = steps.findIndex((s) => s.id === id);
    index = at >= 0 ? at : Math.min(index, steps.length - 1);
    render();
    return;
  }
  schedule();
}

function finish() {
  markSeen();
  if (!root) return;
  root.remove();
  root = spot = card = null;
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", onViewport);
  window.removeEventListener("scroll", schedule, true);
  if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
}

export function start() {
  if (root) return;
  if (location.hash === "#inventory") location.hash = "#recommendations";
  lastFocus = document.activeElement;
  steps = activeSteps();
  index = 0;

  root = el("div", "tour");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "tour-title");
  spot = el("div", "tour-spot");
  card = el("div", "tour-card");
  root.appendChild(spot);
  root.appendChild(card);
  document.body.appendChild(root);

  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onViewport);
  window.addEventListener("scroll", schedule, true);
  render();
  requestAnimationFrame(() => root && root.classList.add("is-ready"));
}

export function init({ auto } = {}) {
  document.getElementById("open-tour")?.addEventListener("click", start);
  onLangChange(() => { if (root) render(); });
  if (auto && !seen()) start();
}
