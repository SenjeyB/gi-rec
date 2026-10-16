import { t, lang } from './js/i18n.js';
import { charLabel, weaponLabel, setLabel, statLabel } from './js/labels.js';
import { toggleDetail } from './js/teamdetail.js';
import { copiesNeeded, subtractCopies, haveCopies, meta as dbMeta } from './js/db.js';
import { openCharacterWindow } from './js/charwindow.js';

// Имена оружия и сетов для подсказок — заполняются из data/refs.json при старте.
let WEAPON_NAMES = {};
let SET_NAMES = {};

// Перевод динамических строк. Второй аргумент — английский текст: он подставится,
// если ключа нет в словаре, так что вид не развалится из-за опечатки в ключе.
function T(key, fallback, vars){
  const s = t(key, vars);
  return s === key ? fallback : s;
}

// Оружие и сеты персонажа внутри отряда: иконка оружия с рефайном и до двух сетов.
// Данные приходят из data/db.json через js/db.js, поэтому рисуем только если
// сборка известна (у отрядов, восстановленных из localStorage, её нет).
function renderLoadout(slot){
  if(!slot) return null;
  const wrap = createEl('div','loadout');
  if(slot.weapon){
    const w = createEl('div', 'loadout-weapon' + (slot.fiveStar ? ' is-five' : ''));
    const img = new Image();
    img.loading = 'lazy'; img.decoding = 'async';
    img.src = `weapons/${slot.weapon}.png`;
    img.alt = '';
    img.onerror = ()=>{ img.style.visibility = 'hidden'; };
    w.appendChild(img);
    w.appendChild(createEl('span','loadout-refine', T('team.refine','R'+slot.refine,{n:slot.refine})));
    const wname = weaponLabel(slot.weapon) || (WEAPON_NAMES && WEAPON_NAMES[slot.weapon]) || slot.weapon;
    w.title = `${T('team.weapon','Weapon')}: ${wname} R${slot.refine}`;
    wrap.appendChild(w);
  }
  const sets = slot.sets || [];
  if(sets.length === 0){
    const none = createEl('div','loadout-set is-empty','—');
    none.title = T('team.noSet','No artifact set');
    wrap.appendChild(none);
  } else {
    // 4 детали одного сета — одна иконка; 2+2 — две
    for(const s of sets.slice(0,2)){
      const node = createEl('div','loadout-set');
      const img = new Image();
      img.loading = 'lazy'; img.decoding = 'async';
      img.src = `sets/${s.key}.png`;
      img.alt = '';
      img.onerror = ()=>{ img.style.visibility = 'hidden'; };
      node.appendChild(img);
      node.appendChild(createEl('span','loadout-pieces', String(s.pieces)));
      const sname = setLabel(s.key) || (SET_NAMES && SET_NAMES[s.key]) || s.key;
      node.title = `${T('team.sets','Artifact sets')}: ${sname} ×${s.pieces}`;
      wrap.appendChild(node);
    }
  }
  return wrap;
}

// Ячейка участника отряда: портрет, имя и его сборка (оружие + сеты).
// idx — позиция в отряде; build в данных выровнен с members, поэтому берём по индексу.
function appendMemberCell(host, key, team, idx, pillClass){
  const slot = (team && team.build) ? team.build[idx] : null;
  // Статус «есть / нет персонажа» раньше красил плашку с именем; теперь он на
  // рамке всей ячейки, а имя идёт обычным текстом — так карточка спокойнее.
  const cell = createEl('div','member-cell');
  if(pillClass) cell.classList.add(pillClass);

  const avatarWrap = createEl('div','member-portrait');
  const img = createAvatarImg(key,'member-avatar');
  if(img) avatarWrap.appendChild(img);
  // созвездие берём из самой сборки, а не из общего признака персонажа:
  // в разных отрядах один и тот же герой может считаться на разных констах
  if(slot && Number.isFinite(slot.cons)){
    avatarWrap.appendChild(createEl('span','cons-badge', `C${slot.cons}`));
  }
  cell.appendChild(avatarWrap);

  cell.appendChild(createEl('div','member-name', charLabel(key)));

  const lo = renderLoadout(slot);
  if(lo) cell.appendChild(lo);
  host.appendChild(cell);
  return cell;
}

// Фильтры и селекты вида живут в отдельном контейнере, а не внутри списка:
// на телефоне он целиком переезжает в шторку фильтров (js/mobile.js), и
// перерисовка вида пишет прямо туда, где он сейчас находится.
function viewControls(){
  return document.getElementById('view-controls') || document.createElement('div');
}

// names.json для функций вне start() (окно персонажа, тир-лист, рекомендации)
let NAMES = {};

// Строка отряда: участники, DPS, раскрытие подробностей по клику.
// owned — у кого из участников рамка «есть», остальные помечаются «нет».
function buildTeamRow(team, owned, extraCls){
  const row = createEl('div','team-row' + (extraCls ? ' ' + extraCls : ''));
  const members = createEl('div','members');
  team.members.forEach((m, mi)=>{
    appendMemberCell(members, m, team, mi, (owned && !owned.has(m)) ? 'missing' : 'owned');
  });
  row.appendChild(members);
  row.appendChild(createEl('div','team-dps', fmtDps(team.dps)));
  if(team.build){
    row.classList.add('expandable');
    row.title = T('team.details','Team details');
    row.addEventListener('click', (e)=>{ e.stopPropagation(); toggleDetail(row, team); });
  }
  return row;
}

// Списки отрядов рисуем страницами: на каждый отряд — четыре портрета с иконками
// сборки, и сотни таких строк сразу заметно тормозят.
function paginate(container, items, pageSize, build){
  let shown = 0;
  const more = createEl('button','macro-btn more-btn');
  more.type = 'button';
  const page = ()=>{
    const slice = items.slice(shown, shown + pageSize);
    for(const it of slice) container.insertBefore(build(it), more);
    shown += slice.length;
    if(shown >= items.length) more.remove();
    else more.textContent = T('views.showMore','Show more ('+(items.length-shown)+')',{n: items.length - shown});
  };
  more.addEventListener('click', page);
  container.appendChild(more);
  page();
}

function createEl(tag,cls,txt){
  const el = document.createElement(tag);
  if(cls) el.className = cls;
  if(txt !== undefined) el.textContent = txt;
  return el;
}

/**
 * Точка входа. Вызывается из js/main.js, когда уже подняты локализация,
 * инвентарь и база — поэтому первый же рендер уходит сразу переведённым
 * и с отрядами, отфильтрованными под инвентарь.
 *
 * @param {object} ctx
 *   names  — names.json
 *   teams  — отряды из js/db.js (там же лежит build с оружием и сетами)
 *   refs   — data/refs.json, нужен для подписей оружия и сетов
 * @returns {{refreshTeams:Function, rerender:Function}}
 */
