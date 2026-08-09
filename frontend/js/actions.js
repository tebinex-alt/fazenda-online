/* =========================================================
   AÇÕES
========================================================= */
const CHICKEN_SELL_RATIO = 0.4;
function sellChicken(bid){
  const breed = breedById(bid);
  const owned = state.coop[bid]?.count||0;
  if(!breed || owned<=0) return;
  const refund = Math.round(breed.cost*CHICKEN_SELL_RATIO);
  confirmAction({
    icon:breed.emoji,
    title:'Vender 1 '+breed.name+'?',
    text:'Você recebe '+money(refund)+' e libera 1 vaga no galinheiro.',
    onYes:()=>{
      if((state.coop[bid]?.count||0)<=0) return;
      state.coop[bid].count--;
      state.money += refund;
      toast('Vendeu 1 '+breed.name+' por '+money(refund)+'.');
      saveGame(); render();
    }
  });
}

function buyChicken(bid){
  const breed = breedById(bid);
  if(!breed) return;
  if(breedIndexUnlocked(breed)===false){ toast('🔒 Ainda não desbloqueado.'); return; }
  if(totalChickens() >= coopCapacity()){ toast('🏠 Galinheiro cheio! Amplie a capacidade na Loja.'); return; }
  const price = chickenPrice(bid);
  if(state.money < price){ toast('💰 Dinheiro insuficiente.'); return; }
  const doBuy = ()=>{
    const p = chickenPrice(bid);
    if(state.money < p){ toast('💰 Dinheiro insuficiente.'); return; }
    if(totalChickens() >= coopCapacity()){ toast('🏠 Galinheiro cheio!'); return; }
    state.money -= p;
    if(!state.coop[bid]) state.coop[bid] = { count:0, progress:0 };
    state.coop[bid].count++;
    registerActivity('buy');
    toast('Comprou 1x '+breed.name+'!');
    saveGame(); render();
  };
  if(price >= CONFIRM_THRESHOLD){
    const owned = state.coop[bid]?.count||0;
    confirmAction({
      icon:breed.emoji,
      title:'Comprar '+breed.name+'?',
      text:'Custo: '+money(price)+' (você já tem '+owned+').',
      onYes:doBuy
    });
  } else doBuy();
}
function breedIndexUnlocked(breed){ return state.tierIndex >= breed.tierReq; }

function sellEggs(){
  if(state.eggs<=0) return;
  const gain = state.eggs*eggSellPrice();
  state.money += gain;
  state.totalEarned += gain;
  state.eggs = 0;
  checkTierUp();
  registerActivity('sell');
  toast('Vendeu ovos por '+money(gain)+'!');
  saveGame(); render();
}
function buyFeed(amount){
  const cost = amount*FEED_BUY_PRICE;
  if(state.money<cost){ toast('💰 Dinheiro insuficiente.'); return; }
  const room = feedCapacity()-state.feed;
  const actual = Math.min(amount, room);
  if(actual<=0){ toast('🌾 Celeiro cheio.'); return; }
  state.money -= actual*FEED_BUY_PRICE;
  state.feed += actual;
  registerActivity('feed');
  toast('Comprou '+fmt(actual)+' de ração.');
  saveGame(); render();
}
function buyUpgrade(id){
  if(upgMaxed(id)){ toast('⭐ Já está no nível máximo!'); return; }
  const cost = upgCost(id);
  if(state.money<cost){ toast('💰 Dinheiro insuficiente.'); return; }
  const doBuy = ()=>{
    if(upgMaxed(id)) return;
    const c = upgCost(id);
    if(state.money<c){ toast('💰 Dinheiro insuficiente.'); return; }
    state.money -= c;
    state.upgrades[id] = (state.upgrades[id]||0)+1;
    if(id==='plots') state.plots.push(mkPlot());
    if(id==='incSlots') state.incubator.push(mkIncSlot());
    if(id==='breedPens') state.breedPens.push(mkPen());
    if(id==='cages') state.cages.push(mkCage());
    if(id==='tractor') state.autoPlot = true;
    registerActivity('buy');
    toast(UPGRADE_DEFS[id].icon+' '+UPGRADE_DEFS[id].name+' melhorado!');
    saveGame(); render();
  };
  const d = UPGRADE_DEFS[id];
  if(cost >= CONFIRM_THRESHOLD){
    confirmAction({
      icon:d.icon,
      title:'Comprar '+d.name+'?',
      text:'Custo: '+money(cost)+' · '+d.desc+' · Nível atual '+upgLevel(id)+'/'+d.max+'.',
      onYes:doBuy
    });
  } else doBuy();
}

