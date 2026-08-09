/* =========================================================
   RENDERIZAÇÃO
========================================================= */
let activeTab = 'overview';

function render(){
  renderTopbar();
  renderScene();
  renderTab();
}

// Guarda o último valor renderizado de cada recurso: pulsa (bump) só quando muda.
const lastResVals = {};
function renderTopbar(){
  const vals = [
    ['res-money', fmt(state.money)],
    ['res-eggs',  fmt(state.eggs)],
    ['res-feed',  fmt(state.feed)]
  ];
  vals.forEach(([id, v]) => {
    const el = document.getElementById(id);
    if(!el) return;
    if(lastResVals[id] !== undefined && lastResVals[id] !== v){
      const res = el.closest('.res');
      if(res){ res.classList.remove('bump'); void res.offsetWidth; res.classList.add('bump'); }
    }
    lastResVals[id] = v;
    el.textContent = v;
  });
  document.getElementById('res-eggs-cap').textContent = '/'+fmt(eggCapacity());
  document.getElementById('res-feed-cap').textContent = '/'+fmt(feedCapacity());
  document.getElementById('tier-badge').textContent = currentTier().name;
  const actEl = document.getElementById('activity-badge');
  if(actEl){
    const pct = Math.round(ACTIVITY_MAX_BONUS*100*activityLevel()/ACTIVITY_LEVELS);
    actEl.textContent = '⚡ '+pct+'%';
  }
}

function renderScene(){
  const scene = document.getElementById('scene');
  const stage = currentTier().stage;
  scene.className = 'scene stage-'+stage;
  // A cena agora é a fazenda em isométrico pixel-art (scene-iso.js), viva e
  // clicável (planta/colhe canteiro, abre o Galinheiro). Ela só LÊ o `state`
  // e chama as MESMAS funções de actions.js — nenhuma regra do jogo mudou
  // aqui, só o desenho. Isolado em try/catch de propósito: um erro aqui não
  // pode voltar a travar o gameTick/save (já aconteceu uma vez com uma outra
  // função — ver applyOfflineProgress).
  if(typeof PIXI==='undefined' && window.__pixiCdnFailed){
    // Os 3 CDNs falharam (provavelmente rede/firewall bloqueando). Mostra um
    // aviso claro em vez de deixar a cena em branco pra sempre.
    if(!scene.querySelector('.scene-fallback')){
      scene.innerHTML = `<div class="scene-fallback" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;color:var(--ink-soft);font-size:.85rem;">
        ⚠️ Não consegui carregar os gráficos (bloqueio de rede/firewall). O resto do jogo funciona normal — veja o console (F12) pra mais detalhes.
      </div>`;
    }
    return;
  }
  try{ IsoFarmScene.update(); }catch(e){ console.error('IsoFarmScene falhou:', e); }
}

function renderTab(){
  const main = document.getElementById('main-content');
  // re-render completo: zera o tracker de treino para o tickTab re-sincronizar
  if(typeof lastTraining !== 'undefined') lastTraining.clear();
  if(activeTab==='overview') main.innerHTML = viewOverview();
  else if(activeTab==='coop') main.innerHTML = viewCoop();
  else if(activeTab==='plantation') main.innerHTML = viewPlantation();
  else if(activeTab==='shop') main.innerHTML = viewShop();
  else if(activeTab==='breed') main.innerHTML = viewBreed();
  else if(activeTab==='incubator') main.innerHTML = viewIncubator();
  else if(activeTab==='fighters') main.innerHTML = viewFighters();
  else if(activeTab==='arena') main.innerHTML = viewArena();
  else if(activeTab==='online') main.innerHTML = viewOnline();
  bindDynamicEvents();
}

function viewOverview(){
  const tierRows = TIERS.map((t,i)=>{
    const cls = i<state.tierIndex ? 'done' : (i===state.tierIndex ? 'current' : '');
    return `<div class="tier-row ${cls}"><div class="dot"></div><div>${t.name}</div><div style="margin-left:auto;font-family:var(--font-mono);font-size:.72rem;color:var(--ink-soft)">${money(t.min)}</div></div>`;
  }).join('');
  return `
    <div class="panel">
      <h2>Bem-vindo à sua fazenda</h2>
      <div class="sub">Patrimônio já acumulado: ${money(state.totalEarned)} · Próximo objetivo: ${state.tierIndex<TIERS.length-1 ? TIERS[state.tierIndex+1].name+' ('+money(TIERS[state.tierIndex+1].min)+')' : 'Você chegou ao topo! 👑'}</div>
      <div class="grid">
        <div class="card"><h3>🐓 Galinheiro</h3><div class="desc">${totalChickens()}/${coopCapacity()} galinhas alojadas</div></div>
        <div class="card"><h3>🌱 Plantação</h3><div class="desc">${state.plots.filter(p=>p.planted).length}/${state.plots.length} canteiros em uso</div></div>
        <div class="card"><h3>🥚 Incubadora</h3><div class="desc">${state.incubator.filter(s=>s.filled).length}/${state.incubator.length} ovos incubando · ${state.fertileQueue.length} na fila</div></div>
        <div class="card"><h3>💞 Cruza</h3><div class="desc">${state.breedPens.filter(p=>p.active).length}/${state.breedPens.length} currais ativos</div></div>
        <div class="card"><h3>🐓‍🔥 Aviário de Combate</h3><div class="desc">${state.fighters.length}/${rosterCap()} aves adultas · ${state.cages.filter(c=>c.occupied).length}/${state.cages.length} gaiolas em uso</div></div>
        <div class="card"><h3>🏆 Arena</h3><div class="desc">${ARENA_RANKS[arenaRankIndex()].name} · ${state.fighters.reduce((s,f)=>s+f.wins,0)} vitórias</div></div>
      </div>
      <div class="section-title">Jornada da pobreza à lenda</div>
      <div class="tier-list">${tierRows}</div>
    </div>
  `;
}