export async function start(ctx){
  const names = ctx && ctx.names;
  let teams = (ctx && ctx.teams) || [];
  // строгий срез под инвентарь — для сборщика и подсказок, где отряд должен
  // реально собираться на тех созвездиях и оружии, что есть у игрока
  let strictTeams = [];
  // общий срез без учёта инвентаря: стандартные созвездия для всех — для
  // «Все отряды», где рейтинг не должен зависеть от того, что есть у игрока
  let baseTeams = [];
  if(!names){
    document.body.prepend(createEl('div','small',T('errors.loadData','Failed to load data. Check that names.json and data/db.json are next to index.html.')))
    return null;
  }
  NAMES = names;
  if(ctx.refs){
    WEAPON_NAMES = {};
    for(const [k,v] of Object.entries(ctx.refs.weapons||{})) WEAPON_NAMES[k] = v.name;
    for(const [k,v] of Object.entries(ctx.refs.fiveStars||{})) WEAPON_NAMES[k] = v.name;
    SET_NAMES = {};
    for(const [k,v] of Object.entries(ctx.refs.sets||{})) SET_NAMES[k] = v.name;
  }

  // Отряды пересобираются при каждом изменении инвентаря или настроек,
  // поэтому держим их в let и умеем перестраивать индекс по участникам.
  let parsedTeams = [];
  let teamsByMember = new Map();

  const toTeam = (t) => ({
    members: t.chars ? t.chars.slice() : [],
    dps: t.dps != null ? t.dps : 0,
    build: t.build || null, src: t.src || null, sims: t.sims || 0,
    kqmCons: !!t.kqmCons, kqmArt: !!t.kqmArt,
    teamIndex: t.teamIndex, buildIndex: t.buildIndex,
  });

  function rebuildTeams(list, strictList, baseList){
    teams = list || [];
    strictTeams = (strictList || list || []).map(toTeam);
    baseTeams = (baseList || list || []).map(toTeam);
    parsedTeams = teams.map(t => ({
      members: t.chars
        ? t.chars.slice()
        : (t.display || []).map((d)=> d || d),
      dps: t.dps != null ? t.dps : (t.DPS || 0),
      build: t.build || null,      // оружие и сеты по слотам, выровнены с members
      src: t.src || null,
      sims: t.sims || 0,
      kqmCons: !!t.kqmCons,
      kqmArt: !!t.kqmArt,
      teamIndex: t.teamIndex,
      buildIndex: t.buildIndex,
    }));
    teamsByMember = new Map();
    for(const pt of parsedTeams){
      for(const m of pt.members){
        if(!m) continue;
        if(!teamsByMember.has(m)) teamsByMember.set(m, []);
        teamsByMember.get(m).push(pt);
      }
    }
  }
  rebuildTeams(teams, (ctx && ctx.strictTeams), (ctx && ctx.baseTeams));

  const charactersDiv = document.getElementById('characters');
  const ownedFiltersHost = document.getElementById('owned-filters');
  // Идентификатор персонажа — ключ из names.json (он же имя файла картинки).
  // Отображаемое имя зависит от языка и для опознания не годится.
  const charKeys = Object.keys(names);
  const sortedCharKeys = ()=> charKeys.slice().sort((a,b)=> charLabel(a).localeCompare(charLabel(b)));
  const selected = new Set();
  let goodConfigBackup = null;

  const byWeapon = new Map();
  const byElement = new Map();
  for(const [k, v] of Object.entries(names)){
    const disp = (v && typeof v==='object')? v.name : v;
    const weapon = (v && v.weapon) ? String(v.weapon).toLowerCase() : null;
    const element = (v && v.element) ? String(v.element).toLowerCase() : null;
    if(weapon){ if(!byWeapon.has(weapon)) byWeapon.set(weapon, new Set()); byWeapon.get(weapon).add(disp); }
    if(element){ if(!byElement.has(element)) byElement.set(element, new Set()); byElement.get(element).add(disp); }
  }

  const filterState = {
    owned: { weapons: new Set(), elements: new Set() },
    main: { weapons: new Set(), elements: new Set() },
    picker: { weapons: new Set(), elements: new Set() },
    bestTeams: { elements: new Set(), weapons: new Set() }
  };

  function renderFilters(host, scope){
    if(!host) return;
    host.innerHTML = '';
    const mkChip = (group, key, label, iconSrc) => {
      const chip = createEl('button','filter-chip');
      chip.type = 'button';
      const icon = new Image(); icon.src = iconSrc; icon.alt = ''; icon.className = 'icon';
      chip.appendChild(icon);
      chip.appendChild(createEl('span',null,label));
      const set = filterState[scope][group];
      function sync(){
        chip.classList.toggle('selected', set.has(key));
        chip.setAttribute('aria-pressed', set.has(key) ? 'true' : 'false');
      }
      chip.addEventListener('click', ()=>{ if(set.has(key)) set.delete(key); else set.add(key); sync(); onFiltersChanged(scope); });
      sync();
      return chip;
    };
    const elOrder = ['anemo','cryo','dendro','electro','geo','hydro','pyro'];
    for(const e of elOrder){
      if(byElement.has(e)){
        const label = T('element.'+e, e[0].toUpperCase()+e.slice(1));
        const chip = mkChip('elements', e, label, `filters/Element_${e[0].toUpperCase()+e.slice(1)}.png`);
        host.appendChild(chip);
      }
    }
    if(scope === 'main' || scope === 'bestTeams'){
      const br = document.createElement('span');
      br.className = 'filter-break';
      host.appendChild(br);
    }
    const wOrder = ['sword','polearm','bow','claymore','catalyst'];
    for(const w of wOrder){
      if(byWeapon.has(w)){
        const label = T('weaponType.'+w, w[0].toUpperCase()+w.slice(1));
        const chip = mkChip('weapons', w, label, `filters/Class-${w}.png`);
        host.appendChild(chip);
      }
    }
  }

  function filterActive(scope){
    const s = filterState[scope];
    if(!s) return false;
    return (s.elements.size>0) || (s.weapons.size>0);
  }

  function onFiltersChanged(scope){
    if(scope === 'owned'){
      renderOwnedCharacters();
      return;
    }
    if(scope === 'main'){
      const hash = location.hash || '#recommendations';
      if(hash === '#tierlist') renderTier();
      else if(hash === '#recommendations') renderRecommendations();
      return;
    }
    if(scope === 'bestTeams'){
      renderBestTeams();
      return;
    }
    if(scope === 'picker'){
      const modal = document.getElementById('team-picker-modal');
      if(modal && !modal.hidden && typeof pickerRefresh === 'function'){
        try{ pickerRefresh(); }catch{}
      }
    }
  }
  let pickerRefresh = null;

  function makeFilterPredicate(scope){
    const sets = filterState[scope];
    const els = sets.elements; const ws = sets.weapons;
    const elActive = els.size>0; const wActive = ws.size>0;
    if(!elActive && !wActive) return ()=>true;
    return (key)=>{
      const entry = names[key];
      const e = (entry && entry.element)? String(entry.element).toLowerCase():'';
      const w = (entry && entry.weapon)? String(entry.weapon).toLowerCase():'';
      const okEl = !elActive || els.has(e);
      const okW = !wActive || ws.has(w);
      return okEl && okW;
    };
  }

  function hasTeams(key){
    return teamsByMember.has(key);
  }

  function getDefaultAutoSelect(){
    const out = [];
    for(const [key, entry] of Object.entries(names)){
      if((entry && entry.stars) === 1 && hasTeams(key)) out.push(key);
    }
    return out;
  }

  let usedDefaults = false;
  try{
    const saved = JSON.parse(localStorage.getItem('ownedSelection')||'[]');
    const defaultAutoSelect = getDefaultAutoSelect();
    usedDefaults = !saved.length;
    for(const n of (saved.length? saved : defaultAutoSelect)) selected.add(n);
  }catch{
    const defaultAutoSelect = getDefaultAutoSelect();
    usedDefaults = true;
    for(const n of defaultAutoSelect) selected.add(n);
  }
  // Автовыбор по умолчанию раньше жил только в памяти, и инвентарь (js/store.js),
  // который читает ownedSelection, видел пустой список. Закрепляем сразу.
  if(usedDefaults){
    try{ localStorage.setItem('ownedSelection', JSON.stringify([...selected])); }catch{}
  }

  function renderOwnedCharacters(){
    charactersDiv.innerHTML = '';
    const pred = makeFilterPredicate('owned');
    const q = (document.getElementById('char-search')?.value || '').trim().toLowerCase();
    for(const key of sortedCharKeys()){
      const label = charLabel(key);
      // ищем и по подписи текущего языка, и по английскому имени
      const english = (names[key] && names[key].name) || key;
      if(q && !label.toLowerCase().includes(q) && !english.toLowerCase().includes(q)) continue;
      if(!pred(key)) continue;
      const btn = createEl('button','char');
      btn.type = 'button';
      const img = createAvatarImg(key,'avatar');
      if(img) btn.appendChild(img);
      btn.appendChild(createEl('div',null,label));

      const noTeams = !hasTeams(key);
      if(noTeams){
        btn.classList.add('no-teams');
        btn.disabled = true;
        btn.title = T('roster.noTeamsForChar','No teams available for this character');
      }

      if(selected.has(key)) btn.classList.add('selected');

      if(!noTeams){
        btn.addEventListener('click',()=>{
          if(btn.classList.toggle('selected')) selected.add(key); else selected.delete(key);
          persistSelection();
          renderActiveView();
        });
      }
      charactersDiv.appendChild(btn);
    }
  }

  let searchTimer = null;
  document.getElementById('char-search')?.addEventListener('input', ()=>{
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderOwnedCharacters, 80);
  });

  renderFilters(ownedFiltersHost, 'owned');
  renderOwnedCharacters();

  const modeEl = document.getElementById('mode');
  try{
    const savedMode = localStorage.getItem('settingMode'); if(savedMode) modeEl.value = savedMode;
  }catch{}
  modeEl.addEventListener('change', ()=> { localStorage.setItem('settingMode', modeEl.value); renderActiveView(); });

  function persistSelection(){
    try{ localStorage.setItem('ownedSelection', JSON.stringify([...selected])); }catch{}
    // Сообщаем новому коду (js/main.js), что выбор изменился здесь, чтобы он
    // подтянул его в инвентарь, не потеряв выставленные созвездия.
    try{ window.dispatchEvent(new CustomEvent('girec:owned-changed')); }catch{}
  }

  // Инвентарь поменялся снаружи (раздел «Инвентарь» или смена языка) —
  // перечитываем выбор. Перерисовку инициирует js/main.js через refreshTeams().
  window.addEventListener('girec:inventory-changed', ()=>{
    let list = [];
    try{ list = JSON.parse(localStorage.getItem('ownedSelection')||'[]'); }catch{ list = []; }
    if(!Array.isArray(list)) list = [];
    const next = new Set(list);
    let same = next.size === selected.size;
    if(same){ for(const v of next){ if(!selected.has(v)){ same = false; break; } } }
    if(!same){
      selected.clear();
      for(const v of next) selected.add(v);
    }
    // «Вернуть конфиг» откатывает к последнему состоянию инвентаря —
    // например к тому, что приехало импортом из GOOD
    goodConfigBackup = new Set(next);
  });

  function updateCharacterSelection(){
    renderOwnedCharacters();
    persistSelection();
    renderActiveView();
  }

  function getCharactersByStars(starsArray){
    const out = [];
    for(const [key, entry] of Object.entries(names)){
      const stars = (entry && entry.stars) ? entry.stars : null;
      if(stars !== null && starsArray.includes(stars) && hasTeams(key)) out.push(key);
    }
    return out;
  }

  document.getElementById('macro-free')?.addEventListener('click', ()=>{
    const freeChars = getCharactersByStars([1]);
    for(const char of freeChars) selected.add(char);
    updateCharacterSelection();
  });

  document.getElementById('macro-4star')?.addEventListener('click', ()=>{
    const chars = getCharactersByStars([1, 2]);
    for(const char of chars) selected.add(char);
    updateCharacterSelection();
  });

  document.getElementById('macro-standard')?.addEventListener('click', ()=>{
    const standardChars = getCharactersByStars([3]);
    for(const char of standardChars) selected.add(char);
    updateCharacterSelection();
  });

  document.getElementById('macro-all')?.addEventListener('click', ()=>{
    for(const key of charKeys){
      if(hasTeams(key)) selected.add(key);
    }
    updateCharacterSelection();
  });

  document.getElementById('macro-clear')?.addEventListener('click', ()=>{
    selected.clear();
    updateCharacterSelection();
  });

  document.getElementById('macro-restore')?.addEventListener('click', ()=>{
    if(goodConfigBackup && goodConfigBackup.size > 0){
      selected.clear();
      for(const char of goodConfigBackup) selected.add(char);
      updateCharacterSelection();
    }
  });

  // Импорт GOOD живёт в js/good.js + js/main.js: он понимает созвездия и 5* оружие,
  // а прежняя версия здесь умела только список имён и дублировала обработчики.

  const openImport = document.getElementById('open-import');
  const importModal = document.getElementById('import-modal');
  const importClose = document.getElementById('import-close');
  function showImport(){ if(importModal){ importModal.hidden = false; importModal.querySelector('.close-btn')?.focus(); } }
  function hideImport(){ if(importModal) importModal.hidden = true; }
  openImport?.addEventListener('click', showImport);
  importClose?.addEventListener('click', hideImport);
  importModal?.querySelector('.modal-backdrop')?.addEventListener('click', hideImport);

  const navLinks = Array.from(document.querySelectorAll('.nav-link'));
  function setActiveLink(hash){
    navLinks.forEach(a=>{
      if(a.getAttribute('href') === hash) a.classList.add('active'); else a.classList.remove('active');
    });
  }
  function getOwned(){ return new Set([...selected]); }

  function renderRecommendations(){
    viewControls().innerHTML = '';
    const owned = getOwned();
    const mode = parseInt(modeEl.value||'1',10);
    const pred = makeFilterPredicate('main');
    const active = filterActive('main');
    const base = computeSuggestions(parsedTeams, owned, mode);
    const suggestions = active
      ? base.map(item => {
          const missingAllMatch = item.missing.every(pred);
          if(!missingAllMatch) return null;
          const filteredTop = (item.topteams||[]).filter(t => {
            const missingInTeam = t.members.filter(m => !owned.has(m));
            return missingInTeam.every(pred);
          });
          if(filteredTop.length === 0) return null;
          return { ...item, topteams: filteredTop };
        }).filter(Boolean)
      : base;
    const content = document.getElementById('view-content');
    content.innerHTML = '';
    const filtersDiv = createEl('div','filter-bar');
    filtersDiv.setAttribute('aria-label', T('filters.currentView','Filter current view'));
    viewControls().appendChild(filtersDiv);
    renderFilters(filtersDiv, 'main');
    const wrap = createEl('div');
    const list = createEl('div'); list.id = 'suggestions';
    wrap.appendChild(list);
    content.appendChild(wrap);
    renderSuggestions(suggestions, getOwned());
  }

  // ------------------------------------------------------------ сборка отряда
  // Слоты под контент: Бездна — две половины 12 этажа, Натиск — три поля боя.
  // Персонажи и копии 5★ оружия, занятые одним слотом, остальным недоступны:
  // если у игрока одна копия, второй отряд с тем же оружием не соберётся.

  const BUILDER_KEY = 'builderSelections';

  function renderTeamBuilder(){
    viewControls().innerHTML = '';
    const owned = getOwned();
    const content = document.getElementById('view-content');
    content.innerHTML = '';
    const wrap = createEl('div','builder');

    let contentKey = 'abyss';
    try{ if(localStorage.getItem('builderContent') === 'onslaught') contentKey = 'onslaught'; }catch{}
    const targetTeams = contentKey === 'onslaught' ? 3 : 2;
    const info = (ctx && ctx.content && ctx.content[contentKey]) || null;
    const enemies = (ctx && ctx.content && ctx.content.enemies) || {};
    const gen = (dbMeta() || {}).generated || '';
    const ownedCopies = (ctx && ctx.weaponCopies) ? ctx.weaponCopies() : {};

    // ---------- шапка: контент, цикл, «очистить всё»
    const head = createEl('div','builder-head');
    const seg = createEl('div','seg');
    for(const [key, label] of [['abyss', T('builder.abyssShort','Spiral Abyss')], ['onslaught', T('builder.onslaughtShort','Stygian Onslaught')]]){
      const b = createEl('button','seg-btn' + (key === contentKey ? ' is-active' : ''), label);
      b.type = 'button';
      b.setAttribute('aria-pressed', key === contentKey ? 'true' : 'false');
      b.addEventListener('click', ()=>{
        if(key === contentKey) return;
        try{ localStorage.setItem('builderContent', key); }catch{}
        renderTeamBuilder();
      });
      seg.appendChild(b);
    }
    head.appendChild(seg);
    if(info) head.appendChild(cycleMeta(info));
    wrap.appendChild(head);

    // ---------- выбранные отряды
    function loadSelections(){
      try{
        const all = JSON.parse(localStorage.getItem(BUILDER_KEY)||'{}');
        const arr = Array.isArray(all[contentKey]) ? all[contentKey] : [];
        return Array(targetTeams).fill(null).map((_, i)=>{
          const s = arr[i];
          return (s && Array.isArray(s.members) && s.members.length === 4) ? s : null;
        });
      }catch{ return Array(targetTeams).fill(null); }
    }
    function saveSelections(){
      try{
        const all = JSON.parse(localStorage.getItem(BUILDER_KEY)||'{}');
        all[contentKey] = state.selections;
        localStorage.setItem(BUILDER_KEY, JSON.stringify(all));
      }catch{}
    }
    const state = { selections: loadSelections() };

    const pack = (team)=> ({
      members: team.members.slice(), dps: team.dps || 0, build: team.build || null,
      src: team.src || null, sims: team.sims || 0, kqmCons: !!team.kqmCons, kqmArt: !!team.kqmArt,
      teamIndex: team.teamIndex, buildIndex: team.buildIndex, gen,
    });
    const sameMembers = (a, b)=> a.length === b.length && a.every(m => b.includes(m));
    const strictFor = (weapons)=> (ctx && ctx.strictWith ? ctx.strictWith(weapons) : []).map(toTeam);

    // Что занято слотами, кроме skip: персонажи и остаток копий 5★.
    function takenExcept(skip){
      let weapons = ownedCopies;
      const chars = new Set();
      state.selections.forEach((s, j)=>{
        if(j === skip || !s) return;
        s.members.forEach(m => chars.add(m));
        const left = subtractCopies(weapons, copiesNeeded(s.build));
        if(left) weapons = left;
      });
      return { chars, weapons };
    }

    // Проверяем слоты по порядку: каждый забирает своих персонажей и копии.
    // После пересборки базы индексы отрядов сдвигаются — тогда находим тот же
    // состав заново, под то, что осталось от предыдущих слотов.
    function checkSlots(){
      let weapons = ownedCopies;
      const chars = new Set();
      let changed = false;
      const out = state.selections.map((sel)=>{
        if(!sel) return null;
        const problems = [];
        if(sel.gen !== gen){
          const fresh = strictFor(weapons).find(t => sameMembers(t.members, sel.members));
          if(fresh){ Object.assign(sel, pack(fresh)); changed = true; }
        }
        const missing = sel.members.filter(m => !owned.has(m));
        const dup = sel.members.filter(m => chars.has(m));
        if(missing.length) problems.push(T('builder.problemChars','Not in your inventory: {list}',{list: missing.map(charLabel).join(', ')}));
        if(dup.length) problems.push(T('builder.problemDup','Already in another team: {list}',{list: dup.map(charLabel).join(', ')}));
        const need = copiesNeeded(sel.build);
        const left = subtractCopies(weapons, need);
        if(left) weapons = left;
        else {
          const short = Object.keys(need).filter(k => !haveCopies({[k]: need[k]}, weapons));
          problems.push(T('builder.problemWeapons','Not enough copies: {list}',{list: short.map(k => weaponLabel(k) || k).join(', ')}));
        }
        sel.members.forEach(m => chars.add(m));
        return problems;
      });
      if(changed) saveSelections();
      return out;
    }

    const slotsHost = createEl('div','builder-slots');
    wrap.appendChild(slotsHost);
    const usedHost = createEl('div','builder-used');
    wrap.appendChild(usedHost);

    function slotTitle(i){
      if(contentKey === 'abyss') return i === 0 ? T('builder.firstHalf','First half') : T('builder.secondHalf','Second half');
      return T('builder.battlefield','Battlefield {n}',{n: i+1});
    }

    function renderSlots(){
      slotsHost.innerHTML = '';
      const problems = checkSlots();
      for(let i=0;i<targetTeams;i++) slotsHost.appendChild(slotCard(i, problems[i]));
      renderUsed();
    }

    function slotCard(i, problems){
      const sel = state.selections[i];
      const card = createEl('section','slot-card' + (sel ? ' is-filled' : ' is-empty') + (problems && problems.length ? ' has-problem' : ''));
      const head = createEl('div','slot-head');
      head.appendChild(createEl('span','slot-num', String(i+1)));
      const titles = createEl('div','slot-titles');
      titles.appendChild(createEl('div','slot-title', slotTitle(i)));
      if(contentKey === 'abyss') titles.appendChild(createEl('div','slot-sub', T('builder.floor12','Floor 12')));
      head.appendChild(titles);
      if(sel) head.appendChild(createEl('div','slot-dps', fmtDps(sel.dps)));
      card.appendChild(head);

      const context = contentKey === 'abyss' ? abyssHalf(info, enemies, i) : onslaughtBoss(info, enemies, i);
      if(context) card.appendChild(context);

      if(sel){
        const row = buildTeamRow(sel, owned, 'slot-team');
        card.appendChild(row);
        for(const p of problems || []) card.appendChild(createEl('div','slot-problem', p));
        const actions = createEl('div','slot-actions');
        const change = createEl('button','macro-btn', T('builder.change','Change'));
        change.type = 'button';
        change.addEventListener('click', ()=> openTeamPicker(i));
        const remove = createEl('button','macro-btn slot-remove', T('builder.remove','Remove'));
        remove.type = 'button';
        remove.addEventListener('click', ()=>{ state.selections[i] = null; saveSelections(); renderSlots(); });
        actions.append(change, remove);
        card.appendChild(actions);
      } else {
        const pick = createEl('button','slot-pick');
        pick.type = 'button';
        pick.appendChild(createEl('span','slot-pick-plus','+'));
        pick.appendChild(createEl('span',null, T('builder.pick','Pick a team')));
        pick.addEventListener('click', ()=> openTeamPicker(i));
        card.appendChild(pick);
      }
      return card;
    }

    function renderUsed(){
      usedHost.innerHTML = '';
      const chosen = state.selections.filter(Boolean);
      if(!chosen.length) return;
      const chars = new Set();
      const weapons = {};
      for(const s of chosen){
        s.members.forEach(m => chars.add(m));
        for(const [k, refines] of Object.entries(copiesNeeded(s.build))) weapons[k] = (weapons[k] || 0) + refines.length;
      }
      const line = createEl('div','builder-used-line');
      line.appendChild(createEl('span',null, T('builder.usedChars','Characters in use: {n}',{n: chars.size})));
      const wl = Object.entries(weapons);
      if(wl.length){
        line.appendChild(createEl('span','builder-used-sep','·'));
        line.appendChild(createEl('span',null, T('builder.usedWeapons','5★ weapons: {list}',{
          list: wl.map(([k, n]) => (weaponLabel(k) || k) + (n > 1 ? ` ×${n}` : '')).join(', ')
        })));
      }
      usedHost.appendChild(line);
      const clear = createEl('button','macro-btn', T('builder.clearAll','Clear all'));
      clear.type = 'button';
      clear.addEventListener('click', ()=>{ state.selections = state.selections.map(()=> null); saveSelections(); renderSlots(); });
      usedHost.appendChild(clear);
    }

    function openTeamPicker(idx){
      const modal = document.getElementById('team-picker-modal');
      const roster = document.getElementById('team-picker-roster');
      const filterHost = document.getElementById('team-picker-filters');
      const list = document.getElementById('team-picker-list');
      const title = document.getElementById('team-picker-title');
      title.textContent = T('builder.pickFor','Team {n} · {slot}',{n: idx+1, slot: slotTitle(idx)});

      const taken = takenExcept(idx);
      const availOwned = new Set([...owned].filter(n => !taken.chars.has(n)));
      // отряды под то, что осталось: персонажи не заняты, копий 5★ хватает
      const baseCandidates = strictFor(taken.weapons)
        .filter(s => s.members.every(m => availOwned.has(m)))
        .sort((a,b)=> b.dps - a.dps);

      const anchors = new Set();
      const currentCandidates = ()=> anchors.size === 0
        ? baseCandidates
        : baseCandidates.filter(s => [...anchors].every(a => s.members.includes(a)));

      function refreshRoster(){
        roster.innerHTML = '';
        const predPicker = makeFilterPredicate('picker');
        const addable = new Set();
        if(anchors.size < 4){
          for(const s of currentCandidates()){ for(const m of s.members) addable.add(m); }
        }
        for(const key of [...owned].sort((a,b)=> charLabel(a).localeCompare(charLabel(b)))){
          const inAnchor = anchors.has(key);
          if(!inAnchor && !predPicker(key)) continue;
          const chip = createEl('div','tier-member');
          const eligible = inAnchor || (!taken.chars.has(key) && addable.has(key));
          if(inAnchor) chip.classList.add('active');
          if(!eligible) chip.classList.add('disabled');
          if(taken.chars.has(key)) chip.title = T('builder.inOtherTeam','In another team');
          const avatar = createAvatarImg(key,'avatar'); if(avatar) chip.appendChild(avatar);
          chip.appendChild(createEl('div','pill', charLabel(key)));
          if(eligible){
            chip.addEventListener('click',()=>{
              if(anchors.has(key)) anchors.delete(key); else anchors.add(key);
              refreshRoster();
              renderList();
            });
          }
          roster.appendChild(chip);
        }
      }

      function renderList(){
        list.innerHTML = '';
        if(anchors.size > 0){
          const selHead = createEl('div','picker-selected-head');
          const clearBtn = createEl('button','small-btn', T('picker.clear','Clear'));
          clearBtn.type = 'button';
          clearBtn.addEventListener('click',()=>{ anchors.clear(); refreshRoster(); renderList(); });
          selHead.appendChild(clearBtn);
          list.appendChild(selHead);
          const selRow = createEl('div','picker-selected');
          for(const a of anchors){
            const chip = createEl('button','anchor-chip');
            chip.type = 'button';
            chip.title = T('roster.removeFromSelection','Remove from selection');
            const img = createAvatarImg(a,'member-avatar'); if(img) chip.appendChild(img);
            chip.appendChild(createEl('span','member-pill', charLabel(a)));
            chip.appendChild(createEl('span','anchor-x','✕'));
            chip.addEventListener('click',()=>{ anchors.delete(a); refreshRoster(); renderList(); });
            selRow.appendChild(chip);
          }
          list.appendChild(selRow);
        }

        const candidates = currentCandidates();
        if(candidates.length === 0){
          list.appendChild(createEl('div','small', T('views.noTeamsSelection','No teams available with this selection.')));
          return;
        }
        list.appendChild(createEl('div','small muted', T('views.showingTop','Teams found: {n}',{n: candidates.length})));
        const holder = createEl('div');
        list.appendChild(holder);
        paginate(holder, candidates, 15, (team)=>{
          const row = createEl('div','team-row clickable');
          const members = createEl('div','members');
          team.members.forEach((m, mi)=> appendMemberCell(members, m, team, mi, anchors.has(m) ? 'owned' : null));
          row.appendChild(members);
          row.appendChild(createEl('div','team-dps', fmtDps(team.dps)));
          row.addEventListener('click',()=>{
            state.selections[idx] = pack(team);
            saveSelections();
            renderSlots();
            closeTeamPicker();
          });
          return row;
        });
      }

      renderFilters(filterHost, 'picker');
      pickerRefresh = refreshRoster;
      refreshRoster();
      renderList();
      modal.hidden = false;
      modal.querySelector('.close-btn')?.focus();
    }

    function closeTeamPicker(){
      document.getElementById('team-picker-modal').hidden = true;
    }

    renderSlots();
    content.appendChild(wrap);
  }

  function renderTier(){
    viewControls().innerHTML = '';
    const owned = getOwned();
    const mode = parseInt(modeEl.value||'1',10);
    const content = document.getElementById('view-content');
    content.innerHTML = '';

    const toggleWrap = createEl('div','best-teams-toggle');

    const displayLabel = createEl('label', 'toggle-label');
    displayLabel.textContent = T('tier.show','Show: ');
    const displaySelect = createEl('select','side-input toggle-select');
    displaySelect.id = 'tier-display-mode';
    const optNotOwned = createEl('option');
    optNotOwned.value = 'not-owned';
    optNotOwned.textContent = T('tier.notOwned','Not owned');
    const optAll = createEl('option');
    optAll.value = 'all';
    optAll.textContent = T('tier.allCharacters','All characters');
    const optOwned = createEl('option');
    optOwned.value = 'owned';
    optOwned.textContent = T('tier.ownedOnly','Owned only');
    displaySelect.appendChild(optNotOwned);
    displaySelect.appendChild(optAll);
    displaySelect.appendChild(optOwned);
    try{
      const savedDisplayMode = localStorage.getItem('tierDisplayMode');
      if(savedDisplayMode) displaySelect.value = savedDisplayMode;
    }catch{}

    displaySelect.addEventListener('change', ()=>{
      try{ localStorage.setItem('tierDisplayMode', displaySelect.value); }catch{}
      renderTier();
    });

    displayLabel.appendChild(displaySelect);
    toggleWrap.appendChild(displayLabel);

    const label = createEl('label', 'toggle-label');
    label.textContent = T('tier.sorting','Sorting: ');
    const select = createEl('select','side-input toggle-select');
    select.id = 'tier-sort-mode';
    const optBest = createEl('option');
    optBest.value = 'best';
    optBest.textContent = T('tier.bestDps','Best DPS');
    const optAvg = createEl('option');
    optAvg.value = 'average';
    optAvg.textContent = T('tier.moreFlexible','More flexible');
    select.appendChild(optBest);
    select.appendChild(optAvg);
    try{
      const savedMode = localStorage.getItem('tierSortMode');
      if(savedMode) select.value = savedMode;
    }catch{}

    select.addEventListener('change', ()=>{
      try{ localStorage.setItem('tierSortMode', select.value); }catch{}
      renderTier();
    });

    label.appendChild(select);
    toggleWrap.appendChild(label);
    viewControls().appendChild(toggleWrap);

    const filtersDiv = createEl('div','filter-bar');
    filtersDiv.setAttribute('aria-label', T('filters.currentView','Filter current view'));
    viewControls().appendChild(filtersDiv);
    renderFilters(filtersDiv, 'main');

    const sortMode = select.value || 'best';
    const displayMode = displaySelect.value || 'not-owned';
    const pred = makeFilterPredicate('main');
    const tierData = buildTierlist(names, parsedTeams, teamsByMember, owned, mode, sortMode, displayMode).filter(item=> pred(item.name));

    const wrap = createEl('div');
    const area = createEl('div'); area.id = 'tierlist'; area.className = 'tier-grid';
    wrap.appendChild(area);
    content.appendChild(wrap);
    renderTierlist(tierData, owned);
  }

  function renderBestTeams(){
    viewControls().innerHTML = '';
    const owned = getOwned();
    const mode = parseInt(modeEl.value||'1',10);
    const content = document.getElementById('view-content');
    content.innerHTML = '';

    const toggleWrap = createEl('div','best-teams-toggle');
    const label = createEl('label', 'toggle-label');
    label.textContent = T('tier.show','Show: ');
    const select = createEl('select','side-input toggle-select');
    select.id = 'best-teams-mode';
    const optAll = createEl('option');
    optAll.value = 'all';
    optAll.textContent = T('tier.allTeams','All Teams');
    const optAvailable = createEl('option');
    optAvailable.value = 'available';
    optAvailable.textContent = T('tier.availableTeams','Available Teams');
    select.appendChild(optAll);
    select.appendChild(optAvailable);
    try{
      const savedMode = localStorage.getItem('bestTeamsMode');
      if(savedMode) select.value = savedMode;
    }catch{}

    select.addEventListener('change', ()=>{
      try{ localStorage.setItem('bestTeamsMode', select.value); }catch{}
      renderBestTeams();
    });

    label.appendChild(select);
    toggleWrap.appendChild(label);
    viewControls().appendChild(toggleWrap);

    const filtersDiv = createEl('div','filter-bar');
    filtersDiv.setAttribute('aria-label', T('filters.byElementWeapon','Filter teams by element and weapon'));
    viewControls().appendChild(filtersDiv);
    renderFilters(filtersDiv, 'bestTeams');

    const wrap = createEl('div');
    const list = createEl('div');
    list.id = 'best-teams-list';
    wrap.appendChild(list);
    content.appendChild(wrap);

    const showMode = select.value || 'all';
    renderBestTeamsList(showMode, mode);
  }

  function renderBestTeamsList(showMode, mode){
    const container = document.getElementById('best-teams-list');
    if(!container) return;
    container.innerHTML = '';

    const owned = getOwned();
    const elementsFilter = filterState.bestTeams.elements;
    const weaponsFilter = filterState.bestTeams.weapons;
    const hasElementFilter = elementsFilter.size > 0;
    const hasWeaponFilter = weaponsFilter.size > 0;

    // «Все отряды» — вся база на стандартных созвездиях, без оглядки на инвентарь.
    // Раньше обе опции резались настройкой «Готов получить», и при нуле «все»
    // совпадали с «доступными». «Доступные» — только то, что реально собирается:
    // ваши персонажи на ваших созвездиях и с вашим 5★ оружием.
    const source = showMode === 'available' ? strictTeams : baseTeams;
    let allTeams = source.map(t => {
      const missingCount = t.members.filter(m => !owned.has(m)).length;
      return {
        members: t.members,
        dps: t.dps,
        build: t.build, src: t.src, sims: t.sims,
        kqmCons: t.kqmCons, kqmArt: t.kqmArt,
        teamIndex: t.teamIndex, buildIndex: t.buildIndex,
        missingCount
      };
    });

    if(showMode === 'available'){
      allTeams = allTeams.filter(team => {
        return team.members.every(m => owned.has(m));
      });
    }

    if(hasElementFilter){
      allTeams = allTeams.filter(team => {
        const teamElements = new Set();
        for(const m of team.members){
          const key = m;
          const entry = names[key];
          const element = (entry && entry.element) ? String(entry.element).toLowerCase() : '';
          if(element) teamElements.add(element);
        }
        for(const reqElement of elementsFilter){
          if(!teamElements.has(reqElement)) return false;
        }
        return true;
      });
    }

    if(hasWeaponFilter){
      allTeams = allTeams.filter(team => {
        const teamWeapons = new Set();
        for(const m of team.members){
          const key = m;
          const entry = names[key];
          const weapon = (entry && entry.weapon) ? String(entry.weapon).toLowerCase() : '';
          if(weapon) teamWeapons.add(weapon);
        }
        for(const reqWeapon of weaponsFilter){
          if(!teamWeapons.has(reqWeapon)) return false;
        }
        return true;
      });
    }

    allTeams.sort((a, b) => b.dps - a.dps);
    if(allTeams.length === 0){
      container.appendChild(createEl('div','small',T('views.noTeamsFiltered','No teams found matching the current filters.')));
      return;
    }

    container.appendChild(createEl('div','small muted',T('views.showingTop','Showing top '+allTeams.length+' team(s) by DPS',{n:allTeams.length})));
    // в режиме «все отряды» рамкой подсвечиваем тех, кого у игрока нет
    const markOwned = showMode === 'all' ? owned : null;
    paginate(container, allTeams, 25, (team)=> buildTeamRow(team, markOwned, 'best-team-row'));
  }

  function renderActiveView(){
    const hash = location.hash || '#recommendations';
    setActiveLink(hash);
    viewControls().innerHTML = '';
    // «Инвентарь» рисует js/inventory.js в своей секции — здесь ничего не делаем,
    // иначе в скрытый #view-content зря уедут рекомендации.
    if(hash === '#inventory') return;
    if(hash === '#tierlist'){
      renderTier();
    } else if(hash === '#team-builder'){
      renderTeamBuilder();
    } else if(hash === '#best-teams'){
      renderBestTeams();
    } else {
      renderRecommendations();
    }
  }

  window.addEventListener('hashchange', renderActiveView);
  if(!location.hash) location.hash = '#recommendations';
  renderActiveView();

  const updatesBtn = document.getElementById('open-updates');
  const updatesModal = document.getElementById('updates-modal');
  const updatesClose = document.getElementById('close-updates');
  const updatesContent = document.getElementById('updates-content');
  async function openUpdates(){
    updatesModal.hidden = false;
    updatesModal.querySelector('.close-btn')?.focus();
    try{
      // перевод списка обновлений лежит отдельным файлом на язык;
      // если его нет — откатываемся на английский оригинал
      const lang = document.documentElement.lang || 'en';
      let text = null;
      if(lang !== 'en'){
        const loc = await fetch(`Updates.${lang}.md`);
        if(loc.ok) text = await loc.text();
      }
      if(text === null) text = await (await fetch('Updates.md')).text();
      updatesContent.innerHTML = renderMarkdownBasic(text);
    }catch(e){
      updatesContent.textContent = T('errors.loadUpdates','Failed to load updates.');
    }
  }
  function closeUpdates(){ updatesModal.hidden = true; }
  updatesBtn?.addEventListener('click', openUpdates);
  updatesClose?.addEventListener('click', closeUpdates);
  updatesModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeUpdates);

  const pickerModalEl = document.getElementById('team-picker-modal');
  pickerModalEl?.querySelector('.modal-backdrop')?.addEventListener('click', ()=>{ pickerModalEl.hidden = true; });
  document.getElementById('team-picker-close')?.addEventListener('click', ()=>{ pickerModalEl.hidden = true; });

  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      for(const m of document.querySelectorAll('.modal:not([hidden])')) m.hidden = true;
    }
  });

  // Перерисовка пересобирает DOM целиком, из-за чего страница и список персонажей
  // прыгали наверх (особенно заметно при смене языка). Запоминаем позиции и
  // возвращаем их в том же кадре, чтобы перерисовка была незаметной.
  function keepScroll(fn){
    const page = window.scrollY;
    const roster = charactersDiv ? charactersDiv.scrollTop : 0;
    fn();
    if(charactersDiv) charactersDiv.scrollTop = roster;
    window.scrollTo({top: page, behavior: 'instant'});
  }

  return {
    // новый список отрядов (сменился инвентарь или настройки фильтра)
    refreshTeams(list, strictList, baseList){
      keepScroll(()=>{
        rebuildTeams(list, strictList, baseList);
        renderOwnedCharacters();
        renderActiveView();
      });
    },
    rerender(){
      keepScroll(()=>{
        // чипы фильтра в «Ваших персонажах» рисуются один раз при старте —
        // при смене языка их тоже нужно пересобрать, иначе подписи остаются старыми
        renderFilters(ownedFiltersHost, 'owned');
        renderOwnedCharacters();
        renderActiveView();
      });
    },
  };
}