function plantPlot(i){
  const p = state.plots[i];
  if(p.planted) return;
  p.planted = true; p.plantedAt = Date.now(); p.ready=false;
  registerActivity('harvest');
  render();
}
function harvestPlot(i){
  const p = state.plots[i];
  if(!p.ready) return;
  const room = feedCapacity()-state.feed;
  const gain = Math.min(plotYieldAmt(), room);
  state.feed += gain;
  p.planted=false; p.ready=false; p.plantedAt=0;
  registerActivity('harvest');
  toast('🌾 Colheu '+fmt(gain)+' de ração!');
  saveGame(); render();
}

function fillIncubatorSlot(i){
  const s = state.incubator[i];
  if(s.filled) return;
  if(state.fertileQueue.length===0){ toast('Sem ovos férteis disponíveis. Faça uma cruza primeiro!'); return; }
  const item = state.fertileQueue.shift();
  s.filled=true; s.breedTarget=item.breedId; s.startedAt=Date.now();
  s.hatchTime = item.hatchTime*incSpeedMult();
  s.ready=false;
  saveGame(); render();
}
function collectIncubatorSlot(i){
  const s = state.incubator[i];
  if(!s.ready) return;
  if(totalChickens() >= coopCapacity()){ toast('🏠 Galinheiro cheio! Amplie a capacidade primeiro.'); return; }
  const bid = s.breedTarget;
  if(!state.coop[bid]) state.coop[bid] = { count:0, progress:0 };
  state.coop[bid].count++;
  toast('🐣 Nasceu uma '+breedById(bid).name+'!');
  state.incubator[i] = mkIncSlot();
  saveGame(); render();
}

function selectBreedTarget(bid){
  state.selectedBreedForBreed = bid;
  render();
}
function startBreeding(penIdx){
  const bid = state.selectedBreedForBreed;
  if(!bid) return;
  const fromIdx = breedIndex(bid);
  if(fromIdx<0 || fromIdx>=BREED_TRANSITION.length){ toast('Esta espécie já é a mais evoluída!'); return; }
  const trans = BREED_TRANSITION[fromIdx];
  const c = state.coop[bid];
  if(!c || c.count<2){ toast('É preciso ter ao menos 2 dessa galinha.'); return; }
  if(state.money<trans.cost){ toast('💰 Dinheiro insuficiente para a cruza.'); return; }
  const pen = state.breedPens[penIdx];
  if(pen.active){ toast('Curral ocupado.'); return; }
  const target = BREEDS[fromIdx+1];
  confirmAction({
    icon:'💞',
    title:'Iniciar cruza?',
    text:'Custo: '+money(trans.cost)+' · Duração: '+trans.duration+'s · Chance de sucesso: '+Math.round(trans.chance*100)+'%.',
    onYes:()=>{
      if(state.money<trans.cost || pen.active) { toast('Não foi possível iniciar a cruza.'); return; }
      state.money -= trans.cost;
      pen.active=true; pen.breedFrom=bid; pen.startedAt=Date.now(); pen.duration=trans.duration;
      registerActivity('breed');
      toast('💞 Cruza iniciada!');
      saveGame(); render();
    }
  });
}

