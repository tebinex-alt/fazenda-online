/* =========================================================
   LOOP DO JOGO
========================================================= */
let lastTick = Date.now();

/* Offline (main.js) usa mult menor — a fazenda anda sozinha, mas claramente
   pior que jogando ativamente. Simula de uma vez só o tempo que passou desde
   o último save (limitado a MAX_OFFLINE_SECONDS, pra não gerar números
   absurdos se o jogador ficar dias sem abrir). Aves não têm Bônus de
   Atividade nesse período — só a produção base × OFFLINE_PRODUCTION_MULT. */
const OFFLINE_PRODUCTION_MULT = 0.5;
const MAX_OFFLINE_SECONDS = 12 * 3600;

async function applyOfflineProgress(){
  const now = Date.now();
  const last = state.lastSaved || now;
  let elapsed = (now - last) / 1000;
  lastTick = now;
  if(!(elapsed > 5)){
    state.lastSaved = now;
    return;
  }
  elapsed = Math.min(elapsed, MAX_OFFLINE_SECONDS);
  const { eggsGained, feedUsed } = produceCoop(elapsed, OFFLINE_PRODUCTION_MULT);
  state.lastSaved = now;
  if(eggsGained > 0){
    toast('🌙 Enquanto você estava fora, o galinheiro produziu '+fmt(eggsGained)+' ovos (consumindo '+fmt(feedUsed)+' de ração).');
  }
}

function produceCoop(dt, mult=1){
  let eggsGained=0, feedUsed=0;
  for(const bid in state.coop){
    const c = state.coop[bid];
    if(c.count<=0) continue;
    const breed = breedById(bid);
    const rate = c.count/breed.eggTime * mult;

    // Anti-bancagem: se a produção está bloqueada (sem ração ou armazém de
    // ovos cheio), o progresso não passa de 1 ciclo. Antes, o progresso podia
    // acumular sem teto — dava pra deixar o galinheiro "carregado" por horas
    // e colher tudo de uma vez quando a ração/armazém voltasse.
    const roomEggs = eggCapacity()-state.eggs;
    const maxCyclesByRoom = breed.eggsPerCycle>0 ? Math.floor(roomEggs/breed.eggsPerCycle) : Infinity;
    const maxCyclesByFeed = breed.feedPerCycle>0 ? Math.floor(state.feed/breed.feedPerCycle) : Infinity;
    if(maxCyclesByRoom<=0 || maxCyclesByFeed<=0) c.progress = Math.min(c.progress, 1);

    c.progress += rate*dt;
    let cycles = Math.floor(c.progress);
    if(cycles>0){
      // Produz só o que dá pra pagar/armazenar, sem descartar o resto do progresso.
      cycles = Math.min(cycles, maxCyclesByRoom, maxCyclesByFeed);
      if(cycles>0){
        c.progress -= cycles;
        const f = cycles*breed.feedPerCycle, e = cycles*breed.eggsPerCycle;
        state.feed -= f; state.eggs += e;
        feedUsed += f; eggsGained += e;
      } else {
        c.progress = Math.min(c.progress, 1);
      }
    }
  }
  if(state.feed<0) state.feed=0;
  if(state.eggs>eggCapacity()) state.eggs=eggCapacity();
  // O trator reaproveita canteiros vazios no mesmo tick — o jogador não precisa
  // clicar em nenhum slot; a colheita já sai e o próximo milho já entra.
  if(state.autoPlot){
    state.plots.forEach(p=>{
      if(!p.planted){
        p.planted=true; p.plantedAt=Date.now(); p.ready=false;
      }
    });
  }
  return { eggsGained, feedUsed };
}

function gameTick(){
  const now = Date.now();
  const dt = Math.min((now-lastTick)/1000, 5);
  lastTick = now;

  // Quem está ONLINE produz mais: o Bônus de Atividade multiplica a produção.
  // Offline (main.js) usa mult menor — a fazenda anda sozinha, mas claramente pior.
  decayActivityIfIdle();
  produceCoop(dt, activityBonusMult());

  const gt = plotGrowTime()*1000;
  state.plots.forEach((p)=>{
    if(p.planted && !p.ready && (now-p.plantedAt)>=gt) p.ready = true;
    // Trator ativado: colhe e planta sozinho assim que fica pronto.
    if(state.autoPlot && p.ready){
      const room = feedCapacity()-state.feed;
      if(room>0){
        state.feed += Math.min(plotYieldAmt(), room);
        p.planted=false; p.ready=false; p.plantedAt=0;
      }
    }
  });

  state.incubator.forEach(s=>{
    if(s.filled && !s.ready && (now-s.startedAt)>=s.hatchTime*1000) s.ready = true;
  });

  while(state.cages.length < cageCount()) state.cages.push(mkCage());
  state.cages.forEach(cg=>{
    if(!cg.occupied || cg.ready) return;
    const elapsed = (now-cg.stageStartedAt)/1000;
    const dur = FIGHT_STAGE_TIME[cg.stage];
    if(elapsed>=dur){
      if(cg.stage==='ovo'){ cg.stage='pintinho'; cg.stageStartedAt=now; }
      else if(cg.stage==='pintinho'){ cg.stage='frango'; cg.stageStartedAt=now; }
      else if(cg.stage==='frango'){ cg.ready=true; }
    }
  });

  state.breedPens.forEach(pen=>{
    if(pen.active && (now-pen.startedAt)>=pen.duration*1000){
      resolveBreeding(pen);
    }
  });

  state.fighters.forEach(f=>finishTrainingIfDue(f));

  renderTick();
}