function fmtDps(n){
  return Math.round(n||0).toLocaleString('en-US').replace(/,/g,' ');
}

function computeSuggestions(parsedTeams, ownedDisplaySet, mode){
  const byMissingSet = new Map();
  for(const s of parsedTeams){
    const missing = [];
    for(const m of s.members){
      if(!ownedDisplaySet.has(m)) missing.push(m);
    }
    if(missing.length > 0 && missing.length <= mode){
      const sortedMissing = missing.slice().sort();
      const key = sortedMissing.join('||');
      const list = byMissingSet.get(key) || {missing: sortedMissing, teams: []};
      list.teams.push({members: s.members, dps: s.dps, build: s.build, src: s.src, sims: s.sims, kqmCons: s.kqmCons, kqmArt: s.kqmArt, teamIndex: s.teamIndex, buildIndex: s.buildIndex});
      byMissingSet.set(key, list);
    }
  }

  const results = [];
  for(const [key, obj] of byMissingSet.entries()){
  const list = obj.teams.slice().sort((a,b)=>b.dps - a.dps);
  const top3 = list.slice(0,3);
  const dpsVals = top3.map(x=>x.dps).sort((a,b)=>a-b);
    let median = 0;
    if(dpsVals.length>0){
      const mid = Math.floor(dpsVals.length/2);
      median = (dpsVals.length%2===1) ? dpsVals[mid] : (dpsVals[mid-1]+dpsVals[mid])/2;
    }
    results.push({
      missing: obj.missing,
      count: obj.teams.length,
      median,
      topteams: list            // все отряды набора — окно покажет их страницами
    });
  }

  results.sort((a,b)=>{ if(b.median!==a.median) return b.median - a.median; return b.count - a.count; });
  return results;
}