function viewCoop(){
  const cards = BREEDS.map(b=>{
    const owned = state.coop[b.id]?.count||0;
    const unlocked = breedIndexUnlocked(b);
    const progress = state.coop[b.id]?.progress||0;
    const refund = Math.round(b.cost*CHICKEN_SELL_RATIO);
    return `
      <div class="card ${unlocked?'':'locked'}" style="border-color:${b.glow}">
        <div class="badge-emoji">${b.emoji}</div>
        <h3>${b.name}</h3>
        <div class="desc">${owned} na fazenda ${unlocked?(owned>0?'· próxima custa '+money(chickenPrice(b.id)):''):'· requer '+TIERS[b.tierReq].name}</div>
        <div class="stat-row"><span>⏱ ${b.eggTime}s/ciclo</span><span>🥚 ${b.eggsPerCycle}/ciclo</span></div>
        <div class="stat-row"><span>🌾 -${b.feedPerCycle}/ciclo</span><span></span></div>
        ${owned>0 ? `<div class="progress"><div style="width:${Math.min(100,progress*100)}%"></div></div>` : ''}
        ${owned>0 ? `<button class="action ghost" data-sell-chicken="${b.id}" style="font-size:.75rem;">Vender 1 (${money(refund)})</button>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="panel">
      <h2>Galinheiro</h2>
      <div class="sub">Capacidade: ${totalChickens()}/${coopCapacity()} · Compre na Loja, ou venda uma galinha aqui para abrir espaço para uma raça melhor.</div>
      ${totalChickens()>=coopCapacity() ? `<div class="desc" style="color:var(--barn-red);font-weight:700;margin-bottom:8px;">🏠 Galinheiro cheio! Venda alguma galinha ou amplie a capacidade na Loja para comprar mais.</div>` : ''}
      <div class="grid">${cards}</div>
    </div>`;
}

function viewPlantation(){
  const plots = state.plots.map((p,i)=>{
    let cls='plot', emoji='➕', label='Plantar';
    if(p.planted && !p.ready){ cls='plot growing'; emoji='🌱'; label='Crescendo...'; }
    if(p.ready){ cls='plot ready'; emoji='🌾'; label='Colher!'; }
    if(!p.planted){ cls='plot empty'; emoji='➕'; label='Plantar milho'; }
    let timeInfo = '';
    if(p.planted && !p.ready){
      const remaining = Math.max(0, plotGrowTime() - (Date.now()-p.plantedAt)/1000);
      timeInfo = `<small>${Math.ceil(remaining)}s restantes</small>`;
    }
    return `<div class="${cls}" data-plot="${i}"><div class="emoji">${emoji}</div><div>${label}</div>${timeInfo}</div>`;
  }).join('');
  const tractorOn = state.autoPlot && upgLevel('tractor')>0;
  const hasTractor = upgLevel('tractor')>0;
  const tractorBtn = `
    <button class="action ${tractorOn?'buy':'ghost'}" data-toggle-auto-plot ${!hasTractor?'disabled':''} style="margin-top:10px;">
      🚜 ${!hasTractor ? '🔒 Trator de Canteiros (Loja)' : (tractorOn ? 'Trator ligado — colhe e planta sozinho' : 'Ligar o Trator (colhe e planta sozinho)')}
    </button>
    ${!hasTractor ? '<div class="desc" style="margin-top:4px;">Compre o upgrade Trator de Canteiros na Loja para colher e plantar sem cliques.</div>' : ''}`;
  return `
    <div class="panel">
      <h2>Plantação</h2>
      <div class="sub">Colheita gera ${fmt(plotYieldAmt())} de ração cada · Tempo de crescimento: ${plotGrowTime().toFixed(1)}s</div>
      <div class="grid">${plots}</div>
      ${tractorBtn}
    </div>`;
}

function viewShop(){
  const chickenCards = BREEDS.map(b=>{
    const unlocked = breedIndexUnlocked(b);
    const price = chickenPrice(b.id);
    const owned = state.coop[b.id]?.count||0;
    return `
      <div class="card ${unlocked?'':'locked'}" style="border-color:${b.glow}">
        <div class="badge-emoji">${b.emoji}</div>
        <h3>${b.name}</h3>
        <div class="desc">${unlocked ? money(price)+(owned>0?' · você tem '+owned:'') : 'Requer '+TIERS[b.tierReq].name}</div>
        <button class="action buy" data-buy-chicken="${b.id}" ${(!unlocked||state.money<price||totalChickens()>=coopCapacity())?'disabled':''}>Comprar</button>
      </div>`;
  }).join('');

  const upgradeCards = Object.keys(UPGRADE_DEFS).map(id=>{
    const d = UPGRADE_DEFS[id];
    const lvl = upgLevel(id);
    const maxed = upgMaxed(id);
    const cost = upgCost(id);
    return `
      <div class="card">
        <div class="badge-emoji">${d.icon}</div>
        <h3>${d.name}</h3>
        <div class="desc">${d.desc} · Nível ${lvl}/${d.max}</div>
        <button class="action buy" data-buy-upgrade="${id}" ${(maxed||state.money<cost)?'disabled':''}>${maxed?'Máximo':money(cost)}</button>
      </div>`;
  }).join('');

  return `
    <div class="panel">
      <h2>Loja</h2>
      <div class="sub">Venda ovos, compre ração e melhore sua fazenda.</div>
      <div class="grid">
        <div class="card">
          <h3>🥚 Vender Ovos</h3>
          <div class="desc">${fmt(state.eggs)} ovos × ${money(eggSellPrice())} cada</div>
          <button class="action" id="sell-eggs" ${state.eggs<=0?'disabled':''}>Vender tudo (${money(state.eggs*eggSellPrice())})</button>
        </div>
        <div class="card">
          <h3>🌾 Comprar Ração</h3>
          <div class="desc">${money(FEED_BUY_PRICE)} por unidade</div>
          <button class="action buy" id="buy-feed-10">Comprar 10 (${money(10*FEED_BUY_PRICE)})</button>
        </div>
      </div>
      <div class="section-title">Comprar galinhas</div>
      <div class="grid">${chickenCards}</div>
      <div class="section-title">Melhorias</div>
      <div class="grid">${upgradeCards}</div>
    </div>`;
}

function viewBreed(){
  const ownedBreeds = BREEDS.filter(b=>(state.coop[b.id]?.count||0)>=1 && breedIndex(b.id)<BREED_TRANSITION.length);
  const chips = ownedBreeds.map(b=>{
    const owned = state.coop[b.id].count;
    const chosen = state.selectedBreedForBreed===b.id;
    return `<button class="select-chip ${chosen?'chosen':''}" data-select-breed="${b.id}" ${owned<2?'disabled':''}>${b.emoji} ${b.name} (${owned})</button>`;
  }).join('') || '<div class="desc">Você ainda não tem galinhas elegíveis para cruzar. Compre pelo menos 2 da mesma espécie.</div>';

  let infoBox = '<div class="desc">Selecione uma espécie com pelo menos 2 unidades para ver os detalhes da cruza.</div>';
  if(state.selectedBreedForBreed){
    const fromIdx = breedIndex(state.selectedBreedForBreed);
    const trans = BREED_TRANSITION[fromIdx];
    const target = BREEDS[fromIdx+1];
    infoBox = `<div class="desc">Cruzar ${breedById(state.selectedBreedForBreed).name} → chance de gerar 1 ovo fértil de <b>${target.name}</b><br>
      Custo: ${money(trans.cost)} · Duração: ${trans.duration}s · Chance de sucesso: ${Math.round(trans.chance*100)}%</div>`;
  }

  const pens = state.breedPens.map((pen,i)=>{
    let content;
    if(pen.active){
      const remaining = Math.max(0, pen.duration - (Date.now()-pen.startedAt)/1000);
      const pct = 100*(1-remaining/pen.duration);
      content = `<div class="desc">Cruzando ${breedById(pen.breedFrom).name}...</div><div class="progress"><div style="width:${pct}%"></div></div><small>${Math.ceil(remaining)}s restantes</small>`;
    } else {
      content = `<button class="action" data-start-pen="${i}" ${!state.selectedBreedForBreed?'disabled':''}>Iniciar cruza aqui</button>`;
    }
    return `<div class="pen" data-pen="${i}"><h3>Curral ${i+1}</h3>${content}</div>`;
  }).join('');

  return `
    <div class="panel">
      <h2>Espaço de Cruza</h2>
      <div class="sub">Cruze duas galinhas da mesma espécie para tentar obter um ovo fértil de espécie superior.</div>
      <div class="section-title">1. Escolha a espécie</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">${chips}</div>
      <div style="margin-top:10px">${infoBox}</div>
      <div class="section-title">2. Currais</div>
      <div class="grid">${pens}</div>
    </div>`;
}

function viewIncubator(){
  const slots = state.incubator.map((s,i)=>{
    if(!s.filled) return `<div class="slot" data-inc-slot="${i}"><div class="emoji">➕</div><div>Colocar ovo fértil</div></div>`;
    if(s.ready) return `<div class="slot filled ready" data-inc-collect="${i}"><div class="emoji">🐣</div><div>Nasceu! Coletar</div></div>`;
    const remaining = Math.max(0, s.hatchTime - (Date.now()-s.startedAt)/1000);
    const pct = 100*(1-remaining/s.hatchTime);
    return `<div class="slot filled" data-inc-slot="${i}"><div class="emoji">🥚</div><div>Incubando ${breedById(s.breedTarget).name}</div><div class="progress" style="width:100%"><div style="width:${pct}%"></div></div><small>${Math.ceil(remaining)}s</small></div>`;
  }).join('');
  return `
    <div class="panel">
      <h2>Incubadora</h2>
      <div class="sub">Ovos férteis na fila: ${state.fertileQueue.length} · Slots: ${state.incubator.length}</div>
      <div class="grid">${slots}</div>
    </div>`;
}

function statBar(label, value, cap){
  const capMark = cap!==undefined ? `<div class="stat-cap" style="left:${cap}%" title="Limite genético: ${cap}"></div>` : '';
  return `<div class="stat-line"><span>${label}</span><div class="stat-track">${capMark}<div class="stat-fill" style="width:${value}%"></div></div><span class="stat-num">${value}</span></div>`;
}

/* Gema de estatística compacta pro card de galo: ícone + rótulo + valor numa
   linha, barra fina embaixo. 4 gemas cabem numa grade 2×2 — muito mais curto
   na vertical que 4 barras full-width empilhadas. */
const STAT_ICON = { forca:'⚔️', velocidade:'💨', resistencia:'🛡️', instinto:'👁️' };
function statGem(key, label, value, cap){
  const pct = Math.max(0, Math.min(100, value));
  const capMark = cap!==undefined ? `<div class="fc-gem-cap" style="left:${Math.max(0,Math.min(100,cap))}%" title="Limite genético: ${cap}"></div>` : '';
  return `<div class="fc-stat-gem" data-stat="${key}">
      <div class="fc-gem-head"><span class="fc-gem-icon">${STAT_ICON[key]}</span><span class="fc-gem-label">${label}</span><span class="fc-gem-val">${value}</span></div>
      <div class="fc-gem-track">${capMark}<div class="fc-gem-fill" style="width:${pct}%"></div></div>
    </div>`;
}
/* Botão de ícone compacto (usado nas ações do verso — grade 2×2 em vez de
   uma lista de botões full-width empilhados). */
function fcIconBtn(icon, label, attrs, disabled){
  return `<button class="fc-icon-btn" ${attrs||''} ${disabled?'disabled':''} title="${esc(label)}">
      <span class="fc-icon-btn-ico">${icon}</span><span class="fc-icon-btn-txt">${esc(label)}</span>
    </button>`;
}

/* --- card de galo FRENTE/VERSO, estilo "card de batalha" ---
   Frente: moldura ornamentada com faixa de linhagem, medalhão de retrato,
   placa de nome e grade 2×2 de atributos — tudo que o jogador quer ver de
   relance, organizado em zonas em vez de empilhado numa coluna comprida.
   Verso: metadados, cartel e ações (cruza, reprodutor, árvore, vender). */
function fighterFrontFace(f, nameOverride){
  const stars = '★'.repeat(f.quality||1)+'☆'.repeat(5-(f.quality||1));
  const displayName = nameOverride!==undefined ? nameOverride : esc(f.name || ('Ave #'+(f.id?f.id.slice(1,5):'?')));
  const genderIcon = f.gender==='M' ? '🐓' : '🐔';
  const genderLabel = f.gender==='M' ? 'Macho' : 'Fêmea';
  return `<div class="fc-ribbon" title="Linhagem">${lineageLabel(f.lineage)}</div>
      ${f.isPhenomenal?'<div class="fc-phenomenal-tag" title="1 em 20.000">✨ Fenomenal</div>':''}
      <div class="fc-portrait">
        <div class="fc-portrait-ring"><div class="fc-portrait-emoji">${genderIcon}</div></div>
      </div>
      <div class="fc-nameplate">
        <h3>${displayName}</h3>
        <div class="fc-subrow">
          <span class="fc-gender-tag" title="${genderLabel}">${genderLabel}</span>
          <span class="fc-stars" title="Qualidade ${f.quality||1}/5">${stars}</span>
          ${f.isBreeder?'<span class="fc-breeder-tag" title="Reprodutor">⭐</span>':''}
        </div>
      </div>
      <div class="fc-stat-grid">
        ${statGem('forca','Força', f.forca, f.potential?.forca)}
        ${statGem('velocidade','Veloc.', f.velocidade, f.potential?.velocidade)}
        ${statGem('resistencia','Resist.', f.resistencia, f.potential?.resistencia)}
        ${statGem('instinto','Instinto', f.instinto, f.potential?.instinto)}
      </div>`;
}
function fighterFlipWrap(f, frontHtml, backHtml, extraCls=''){
  const lnCls = 'fc-ln-'+(f.lineage||'comum');
  // id do flip com prefixo: aves locais usam o id, aves online (publicadas)
  // usam o _key do servidor — assim cartas de jogadores diferentes nunca
  // compartilham o mesmo estado virado.
  let flipId = ' data-flip=""';
  if(f && f.id) flipId = ` data-flip="local:${esc(f.id)}"`;
  else if(f && f._key) flipId = ` data-flip="net:${esc(f._key)}"`;
  // restaura o estado virado (a carta só volta à frente com outro clique)
  const flipKey = flipId.replace(' data-flip="','').replace('"','');
  const wasFlipped = (typeof flippedCards !== 'undefined') && flippedCards.has(flipKey);
  const flippedCls = wasFlipped ? ' flipped' : '';
  return `<div class="fc-flip ${lnCls} ${extraCls}${flippedCls}"${flipId}>
    <div class="fc-inner">
      <div class="fc-front">${frontHtml}<div class="fc-hint">🔄 clique para virar</div></div>
      <div class="fc-back">${backHtml}<div class="fc-hint">🔄 clique para voltar</div></div>
    </div>
  </div>`;
}
function fighterCardMeta(f, potentialValue){
  const potItem = potentialValue!==undefined ? `<div class="fc-meta-item"><span class="fc-meta-label">Potencial</span><span class="fc-meta-value">${potentialValue}</span></div>` : '';
  return `<div class="fc-meta">
      ${potItem}
      <div class="fc-meta-item"><span class="fc-meta-label">Diversidade</span><span class="fc-meta-value">${diversityLabel(f.diversity)}</span></div>
      <div class="fc-meta-item"><span class="fc-meta-label">Geração</span><span class="fc-meta-value">F${f.generation||1}</span></div>
    </div>`;
}

function viewFighters(){
  const freeCagesCount = state.cages.filter(c=>!c.occupied).length;
  const breedShopCards = FIGHT_BREEDS_TYPES.map(bt=>{
    return `<div class="card" style="border-color:#8a5a34">
      <div class="badge-emoji">${bt.emoji}</div>
      <h3>${bt.name}</h3>
      <div class="desc">${bt.desc}</div>
      ${statBar('Força', Math.round((bt.bias.forca[0]+bt.bias.forca[1])/2))}
      ${statBar('Velocidade', Math.round((bt.bias.velocidade[0]+bt.bias.velocidade[1])/2))}
      ${statBar('Resistência', Math.round((bt.bias.resistencia[0]+bt.bias.resistencia[1])/2))}
      ${statBar('Instinto', Math.round((bt.bias.instinto[0]+bt.bias.instinto[1])/2))}
      <div class="desc" style="text-align:center;font-weight:700;color:var(--soil-dark);">= 100 pts iniciais</div>
      <button class="action buy" data-buy-egg="${bt.id}" ${(freeCagesCount<=0||state.money<bt.cost)?'disabled':''}>Comprar ovo (${money(bt.cost)})</button>
    </div>`;
  }).join('');

  const cages = state.cages.map((cg,i)=>{
    if(!cg.occupied){
      return `<div class="cage empty"><div class="emoji">➕</div><div>Gaiola vazia</div><small>Compre um ovo abaixo</small></div>`;
    }
    if(cg.ready){
      const full = state.fighters.length >= rosterCap();
      return `<div class="cage ready" data-collect-fighter="${i}"><div class="emoji">${cg.gender==='M'?'🐓':'🐔'}</div><div>${lineageLabel(cg.lineage)}</div><small>${full?'⚠️ Plantel cheio — libere espaço':'Ave adulta pronta — coletar!'}</small></div>`;
    }
    const dur = FIGHT_STAGE_TIME[cg.stage];
    const remaining = Math.max(0, dur-(Date.now()-cg.stageStartedAt)/1000);
    const pct = 100*(1-remaining/dur);
    const stageLabel = {ovo:'🥚 Ovo', pintinho:'🐤 Pintinho', frango:'🐥 Frango jovem'}[cg.stage];
    const canFeed = cg.stage!=='ovo' && !cg.careFed[cg.stage];
    return `<div class="cage" data-cage="${i}">
      <div class="emoji">${cg.stage==='ovo'?'🥚':(cg.gender==='M'?'🐤':'🐥')}</div>
      <div>${stageLabel}</div>
      <small style="opacity:.85">${lineageLabel(cg.lineage)}</small>
      <div class="progress" style="width:100%"><div style="width:${pct}%"></div></div>
      <small>${Math.ceil(remaining)}s restantes</small>
      ${canFeed ? `<button class="action" data-feed-cage="${i}" style="margin-top:4px;padding:5px 8px;font-size:.72rem;">🌾 Alimentar</button>` : (cg.stage!=='ovo' ? '<small>✅ Já alimentada</small>' : '')}
    </div>`;
  }).join('');

  const fighterCards = state.fighters.map(f=>{
    const resting = isResting(f);
    const training = f.trainingUntil>Date.now();
    let statusTxt = '';
    if(training){
      const rem = Math.max(0, Math.ceil((f.trainingUntil-Date.now())/1000));
      statusTxt = `<div class="desc">🏋️ Treinando ${statLabel(f.trainingStat)}... ${rem}s</div>`;
    } else if(resting){
      const rem = Math.max(0, Math.ceil((f.restUntil-Date.now())/60000));
      statusTxt = `<div class="desc">😴 Descansando (~${rem} min)</div>`;
    }
    const selected = (state.selectedFighterA===f.id || state.selectedFighterB===f.id);
    const trainRow = ['forca','velocidade','resistencia','instinto'].map(k=>{
      const atCap = f[k]>=f.potential[k];
      return fcIconBtn(STAT_ICON[k], '+'+statLabel(k).slice(0,3), `data-train="${f.id}|${k}"`, resting||training||atCap);
    }).join('');
    return fighterFlipWrap(f,
      fighterFrontFace(f),
      `${fighterCardMeta(f, f.potential.forca)}
      <div class="fc-record">🏆 <b>${f.wins}</b>V · <b>${f.losses}</b>D <span class="fc-power">⚡ ${Math.round(fighterPower(f))}</span></div>
      ${statusTxt}
      <div class="fc-section-label">Treinar atributo</div>
      <div class="fc-icon-grid">${trainRow}</div>
      <button class="action" data-select-fighter="${f.id}" ${(resting||training)?'disabled':''}>${selected?'✅ Selecionada p/ Cruza':'Selecionar p/ Cruza'}</button>
      <div class="fc-icon-grid">
        ${fcIconBtn(f.isBreeder?'⭐':'☆', f.isBreeder?'Desmarcar':'Reprodutor', `data-toggle-breeder="${f.id}"`)}
        ${fcIconBtn('🌳', 'Árvore', `data-genealogy="${f.id}"`)}
        ${fcIconBtn('✏️', 'Renomear', `data-rename-fighter="${f.id}"`)}
        ${fcIconBtn('💰', 'Vender', `data-sell-fighter="${f.id}"`)}
      </div>
      <div class="fc-sell-hint">Venda: ${money(fighterSellPrice(f))}</div>`,
      `card fighter-card ${selected?'chosen':''} ${f.isPhenomenal?'phenomenal':''}`
    );
  }).join('') || '<div class="desc">Nenhuma ave de combate adulta ainda. Compre um ovo de alguma raça abaixo.</div>';

  return `
    <div class="panel">
      <h2>Aviário de Combate</h2>
      <div class="sub">Escolha a raça, cuide dos filhotes até virarem adultos e cruze raças diferentes para combinar suas características.</div>
      <div class="section-title">Raças disponíveis (${freeCagesCount} gaiola${freeCagesCount===1?'':'s'} livre${freeCagesCount===1?'':'s'})</div>
      <div class="grid">${breedShopCards}</div>
      <div class="section-title">Gaiolas de cria (${state.cages.length})</div>
      <div class="grid">${cages}</div>
      <div class="section-title">Cruzar genética</div>
      <div class="desc" style="margin-bottom:8px;">Selecione 1 galo e 1 galinha entre as aves adultas abaixo, depois clique em cruzar. Custo: ${money(FIGHT_BREED_COST)}. Cada atributo do filhote vem 100% do pai OU da mãe (por exemplo, a força pode vir do pai e a velocidade, da mãe) — com uma chance de mutação genética que cresce quanto pior a diversidade do cruzamento.</div>
      <button class="action buy" id="do-breed-fighters" ${(!state.selectedFighterA||!state.selectedFighterB)?'disabled':''}>💞 Cruzar selecionadas</button>
      <div class="section-title">Plantel adulto (${state.fighters.length}/${rosterCap()})</div>
      <div class="grid grid-fighters">${fighterCards}</div>
    </div>`;
}

function viewArena(){
  const rankIdx = arenaRankIndex();
  const rank = ARENA_RANKS[rankIdx];
  const nextRank = ARENA_RANKS[rankIdx+1];
  const totalWins = state.fighters.reduce((s,f)=>s+f.wins,0);
  const totalLosses = state.fighters.reduce((s,f)=>s+f.losses,0);

  const titlesCards = ARENA_TITLES.map(t=>{
    const unlocked = state.arena.titles[t.id]?.unlocked;
    const cls = unlocked?'unlocked':'locked';
    const head = unlocked ? `${t.emoji} ${t.name}` : '❓ ???';
    const status = unlocked ? `✅ Desbloqueado · +${money(t.reward)}` : `🔒 Bloqueado · prêmio ${money(t.reward)}`;
    return `<div class="card feat-card ${cls}"><h3>${head}</h3><div class="desc">${esc(t.desc)}</div><div class="feat-reward ${unlocked?'won':'pending'}">${status}</div></div>`;
  }).join('');

  const ranksList = ARENA_RANKS.map((r,i)=>{
    const cls = i<rankIdx?'done':(i===rankIdx?'current':'');
    return `<div class="tier-row ${cls}"><div class="dot"></div><div>${r.name}</div><div style="margin-left:auto;font-family:var(--font-mono);font-size:.72rem;color:var(--ink-soft)">${r.minWins}+ vitórias · Poder ${r.minPower}+ · Linhagem ${lineageLabel(r.minLineage)}+</div></div>`;
  }).join('');

  const ready = state.fighters.filter(f=>!isResting(f) && f.trainingUntil<=Date.now());
  const cards = ready.map(f=>{
    return fighterFlipWrap(f,
      fighterFrontFace(f),
      `${fighterCardMeta(f, f.potential.forca)}
      <div class="fc-record">🏆 <b>${f.wins}</b>V · <b>${f.losses}</b>D <span class="fc-power">⚡ ${Math.round(fighterPower(f))}</span></div>
      <button class="action danger" data-enter-arena="${f.id}">🏆 Competir</button>`,
      `card fighter-card ${f.isPhenomenal?'phenomenal':''}`
    );
  }).join('') || '<div class="desc">Nenhuma ave disponível agora (todas descansando, treinando, ou você ainda não tem nenhuma — vá ao Aviário de Combate).</div>';

  return `
    <div class="panel">
      <h2>Arena</h2>
      <div class="sub">Categoria atual: <b>${rank.name}</b> · Prêmio por vitória: ${money(rank.reward)} ${nextRank?('· Próxima categoria em '+(nextRank.minWins-totalWins)+' vitórias e poder '+nextRank.minPower+'+'):'(categoria máxima!)'}</div>
      <div class="grid">
        <div class="card"><h3>🏆 Recorde geral</h3><div class="desc">${totalWins} vitórias · ${totalLosses} derrotas</div></div>
        <div class="card"><h3>⚡ Melhor poder</h3><div class="desc">${state.fighters.length ? Math.round(Math.max(...state.fighters.map(f=>fighterPower(f)))) : 0}</div></div>
      </div>
      <div class="section-title">🏅 Mural de Recordes</div>
      <div class="grid">
        <div class="card feat-card"><h3>💪 Melhor poder</h3><div class="feat-value">${state.arena.records.bestPower}</div><div class="desc">maior poder de combate já visto</div></div>
        <div class="card feat-card"><h3>🏆 Mais vitórias</h3><div class="feat-value">${state.arena.records.mostWins}</div><div class="desc">recorde de vitórias de uma única ave</div></div>
        <div class="card feat-card"><h3>🔥 Maior sequência</h3><div class="feat-value">${state.arena.records.longestStreak}</div><div class="desc">vitórias seguidas sem derrota</div></div>
      </div>
      <div class="section-title">👑 Títulos</div>
      <div class="grid grid-titles">${titlesCards}</div>
      <div class="section-title">Aves disponíveis</div>
      <div class="grid grid-fighters">${cards}</div>
      <div class="section-title">Ranking da Arena</div>
      <div class="tier-list">${ranksList}</div>
    </div>`;
}

function selectArenaFighter(id){
  state.selectedArenaFighter = state.selectedArenaFighter===id ? null : id;
  render();
}

function viewOnline(){
  if(!mpIdentity){
    return `
      <div class="panel">
        <h2>Online — Rinhas com Amigos</h2>
        <div class="sub">Crie uma sala e mande o código para seus amigos, ou entre numa sala que já recebeu. Todo mundo na mesma sala pode publicar galos e desafiar os dos outros.</div>
        <div class="card" style="max-width:360px;">
          <h3>Entrar em uma sala</h3>
          <label class="desc" style="text-align:left;">Seu nome de jogador</label>
          <input id="mp-nickname" type="text" maxlength="16" placeholder="ex: Zé da Roça" style="padding:8px;border-radius:8px;border:2px solid var(--line);font-family:var(--font-body);">
          <label class="desc" style="text-align:left;">Código da sala (deixe vazio para criar uma nova)</label>
          <input id="mp-room" type="text" maxlength="8" placeholder="ex: G7K2P" style="padding:8px;border-radius:8px;border:2px solid var(--line);font-family:var(--font-mono);text-transform:uppercase;">
          <button class="action buy" id="mp-join-btn">Entrar / Criar sala</button>
        </div>
        <div class="desc" style="margin-top:10px;">⚠️ Não há partidas em tempo real — é assíncrono: você publica seu melhor galo, e seus amigos desafiam os dados reais dele quando quiserem.</div>
      </div>`;
  }

  const readyFighters = state.fighters.filter(f=>!isResting(f) && f.trainingUntil<=Date.now());
  const myFighterOptions = readyFighters.map(f=>{
    const selected = state.selectedArenaFighter===f.id;
    return `<button class="select-chip ${selected?'chosen':''}" data-select-arena-fighter="${f.id}">${f.gender==='M'?'🐓':'🐔'} ${lineageLabel(f.lineage)} (Poder ${Math.round(fighterPower(f))})</button>`;
  }).join('') || '<div class="desc">Nenhuma ave disponível pra desafiar agora.</div>';

  const publishOptions = readyFighters.map(f=>
    `<button class="action ghost" style="font-size:.75rem;" data-publish-fighter="${f.id}">${f.gender==='M'?'🐓':'🐔'} Publicar ${lineageLabel(f.lineage)}</button>`
  ).join('') || '<div class="desc">Crie uma ave adulta e descansada para publicar.</div>';

  // Identifica "meu galo" e oponentes por ownerId (pubId), não por apelido —
  // dois jogadores podem ter o mesmo apelido na sala.
  const myBird = mpCache.birds.find(b=>b.ownerId && b.ownerId===mpIdentity.pubId);

  const oppCards = mpCache.birds.filter(b=>!(b.ownerId && b.ownerId===mpIdentity.pubId)).map(b=>{
    const ago = Math.round((Date.now()-b.updatedAt)/60000);
    const displayName = esc(b.name?b.name+' — ':'')+esc(b.nickname);
    return fighterFlipWrap(b,
      fighterFrontFace(b, displayName),
      `${fighterCardMeta(b)}
      <div class="fc-record">🏆 <b>${b.wins}</b>V · <b>${b.losses}</b>D <span class="fc-power">⚡ ${Math.round(fighterPower(b))}</span></div>
      <div class="fc-status">atualizado há ${ago}min</div>
      <button class="action danger" data-challenge-online="${esc(b._key)}" ${!state.selectedArenaFighter?'disabled':''}>🌍 Desafiar</button>`,
      `card fighter-card ${b.isPhenomenal?'phenomenal':''}`
    );
  }).join('') || '<div class="desc">Nenhum amigo publicou um galo nesta sala ainda. Mande o código '+mpIdentity.room+' pra eles!</div>';

  const logItems = mpCache.log.map(e=>{
    const when = Math.round((Date.now()-e.t)/60000);
    return `<div class="tier-row"><div>${e.won?'🏆':'💔'}</div><div>${esc(e.from)} (${esc(e.fromBird)}) ${e.won?'venceu':'perdeu contra'} ${esc(e.to)} (${esc(e.toBird)})</div><div style="margin-left:auto;font-size:.7rem;color:var(--ink-soft);">há ${when}min</div></div>`;
  }).join('') || '<div class="desc">Nenhum desafio ainda nesta sala.</div>';

  return `
    <div class="panel">
      <h2>Online — Rinhas com Amigos</h2>
      <div class="sub">Sala <b style="font-family:var(--font-mono);">${esc(mpIdentity.room)}</b> · Jogando como <b>${esc(mpIdentity.nickname)}</b> · <button class="action ghost" id="mp-leave-btn" style="padding:4px 10px;font-size:.72rem;display:inline;">Sair da sala</button></div>
      <div class="desc" style="margin-bottom:10px;">Compartilhe o código <b style="font-family:var(--font-mono);">${mpIdentity.room}</b> com seus amigos para eles entrarem na mesma sala.</div>
      ${mpCache.error ? `<div class="desc" style="color:var(--barn-red);">${mpCache.error}</div>` : ''}
      <button class="action ghost" id="mp-refresh-btn" style="margin-bottom:14px;">🔄 Atualizar sala${mpCache.loading?' (carregando...)':''}</button>

      <div class="section-title">1. Publique seu galo</div>
      <div class="desc" style="margin-bottom:6px;">${myBird ? 'Publicado atualmente: '+lineageLabel(myBird.lineage)+' (Poder '+Math.round(fighterPower(myBird))+')' : 'Você ainda não publicou nenhum galo nesta sala.'}</div>
      <div class="stat-row" style="gap:6px;flex-wrap:wrap;">${publishOptions}</div>

      <div class="section-title">2. Escolha seu desafiante</div>
      <div class="stat-row" style="gap:6px;flex-wrap:wrap;">${myFighterOptions}</div>

      <div class="section-title">3. Desafie os galos da sala</div>
      <div class="grid grid-fighters">${oppCards}</div>

      <div class="section-title">Últimos resultados da sala</div>
      <div class="tier-list">${logItems}</div>
    </div>`;
}

/* --- Etapa 8: Árvore genealógica --- */
function genealogyDepthTag(depth, gender){
  const labels = { 1:['Pai','Mãe'], 2:['Avô','Avó'], 3:['Bisavô','Bisavó'] }[depth] || ['Ancestral','Ancestral'];
  return gender==='M' ? labels[0] : labels[1];
}
function renderGenealogyNode(node, depth){
  if(depth>3) return '';
  if(!node){
    const tag = genealogyDepthTag(depth,'M')+'/'+genealogyDepthTag(depth,'F');
    return `<div class="gen-node gen-empty"><span class="gen-tag">${tag}</span><span class="gen-name">— sem registro (ave selvagem ou de antes desta atualização) —</span></div>`;
  }
  const tag = genealogyDepthTag(depth, node.gender);
  const childrenHtml = node.parents ? node.parents.map(p=>renderGenealogyNode(p, depth+1)).join('') : renderGenealogyNode(null, depth+1)+renderGenealogyNode(null, depth+1);
  return `<div class="gen-node ${node.isPhenomenal?'phenomenal-node':''}">
      <span class="gen-tag">${tag}${node.isPhenomenal?' ✨':''}</span>
      <span class="gen-name">${node.gender==='M'?'🐓':'🐔'} ${esc(node.name||'?')} — ${lineageLabel(node.lineage)} F${node.generation||1}</span>
    </div>${childrenHtml}`;
}
function showGenealogy(id){
  const f = state.fighters.find(x=>x.id===id);
  if(!f) return;
  const overlay = document.getElementById('genealogy-overlay');
  const content = document.getElementById('genealogy-content');
  const pai = f.parents ? f.parents.find(p=>p && p.gender==='M') || f.parents[0] : null;
  const mae = f.parents ? f.parents.find(p=>p && p.gender==='F') || f.parents[1] : null;
  content.innerHTML = `
    <div class="desc" style="margin-bottom:14px;">${f.gender==='M'?'🐓':'🐔'} <b>${esc(f.name)}</b> — ${lineageLabel(f.lineage)} F${f.generation||1} · Diversidade: ${diversityLabel(f.diversity)}</div>
    <div class="gen-branches">
      <div class="gen-branch"><h4>Linha paterna</h4>${renderGenealogyNode(pai||null, 1)}</div>
      <div class="gen-branch"><h4>Linha materna</h4>${renderGenealogyNode(mae||null, 1)}</div>
    </div>`;
  overlay.classList.add('open');
  document.getElementById('genealogy-close').onclick = ()=>{
    // Saída animada: .closing antes de remover .open.
    overlay.classList.add('closing');
    setTimeout(()=>{ overlay.classList.remove('open'); overlay.classList.remove('closing'); }, 160);
  };
}