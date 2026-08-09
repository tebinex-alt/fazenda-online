/* =========================================================
   UTILITÁRIOS
========================================================= */
/* Escapa texto antes de injetar em innerHTML — impede XSS via apelido,
   nomes de ave ou mensagens vindas do backend. */
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>(
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

function fmt(n){
  n = Math.floor(n*100)/100;
  if(n < 1000) return (Math.round(n*10)/10).toString().replace(/\.0$/,'');
  if(n < 1e6) return (n/1e3).toFixed(n<1e4?2:1).replace(/\.00$/,'')+'mil';
  if(n < 1e9) return (n/1e6).toFixed(2).replace(/\.00$/,'')+'M';
  return (n/1e9).toFixed(2).replace(/\.00$/,'')+'B';
}
function money(n){ return '$'+fmt(n); }
function upgLevel(id){ return state.upgrades[id]||0; }

/* ---------- Bônus de Atividade ----------
   Cada ação relevante do jogador soma pontos (peso 2 = ação mais valiosa);
   o nível cai com o tempo parado. O bônus de produção aplicado é
   ACTIVITY_MAX_BONUS × nível/nível máx — ou seja, produzir aos poucos com o
   jogo aberto e interagindo rende mais do que deixar fechado. */
const ACTIVITY_MAX_BONUS = 0.5;      // até +50% de produção
const ACTIVITY_LEVELS = 10;          // níveis discretos
const ACTIVITY_DECAY_SECONDS = 45;   // a cada ~45s sem ação, perde 1 nível
const ACTIVITY_ACTION_WEIGHT = { shop:2, coop:2, breed:2, harvest:2, feed:2, fight:3, arena:3, sell:3, online:3, collect:2, buy:2 };
function activityLevel(){ return Math.max(0, Math.min(ACTIVITY_LEVELS, state.activity?.level||0)); }
function activityBonusMult(){ return 1 + ACTIVITY_MAX_BONUS * (activityLevel()/ACTIVITY_LEVELS); }
function registerActivity(weightKey){
  const w = ACTIVITY_ACTION_WEIGHT[weightKey] ?? 1;
  const before = state.activity?.level||0;
  state.activity.level = Math.min(ACTIVITY_LEVELS, before + w);
  state.activity.lastAction = Date.now();
  // Avisa de forma discreta a cada 5 níveis — o jogador vê que está rendendo.
  if(state.activity.level !== before && state.activity.level % 5 === 0){
    toast('⚡ Bônus de Atividade: +'+Math.round(ACTIVITY_MAX_BONUS*100*state.activity.level/ACTIVITY_LEVELS)+'% produção');
  }
}
function decayActivityIfIdle(){
  const now = Date.now();
  const idle = (now - (state.activity?.lastAction||now))/1000;
  if(idle >= ACTIVITY_DECAY_SECONDS && (state.activity?.level||0) > 0){
    const lost = Math.floor(idle / ACTIVITY_DECAY_SECONDS);
    state.activity.level = Math.max(0, (state.activity?.level||0) - lost);
    state.activity.lastAction = now;
  }
}
function upgCost(id){
  const d = UPGRADE_DEFS[id];
  return Math.round(d.base * Math.pow(d.mult, upgLevel(id)));
}
function upgMaxed(id){ return upgLevel(id) >= UPGRADE_DEFS[id].max; }
function coopCapacity(){ return 12 + upgLevel('coopCap')*UPGRADE_DEFS.coopCap.step; }
function eggCapacity(){ return 200 + upgLevel('eggCap')*UPGRADE_DEFS.eggCap.step; }
function feedCapacity(){ return 120 + upgLevel('feedCap')*UPGRADE_DEFS.feedCap.step; }
function plotCount(){ return 3 + upgLevel('plots')*UPGRADE_DEFS.plots.step; }
function plotGrowTime(){ return PLOT_BASE_GROW * Math.pow(1-UPGRADE_DEFS.plotSpeed.step, upgLevel('plotSpeed')); }
function plotYieldAmt(){ return PLOT_BASE_YIELD * (1 + upgLevel('plotYield')*UPGRADE_DEFS.plotYield.step); }
function incSlotCount(){ return 2 + upgLevel('incSlots')*UPGRADE_DEFS.incSlots.step; }
function incSpeedMult(){ return Math.pow(1-UPGRADE_DEFS.incSpeed.step, upgLevel('incSpeed')); }
function penCount(){ return 1 + upgLevel('breedPens')*UPGRADE_DEFS.breedPens.step; }
function eggSellPrice(){ return EGG_SELL_BASE + upgLevel('sellPrice')*UPGRADE_DEFS.sellPrice.step; }
function totalChickens(){ return Object.values(state.coop).reduce((s,c)=>s+c.count,0); }
function cageCount(){ return 2 + upgLevel('cages')*UPGRADE_DEFS.cages.step; }
function rosterCap(){ return 2 + upgLevel('roster')*UPGRADE_DEFS.roster.step; }
function randInt(min,max){ return Math.floor(min + Math.random()*(max-min+1)); }
function fighterPower(f){ return f.forca*0.4 + f.velocidade*0.3 + f.resistencia*0.3; }

/* Índice numérico da linhagem (comum:0 .. mitica:4) — usado no gate da Arena. */
function lineageTierIndex(tierId){
  const idx = LINEAGE_TIERS.findIndex(t=>t.id===tierId);
  return idx < 0 ? 0 : idx;
}

function arenaRankIndex(){
  let idx = 0;
  const wins = state.fighters.reduce((s,f)=>s+f.wins,0);
  const power = state.fighters.length ? Math.max(...state.fighters.map(f=>fighterPower(f))) : 0;
  // A melhor linhagem do plantel também conta: sem ave elite+, você não
  // sobe pro Regional — o badge da Arena e o gate de luta ficam coerentes.
  const bestLineage = state.fighters.length
    ? Math.max(...state.fighters.map(f=>lineageTierIndex(f.lineage)))
    : 0;
  for(let i=0;i<ARENA_RANKS.length;i++){
    if(wins >= ARENA_RANKS[i].minWins
      && power >= ARENA_RANKS[i].minPower
      && bestLineage >= lineageTierIndex(ARENA_RANKS[i].minLineage)) idx=i;
  }
  return idx;
}

function isResting(f){ return f.restUntil && f.restUntil>Date.now(); }
function sameLineage(l1, l2){
  if(!l1||!l2||l1.length!==l2.length) return false;
  const s = new Set(l1);
  return l2.every(x=>s.has(x));
}
function currentTier(){ return TIERS[state.tierIndex]; }

const CONFIRM_THRESHOLD = 250;
function confirmAction({icon='🤔', title='Confirmar ação', text='', onYes}){
  const overlay = document.getElementById('confirm-overlay');
  document.getElementById('confirm-icon').textContent = icon;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent = text;
  overlay.classList.add('open');
  const yesBtn = document.getElementById('confirm-yes');
  const noBtn = document.getElementById('confirm-no');
  function close(){
    // Saída animada: .closing toca o pop-out antes de remover .open.
    overlay.classList.add('closing');
    setTimeout(()=>{ overlay.classList.remove('open'); overlay.classList.remove('closing'); yesBtn.onclick=null; noBtn.onclick=null; }, 160);
  }
  yesBtn.onclick = ()=>{ close(); onYes(); };
  noBtn.onclick = close;
}

function toast(msg, cls){
  const box = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast'+(cls?(' '+cls):'');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(()=>el.remove(), 3000);
}

function checkTierUp(){
  let idx = state.tierIndex;
  while(idx < TIERS.length-1 && state.totalEarned >= TIERS[idx+1].min) idx++;
  if(idx !== state.tierIndex){
    state.tierIndex = idx;
    toast('🎉 Nova posição alcançada: '+TIERS[idx].name+'!', 'tierup');
  }
}

