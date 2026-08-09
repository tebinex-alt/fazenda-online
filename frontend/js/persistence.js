/* =========================================================
   PERSISTÊNCIA (fala com o backend via Storage)
========================================================= */
let saveInFlight = false;
let saveQueued = false;
let saveDebounceTimer = null;

function saveGame(){
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(flushSave, 900);
}

async function flushSave(){
  state.lastSaved = Date.now();
  if(saveInFlight){ saveQueued = true; return; }
  saveInFlight = true;
  try{
    await saveWithRetry();
  } finally {
    saveInFlight = false;
    if(saveQueued){ saveQueued = false; flushSave(); }
  }
}
async function saveWithRetry(attempt=0){
  try{
    await Storage.set('fazenda-save', JSON.stringify(state), false);
  }catch(e){
    if(attempt < 2){
      await new Promise(r=>setTimeout(r, 600*(attempt+1)));
      return saveWithRetry(attempt+1);
    }
    console.warn('Não foi possível salvar agora — tentaremos de novo em breve.', e);
  }
}
async function loadGame(){
  try{
    const res = await Storage.get('fazenda-save', false);
    if(res && res.value){
      const loaded = JSON.parse(res.value);
      state = Object.assign(freshState(), loaded);
    } else {
      state = freshState();
    }
  }catch(e){
    state = freshState();
  }
  migrateState();
}

function migrateState(){
  if(!state.activity) state.activity = { level:0, lastAction:Date.now() };
  if(state.autoPlot===undefined) state.autoPlot = false;
  if(!Array.isArray(state.fighters)) state.fighters = [];
  if(!Array.isArray(state.cages) || state.cages.length===0) state.cages=[mkCage(),mkCage()];
  // Upgrade de Plantel: saves antigos não têm a chave (o plantel antes era
  // limitado pelas gaiolas). Começa em 0 — capacidade base de 2, como antes.
  if(state.upgrades?.roster === undefined) state.upgrades.roster = 0;

  if(!state.dnaVersion || state.dnaVersion < 2){
    // Etapa 1 (novo DNA): o modelo das aves de combate mudou por completo
    // (Instinto, Linhagem, Qualidade Genética, Potencial Máximo único).
    // Combinado: reseta só o aviário de combate — o resto da fazenda continua igual.
    const hadFighters = state.fighters.length>0 || state.cages.some(c=>c.occupied);
    state.fighters = [];
    state.cages = [mkCage(), mkCage()];
    state.selectedFighterA = null;
    state.selectedFighterB = null;
    state.selectedArenaFighter = null;
    state.dnaVersion = 2;
    if(hadFighters){
      toast('🧬 O sistema de genética das aves de combate foi totalmente refeito! Seu aviário foi reiniciado — o resto da fazenda continua igual.');
    }
  }

  // Etapa 2 (reprodução real): aves nascidas antes dessa etapa não têm o registro
  // de "genética de nascença" (birthStats), usado pra herança na cruza. Preenche
  // com os stats atuais como aproximação — não precisa resetar nada pra isso.
  state.fighters.forEach(f=>{
    if(!f.birthStats){
      f.birthStats = { forca:f.forca, velocidade:f.velocidade, resistencia:f.resistencia, instinto:f.instinto };
    }
    if(!f.generation) f.generation = 1;
    if(!f.diversity) f.diversity = 'excelente';
    if(f.parents===undefined) f.parents = null;
    if(f.isBreeder===undefined) f.isBreeder = false;
    if(f.isPhenomenal===undefined) f.isPhenomenal = false;
  });

  // Etapa 3 (feitos da Arena): saves antigos não têm o mural de recordes/títulos.
  if(!state.arena) state.arena = { records:{ bestPower:0, mostWins:0, longestStreak:0 }, titles:{} };
  if(!state.arena.records) state.arena.records = { bestPower:0, mostWins:0, longestStreak:0 };
  state.fighters.forEach(f=>{
    if(f.winStreak===undefined) f.winStreak = 0;
    if(f.breedType===undefined) f.breedType = null;
  });

  // Correção de bug: coletar aves não checava o limite de plantel, então alguns
  // jogadores acumularam mais aves adultas do que o plantel comportava. Não
  // removemos nada (as aves continuam suas, só avisamos), mas a partir de agora
  // não dá pra coletar uma nova ave enquanto o plantel estiver acima da capacidade.
  if(state.fighters.length > rosterCap()){
    toast('⚠️ Seu plantel de combate ('+state.fighters.length+' aves) está acima da capacidade ('+rosterCap()+'). Isso era um bug e foi corrigido — suas aves continuam todas com você, mas você só vai poder coletar novas aves depois de vender algumas ou ampliar o plantel na Loja.');
  }
}