// Рекомендаций бывает несколько сотен, и каждая тянет за собой четыре портрета
// с иконками сборки. Рисуем страницами, остальное — по кнопке.
const SUGGESTION_PAGE = 25;

function renderSuggestions(list, owned){
  const container = document.getElementById('suggestions');
  container.innerHTML = '';
  if(list.length === 0){
    container.appendChild(createEl('div','small',T('views.emptyRecommendations','No recommendations: either too few characters are selected or no teams fit the current rules.')));
    return;
  }
  function buildCard(item){
    const card = createEl('div','squad clickable');
    const left = createEl('div','left');
    const group = createEl('div','missing-group');
    for(const missingName of item.missing){
      const img = createAvatarImg(missingName,'avatar-sm');
      if(img) group.appendChild(img);
      group.appendChild(createEl('div','pill',charLabel(missingName)));
    }
    left.appendChild(group);
    left.appendChild(createEl('div','small',T('views.teamsMatchSet',item.count+' team(s) match this set',{n:item.count})));

    const right = createEl('div','right');
    const medianBadge = createEl('div','dps-badge', T('views.medianDps','Median DPS: '+fmtDps(item.median),{value:fmtDps(item.median)}));
    right.appendChild(medianBadge);

    if(item.topteams && item.topteams.length){
      const best = item.topteams[0];
      const preview = createEl('div','team-row preview');
      const members = createEl('div','members');
      best.members.forEach((m, mi)=>{
        appendMemberCell(members, m, best, mi,
          item.missing.includes(m) ? 'missing' : 'owned');
      });
      preview.appendChild(members);
      const dpsEl = createEl('div','team-dps', fmtDps(best.dps));
      preview.appendChild(dpsEl);
      right.appendChild(preview);
    }

    card.appendChild(left);
    card.appendChild(right);
    card.addEventListener('click',()=> openCharacterWindow({
      chars: item.missing,
      teams: item.topteams || [],
      names: NAMES,
      teamRow: (team)=> buildTeamRow(team, owned),
    }));
    return card;
  }

  paginate(container, list, SUGGESTION_PAGE, buildCard);
}