/* ---------- Aves de combate ---------- */
function buyFightEgg(breedTypeId){
  const breedType = fightBreedById(breedTypeId);
  if(!breedType) return;
  const freeCage = state.cages.find(c=>!c.occupied);
  if(!freeCage){ toast('🐣 Todas as gaiolas estão ocupadas.'); return; }
  if(state.money < breedType.cost){ toast('💰 Dinheiro insuficiente.'); return; }
  const doBuy = ()=>{
    const fc = state.cages.find(c=>!c.occupied);
    if(!fc){ toast('🐣 Todas as gaiolas estão ocupadas.'); return; }
    if(state.money < breedType.cost){ toast('💰 Dinheiro insuficiente.'); return; }
    state.money -= breedType.cost;
    fc.occupied=true; fc.stage='ovo'; fc.stageStartedAt=Date.now();
    fc.careFed={pintinho:false,frango:false};
    fc.gender = Math.random()<0.5?'M':'F';
    const stats = rollStatsForBreed(breedType.id);
    fc.baseForca = stats.forca; fc.baseVel = stats.velocidade; fc.baseRes = stats.resistencia; fc.baseInstinto = stats.instinto;
    fc.breedType = breedType.id;
    fc.lineage = computeGenetics(stats).lineageTier;
    fc.generation = 1;
    fc.diversity = 'excelente';
    fc.parents = null;
    fc.ready=false;
    toast('🥚 Ovo de '+breedType.name+' colocado na gaiola!');
    saveGame(); render();
  };
  confirmAction({
    icon:breedType.emoji, title:'Comprar ovo de '+breedType.name+'?',
    text:'Custo: '+money(breedType.cost)+'. '+breedType.desc,
    onYes:doBuy
  });
}
function feedCage(i){
  const cg = state.cages[i];
  if(!cg.occupied || cg.ready) return;
  if(cg.stage==='ovo'){ toast('Ovos ainda não precisam de alimentação.'); return; }
  if(cg.careFed[cg.stage]){ toast('Já alimentou nesta fase.'); return; }
  const cost = FIGHT_FEED_COST[cg.stage];
  if(state.feed < cost){ toast('🌾 Ração insuficiente.'); return; }
  state.feed -= cost;
  cg.careFed[cg.stage] = true;
  toast('🌾 Alimentou a ave.');
  saveGame(); render();
}
function collectFighter(i){
  const cg = state.cages[i];
  if(!cg.ready) return;
  if(state.fighters.length >= rosterCap()){
    toast('🐔 Aviário cheio! Você só pode manter '+rosterCap()+' aves de combate adultas ao mesmo tempo. Venda uma ave ou amplie o plantel na Loja antes de coletar esta.');
    return;
  }
  // A genética vem 100% dos pais/raça — alimentar durante a criação não dá
  // mais bônus de atributos. A ração só evita que a ave fique fraca de fome.
  let forca = cg.baseForca;
  let velocidade = cg.baseVel;
  let resistencia = cg.baseRes;
  let instinto = cg.baseInstinto||0;

  const isPhenomenal = rollPhenomenal();
  if(isPhenomenal){
    const boosted = applyPhenomenalBoost({ forca, velocidade, resistencia, instinto });
    forca = boosted.forca; velocidade = boosted.velocidade; resistencia = boosted.resistencia; instinto = boosted.instinto;
  }

  const genetics = isPhenomenal
    ? { potentialMax: 100, quality: 5, lineageTier: 'mitica' }
    : computeGenetics({ forca, velocidade, resistencia, instinto }, cg.diversity);

  const f = {
    id: fighterId(), name: randomFighterName(), gender: cg.gender,
    breedType: cg.breedType || null,
    forca, velocidade, resistencia, instinto,
    birthStats: { forca, velocidade, resistencia, instinto }, // genética de nascença (imutável, treino não altera isso)
    lineage: genetics.lineageTier,
    generation: cg.generation || 1,
    diversity: cg.diversity || 'excelente',
    parents: cg.parents || null,
    quality: genetics.quality,
    potential: {
      forca: genetics.potentialMax, velocidade: genetics.potentialMax,
      resistencia: genetics.potentialMax, instinto: genetics.potentialMax,
    },
    wins:0, losses:0, restUntil:0, trainingUntil:0, trainingStat:null,
    isBreeder:false,
    isPhenomenal,
  };
  state.fighters.push(f);
  state.cages[i] = mkCage();
  if(isPhenomenal){
    toast('✨✨✨ FENOMENAL! ✨✨✨ '+(f.gender==='M'?'🐓':'🐔')+' '+f.name+' nasceu com uma genética perfeita — 1 em 20.000! Essa ave ficará marcada pra sempre.');
  } else {
    const stars = '★'.repeat(genetics.quality)+'☆'.repeat(5-genetics.quality);
    const divWarn = (f.diversity==='baixa'||f.diversity==='critica') ? ' ⚠️ Diversidade '+DIVERSITY_TIERS[f.diversity].name+'!' : '';
    toast((f.gender==='M'?'🐓':'🐔')+' '+f.name+' nasceu! Linhagem '+lineageLabel(f.lineage)+' '+stars+' F'+f.generation+'.'+divWarn);
  }
  saveGame(); render();
}
function selectFighter(slot, id){
  if(slot==='A') state.selectedFighterA = state.selectedFighterA===id?null:id;
  else state.selectedFighterB = state.selectedFighterB===id?null:id;
  render();
}

