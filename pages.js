// Фильтры каталога персонажей на статических страницах (tools/build_pages.py).
// Без скрипта видны все персонажи; со скриптом — стихии, типы оружия, редкость
// и поиск по имени (на любом из двух языков). Внутри группы — «или», между
// группами — «и», как в фильтрах основного сайта. Выбор живёт в адресе (#el=…),
// чтобы отфильтрованный каталог можно было переслать ссылкой.
(function () {
  const box = document.querySelector(".pg-filters");
  if (!box) return;
  const cards = [...document.querySelectorAll(".pg-section .pg-char")];
  const sections = [...document.querySelectorAll(".pg-section")];
  const search = box.querySelector(".pg-search");
  const empty = document.querySelector(".pg-empty");
  const state = { el: new Set(), wt: new Set(), r: new Set() };

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    for (const g of Object.keys(state)) {
      state[g] = new Set((p.get(g) || "").split(",").filter(Boolean));
    }
    search.value = p.get("q") || "";
  }

  function writeHash() {
    const p = new URLSearchParams();
    for (const [g, set] of Object.entries(state)) if (set.size) p.set(g, [...set].join(","));
    if (search.value.trim()) p.set("q", search.value.trim());
    const h = p.toString();
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  function apply() {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const c of cards) {
      const ok = (!state.el.size || state.el.has(c.dataset.el)) &&
        (!state.wt.size || state.wt.has(c.dataset.wt)) &&
        (!state.r.size || state.r.has(c.dataset.r)) &&
        (!q || c.dataset.q.includes(q));
      c.hidden = !ok;
      if (ok) shown++;
    }
    for (const s of sections) s.hidden = !s.querySelector(".pg-char:not([hidden])");
    for (const chip of box.querySelectorAll(".pg-chip")) {
      const on = state[chip.dataset.group].has(chip.dataset.value);
      chip.classList.toggle("is-on", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (empty) empty.hidden = shown > 0;
  }

  box.addEventListener("click", (e) => {
    const chip = e.target.closest(".pg-chip");
    if (!chip) return;
    const set = state[chip.dataset.group];
    if (set.has(chip.dataset.value)) set.delete(chip.dataset.value);
    else set.add(chip.dataset.value);
    writeHash();
    apply();
  });
  search.addEventListener("input", () => { writeHash(); apply(); });
  // «назад» или правка адреса руками (replaceState сам hashchange не вызывает)
  window.addEventListener("hashchange", () => { readHash(); apply(); });

  readHash();
  apply();
})();
