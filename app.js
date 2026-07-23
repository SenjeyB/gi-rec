async function loadJSON(path){
  try{
    const resp = await fetch(path);
    if(!resp.ok) throw new Error('Fetch failed');
    return await resp.json();
  }catch(e){
    console.error('Error loading',path,e);
    return null;
  }
}
function createEl(tag,cls,txt){
  const el = document.createElement(tag);
  if(cls) el.className = cls;
  if(txt !== undefined) el.textContent = txt;
  return el;
}

async function main(){
  const names = await loadJSON('names.json');
  const teams = await loadJSON('teams.json');
  if(!names || !teams){
    document.body.prepend(createEl('div','small','Failed to load data. Ensure `names.json` and `teams.json` are next to `index.html`.'))
    return;
  }

  const keyByDisplay = {};
  for(const k of Object.keys(names)){
    const entry = names[k];
    const disp = (entry && typeof entry === 'object') ? entry.name : entry;
    keyByDisplay[disp] = k;
  }

  CONS_BY_DISPLAY = {};
  for(const entry of Object.values(names)){
    if(entry && typeof entry === 'object' && entry.cons){
      CONS_BY_DISPLAY[entry.name] = entry.cons;
    }
  }

  const parsedTeams = teams.map(t => ({
    members: [t.character_1, t.character_2, t.character_3, t.character_4].map(normalizeName),
    dps: t.DPS || 0
  }));
  const teamsByMember = new Map();
  for(const pt of parsedTeams){
    for(const m of pt.members){
      if(!m) continue;
      if(!teamsByMember.has(m)) teamsByMember.set(m, []);
      teamsByMember.get(m).push(pt);
    }
  }

  const charactersDiv = document.getElementById('characters');
  const ownedFiltersHost = document.getElementById('owned-filters');
  const displayNames = Object.values(names).map(v=> (v && typeof v==='object')? v.name : v).sort((a,b)=>a.localeCompare(b,'en'));
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
        const label = e[0].toUpperCase()+e.slice(1);
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
        const label = w[0].toUpperCase()+w.slice(1);
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
    return (disp)=>{
      const key = keyByDisplay[disp];
      const entry = names[key];
      const e = (entry && entry.element)? String(entry.element).toLowerCase():'';
      const w = (entry && entry.weapon)? String(entry.weapon).toLowerCase():'';
      const okEl = !elActive || els.has(e);
      const okW = !wActive || ws.has(w);
      return okEl && okW;
    };
  }

  function hasTeams(displayName){
    return teamsByMember.has(displayName);
  }

  function getDefaultAutoSelect(){
    const chars = [];
    for(const [key, entry] of Object.entries(names)){
      const disp = (entry && typeof entry === 'object') ? entry.name : entry;
      const stars = (entry && entry.stars) ? entry.stars : null;
      if(stars === 1 && hasTeams(disp)){
        chars.push(disp);
      }
    }
    return chars;
  }

  try{
    const saved = JSON.parse(localStorage.getItem('ownedSelection')||'[]');
    const defaultAutoSelect = getDefaultAutoSelect();
    for(const n of (saved.length? saved : defaultAutoSelect)) selected.add(n);
  }catch{ 
    const defaultAutoSelect = getDefaultAutoSelect();
    for(const n of defaultAutoSelect) selected.add(n); 
  }

  function renderOwnedCharacters(){
    charactersDiv.innerHTML = '';
    const pred = makeFilterPredicate('owned');
    const q = (document.getElementById('char-search')?.value || '').trim().toLowerCase();
    for(const disp of displayNames){
      if(q && !disp.toLowerCase().includes(q)) continue;
      const btn = createEl('button','char');
      btn.type = 'button';
      const key = keyByDisplay[disp];
      const img = createAvatarImg(disp,'avatar', key);
      if(img) btn.appendChild(img); else btn.appendChild(createEl('div','pill',disp[0]));
      const lbl = createEl('div',null,disp);
      btn.appendChild(lbl);
      
      const noTeams = !hasTeams(disp);
      if(noTeams){
        btn.classList.add('no-teams');
        btn.disabled = true;
        btn.title = 'No teams available for this character';
      }
      
      if(selected.has(disp)) btn.classList.add('selected');
      if(!pred(disp)) btn.classList.add('dimmed');
      
      if(!noTeams){
        btn.addEventListener('click',()=>{
          if(btn.classList.toggle('selected')) selected.add(disp); else selected.delete(disp);
          persistSelection();
          renderActiveView();
        });
      }
      charactersDiv.appendChild(btn);
    }
  }

  document.getElementById('char-search')?.addEventListener('input', ()=> renderOwnedCharacters());

  renderFilters(ownedFiltersHost, 'owned');
  renderOwnedCharacters();

  const modeEl = document.getElementById('mode');
  const maxShowEl = document.getElementById('maxShow');
  try{
    const savedMode = localStorage.getItem('settingMode'); if(savedMode) modeEl.value = savedMode;
    const savedMax = localStorage.getItem('settingMaxShow'); if(savedMax) maxShowEl.value = savedMax;
  }catch{}
  modeEl.addEventListener('change', ()=> { localStorage.setItem('settingMode', modeEl.value); renderActiveView(); });
  maxShowEl.addEventListener('change', ()=> { localStorage.setItem('settingMaxShow', maxShowEl.value); renderActiveView(); });
  
  function persistSelection(){
    try{ localStorage.setItem('ownedSelection', JSON.stringify([...selected])); }catch{}
  }

  function updateCharacterSelection(){
    renderOwnedCharacters();
    persistSelection();
    renderActiveView();
  }

  function getCharactersByStars(starsArray){
    const chars = [];
    for(const [key, entry] of Object.entries(names)){
      const disp = (entry && typeof entry === 'object') ? entry.name : entry;
      const stars = (entry && entry.stars) ? entry.stars : null;
      if(stars !== null && starsArray.includes(stars) && hasTeams(disp)){
        chars.push(disp);
      }
    }
    return chars;
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
    for(const disp of displayNames){
      if(hasTeams(disp)) selected.add(disp);
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

  function goodStatus(msg, ok){
    const el = document.getElementById('good-status'); if(!el) return; el.textContent = msg||''; el.style.color = ok? '#4caf50':'#ccc';
  }
  function normalizeGoodCharName(n){
    if(!n) return '';
    let s = String(n).trim();
    s = s.replace(/^Traveler\s*(?:\((Anemo|Geo|Electro|Dendro|Hydro|Pyro)\))?$/i,(m,el)=> el? `MC (${el.charAt(0).toUpperCase()+el.slice(1).toLowerCase()})` : 'MC (Anemo)');
    s = s.replace(/^Aether\s*(?:\((Anemo|Geo|Electro|Dendro|Hydro|Pyro)\))?$/i,(m,el)=> el? `MC (${el.charAt(0).toUpperCase()+el.slice(1).toLowerCase()})` : 'MC (Anemo)');
    s = s.replace(/^Lumine\s*(?:\((Anemo|Geo|Electro|Dendro|Hydro|Pyro)\))?$/i,(m,el)=> el? `MC (${el.charAt(0).toUpperCase()+el.slice(1).toLowerCase()})` : 'MC (Anemo)');
    const mapAlt = {
      'Kaedehara Kazuha':'Kaedehara Kazuha','Kamisato Ayaka':'Kamisato Ayaka','Kamisato Ayato':'Kamisato Ayato','Kujou Sara':'Kujou Sara','Raiden Shogun':'Raiden Shogun','Sangonomiya Kokomi':'Sangonomiya Kokomi','Yae Miko':'Yae Miko','Yun Jin':'Yun Jin','Hu Tao':'Hu Tao'
    };
    if(mapAlt[s]) return mapAlt[s];
    return s;
  }
  function importGoodData(obj){
    if(!obj) return {added:0, removed:0, total: selected.size};
    goodConfigBackup = new Set(selected);
    const displaySet = new Set(Object.values(names).map(v=> (v && typeof v==='object')? v.name : v));
    const collapsedMap = (function(){
      const m = {};
      for(const disp of displaySet){
        const key = disp.toLowerCase().replace(/[^a-z0-9]+/g,'');
        if(!m[key]) m[key] = disp;
      }
      return m;
    })();
    const before = new Set(selected);
    const imported = new Set();
    function consider(raw){
      if(!raw) return;
      let d = normalizeGoodCharName(raw);
      if(displaySet.has(d)){ imported.add(d); return; }
      const collapsed = String(raw).toLowerCase().replace(/[^a-z0-9]+/g,'');
      if(collapsedMap[collapsed]) imported.add(collapsedMap[collapsed]);
    }
    if(Array.isArray(obj.characters)){
      for(const ch of obj.characters){
        if(!ch) continue;
        consider(ch.name || ch.key || ch.characterName || ch.displayName);
      }
    }
    if(obj.charactersByKey && typeof obj.charactersByKey==='object'){
      for(const k of Object.keys(obj.charactersByKey)){
        const ch = obj.charactersByKey[k];
        consider(ch?.name || k);
      }
    }
    if(Array.isArray(obj.avatarInfoList)){
      for(const ch of obj.avatarInfoList){
        consider(ch?.name || ch?.characterName || ch?.key);
      }
    }
    selected.clear();
    for(const v of imported) selected.add(v);
    goodConfigBackup = new Set(imported);
    const added = [...selected].filter(x=> !before.has(x)).length;
    const removed = [...before].filter(x=> !selected.has(x)).length;
    persistSelection();
    renderOwnedCharacters();
    renderActiveView();
    return {added, removed, total: selected.size};
  }
  async function handleGoodText(text){
    if(!text || !text.trim().length){ goodStatus('Empty input'); return; }
    try{
      const obj = JSON.parse(text);
      const res = importGoodData(obj);
      if(res.total===0){ goodStatus('No recognized characters'); return; }
      goodStatus(`Imported ${res.total} (added ${res.added}, removed ${res.removed})`, res.total>0);
    }catch(e){ goodStatus('Invalid JSON'); }
  }
  const openImport = document.getElementById('open-import');
  const importModal = document.getElementById('import-modal');
  const importClose = document.getElementById('import-close');
  const importFile = document.getElementById('good-file');
  const importText = document.getElementById('good-text');
  const importPasteBtn = document.getElementById('import-paste');
  const importClipboardBtn = document.getElementById('import-clipboard');
  function showImport(){ if(importModal){ importModal.hidden = false; importModal.querySelector('.close-btn')?.focus(); } }
  function hideImport(){ if(importModal) importModal.hidden = true; }
  openImport?.addEventListener('click', showImport);
  importClose?.addEventListener('click', hideImport);
  importModal?.querySelector('.modal-backdrop')?.addEventListener('click', hideImport);
  importFile?.addEventListener('change', ()=>{
    const f = importFile.files && importFile.files[0]; if(!f){ goodStatus('No file'); return; }
    const reader = new FileReader();
    reader.onload = ()=> handleGoodText(String(reader.result||''));
    reader.onerror = ()=> goodStatus('Read error');
    reader.readAsText(f);
  });
  importPasteBtn?.addEventListener('click', ()=>{ handleGoodText(importText?.value||''); });
  importClipboardBtn?.addEventListener('click', async ()=>{ try{ const txt = await navigator.clipboard.readText(); if(importText) importText.value = txt; await handleGoodText(txt); }catch{ goodStatus('Clipboard denied'); } });

  const navLinks = Array.from(document.querySelectorAll('.nav-link'));
  function setActiveLink(hash){
    navLinks.forEach(a=>{
      if(a.getAttribute('href') === hash) a.classList.add('active'); else a.classList.remove('active');
    });
  }
  function getOwned(){ return new Set([...selected]); }

  function renderRecommendations(){
    const owned = getOwned();
    const mode = parseInt(modeEl.value||'1',10);
    const maxShow = parseInt(maxShowEl.value||'3',10);
    const pred = makeFilterPredicate('main');
    const active = filterActive('main');
    const base = computeSuggestions(parsedTeams, owned, mode, maxShow);
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
    content.appendChild(createInlineHint());
    const filtersDiv = createEl('div','filter-bar');
    filtersDiv.setAttribute('aria-label', 'Filter current view');
    content.appendChild(filtersDiv);
    renderFilters(filtersDiv, 'main');
    const wrap = createEl('div');
    const list = createEl('div'); list.id = 'suggestions';
    wrap.appendChild(list);
    content.appendChild(wrap);
    renderSuggestions(suggestions, keyByDisplay, maxShow);
  }

  function renderTeamBuilder(){
    const owned = getOwned();
    const content = document.getElementById('view-content');
    content.innerHTML = '';
    content.appendChild(createInlineHint());
    const wrap = createEl('div');

    const toggleWrap = createEl('div','best-teams-toggle');
    const contentLabel = createEl('label','toggle-label');
    contentLabel.textContent = 'Content: ';
    const contentSelect = createEl('select','side-input toggle-select');
    contentSelect.id = 'builder-content-mode';
    const optAbyss = createEl('option'); optAbyss.value = 'abyss'; optAbyss.textContent = 'Spiral Abyss (2 teams)';
    const optOnslaught = createEl('option'); optOnslaught.value = 'onslaught'; optOnslaught.textContent = 'Stygian Onslaught (3 teams)';
    contentSelect.appendChild(optAbyss);
    contentSelect.appendChild(optOnslaught);
    try{
      const savedContent = localStorage.getItem('builderContent');
      if(savedContent) contentSelect.value = savedContent;
    }catch{}
    contentSelect.addEventListener('change', ()=>{
      try{ localStorage.setItem('builderContent', contentSelect.value); }catch{}
      renderTeamBuilder();
    });
    contentLabel.appendChild(contentSelect);
    toggleWrap.appendChild(contentLabel);
    wrap.appendChild(toggleWrap);

    const contentKey = contentSelect.value || 'abyss';
    const targetTeams = contentKey === 'onslaught' ? 3 : 2;

    function loadSelections(){
      try{
        const all = JSON.parse(localStorage.getItem('builderSelections')||'{}');
        const arr = Array.isArray(all[contentKey]) ? all[contentKey] : [];
        return Array(targetTeams).fill(null).map((_, i)=>{
          const s = arr[i];
          if(s && Array.isArray(s.members) && s.members.length === 4) return {members: s.members.map(String), dps: +s.dps || 0};
          return null;
        });
      }catch{ return Array(targetTeams).fill(null); }
    }
    function saveSelections(){
      try{
        const all = JSON.parse(localStorage.getItem('builderSelections')||'{}');
        all[contentKey] = state.selections;
        localStorage.setItem('builderSelections', JSON.stringify(all));
      }catch{}
    }

    const state = { selections: loadSelections() };

    const summaryBlocks = state.selections.map(()=> createEl('div'));
    summaryBlocks.forEach(b=> wrap.appendChild(b));

    const grid = createEl('div','two-col');
    wrap.appendChild(grid);

  const pickButtonsRow = createEl('div','tier-members pick-row');
    const pickButtons = [];
    for(let i=0;i<targetTeams;i++){
      const btn = createEl('button','small-btn big-btn', `Pick team #${i+1}`);
      btn.addEventListener('click', ()=> openTeamPicker(i));
      if(state.selections[i]) btn.style.display = 'none';
      pickButtons.push(btn);
      pickButtonsRow.appendChild(btn);
    }
  grid.appendChild(pickButtonsRow);

    function updatePickRowVisibility(){
      const anyVisible = pickButtons.some(b => b && b.style.display !== 'none');
      if(!anyVisible){
        if(pickButtonsRow.parentElement){ pickButtonsRow.parentElement.removeChild(pickButtonsRow); }
      } else if(!pickButtonsRow.parentElement){
        grid.appendChild(pickButtonsRow);
      }
    }

    function openTeamPicker(idx){
      const modal = document.getElementById('team-picker-modal');
      const roster = document.getElementById('team-picker-roster');
      const filterHost = document.getElementById('team-picker-filters');
      const list = document.getElementById('team-picker-list');
      const title = document.getElementById('team-picker-title');
      title.textContent = `Pick team #${idx+1}`;

      const used = new Set();
      for(let j=0;j<state.selections.length;j++){
        if(j===idx) continue;
        const sel = state.selections[j];
        if(sel?.members){ for(const m of sel.members) used.add(m); }
      }
      const availOwned = new Set([...owned].filter(n=> !used.has(n)));

      const baseCandidates = parsedTeams
        .filter(s=> s.members.every(m=> availOwned.has(m)))
        .slice()
        .sort((a,b)=> b.dps - a.dps);

      const anchors = new Set();

      function currentCandidates(){
        if(anchors.size === 0) return baseCandidates;
        return baseCandidates.filter(s=> [...anchors].every(a=> s.members.includes(a)));
      }

      function refreshRoster(){
        roster.innerHTML = '';
        const predPicker = makeFilterPredicate('picker');
        const cands = currentCandidates();
        const addable = new Set();
        if(anchors.size < 4){
          for(const s of cands){ for(const m of s.members) addable.add(m); }
        }
        for(const name of [...owned].sort((a,b)=>a.localeCompare(b,'en'))){
          const chip = createEl('div','tier-member');
          const inAnchor = anchors.has(name);
          const eligible = inAnchor || (!used.has(name) && addable.has(name));
          if(inAnchor) chip.classList.add('active');
          if(!eligible) chip.classList.add('disabled');
          if(!predPicker(name)) chip.classList.add('dimmed');
          const key = keyByDisplay[name];
          const avatar = createAvatarImg(name,'avatar', key); if(avatar) chip.appendChild(avatar);
          chip.appendChild(createEl('div','pill',name));
          if(eligible){
            chip.addEventListener('click',()=>{
              if(anchors.has(name)) anchors.delete(name); else anchors.add(name);
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
          const clearBtn = createEl('button','small-btn','Clear');
          clearBtn.type = 'button';
          clearBtn.addEventListener('click',()=>{ anchors.clear(); refreshRoster(); renderList(); });
          selHead.appendChild(clearBtn);
          list.appendChild(selHead);
          const selRow = createEl('div','picker-selected');
          for(const a of anchors){
            const chip = createEl('button','anchor-chip');
            chip.type = 'button';
            chip.title = 'Remove from selection';
            const img = createAvatarImg(a,'member-avatar', keyByDisplay[a]); if(img) chip.appendChild(img);
            chip.appendChild(createEl('span','member-pill',a));
            chip.appendChild(createEl('span','anchor-x','✕'));
            chip.addEventListener('click',()=>{ anchors.delete(a); refreshRoster(); renderList(); });
            selRow.appendChild(chip);
          }
          list.appendChild(selRow);
        }

        const candidates = currentCandidates();
        if(candidates.length===0){ list.appendChild(createEl('div','small','No teams available with this selection.')); return; }
        list.appendChild(createEl('div','small muted',`Showing ${Math.min(10,candidates.length)} of ${candidates.length} team(s) by DPS`));
        const top = candidates.slice(0, 10);
        for(const team of top){
          const row = createEl('div','team-row clickable');
          const members = createEl('div','members');
          for(const m of team.members){
            const mk = keyByDisplay[m];
            const img = createAvatarImg(m,'member-avatar', mk); if(img) members.appendChild(img);
            const pill = createEl('div','member-pill',m);
            if(anchors.has(m)) pill.classList.add('owned');
            members.appendChild(pill);
          }
          row.appendChild(members);
          row.appendChild(createEl('div','team-dps', fmtDps(team.dps)));
          row.addEventListener('click',()=>{
            state.selections[idx] = {members: team.members, dps: team.dps||0};
            saveSelections();
            renderSummaries();
            if(pickButtons[idx]) pickButtons[idx].style.display = 'none';
            updatePickRowVisibility();
            closeTeamPicker();
          });
          list.appendChild(row);
        }
      }

      renderFilters(filterHost, 'picker');
      pickerRefresh = refreshRoster;

      refreshRoster();
      renderList();
      modal.hidden = false;
      modal.querySelector('.close-btn')?.focus();
    }

    function closeTeamPicker(){
      const modal = document.getElementById('team-picker-modal');
      modal.hidden = true;
    }

    function renderSummaries(){
      for(let i=0;i<summaryBlocks.length;i++){
        const host = summaryBlocks[i];
        host.innerHTML = '';
        const sel = state.selections[i];
        if(!sel) continue;
        const card = createEl('div','summary-card');
        const head = createEl('div','summary-head');
        head.appendChild(createEl('h3',null,`Team #${i+1} selected`));
        const clearBtn = createEl('button','small-btn big-btn','Clear');
        clearBtn.addEventListener('click',()=>{ state.selections[i]=null; saveSelections(); renderSummaries(); if(pickButtons[i]) pickButtons[i].style.display=''; updatePickRowVisibility(); });
        head.appendChild(clearBtn);
        card.appendChild(head);
        const row = createEl('div','team-row');
        const members = createEl('div','members');
        for(const m of sel.members){
          const mk = keyByDisplay[m];
          const img = createAvatarImg(m,'member-avatar', mk); if(img) members.appendChild(img);
          members.appendChild(createEl('div','member-pill',m));
        }
        row.appendChild(members);
        row.appendChild(createEl('div','team-dps', fmtDps(sel.dps)));
        card.appendChild(row);
        host.appendChild(card);
      }
    }

    renderSummaries();
    content.appendChild(wrap);
  }

  function renderTier(){
    const owned = getOwned();
    const maxShow = parseInt(maxShowEl.value||'3',10);
    const mode = parseInt(modeEl.value||'1',10);
    const content = document.getElementById('view-content');
    content.innerHTML = '';
    content.appendChild(createInlineHint());

    const toggleWrap = createEl('div','best-teams-toggle');
    
    const displayLabel = createEl('label', 'toggle-label');
    displayLabel.textContent = 'Show: ';
    const displaySelect = createEl('select','side-input toggle-select');
    displaySelect.id = 'tier-display-mode';
    const optNotOwned = createEl('option');
    optNotOwned.value = 'not-owned';
    optNotOwned.textContent = 'Not owned';
    const optAll = createEl('option');
    optAll.value = 'all';
    optAll.textContent = 'All characters';
    const optOwned = createEl('option');
    optOwned.value = 'owned';
    optOwned.textContent = 'Owned only';
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
    label.textContent = 'Sorting: ';
    const select = createEl('select','side-input toggle-select');
    select.id = 'tier-sort-mode';
    const optBest = createEl('option');
    optBest.value = 'best';
    optBest.textContent = 'Best DPS';
    const optAvg = createEl('option');
    optAvg.value = 'average';
    optAvg.textContent = 'More flexible';
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
    content.appendChild(toggleWrap);

    const filtersDiv = createEl('div','filter-bar');
    filtersDiv.setAttribute('aria-label', 'Filter current view');
    content.appendChild(filtersDiv);
    renderFilters(filtersDiv, 'main');

    const sortMode = select.value || 'best';
    const displayMode = displaySelect.value || 'not-owned';
    const pred = makeFilterPredicate('main');
    const tierData = buildTierlist(names, parsedTeams, teamsByMember, owned, maxShow, mode, sortMode, displayMode).filter(item=> pred(item.name));

    const wrap = createEl('div');
    const area = createEl('div'); area.id = 'tierlist'; area.className = 'tier-grid';
    wrap.appendChild(area);
    content.appendChild(wrap);
    renderTierlist(tierData, keyByDisplay, maxShow, owned);
  }

  function renderBestTeams(){
    const owned = getOwned();
    const maxShow = parseInt(maxShowEl.value||'3',10);
    const mode = parseInt(modeEl.value||'1',10);
    const content = document.getElementById('view-content');
    content.innerHTML = '';
    content.appendChild(createInlineHint());

    const toggleWrap = createEl('div','best-teams-toggle');
    const label = createEl('label', 'toggle-label');
    label.textContent = 'Show: ';
    const select = createEl('select','side-input toggle-select');
    select.id = 'best-teams-mode';
    const optAll = createEl('option');
    optAll.value = 'all';
    optAll.textContent = 'All Teams';
    const optAvailable = createEl('option');
    optAvailable.value = 'available';
    optAvailable.textContent = 'Available Teams';
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
    content.appendChild(toggleWrap);

    const filtersDiv = createEl('div','filter-bar');
    filtersDiv.setAttribute('aria-label', 'Filter teams by element and weapon');
    content.appendChild(filtersDiv);
    renderFilters(filtersDiv, 'bestTeams');

    const wrap = createEl('div');
    const list = createEl('div'); 
    list.id = 'best-teams-list';
    wrap.appendChild(list);
    content.appendChild(wrap);

    const showMode = select.value || 'all';
    renderBestTeamsList(showMode, maxShow, mode);
  }

  function renderBestTeamsList(showMode, maxShow, mode){
    const container = document.getElementById('best-teams-list');
    if(!container) return;
    container.innerHTML = '';

    const owned = getOwned();
    const elementsFilter = filterState.bestTeams.elements;
    const weaponsFilter = filterState.bestTeams.weapons;
    const hasElementFilter = elementsFilter.size > 0;
    const hasWeaponFilter = weaponsFilter.size > 0;

    let allTeams = parsedTeams.map(t => {
      const missingCount = t.members.filter(m => !owned.has(m)).length;
      return {
        members: t.members,
        dps: t.dps,
        missingCount
      };
    });

    allTeams = allTeams.filter(team => team.missingCount <= mode);

    if(showMode === 'available'){
      allTeams = allTeams.filter(team => {
        return team.members.every(m => owned.has(m));
      });
    }

    if(hasElementFilter){
      allTeams = allTeams.filter(team => {
        const teamElements = new Set();
        for(const m of team.members){
          const key = keyByDisplay[m];
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
          const key = keyByDisplay[m];
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
    const topTeams = allTeams.slice(0, maxShow);

    if(topTeams.length === 0){
      container.appendChild(createEl('div','small','No teams found matching the current filters.'));
      return;
    }

    container.appendChild(createEl('div','small muted',`Showing top ${topTeams.length} team(s) by DPS`));

    for(const team of topTeams){
      const row = createEl('div','team-row best-team-row');
      const members = createEl('div','members');
      for(const m of team.members){
        const mk = keyByDisplay[m];
        const img = createAvatarImg(m,'member-avatar', mk); 
        if(img) members.appendChild(img);
        const pill = createEl('div','member-pill',m);
        if(showMode === 'all' && !owned.has(m)){
          pill.classList.add('missing');
        } else {
          pill.classList.add('owned');
        }
        members.appendChild(pill);
      }
      row.appendChild(members);
      const dpsEl = createEl('div','team-dps', fmtDps(team.dps));
      row.appendChild(dpsEl);
      container.appendChild(row);
    }
  }

  function renderActiveView(){
    const hash = location.hash || '#recommendations';
    setActiveLink(hash);
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
      const resp = await fetch('Updates.md');
      const text = await resp.text();
      updatesContent.innerHTML = renderMarkdownBasic(text);
    }catch(e){
      updatesContent.textContent = 'Failed to load updates.';
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
}

function normalizeName(name){
  return String(name).trim();
}

let CONS_BY_DISPLAY = {};

function fmtDps(n){
  return Math.round(n||0).toLocaleString('en-US').replace(/,/g,' ');
}

function computeSuggestions(parsedTeams, ownedDisplaySet, mode, maxShow=3){
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
      list.teams.push({members: s.members, dps: s.dps});
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
      topteams: list.slice(0, Math.max(1, Math.min(maxShow || 3, list.length)))
    });
  }

  results.sort((a,b)=>{ if(b.median!==a.median) return b.median - a.median; return b.count - a.count; });
  return results;
}

function renderSuggestions(list, keyByDisplay, maxShow){
  const container = document.getElementById('suggestions');
  container.innerHTML = '';
  if(list.length === 0){
    container.appendChild(createEl('div','small','No recommendations: either too few characters are selected or no teams fit the current rules.'));
    return;
  }
  for(const item of list){
    const card = createEl('div','squad clickable');
    const left = createEl('div','left');
    const group = createEl('div','missing-group');
    for(const missingName of item.missing){
      const key = keyByDisplay[missingName];
      const img = createAvatarImg(missingName,'avatar-sm', key);
      if(img) group.appendChild(img);
      group.appendChild(createEl('div','pill',missingName));
    }
    left.appendChild(group);
    left.appendChild(createEl('div','small',`${item.count} team(s) match this set`));

    const right = createEl('div','right');
    const medianBadge = createEl('div','dps-badge', `Median DPS: ${fmtDps(item.median)}`);
    right.appendChild(medianBadge);

    if(item.topteams && item.topteams.length){
      const best = item.topteams[0];
      const preview = createEl('div','team-row preview');
      const members = createEl('div','members');
      for(const m of best.members){
        const mk = keyByDisplay[m];
        const img = createAvatarImg(m,'member-avatar', mk); if(img) members.appendChild(img);
        const pill = createEl('div','member-pill', m);
        if(item.missing.includes(m)) pill.classList.add('missing'); else pill.classList.add('owned');
        members.appendChild(pill);
      }
      preview.appendChild(members);
      const dpsEl = createEl('div','team-dps', fmtDps(best.dps));
      preview.appendChild(dpsEl);
      right.appendChild(preview);
    }

    card.appendChild(left);
    card.appendChild(right);
    card.addEventListener('click',()=> togglePanel(card, item, keyByDisplay, null));
    container.appendChild(card);
  }
}

function buildTierlist(names, parsedTeams, teamsByMember, ownedDisplaySet, maxShow=3, mode=1, sortMode='best', displayMode='not-owned'){
  const results = [];
  const allDisplayNames = Object.values(names).map(v=> (v && typeof v==='object')? v.name : v);

  let globalDpsThreshold = 0;
  if(sortMode === 'average'){
    const allDps = parsedTeams.map(t => t.dps).sort((a,b) => a - b);
    globalDpsThreshold = allDps[Math.floor(allDps.length * 0.5)] || 0;
  }

  for(const disp of allDisplayNames){
    const isOwned = ownedDisplaySet && ownedDisplaySet.has(disp);
    const candidates = [];
    for(const s of (teamsByMember.get(disp) || [])){
      const others = s.members.filter(m=>m!==disp);
      let ownedCount = 0; for(const o of others) if(ownedDisplaySet.has(o)) ownedCount++;
      const missingOthers = others.length - ownedCount;
      const totalMissing = isOwned ? missingOthers : (1 + missingOthers);
      if(totalMissing <= mode){
        candidates.push({members: s.members, dps: s.dps, ownedCount});
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
        showteams = uniqueTeams.slice(0, Math.max(1, Math.min(maxShow, uniqueTeams.length)));
      }
    } else {
      score = candidates[0]?.dps || 0;
      showteams = candidates.slice(0, Math.max(1, Math.min(maxShow, candidates.length)));
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

function renderTierlist(tierData, keyByDisplay, maxShow, ownedSet){
  const container = document.getElementById('tierlist');
  container.innerHTML = '';
  const tiersOrder = ['ss','s','A','B','C','D'];
  const grouped = {};
  for(const t of tiersOrder) grouped[t]=[];
  for(const item of tierData) grouped[item.tier].push(item);

  const table = createEl('table','tier-table');
  const anyMembers = tierData && tierData.length>0;
  if(!anyMembers){
    container.appendChild(createEl('div','small','Tier list is empty: no characters have teams that include any of your selected characters.'));
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
      const key = keyByDisplay[member.name];
      const chip = createEl('div','tier-member');
      const avatar = createAvatarImg(member.name,'avatar', key);
      if(avatar) chip.appendChild(avatar);
      chip.appendChild(createEl('div','pill',member.name));
      chip.addEventListener('click', ()=> togglePanel(chip, {missing:[member.name], topteams:member.teams}, keyByDisplay, ownedSet));
      membersTd.appendChild(chip);
    }
    row.appendChild(membersTd);
    table.appendChild(row);
  }
  container.appendChild(table);
}
function togglePanel(card, item, keyByDisplay, ownedSet){
  const next = card.nextElementSibling;
  if(next && next.classList && next.classList.contains('panel')){
    next.remove();
    return;
  }
  const panel = createEl('div','panel');
  const title = createEl('div','small',`Best teams for: ${item.missing.join(', ')}`);
  panel.appendChild(title);
  if(!item.topteams || item.topteams.length===0){
    panel.appendChild(createEl('div','small','No top teams found.'));
  } else {
    for(const team of item.topteams){
      const row = createEl('div','team-row');
      const members = createEl('div','members');
      for(const m of team.members){
        const memberKey = findKeyForDisplay(m, keyByDisplay);
        const img = createAvatarImg(m,'member-avatar', memberKey);
        if(img) members.appendChild(img);
        const pill = createEl('div','member-pill',m);
        if(ownedSet && !ownedSet.has(m)) {
          pill.classList.add('missing');
        } else {
          pill.classList.add('owned');
        }
        members.appendChild(pill);
      }
      row.appendChild(members);
      const dpsEl = createEl('div','team-dps', fmtDps(team.dps));
      row.appendChild(dpsEl);
      panel.appendChild(row);
    }
  }
  card.insertAdjacentElement('afterend', panel);
}

function findKeyForDisplay(displayName, keyByDisplay){
  return keyByDisplay ? keyByDisplay[displayName] : null;
}

function sanitizeFileName(name){
  return name.toLowerCase().replace(/\s+/g,'').replace(/[^a-z0-9_\-]/g,'') + '.png';
}

function createAvatarImg(displayName, cls, key){
  const file = key ? (key.toLowerCase() + '.png') : sanitizeFileName(displayName);
  const img = new Image();
  img.src = `characters/${file}`;
  img.className = cls;
  img.onerror = ()=>{ img.style.display = 'none'; };
  const cons = CONS_BY_DISPLAY[displayName];
  if(cons){
    const wrap = createEl('span','avatar-wrap');
    wrap.appendChild(img);
    wrap.appendChild(createEl('span','cons-badge',`C${cons}`));
    return wrap;
  }
  return img;
}

window.addEventListener('DOMContentLoaded',main);

function createInlineHint(){
  const hintWrap = document.createElement('div');
  hintWrap.className = 'view-hint-inline';
  const hint = document.createElement('div');
  hint.className = 'small muted';
  hint.textContent = 'The list updates when you change selection or settings';
  hintWrap.appendChild(hint);
  return hintWrap;
}

function renderMarkdownBasic(md){
  const lines = md.split(/\r?\n/);
  const out = [];
  let inList = false;
  for(const line of lines){
    if(/^\s*[-*]\s+/.test(line)){
      if(!inList){ out.push('<ul>'); inList = true; }
      const item = line.replace(/^\s*[-*]\s+/, '');
      out.push(`<li>${escapeHtml(item)}</li>`);
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
