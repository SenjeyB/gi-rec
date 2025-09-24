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

  const charactersDiv = document.getElementById('characters');
  const ownedFiltersHost = document.getElementById('owned-filters');
  const mainFiltersHost = document.getElementById('main-filters');
  const displayNames = Object.values(names).map(v=> (v && typeof v==='object')? v.name : v).sort((a,b)=>a.localeCompare(b,'ru'));
  const selected = new Set();

  const defaultAutoSelect = [
    'Aino','Amber','Barbara','Collei','Kachina','Lynette',
    'MC (Anemo)','MC (Geo)','MC (Electro)','MC (Dendro)','MC (Hydro)','MC (Pyro)',
    'Noelle','Xiangling'
  ];
  try{
    const saved = JSON.parse(localStorage.getItem('ownedSelection')||'[]');
    for(const n of (saved.length? saved : defaultAutoSelect)) selected.add(n);
  }catch{ for(const n of defaultAutoSelect) selected.add(n); }

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
    picker: { weapons: new Set(), elements: new Set() }
  };

  function renderFilters(host, scope){
    if(!host) return;
    host.innerHTML = '';
    const mkChip = (group, key, label, iconSrc) => {
      const chip = createEl('div','filter-chip');
      const icon = new Image(); icon.src = iconSrc; icon.alt = key; icon.className = 'icon';
      chip.appendChild(icon);
      chip.appendChild(createEl('span',null,label));
      const set = filterState[scope][group];
      function sync(){ if(set.has(key)) chip.classList.add('selected'); else chip.classList.remove('selected'); }
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
    if(scope === 'main'){
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
    if(scope === 'picker'){
      const modal = document.getElementById('team-picker-modal');
      if(modal && !modal.hidden && typeof window.__pickerRefresh === 'function'){
        try{ window.__pickerRefresh(); }catch{}
      }
    }
  }

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

  function renderOwnedCharacters(){
    charactersDiv.innerHTML = '';
    const pred = makeFilterPredicate('owned');
    for(const disp of displayNames){
      const btn = createEl('button','char');
      btn.type = 'button';
      const key = keyByDisplay[disp];
      const img = createAvatarImg(disp,'avatar', key);
      if(img) btn.appendChild(img); else btn.appendChild(createEl('div','pill',disp[0]));
      const lbl = createEl('div',null,disp);
      btn.appendChild(lbl);
      if(selected.has(disp)) btn.classList.add('selected');
      if(!pred(disp)) btn.classList.add('dimmed');
      btn.addEventListener('click',()=>{
        if(btn.classList.toggle('selected')) selected.add(disp); else selected.delete(disp);
        persistSelection();
        renderActiveView();
      });
      charactersDiv.appendChild(btn);
    }
  }

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
  document.getElementById('clear').addEventListener('click',()=>{
    selected.clear();
    document.querySelectorAll('.char.selected').forEach(el=>el.classList.remove('selected'));
    persistSelection();
    renderActiveView();
  });
  function persistSelection(){
    try{ localStorage.setItem('ownedSelection', JSON.stringify([...selected])); }catch{}
  }

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
    const base = computeSuggestions(teams, owned, mode, maxShow);
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
    const wrap = createEl('div');
    const list = createEl('div'); list.id = 'suggestions';
    wrap.appendChild(list);
    content.appendChild(wrap);
    renderSuggestions(suggestions, keyByDisplay, maxShow);
  }

  function renderTeamSuggestions(){
    const owned = getOwned();
    const content = document.getElementById('view-content');
    content.innerHTML = '';
    content.appendChild(createInlineHint());
    const wrap = createEl('div');

  const targetTeams = 3;
    const state = { selections: Array(targetTeams).fill(null) };

    const summaryBlocks = state.selections.map(()=> createEl('div'));
    summaryBlocks.forEach(b=> wrap.appendChild(b));

    const grid = createEl('div','two-col');
    wrap.appendChild(grid);

  const pickButtonsRow = createEl('div','tier-members pick-row');
    const pickButtons = [];
    for(let i=0;i<targetTeams;i++){
      const btn = createEl('button','small-btn big-btn', `Pick team #${i+1}`);
      btn.addEventListener('click', ()=> openTeamPicker(i));
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
      function computeUsed(){
        const u = new Set();
        for(const s of state.selections){ if(s?.members){ for(const m of s.members) u.add(m); } }
        if(state.selections[idx]?.members){ for(const m of state.selections[idx].members) u.delete(m); }
        return u;
      }
      function refreshRoster(){
        const used = computeUsed();
        const filteredOwned = new Set([...owned].filter(n=> !used.has(n)));
        roster.innerHTML = '';
        const predPicker = makeFilterPredicate('picker');
        for(const name of owned){
          const chip = createEl('div','tier-member');
          const eligible = (function(){
            if(used.has(name)) return false;
            for(const s of teams){
              const members = [s.character_1, s.character_2, s.character_3, s.character_4].map(normalizeName);
              if(!members.includes(name)) continue;
              if(members.some(m=> used.has(m))) continue;
              const others = members.filter(m=> m!==name);
              let ok = true;
              for(const o of others){ if(!filteredOwned.has(o)){ ok=false; break; } }
              if(ok) return true;
            }
            return false;
          })();
          if(!eligible) chip.classList.add('disabled');
          if(!predPicker(name)) chip.classList.add('dimmed');
          const key = keyByDisplay[name];
          const avatar = createAvatarImg(name,'avatar', key); if(avatar) chip.appendChild(avatar);
          chip.appendChild(createEl('div','pill',name));
          if(eligible) chip.addEventListener('click',()=> showPickerList(idx, name));
          roster.appendChild(chip);
        }
      }
      roster.innerHTML = '';
      list.innerHTML = '';

      renderFilters(filterHost, 'picker');
      window.__pickerRefresh = refreshRoster;

      refreshRoster();
      function showPickerList(slotIndex, chosen){
        list.innerHTML = '';
        const othersUsed = new Set();
        for(let j=0;j<state.selections.length;j++){
          if(j===slotIndex) continue;
          const sel = state.selections[j];
          if(sel?.members){ for(const m of sel.members) othersUsed.add(m); }
        }
        const filteredOwned = new Set([...owned].filter(n=> !othersUsed.has(n)));
        const candidates = [];
        for(const s of teams){
          const members = [s.character_1, s.character_2, s.character_3, s.character_4].map(normalizeName);
          if(!members.includes(chosen)) continue;
          if(members.some(m=> othersUsed.has(m))) continue;
          const others = members.filter(m=>m!==chosen);
          let missing=0; for(const o of others){ if(!filteredOwned.has(o)) missing++; }
          if(missing===0){ candidates.push({members, dps:s.DPS||0}); }
        }
        candidates.sort((a,b)=> b.dps - a.dps);
        if(candidates.length===0){ list.appendChild(createEl('div','small','No teams available.')); return; }
        list.appendChild(createEl('div','small muted',`Showing ${Math.min(10,candidates.length)} of ${candidates.length} by DPS`));
        const top = candidates.slice(0, 10);
        for(const team of top){
          const row = createEl('div','team-row clickable');
          const members = createEl('div','members');
          for(const m of team.members){
            const mk = keyByDisplay[m];
            const img = createAvatarImg(m,'member-avatar', mk); if(img) members.appendChild(img);
            members.appendChild(createEl('div','member-pill',m));
          }
          row.appendChild(members);
          row.appendChild(createEl('div','team-dps', `${Math.round(team.dps||0)}`));
          row.addEventListener('click',()=>{
            state.selections[slotIndex] = {members: team.members, dps: team.dps||0};
            renderSummaries();
            if(pickButtons[slotIndex]) pickButtons[slotIndex].style.display = 'none';
            updatePickRowVisibility();
            closeTeamPicker();
          });
          list.appendChild(row);
        }
      }
      modal.hidden = false;
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
        clearBtn.addEventListener('click',()=>{ state.selections[i]=null; renderSummaries(); if(pickButtons[i]) pickButtons[i].style.display=''; updatePickRowVisibility(); });
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
        row.appendChild(createEl('div','team-dps', `${Math.round(sel.dps||0)}`));
        card.appendChild(row);
        host.appendChild(card);
      }
    }

    const pickerModal = document.getElementById('team-picker-modal');
    pickerModal?.querySelector('.modal-backdrop')?.addEventListener('click', ()=>{ pickerModal.hidden = true; });
    document.getElementById('team-picker-close')?.addEventListener('click', ()=>{ pickerModal.hidden = true; });

    renderSummaries();
    content.appendChild(wrap);
  }

  function renderTier(){
    const owned = getOwned();
    const maxShow = parseInt(maxShowEl.value||'3',10);
    const mode = parseInt(modeEl.value||'1',10);
    const pred = makeFilterPredicate('main');
    const tierData = buildTierlist(names, teams, owned, maxShow, mode).filter(item=> pred(item.name));
    const content = document.getElementById('view-content');
    content.innerHTML = '';
    content.appendChild(createInlineHint());
    const wrap = createEl('div');
    const area = createEl('div'); area.id = 'tierlist'; area.className = 'tier-grid';
    wrap.appendChild(area);
    content.appendChild(wrap);
    renderTierlist(tierData, keyByDisplay, maxShow);
  }

  function renderActiveView(){
    const hash = location.hash || '#recommendations';
    setActiveLink(hash);
    if(hash === '#tierlist'){
      renderFilters(mainFiltersHost, 'main');
      renderTier();
    } else if(hash === '#team-suggestions'){
      if(mainFiltersHost) mainFiltersHost.innerHTML = '';
      renderTeamSuggestions();
    } else {
      renderFilters(mainFiltersHost, 'main');
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
}

function normalizeName(name){
  return String(name).trim();
}

function computeSuggestions(teams, ownedDisplaySet, mode, maxShow=3){
  const byMissingSet = new Map();
  for(const s of teams){
    const members = [s.character_1, s.character_2, s.character_3, s.character_4].map(normalizeName);
    const missing = [];
    for(const m of members){
      if(!ownedDisplaySet.has(m)) missing.push(m);
    }
    if(missing.length > 0 && missing.length <= mode){
      const sortedMissing = missing.slice().sort();
      const key = sortedMissing.join('||');
      const list = byMissingSet.get(key) || {missing: sortedMissing, teams: []};
      list.teams.push({members, dps: s.DPS || 0});
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
    const medianBadge = createEl('div','dps-badge', `Median DPS: ${Math.round(item.median||0)}`);
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
      const dpsEl = createEl('div','team-dps', `${Math.round(best.dps||0)}`);
      preview.appendChild(dpsEl);
      right.appendChild(preview);
    }

    card.appendChild(left);
    card.appendChild(right);
    card.addEventListener('click',()=> togglePanel(card, item, keyByDisplay, maxShow));
    container.appendChild(card);
  }
}

function buildTierlist(names, teams, ownedDisplaySet, maxShow=3, mode=1){
  const results = [];
  const allDisplayNames = Object.values(names).map(v=> (v && typeof v==='object')? v.name : v);
  for(const disp of allDisplayNames){
    if(ownedDisplaySet && ownedDisplaySet.has(disp)){
      continue;
    }
    const candidates = [];
    for(const s of teams){
      const members = [s.character_1, s.character_2, s.character_3, s.character_4].map(normalizeName);
      if(members.includes(disp)){
        const others = members.filter(m=>m!==disp);
        let ownedCount = 0; for(const o of others) if(ownedDisplaySet.has(o)) ownedCount++;
        const missingOthers = others.length - ownedCount;
        const totalMissing = 1 + missingOthers;
        if(totalMissing <= mode && ownedCount>0){
          candidates.push({members, dps: s.DPS||0, ownedCount});
        }
      }
    }
    if(candidates.length===0){ continue; }
  candidates.sort((a,b)=> b.dps - a.dps);
  const best = candidates[0];
  const showteams = candidates.slice(0, Math.max(1, Math.min(maxShow, candidates.length)));
    results.push({name:disp, score: best.dps || 0, teams: showteams});
  }
  const vals = results.map(r=>r.score);
  const mean = vals.length? (vals.reduce((s,v)=>s+v,0)/vals.length) : 0;
  const sd = vals.length? Math.sqrt(vals.reduce((s,v)=>s+(v-mean)*(v-mean),0)/vals.length) : 0;
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
      tiered.push({name: r.name, score: r.score, teams: r.teams, tier: tiers[t]});
    }
  }
  for(; pos<N; pos++){ const r = results[pos]; tiered.push({name: r.name, score: r.score, teams: r.teams, tier: tiers[k-1]}); }
  return tiered;
}