function toggleBreeder(id){
  const f = state.fighters.find(x=>x.id===id);
  if(!f) return;
  f.isBreeder = !f.isBreeder;
  toast(f.isBreeder ? '⭐ '+(f.name||'Ave')+' marcada como Reprodutor.' : (f.name||'Ave')+' desmarcada como Reprodutor.');
  saveGame(); render();
}

function sellFighter(id){
  const f = state.fighters.find(x=>x.id===id);
  if(!f) return;
  const price = fighterSellPrice(f);
  const breederWarn = f.isBreeder ? ' ⚠️ Esta ave está marcada como ⭐ Reprodutor!' : '';
  confirmAction({
    icon: f.isBreeder ? '⚠️' : '💰',
    title:'Vender '+(f.name||'esta ave')+'?',
    text: `${lineageLabel(f.lineage)} · ${'★'.repeat(f.quality||1)}${'☆'.repeat(5-(f.quality||1))} · F${f.generation||1} · Poder ${Math.round(fighterPower(f))} · ${f.wins}V/${f.losses}D. Você recebe ${money(price)}.${breederWarn} Esta ação não pode ser desfeita.`,
    onYes:()=>{
      state.fighters = state.fighters.filter(x=>x.id!==id);
      if(state.selectedFighterA===id) state.selectedFighterA=null;
      if(state.selectedFighterB===id) state.selectedFighterB=null;
      if(state.selectedArenaFighter===id) state.selectedArenaFighter=null;
      state.money += price;
      toast('💰 '+(f.name||'Ave')+' vendida por '+money(price)+'.');
      saveGame(); render();
    }
  });
}

