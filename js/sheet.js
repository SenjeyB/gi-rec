import { t } from "./i18n.js";

const stack = [];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function onKey(e) {
  if (!stack.length) return;
  const sheet = stack[stack.length - 1];
  if (e.key === "Escape" && stack.length) {
    e.preventDefault();
    e.stopPropagation();
    sheet.close();
  } else if (e.key === "Tab") {
    const controls = [...sheet.panel.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      .filter(node => node.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { e.preventDefault(); return; }
    const active = document.activeElement;
    if (!sheet.panel.contains(active) || (e.shiftKey ? active === first : active === last)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }
}

export function openSheet({ title = "", className = "", onClose } = {}) {
  const previousFocus = document.activeElement;
  const layer = el("div", "sheet-layer");
  const backdrop = el("div", "sheet-backdrop");
  const panel = el("div", `sheet-panel ${className}`.trim());
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");

  const head = el("div", "sheet-head");
  head.appendChild(el("div", "sheet-grip"));
  const titleEl = el("div", "sheet-title", title);
  head.appendChild(titleEl);
  const closeBtn = el("button", "sheet-close", "✕");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", t("common.close"));
  head.appendChild(closeBtn);

  const body = el("div", "sheet-body");
  const footer = el("div", "sheet-foot");
  footer.hidden = true;

  panel.append(head, body, footer);
  layer.append(backdrop, panel);
  document.body.appendChild(layer);
  document.body.classList.add("sheet-open");

  let closed = false;
  const handle = {
    layer, panel, body, footer,
    setTitle(text) { titleEl.textContent = text; },
    close() {
      if (closed) return;
      closed = true;
      layer.remove();
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length) {
        document.body.classList.remove("sheet-open");
        document.removeEventListener("keydown", onKey, true);
      }
      if (onClose) onClose();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    },
  };

  backdrop.addEventListener("click", () => handle.close());
  closeBtn.addEventListener("click", () => handle.close());
  if (!stack.length) document.addEventListener("keydown", onKey, true);
  stack.push(handle);
  closeBtn.focus({ preventScroll: true });
  return handle;
}

export function closeAll() {
  for (const h of stack.slice().reverse()) h.close();
}