/* renderTick: atualiza topo e cenário a cada tick e chama tickTab(), que NÃO
   reconstrói a aba a cada segundo — só em transições (algo pronto, mudou de
   estágio). O gameTick roda a cada 1s; antes, ele re-renderizava a aba inteira,
   o que reiniciava as animações CSS e perdia cliques quando o elemento era
   substituído entre o mousedown e o mouseup. A aba Online (com campos de texto)
   só é re-renderizada em eventos (trocar de aba, entrar/sair, atualizar). */
function renderTick(){
  renderTopbar();
  renderScene();
  if(activeTab !== 'online') tickTab();
}

/* tickTab: atualiza a aba ativa SEM reconstruir o DOM — só contadores/timers
   (segundos restantes, barras de progresso). Quando algo muda de estado
   (plantação pronta, ovo chocado, ave adulta, cruza terminada, treino
   concluído), chama renderTab() para trocar classes/animações. */
let lastTraining = new Map(); // fighterId -> trainingUntil (detecta conclusão)

function tickTab(){
  const main = document.getElementById('main-content');
  if(!main || !main.children.length) return;
  const now = Date.now();
  let needRebuild = false;

  if(activeTab==='plantation'){
    main.querySelectorAll('.plot[data-plot]').forEach(el=>{
      const p = state.plots[+el.dataset.plot];
      if(!p) return;
      // Trator colheu/plantou sozinho: estado mudou sem ação do usuário
      if(state.autoPlot && !p.planted && el.classList.contains('growing')){ needRebuild = true; return; }
      if(!p.planted) return;
      const small = el.querySelector('small');
      if(p.ready){
        if(!el.classList.contains('ready')){ el.classList.add('ready'); needRebuild = true; }
      } else {
        const remaining = Math.max(0, plotGrowTime() - (now-p.plantedAt)/1000);
        if(small) small.textContent = Math.ceil(remaining)+'s restantes';
      }
    });
  }
  else if(activeTab==='breed'){
    state.breedPens.forEach((pen,i)=>{
      if(!pen.active) return;
      const penEl = main.querySelector('[data-pen="'+i+'"]');
      if(!penEl) return;
      const remaining = Math.max(0, pen.duration - (now-pen.startedAt)/1000);
      const small = penEl.querySelector('small');
      if(small) small.textContent = Math.ceil(remaining)+'s restantes';
      if(remaining<=0) needRebuild = true; // resolveBreeding rodou no gameTick
    });
  }
  else if(activeTab==='incubator'){
    state.incubator.forEach((s,i)=>{
      if(!s.filled) return;
      const slotEl = main.querySelector('[data-inc-slot="'+i+'"]');
      const small = slotEl ? slotEl.querySelector('small') : null;
      if(s.ready){
        if(small) small.textContent = 'Nasceu!';
      } else {
        const remaining = Math.max(0, s.hatchTime - (now-s.startedAt)/1000);
        if(small) small.textContent = Math.ceil(remaining)+'s';
        if(remaining<=0) needRebuild = true;
      }
    });
  }
  else if(activeTab==='fighters'){
    state.cages.forEach((cg,i)=>{
      if(!cg.occupied || cg.ready) return;
      const cageEl = main.querySelector('[data-cage="'+i+'"]');
      const small = cageEl ? cageEl.querySelector('small:last-of-type') : null;
      if(!small) return;
      const dur = FIGHT_STAGE_TIME[cg.stage];
      const remaining = Math.max(0, dur-(now-cg.stageStartedAt)/1000);
      small.textContent = Math.ceil(remaining)+'s restantes';
      if(remaining<=0) needRebuild = true; // trocou de estágio
    });
    // status de treino nos flip-cards (só quando virados, para não quebrar texto)
    state.fighters.forEach(f=>{
      const card = main.querySelector('[data-flip="local:'+f.id+'"]');
      if(!card) return;
      const was = lastTraining.get(f.id);
      const is = f.trainingUntil || 0;
      if(was && was<=now && is<=now){ /* terminou agora */ needRebuild = true; }
      else if(card.classList.contains('flipped')){
        const desc = card.querySelector('.fc-back .desc');
        if(desc && is>now) desc.textContent = '🏋️ Treinando '+statLabel(f.trainingStat)+'... '+Math.max(0,Math.ceil((is-now)/1000))+'s';
      }
      lastTraining.set(f.id, is);
    });
  }

  if(needRebuild) renderTab();
}

function resolveBreeding(pen){
  const fromIdx = breedIndex(pen.breedFrom);
  const trans = BREED_TRANSITION[fromIdx];
  const success = Math.random() < trans.chance;
  if(success){
    const targetBreed = BREEDS[fromIdx+1];
    state.fertileQueue.push({ breedId: targetBreed.id, hatchTime: trans.hatch });
    toast('💞 Cruza bem-sucedida! Ovo fértil de '+targetBreed.name+' pronto para incubar.');
  } else {
    toast('💔 A cruza não deu certo desta vez. Tente novamente!');
  }
  pen.active=false; pen.breedFrom=null; pen.startedAt=0; pen.duration=0;
}