function breedFighters(){
  const a = state.fighters.find(f=>f.id===state.selectedFighterA);
  const b = state.fighters.find(f=>f.id===state.selectedFighterB);
  if(!a||!b){ toast('Selecione um galo e uma galinha.'); return; }
  if(a.gender===b.gender){ toast('É preciso 1 galo e 1 galinha para cruzar.'); return; }
  if(isResting(a)||isResting(b)){ toast('Uma das aves ainda está descansando.'); return; }
  if(a.trainingUntil>Date.now()||b.trainingUntil>Date.now()){ toast('Uma das aves está em treino.'); return; }
  const freeCage = state.cages.find(c=>!c.occupied);
  if(!freeCage){ toast('🐣 Nenhuma gaiola livre.'); return; }
  if(state.money<FIGHT_BREED_COST){ toast('💰 Dinheiro insuficiente.'); return; }

  // Etapa 2 — reprodução real: a herança usa a genética de NASCENÇA de cada pai
  // (não o quanto foi treinado depois), pra treino não virar genética permanente.
  const successChance = 0.85;

  // Etapa 4 — consanguinidade: calculada ANTES de confirmar, pra avisar o jogador
  // se os dois pais são parentes próximos antes de ele gastar o dinheiro.
  const diversity = computeDiversity(a, b);
  const divWarnText = (diversity.id==='baixa'||diversity.id==='critica')
    ? ` ⚠️ Diversidade genética ${diversity.name} entre os pais — o filhote pode nascer com potencial reduzido.`
    : '';

  confirmAction({
    icon: (diversity.id==='critica') ? '⚠️' : '💞',
    title:'Cruzar estas duas aves?',
    text: `Custo: ${money(FIGHT_BREED_COST)}. Cruzando ${a.name} (${lineageLabel(a.lineage)}, F${a.generation||1}) com ${b.name} (${lineageLabel(b.lineage)}, F${b.generation||1}). O filhote nasce F${Math.max(a.generation||1,b.generation||1)+1}. Chance de sucesso: ${Math.round(successChance*100)}%.${divWarnText}`,
    onYes:()=>{
      const fc = state.cages.find(c=>!c.occupied);
      if(!fc || state.money<FIGHT_BREED_COST){ toast('Não foi possível cruzar.'); return; }
      state.money -= FIGHT_BREED_COST;
      state.selectedFighterA=null; state.selectedFighterB=null;

      if(Math.random() >= successChance){
        toast('💔 A genética não combinou. Tente novamente!');
        saveGame(); render();
        return;
      }

      // Herança individual por atributo: cada característica vem 100% do pai
      // OU 100% da mãe (50/50 por atributo) — a força pode vir do pai, a
      // velocidade da mãe, e assim por diante. Depois disso, cada atributo
      // tem uma chance de sofrer uma MUTAÇÃO (positiva ou negativa) que
      // depende da diversidade genética do cruzamento: quanto pior a
      // diversidade, maior a chance de mutar e maior a chance de a mutação
      // ser ruim. Diversidade boa = herança limpa e previsível.
      const MUTATION_CHANCE_BY_DIVERSITY = {
        excelente: 0.03, boa: 0.05, normal: 0.08, baixa: 0.14, critica: 0.22,
      };
      const BAD_MUTATION_BY_DIVERSITY = {
        excelente: 0.4, boa: 0.45, normal: 0.55, baixa: 0.7, critica: 0.85,
      };
      const mutationChance = MUTATION_CHANCE_BY_DIVERSITY[diversity.id] ?? 0.08;
      const badBias = BAD_MUTATION_BY_DIVERSITY[diversity.id] ?? 0.5;
      const inheritStat = (parentA, parentB) => {
        let base = Math.random()<0.5 ? parentA : parentB; // 100% de um dos pais
        if(Math.random() < mutationChance){
          const good = Math.random() >= badBias;
          base += (good?1:-1) * randInt(5, 12); // mutação mais forte que a variação comum
        }
        return Math.max(5, Math.min(100, Math.round(base)));
      };

      const genesA = a.birthStats || a; // fallback defensivo, migrateState já preenche isso
      const genesB = b.birthStats || b;
      const babyStats = {
        forca: inheritStat(genesA.forca, genesB.forca),
        velocidade: inheritStat(genesA.velocidade, genesB.velocidade),
        resistencia: inheritStat(genesA.resistencia, genesB.resistencia),
        instinto: inheritStat(genesA.instinto, genesB.instinto),
      };
      const genetics = computeGenetics(babyStats, diversity.id);

      fc.occupied=true; fc.stage='ovo'; fc.stageStartedAt=Date.now();
      fc.careFed={pintinho:false,frango:false};
      fc.gender = Math.random()<0.5?'M':'F';
      fc.baseForca = babyStats.forca;
      fc.baseVel = babyStats.velocidade;
      fc.baseRes = babyStats.resistencia;
      fc.baseInstinto = babyStats.instinto;
      fc.breedType = a.breedType || b.breedType || null; // cruza herda a raça do 1º pai com raça definida
      fc.lineage = genetics.lineageTier;
      fc.generation = Math.max(a.generation||1, b.generation||1) + 1;
      fc.diversity = diversity.id;
      fc.parents = [ancestorSnapshot(a, 3), ancestorSnapshot(b, 3)];
      fc.ready=false;

      toast(`💞 Cruza realizada! Novo ovo linhagem ${lineageLabel(fc.lineage)} (F${fc.generation}) na gaiola.`);
      saveGame(); render();
    }
  });
}

function trainFighter(id, statKey){
  const f = state.fighters.find(x=>x.id===id);
  if(!f) return;
  if(isResting(f)){ toast('Esta ave está descansando.'); return; }
  if(f.trainingUntil>Date.now()){ toast('Esta ave já está em treino.'); return; }
  if(f[statKey] >= f.potential[statKey]){ toast('🧬 Limite genético atingido! Cruze para melhorar o potencial.'); return; }
  if(state.money < FIGHT_TRAIN_COST){ toast('💰 Dinheiro insuficiente.'); return; }
  if(state.feed < FIGHT_TRAIN_FEED){ toast('🌾 Ração insuficiente para treinar.'); return; }

  const doTrain = ()=>{
    if(state.money<FIGHT_TRAIN_COST || state.feed<FIGHT_TRAIN_FEED || f.trainingUntil>Date.now()){
      toast('Não foi possível treinar.'); return;
    }
    state.money -= FIGHT_TRAIN_COST;
    state.feed -= FIGHT_TRAIN_FEED;
    f.trainingUntil = Date.now() + FIGHT_TRAIN_TIME*1000;
    f.trainingStat = statKey;
    registerActivity('fight');
    toast('🏋️ Treino iniciado! Duração: '+FIGHT_TRAIN_TIME+'s.');
    saveGame(); render();
  };

  confirmAction({
    icon:'🏋️',
    title:'Iniciar treino de '+statLabel(statKey)+'?',
    text:'Custo: '+money(FIGHT_TRAIN_COST)+' + '+FIGHT_TRAIN_FEED+' ração · Duração: '+FIGHT_TRAIN_TIME+'s. Quanto maior o atributo, menor o ganho.',
    onYes:doTrain
  });
}