function buildTierlist(names, parsedTeams, teamsByMember, ownedDisplaySet, mode=1, sortMode='best', displayMode='not-owned'){
  const results = [];
  const allKeys = Object.keys(names);

  let globalDpsThreshold = 0;
  if(sortMode === 'average'){
    const allDps = parsedTeams.map(t => t.dps).sort((a,b) => a - b);
    globalDpsThreshold = allDps[Math.floor(allDps.length * 0.5)] || 0;
  }

  for(const disp of allKeys){
    const isOwned = ownedDisplaySet && ownedDisplaySet.has(disp);
    const candidates = [];
    for(const s of (teamsByMember.get(disp) || [])){
      const others = s.members.filter(m=>m!==disp);
      let ownedCount = 0; for(const o of others) if(ownedDisplaySet.has(o)) ownedCount++;
      const missingOthers = others.length - ownedCount;
      const totalMissing = isOwned ? missingOthers : (1 + missingOthers);
      if(totalMissing <= mode){
        candidates.push({members: s.members, dps: s.dps, build: s.build, src: s.src, sims: s.sims, kqmCons: s.kqmCons, kqmArt: s.kqmArt, teamIndex: s.teamIndex, buildIndex: s.buildIndex, ownedCount});
      }
    }
    if(candidates.length===0){ continue; }
    candidates.sort((a,b)=> b.dps - a.dps);

    let showteams = [];
    let score = 0;
    if(sortMode === 'average'){
      const viableTeams = candidates.filter(c => c.dps >= globalDpsThreshold);
      if(viableTeams.length === 0){
        score = 0;
        showteams = [];
      } else {
        const uniqueTeams = [];
        const seenMembers = new Set();
        for(const cand of viableTeams){
          const candOthers = cand.members.filter(m => m !== disp);
          const newMembers = candOthers.filter(m => !seenMembers.has(m));
          const isUnique = uniqueTeams.length === 0 || newMembers.length >= 2;
          if(isUnique){
            uniqueTeams.push(cand);
            for(const m of candOthers) seenMembers.add(m);
          }
        }
        const bestDps = uniqueTeams[0]?.dps || 0;
        const flexBonus = 1 + 0.05 * (uniqueTeams.length - 1);
        score = bestDps * flexBonus;
        showteams = uniqueTeams;
      }
    } else {
      score = candidates[0]?.dps || 0;
      showteams = candidates;
    }
    results.push({name:disp, score: score, teams: showteams, isOwned});
  }
  results.sort((a,b)=>b.score - a.score);
  const N = results.length;
  const tiers = ['ss','s','A','B','C','D'];
  const k = tiers.length;
  // -2.5,-1.5,-0.5,0.5,1.5,2.5
  const centers = [];
  const start = -(k/2) + 0.5;
  for(let i=0;i<k;i++) centers.push(start + i);
  const pdf = x => Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI);
  let weights = centers.map(c=>pdf(c));
  const edgeBoost = 0.06;
  if(weights.length>0){ weights[0] += edgeBoost; weights[weights.length-1] += edgeBoost; }
  const sumW = weights.reduce((s,w)=>s+w,0) || 1;
  weights = weights.map(w=>w/sumW);
  let counts = weights.map(w=>Math.floor(w * N));
  let assigned = counts.reduce((s,c)=>s+c,0);
  const fracs = weights.map((w,i)=>({i, frac: (w*N) - Math.floor(w*N)}));
  fracs.sort((a,b)=>b.frac - a.frac);
  let rem = N - assigned;
  let idx = 0;
  while(rem>0 && idx<fracs.length){ counts[fracs[idx].i]++; rem--; idx++; }
  for(let j=0; rem>0; j=(j+1)%k){ counts[j]++; rem--; }
  const tiered = [];
  let pos = 0;
  for(let t=0;t<k;t++){
    const cnt = counts[t];
    for(let j=0;j<cnt && pos<N;j++,pos++){
      const r = results[pos];
      tiered.push({name: r.name, score: r.score, teams: r.teams, tier: tiers[t], isOwned: r.isOwned});
    }
  }
  for(; pos<N; pos++){ const r = results[pos]; tiered.push({name: r.name, score: r.score, teams: r.teams, tier: tiers[k-1], isOwned: r.isOwned}); }
  if(displayMode === 'not-owned') return tiered.filter(item=> !item.isOwned);
  if(displayMode === 'owned') return tiered.filter(item=> item.isOwned);
  return tiered;
}