function erf(x){
  const sign = x<0?-1:1; x = Math.abs(x);
  const a1=  0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const t = 1/(1+p*x);
  const y = 1 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t*Math.exp(-x*x);
  return sign*y;
}

function renderTierlist(tierData, keyByDisplay, maxShow){
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
      chip.addEventListener('click', ()=> togglePanel(chip, {missing:[member.name], topteams:member.teams}, keyByDisplay));
      membersTd.appendChild(chip);
    }
    row.appendChild(membersTd);
    table.appendChild(row);
  }
  container.appendChild(table);
}
function togglePanel(card, item, keyByDisplay){
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
        if(item.missing && item.missing.includes(m)) pill.classList.add('missing'); else pill.classList.add('owned');
        members.appendChild(pill);
      }
      row.appendChild(members);
      const dpsEl = createEl('div','team-dps', `${Math.round(team.dps||0)}`);
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
  const fileCandidates = [];
  if(key){
    fileCandidates.push(key.toLowerCase() + '.png');
  }
  fileCandidates.push(sanitizeFileName(displayName));
  fileCandidates.push(displayName.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9_\-]/g,'') + '.png');

  for(const candidate of fileCandidates){
    const path = `characters/${candidate}`;
    const img = new Image();
    img.src = path;
    img.className = cls;
    img.onerror = ()=>{ img.style.display = 'none'; };
    return img;
  }
  return null;
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