function finishTrainingIfDue(f){
  if(f.trainingUntil && f.trainingUntil<=Date.now()){
    const stat = f.trainingStat;
    const cur = f[stat];
    const cap = f.potential[stat];
    const remaining = cap - cur;
    if(remaining <= 0){
      toast('✅ Treino concluído, mas já no limite genético.');
      f.trainingUntil=0; f.trainingStat=null; return;
    }
    const gain = Math.max(1, Math.min(remaining, Math.round(FIGHT_TRAIN_GAIN_BASE * (1 - FIGHT_TRAIN_GAIN_DECAY * cur))));
    f[stat] = Math.min(cap, cur + gain);
    toast('✅ Treino concluído! +'+gain+' em '+statLabel(stat)+' (atingiu '+f[stat]+'/'+cap+').');
    f.trainingUntil=0; f.trainingStat=null;
    saveGame();
  }
}

function statLabel(k){ return {forca:'Força', velocidade:'Velocidade', resistencia:'Resistência', instinto:'Instinto'}[k]||k; }
function lineageLabel(tierId){
  const t = LINEAGE_TIERS.find(x=>x.id===tierId);
  return t ? t.name : 'Comum';
}

/* Renomear galo: o nome aparece na árvore genealógica, no snapshot online
   e no HUD da Arena. Sanitiza igual ao apelido do multiplayer. */