function renderTierlist(tierData, ownedSet){
  const container = document.getElementById('tierlist');
  container.innerHTML = '';
  const tiersOrder = ['ss','s','A','B','C','D'];
  const grouped = {};
  for(const t of tiersOrder) grouped[t]=[];
  for(const item of tierData) grouped[item.tier].push(item);

  const table = createEl('table','tier-table');
  const anyMembers = tierData && tierData.length>0;
  if(!anyMembers){
    container.appendChild(createEl('div','small',T('views.emptyTierlist','Tier list is empty: no characters have teams that include any of your selected characters.')));
    return;
  }
  for(const t of tiersOrder){
    const row = document.createElement('tr'); row.className = 'tier-row';
  const labelTd = document.createElement('td'); labelTd.className = 'tier-label';
  const badge = createEl('img','tier-badge'); badge.src = `tiers/${t}.png`;
  labelTd.appendChild(badge);
    row.appendChild(labelTd);

    const membersTd = document.createElement('td'); membersTd.className = 'tier-members';
    for(const member of grouped[t]){
      const key = member.name;   // в тир-листе name хранит ключ персонажа
      const chip = createEl('div','tier-member');
      const avatar = createAvatarImg(key,'avatar');
      if(avatar) chip.appendChild(avatar);
      chip.appendChild(createEl('div','pill',charLabel(member.name)));
      chip.addEventListener('click', ()=> openCharacterWindow({
        chars: [key],
        teams: member.teams || [],
        names: NAMES,
        teamRow: (team)=> buildTeamRow(team, ownedSet),
      }));
      membersTd.appendChild(chip);
    }
    row.appendChild(membersTd);
    table.appendChild(row);
  }
  container.appendChild(table);
}
function createAvatarImg(key, cls){
  const img = new Image();
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = `characters/${String(key).toLowerCase()}.png`;
  img.className = cls;
  img.alt = charLabel(key);
  img.onerror = ()=>{ img.style.display = 'none'; };
  // Общий бейдж «C1» на персонаже убран: созвездие теперь показывается у каждой
  // сборки отдельно, из её собственных данных, и не висит там, где неуместен.
  return img;
}

// ------------------------------------------------ Бездна и Натиск в сборщике
// Данные — data/content.json (собирает build_content.py с вики). Файла может
// не быть: тогда слоты просто без подсказок о врагах.

const isRu = ()=> lang() === 'ru';

function fmtDay(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if(isNaN(d)) return iso;
  return d.toLocaleDateString(isRu() ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' });
}

function cycleMeta(info){
  const box = createEl('div','builder-cycle');
  const today = new Date().toISOString().slice(0,10);
  if(info.end && info.end < today){
    box.classList.add('is-stale');
    box.appendChild(createEl('span',null, T('builder.cycleOver','The cycle ended on {end}; the data will refresh with the next site update',{end: fmtDay(info.end)})));
  } else {
    box.appendChild(createEl('span',null, T('builder.cycle','{start} – {end}',{start: fmtDay(info.start), end: fmtDay(info.end)})));
  }
  if(info.source){
    const a = createEl('a','builder-source', T('builder.source','Wiki'));
    a.href = info.source; a.target = '_blank'; a.rel = 'noopener';
    box.appendChild(a);
  }
  return box;
}

function enemyChip(enemies, ref, big){
  const e = enemies[ref.id] || { en: ref.id, ru: ref.id };
  const chip = createEl('span','enemy-chip' + (big ? ' is-big' : ''));
  if(e.icon){
    const img = new Image();
    img.loading = 'lazy'; img.decoding = 'async';
    img.src = e.icon; img.alt = '';
    img.onerror = ()=>{ img.style.visibility = 'hidden'; };
    chip.appendChild(img);
  }
  const text = createEl('span','enemy-text');
  text.appendChild(createEl('span','enemy-name', isRu() ? e.ru : e.en));
  // по-английски «Battle-Hardened» уже в названии, по-русски — отдельной меткой
  if(e.legend && isRu()) text.appendChild(createEl('span','enemy-legend', T('builder.legend','Local Legend')));
  chip.appendChild(text);
  if(ref.count > 1) chip.appendChild(createEl('span','enemy-count', `×${ref.count}`));
  return chip;
}

function disorderLine(items){
  if(!items || !items.length) return null;
  const line = createEl('div','ctx-disorder');
  line.appendChild(createEl('span','ctx-disorder-label', T('builder.disorder','Ley Line Disorder')));
  line.appendChild(createEl('span',null, items.map(d => isRu() ? d.ru : d.en).join('; ')));
  return line;
}

/** Сопротивления врага, отличные от обычных 10%: выше — красным (стихию лучше
 *  не нести), ниже — зелёным (уязвим). */
function resChips(res){
  const entries = Object.entries(res || {});
  if(!entries.length) return null;
  const wrap = createEl('div','enemy-res');
  wrap.title = T('builder.resTitle','RES');
  for(const [el, v] of entries){
    const high = v === 'immune' || v > 10;
    const chip = createEl('span','res-chip ' + (high ? 'is-high' : 'is-low'));
    if(el === 'phys') chip.appendChild(createEl('span','res-phys', T('builder.phys','Phys.')));
    else chip.appendChild(elementIcon(el));
    chip.appendChild(createEl('span', null, v === 'immune' ? T('builder.immune','immune') : `${v}%`));
    wrap.appendChild(chip);
  }
  return wrap;
}

/** Карточка врага в зале: иконка, имя, количество, сопротивления. Если у врага
 *  есть официальная подсказка из игры — карточка раскрывает её по клику. */
function enemyTile(enemies, ref){
  const e = enemies[ref.id] || { en: ref.id, ru: ref.id };
  const tipText = e.tip ? (isRu() ? e.tip.ru : e.tip.en) : '';
  const wrap = createEl('div','enemy-item');
  const tile = createEl(tipText ? 'button' : 'div', 'enemy-tile' + (tipText ? ' has-tip' : ''));
  if(tipText){ tile.type = 'button'; tile.setAttribute('aria-expanded','false'); }
  const pic = createEl('div','enemy-pic');
  if(e.icon){
    const img = new Image();
    img.loading = 'lazy'; img.decoding = 'async';
    img.src = e.icon; img.alt = '';
    img.onerror = ()=>{ img.style.visibility = 'hidden'; };
    pic.appendChild(img);
  }
  if(ref.count > 1) pic.appendChild(createEl('span','enemy-tile-count', `×${ref.count}`));
  tile.appendChild(pic);
  const body = createEl('div','enemy-tile-body');
  body.appendChild(createEl('div','enemy-tile-name', isRu() ? e.ru : e.en));
  if(e.legend && isRu()) body.appendChild(createEl('div','enemy-legend', T('builder.legend','Local Legend')));
  const res = resChips(e.res);
  if(res) body.appendChild(res);
  tile.appendChild(body);
  if(tipText) tile.appendChild(createEl('span','enemy-tile-more','▾'));
  wrap.appendChild(tile);
  if(tipText){
    let tip = null;
    tile.addEventListener('click', ()=>{
      if(tip){ tip.remove(); tip = null; tile.setAttribute('aria-expanded','false'); wrap.classList.remove('is-open'); return; }
      tip = gameText(tipText, 'game-text enemy-tip');
      wrap.appendChild(tip);
      tile.setAttribute('aria-expanded','true');
      wrap.classList.add('is-open');
    });
  }
  return wrap;
}

/** Враги половины 12 этажа: залы колонками, внутри — волны по порядку. */
function abyssHalf(info, enemies, half){
  if(!info || !info.chambers) return null;
  const key = half === 0 ? 'first' : 'second';
  const box = createEl('div','slot-context');
  const grid = createEl('div','abyss-grid');
  for(const ch of info.chambers){
    const waves = ch[key] || [];
    if(!waves.length) continue;
    const room = createEl('section','abyss-room');
    const head = createEl('div','abyss-room-head');
    head.appendChild(createEl('span','abyss-room-name', `${info.floor || 12}-${ch.n}`));
    if(ch.level) head.appendChild(createEl('span','abyss-room-level', T('builder.level','Lv. {n}',{n: ch.level})));
    room.appendChild(head);
    waves.forEach((wave, wi)=>{
      if(wi > 0) room.appendChild(createEl('div','abyss-then', T('builder.then','then')));
      const w = createEl('div','abyss-wave');
      for(const ref of wave) w.appendChild(enemyTile(enemies, ref));
      room.appendChild(w);
    });
    grid.appendChild(room);
  }
  box.appendChild(grid);
  const dis = disorderLine([...((info.disorder || {}).all || []), ...((info.disorder || {})[key] || [])]);
  if(dis) box.appendChild(dis);
  return box;
}

const elementIcon = (el)=>{
  const img = new Image();
  img.src = `filters/Element_${el.charAt(0).toUpperCase() + el.slice(1)}.png`;
  img.alt = T('element.' + el, el);
  img.title = img.alt;
  img.className = 'ctx-element';
  return img;
};

/** Босс поля боя в Натиске и его преимущества. По клику раскрываются уровни
 *  сложности из игровых данных: форма босса, механики и правила уровня. */
function onslaughtBoss(info, enemies, i){
  const boss = info && info.bosses && info.bosses[i];
  if(!boss) return null;
  const box = createEl('div','slot-context is-boss');
  const head = createEl('div','ctx-boss-head');
  head.appendChild(enemyChip(enemies, boss, true));
  if((boss.elements && boss.elements.length) || (boss.tags && boss.tags.length)){
    const adv = createEl('div','ctx-advantage');
    adv.appendChild(createEl('span','ctx-disorder-label', T('builder.advantage','Advantage')));
    for(const el of boss.elements || []) adv.appendChild(elementIcon(el));
    for(const tag of boss.tags || []) adv.appendChild(createEl('span','ctx-tag', isRu() ? tag.ru : tag.en));
    head.appendChild(adv);
  }
  box.appendChild(head);

  const details = info.details && info.details.difficulties;
  if(details && details.length){
    head.classList.add('is-toggle');
    head.setAttribute('role','button');
    head.tabIndex = 0;
    head.setAttribute('aria-expanded','false');
    head.appendChild(createEl('span','ctx-chevron','▾'));
    let panel = null;
    const toggle = ()=>{
      if(panel){
        onsPanels.delete(panel);
        panel.remove(); panel = null;
        head.setAttribute('aria-expanded','false');
        box.classList.remove('is-open');
        return;
      }
      panel = createEl('div','ons-details');
      panel._render = ()=> renderOnsDetails(panel, details, i);
      panel._render();
      onsPanels.add(panel);
      box.appendChild(panel);
      head.setAttribute('aria-expanded','true');
      box.classList.add('is-open');
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); } });
  }
  return box;
}