let renameFighterId = null;
function openRename(id){
  const f = state.fighters.find(x=>x.id===id);
  if(!f) return;
  renameFighterId = id;
  const input = document.getElementById('rename-input');
  if(input) input.value = f.name || '';
  const overlay = document.getElementById('rename-overlay');
  if(overlay) overlay.classList.add('open');
  if(input) setTimeout(()=>input.focus(), 50);
}
function saveFighterName(){
  const overlay = document.getElementById('rename-overlay');
  if(!overlay) return;
  overlay.classList.remove('open');
  if(!renameFighterId) return;
  const f = state.fighters.find(x=>x.id===renameFighterId);
  renameFighterId = null;
  if(!f) return;
  const raw = String(document.getElementById('rename-input').value || '').trim()
    .replace(/[\u0000-\u001F\u007F<>"'`]/g, '')
    .slice(0,16);
  if(raw) f.name = raw;
  saveGame(); render();
  if(window.SFX && SFX.available()) SFX.ui();
  toast(raw ? '✏️ Nome atualizado para "'+raw+'".' : 'Nome mantido como estava.');
}

/* Bind estático do overlay de renomear (DOM estático do index.html). */
(function(){
  const overlay = document.getElementById('rename-overlay');
  if(!overlay) return;
  const cancelBtn = document.getElementById('rename-cancel');
  const saveBtn = document.getElementById('rename-save');
  if(cancelBtn) cancelBtn.onclick = ()=>{ overlay.classList.remove('open'); renameFighterId = null; };
  if(saveBtn) saveBtn.onclick = saveFighterName;
  // clique fora da caixa fecha
  overlay.addEventListener('click', e=>{ if(e.target === overlay){ overlay.classList.remove('open'); renameFighterId = null; } });
})();

function enterArena(id){
  const f = state.fighters.find(x=>x.id===id);
  if(!f) return;
  if(isResting(f)){ toast('Esta ave ainda está descansando.'); return; }
  if(f.trainingUntil>Date.now()){ toast('Esta ave está em treino.'); return; }

  const rankIdx = arenaRankIndex();
  const rank = ARENA_RANKS[rankIdx];
  const power = fighterPower(f);

  if(power < rank.minPower){
    toast(`🔒 Poder necessário: ${rank.minPower} (seu: ${Math.round(power)}). Treine ou cruze para melhorar.`);
    return;
  }

  // Gate de linhagem: obriga a melhorar a genética para subir de ranking.
  if(lineageTierIndex(f.lineage) < lineageTierIndex(rank.minLineage)){
    toast(`🔒 Para lutar no ranking ${rank.name} sua ave precisa de linhagem ${lineageLabel(rank.minLineage)}+. Melhore sua genética!`);
    return;
  }

  // Sorteia um bot com identidade do rank atual.
  const bots = ARENA_BOTS.filter(b=>b.rank===rankIdx);
  const bot = bots[randInt(0, bots.length-1)];
  const oppPower = randInt(rank.oppPower[0], rank.oppPower[1]);
  const opponent = Combat.buildBotOpponent(bot, oppPower);

  // Multiplicadores de recompensa: sequência de vitórias e linhagem da ave.
  const streak = f.winStreak||0;
  const streakMult = streak >= 5 ? 2 : (streak >= 2 ? 1.5 : 1);
  const lineageMult = (f.lineage==='elite' ? 1.1 : (f.lineage==='imperial' ? 1.2 : (f.lineage==='mitica' ? 1.35 : 1)));
  const baseReward = Math.round(rank.reward * streakMult * lineageMult);

  // Dica de vantagem/desvantagem de raça para o jogador escolher consciente.
  let breedHint = '';
  if(opponent.breedType && f.breedType){
    if(BREED_COUNTER[f.breedType] === opponent.breedType) breedHint = `⚔️ Vantagem: ${fightBreedById(f.breedType).name} countera ${fightBreedById(opponent.breedType).name}.`;
    else if(BREED_COUNTER[opponent.breedType] === f.breedType) breedHint = `⚠️ Desvantagem: ${fightBreedById(opponent.breedType).name} countera ${fightBreedById(f.breedType).name}.`;
  }

  confirmAction({
    icon:'🏆', title:'Desafiar '+opponent.name+'?',
    text:`Rank ${rank.name}. Seu ${lineageLabel(f.lineage)} (poder ${Math.round(power)}) vs ${lineageLabel(opponent.lineage)} do bot (poder ${Math.round(fighterPower(opponent))}). Prêmio se vencer: ${money(baseReward)}. ${breedHint}`,
    onYes: ()=>{
      showFightScene(f, opponent, { rank, online:false, bot:opponent }, (won) => {
        registerActivity('arena');
        f.restUntil = Date.now() + FIGHT_REST_TIME*1000;

        if(won){
          f.wins++;
          f.winStreak = (f.winStreak||0)+1;
          // Bônus de primeira vitória no rank (uma vez por rank).
          if(!state.arena) state.arena = { records:{ bestPower:0, mostWins:0, longestStreak:0 }, titles:{} };
          if(!Array.isArray(state.arena.rankFirstWins)) state.arena.rankFirstWins = [];
          let firstWinBonus = 0;
          if(!state.arena.rankFirstWins.includes(rankIdx)){
            state.arena.rankFirstWins.push(rankIdx);
            firstWinBonus = Math.round(baseReward*0.5);
          }
          const totalReward = baseReward + firstWinBonus;
          state.money += totalReward;
          state.totalEarned += totalReward;
          checkTierUp();
          if(window.SFX && SFX.available()) SFX.coin();
          toast(`🏆 Vitória na Arena contra ${opponent.name}! +${money(totalReward)}${firstWinBonus?' (bônus de 1º rank)':''}.`);
        } else {
          f.losses++;
          f.winStreak = 0; // derrota local quebra a sequência
          if(rank.penalty > 0 && f.wins > 0) {
            f.wins = Math.max(0, f.wins - rank.penalty);
            toast(`💔 Derrota para ${opponent.name}! Perdeu ${rank.penalty} vitórias e precisa descansar.`);
          } else {
            f.restUntil = Date.now() + FIGHT_REST_TIME*2*1000;
            toast(`😔 Derrota para ${opponent.name}! Descanso estendido para ${Math.round(FIGHT_REST_TIME*2/60)} min.`);
          }
        }
        updateArenaFeats(f);
        saveGame(); render();
      });
    }
  });
}

/* Atualiza recordes + títulos da Arena após uma luta (local ou online).
   Os checks dos títulos são funções puras sobre state, então basta chamar
   esta função com qualquer ave que lutou e pronto. */
function updateArenaFeats(f){
  if(!state.arena) state.arena = { records:{ bestPower:0, mostWins:0, longestStreak:0 }, titles:{} };
  const rec = state.arena.records;
  rec.bestPower = Math.max(rec.bestPower, Math.round(fighterPower(f)));
  rec.mostWins = Math.max(rec.mostWins, f.wins||0);
  rec.longestStreak = Math.max(rec.longestStreak, f.winStreak||0);
  ARENA_TITLES.forEach(t=>{
    if(state.arena.titles[t.id]?.unlocked) return;
    if(!t.check(state)) return;
    state.arena.titles[t.id] = { unlocked:true, claimed:true };
    state.money += t.reward;
    state.totalEarned += t.reward;
    checkTierUp();
    toast(`👑 Título desbloqueado: ${t.emoji} ${t.name}! +${money(t.reward)}.`);
  });
  saveGame();
}

/* Luta animada da Arena. Pré-rola o resultado com Combat.simulateFight
   (a animação é playback fiel) e toca a cena PIXI via ArenaScene. Se o
   PIXI não carregou (CDN bloqueada → __pixiCdnFailed), cai para a animação
   de emoji. onEnd(won) é chamado UMA vez para aplicar as recompensas. */
function showFightScene(a, b, meta, onEnd){
  const fight = Combat.simulateFight(a, b);
  const won = fight.winner === 'a';
  const overlay = document.getElementById('arena-overlay');
  if(!overlay){ return onEnd(won); }
  const sceneEl = document.getElementById('arena-scene');

  const finish = () => {
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.classList.remove('open');
      overlay.classList.remove('closing');
      if(window.ArenaScene) ArenaScene.destroy();
    }, 200);
  };

  if(window.ArenaScene && ArenaScene.available()){
    overlay.classList.add('open');
    ArenaScene.mount(sceneEl);
    // onEnd é disparado pela cena quando o banner de resultado aparece;
    // onClose (botão Continuar) fecha o overlay.
    ArenaScene.play(fight, { fA:a, fB:b, onEnd, onClose:finish });
  } else {
    showArenaAnimationEmoji(a, b, meta, () => onEnd(won), finish, won);
  }
}

/* Fallback de animação quando o PIXI não está disponível: emojis dentro
   de #arena-scene, ~8 rounds com flash, resultado com pop e saída .closing.
   Mesmo contrato da cena: onEnd (recompensas) e onClose (fechar overlay). */
function showArenaAnimationEmoji(a, b, meta, onEnd, onClose, won){
  const overlay = document.getElementById('arena-overlay');
  const sceneEl = document.getElementById('arena-scene');
  const result = document.getElementById('arena-result');
  if(!overlay || !sceneEl){ return onEnd && onEnd(); }
  if(result) result.textContent = '';

  overlay.classList.add('open');

  const mk = (emoji, left) => {
    const el = document.createElement('div');
    el.className = 'fighter arena-fallback';
    el.textContent = emoji;
    el.style.left = left;
    el.style.top = '58%';
    sceneEl.appendChild(el);
    return el;
  };
  const p1 = mk(a && a.gender==='M' ? '🐓' : '🐔', '22%');
  const p2 = mk('🐓', '66%');
  const vsEl = document.createElement('div');
  vsEl.className = 'arena-vs';
  vsEl.textContent = 'VS';
  sceneEl.appendChild(vsEl);

  let round = 0;
  const interval = setInterval(() => {
    round++;
    if(window.SFX && SFX.available()) SFX.hit();
    // Flash de acerto: o fighter que "bate" neste round fica iluminado.
    p1.classList.remove('hit');
    p2.classList.remove('hit');
    (round % 2 === 0 ? p1 : p2).classList.add('hit');
    if(round % 2 === 0){
      p1.style.transform = 'translateX(14px) scale(1.15)';
      p2.style.transform = 'translateX(-14px) scale(0.92)';
    } else {
      p1.style.transform = 'translateX(-14px) scale(0.92)';
      p2.style.transform = 'translateX(14px) scale(1.15)';
    }
    if(round >= 8){
      clearInterval(interval);
      p1.style.transform = 'translateX(0) scale(1)';
      p2.style.transform = 'translateX(0) scale(1)';
      p1.classList.remove('hit');
      p2.classList.remove('hit');
      if(vsEl && vsEl.parentNode) vsEl.parentNode.removeChild(vsEl);
      if(result){
        result.textContent = '⚡⚡⚡';
        // Pop no resultado (reflow reinicia a animação CSS).
        result.classList.remove('pop');
        void result.offsetWidth;
        result.classList.add('pop');
      }
      if(window.SFX && SFX.available()){ if(won) SFX.victory(); else SFX.defeat(); }
      if(onEnd) onEnd();
      overlay.classList.add('closing');
      setTimeout(() => {
        overlay.classList.remove('open');
        overlay.classList.remove('closing');
        if(result) result.textContent = '...';
        if(onClose) onClose();
      }, 200);
    }
  }, 200);
}