// Выбранная сложность общая для всех трёх полей боя и запоминается.
const ONS_KEY = 'girec.onsDifficulty';
let onsDifficulty = 6;
try{ const v = Number(localStorage.getItem(ONS_KEY)); if(v >= 1 && v <= 6) onsDifficulty = v; }catch{}
const onsPanels = new Set();

function setOnsDifficulty(n){
  onsDifficulty = n;
  try{ localStorage.setItem(ONS_KEY, String(n)); }catch{}
  for(const p of [...onsPanels]){
    if(p.isConnected) p._render(); else onsPanels.delete(p);
  }
}

/** Текст из игры: {hl}..{/hl} — выделение, {el:pyro} — иконка стихии,
 *  перенос строки — новый абзац. Собирается узлами, без innerHTML. */
function gameText(str, cls){
  const wrap = createEl('div', cls || 'game-text');
  for(const para of String(str || '').split('\n')){
    if(!para.trim()) continue;
    const p = createEl('p');
    let hl = false;
    for(const part of para.split(/(\{hl\}|\{\/hl\}|\{el:[a-z]+\})/)){
      if(!part) continue;
      if(part === '{hl}'){ hl = true; continue; }
      if(part === '{/hl}'){ hl = false; continue; }
      const el = part.match(/^\{el:([a-z]+)\}$/);
      if(el){ p.appendChild(elementIcon(el[1])); continue; }
      p.appendChild(hl ? createEl('span','game-hl', part) : document.createTextNode(part));
    }
    wrap.appendChild(p);
  }
  return wrap;
}

function renderOnsDetails(panel, details, i){
  panel.innerHTML = '';
  const pick = (x)=> x ? (isRu() ? x.ru : x.en) : '';
  const tabs = createEl('div','ons-tabs');
  for(const d of details){
    const b = createEl('button','ons-tab' + (d.id === onsDifficulty ? ' is-active' : ''), pick(d.name) || String(d.id));
    b.type = 'button';
    b.addEventListener('click', (e)=>{ e.stopPropagation(); setOnsDifficulty(d.id); });
    tabs.appendChild(b);
  }
  panel.appendChild(tabs);

  const d = details.find(x => x.id === onsDifficulty) || details[details.length - 1];
  const boss = d.bosses && d.bosses[i];
  if(!boss) return;

  const meta = createEl('div','ons-meta');
  if(boss.form) meta.appendChild(createEl('span','ons-form', pick(boss.form)));
  const facts = [];
  if(d.level) facts.push(T('builder.level','Lv. {n}',{n: d.level}));
  if(d.timeLimit) facts.push(T('builder.timeLimit','{n} s',{n: d.timeLimit}));
  if(facts.length) meta.appendChild(createEl('span','ons-facts', facts.join(' · ')));
  panel.appendChild(meta);

  if(boss.advantage){
    const adv = createEl('div','ons-adv');
    adv.appendChild(createEl('span','ctx-disorder-label', T('builder.advantage','Advantage')));
    adv.appendChild(gameText(pick(boss.advantage), 'game-text is-inline'));
    panel.appendChild(adv);
  }
  for(const m of boss.mechanics || []){
    const block = createEl('div','ons-mech');
    block.appendChild(createEl('div','ons-mech-title', pick(m.title)));
    block.appendChild(gameText(pick(m.text)));
    panel.appendChild(block);
  }
  if(d.rules && d.rules.length){
    const rules = createEl('div','ons-rules');
    rules.appendChild(createEl('div','ctx-disorder-label', T('builder.rules','Difficulty rules')));
    for(const r of d.rules) rules.appendChild(gameText(pick(r)));
    panel.appendChild(rules);
  }
}


function renderMarkdownBasic(md){
  const lines = md.split(/\r?\n/);
  const out = [];
  let inList = false;
  for(const line of lines){
    if(/^\s*[-*]\s+/.test(line)){
      if(!inList){ out.push('<ul>'); inList = true; }
      const item = line.replace(/^\s*[-*]\s+/, '');
      out.push(`<li>${inlineMd(item)}</li>`);
      continue;
    } else if(inList){ out.push('</ul>'); inList = false; }
    const h = line.match(/^(#+)\s+(.*)$/);
    if(h){ const level = Math.min(h[1].length,3); out.push(`<h${level}>${escapeHtml(h[2])}</h${level}>`); continue; }
    if(line.trim().length===0){ out.push('<br/>'); continue; }
    out.push(`<p>${escapeHtml(line)}</p>`);
  }
  if(inList) out.push('</ul>');
  return out.join('\n');
}
function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Жирный текст в списке обновлений. Экранируем сначала, размечаем потом,
// поэтому разметка из самого файла в HTML не просочится.
function inlineMd(s){
  return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
