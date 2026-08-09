/* Harness headless (node, sem browser): carrega TODOS os scripts do index.html
   na mesma ordem, com um stub de DOM e Storage em memória. Verifica:
   1. Página carrega sem erro; window.SFX definido e available() false em node.
   2. Gestos de desbloqueio são registrados no document.
   3. Renomear: openRename/saveFighterName sanitiza, atualiza nome, salva.
   4. Gate de linhagem: enterArena bloqueia ave comum no rank que exige Elite.
   5. Luta da Arena com emoji fallback roda e aplica recompensa (SFX no-op seguro).
   6. Mudo: setMuted(true) persiste via Storage.
   7. ARENA_RANKS/ARENA_BOTS/BREED_COUNTER consistentes. */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'js');

let fails = 0;
const check = (cond, msg) => { if(cond){ console.log('PASS: '+msg); } else { fails++; console.log('FAIL: '+msg); } };
const sleep = ms => new Promise(r=>setTimeout(r,ms));
/* O toast/confirmAction REAIS (declarados em utils.js) sombreiam os stubs
   passados no sandbox — captura via stub de DOM. */
const toastTexts = () => ids['toast-container'].children.map(el=>el.textContent);
const clearToasts = () => { ids['toast-container'].children.length = 0; };

/* ---------- Stub de fetch para o Storage client real (api/kv) ---------- */
const kv = new Map();
global.fetch = async (url, opts)=>{
  opts = opts || {};
  let u = String(url);
  const q = new URLSearchParams((u.split('?')[1])||'');
  const key = q.get('key');
  const shared = q.get('shared') === 'true';
  if(u.includes('/api/kv/list')){
    const prefix = q.get('prefix')||'';
    const vals = [];
    kv.forEach((v,k)=>{ if(k.startsWith(prefix)) vals.push({ key:k, value:v }); });
    return { ok:true, status:200, headers:{ get:()=> 'application/json' }, json: async()=>({ entries: vals }) };
  }
  if(opts.method === 'PUT'){
    const body = JSON.parse(opts.body || '{}');
    kv.set(body.key, body.value);
    return { ok:true, status:200, headers:{ get:()=> 'application/json' }, json: async()=>({ ok:true }) };
  }
  if(opts.method === 'DELETE'){
    kv.delete(key);
    return { ok:true, status:200, headers:{ get:()=> 'application/json' }, json: async()=>({ ok:true }) };
  }
  const v = kv.get(key);
  if(v === undefined) return { ok:true, status:200, headers:{ get:()=> 'application/json' }, json: async()=>({ value:null }) };
  return { ok:true, status:200, headers:{ get:()=> 'application/json' }, json: async()=>({ value:v }) };
};

/* ---------- Stub de DOM ---------- */
class El {
  constructor(tag){ this.tagName = tag; this.children = []; this.style = {}; this.dataset = {};
    this.classList = { add:()=>{}, remove:()=>{} }; this.listeners = {};
    this.value = ''; this.textContent = ''; this.title = '';
    this.appendChild = c => this.children.push(c); this.remove = ()=>{};
    this.removeChild = ()=>{};
    this.querySelectorAll = () => []; this.querySelector = () => null;
    this.closest = () => null;
    this.addEventListener = (ev, fn) => { (this.listeners[ev] = this.listeners[ev] || []).push(fn); };
    this.removeEventListener = (ev, fn) => { this.listeners[ev] = (this.listeners[ev] || []).filter(f=>f!==fn); };
    this.focus = ()=>{};
  }
  dispatch(ev, evt){ (this.listeners[ev] || []).forEach(fn=>fn(evt||{})); }
}
const ids = {};
const documentListeners = {};
const document = {
  getElementById: id => { if(!ids[id]) ids[id] = new El('div'); return ids[id]; },
  addEventListener: (ev, fn) => { (documentListeners[ev] = documentListeners[ev] || []).push(fn); },
  removeEventListener: (ev, fn) => { documentListeners[ev] = (documentListeners[ev] || []).filter(f=>f!==fn); },
  createElement: t => new El(t),
  querySelectorAll: () => [],
  querySelector: () => null,
};
global.document = document;
// Elementos usados pelos scripts (stub vazio é suficiente para os binds).
['sfx-toggle','rename-overlay','rename-input','rename-cancel','rename-save','arena-overlay','arena-scene','arena-result','confirm-overlay','confirm-icon','confirm-title','confirm-text','confirm-yes','confirm-no','toast-container','auth-overlay','auth-title','auth-subtitle','auth-error','auth-username','auth-password','auth-claim','auth-claim-wrap','user-btn'].forEach(id=>{ ids[id] = new El('div'); });

global.window = global;
global.PIXI = undefined; // CDN ausente → fallback de emoji
global.localStorage = { getItem:()=>null, setItem:()=>{}, removeItem:()=>{} };
const windowListeners = {};
global.addEventListener = (ev, fn) => { (windowListeners[ev] = windowListeners[ev] || []).push(fn); };
global.removeEventListener = (ev, fn) => { windowListeners[ev] = (windowListeners[ev] || []).filter(f=>f!==fn); };
let toastLog = [];
global.toast = m => { toastLog.push(String(m)); };
let renderCount = 0;
global.render = () => { renderCount++; };
let savedCount = 0;
global.saveGame = () => { savedCount++; };
global.confirmAction = ({onYes}) => { onYes(); }; // auto-confirma
global.registerActivity = () => {};
global.updateArenaFeats = () => {};
global.flushSave = async () => {};

/* ---------- Carrega os scripts do index.html em ordem ---------- */
const order = ['storage-client.js','config.js','state.js','utils.js','persistence.js','engine.js','combat.js','actions.js','multiplayer.js','audio.js','scene-iso.js','arena-scene.js','ui.js','events.js','main.js'];
const combined = order.map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n;\n');
const fn = new Function('window','document','PIXI','localStorage','toast','registerActivity','confirmAction','saveGame','render','flushSave',
  combined + '\nfunction loadState(){ state = freshState(); return state; }\nreturn { loadState, state: () => state, fighterId, ARENA_RANKS, ARENA_BOTS, BREED_COUNTER, lineageTierIndex, arenaRankIndex, SFX: window.SFX, openRename, saveFighterName, enterArena, fighterPower, lineageLabel };');
const w = fn(global.window, global.document, global.PIXI, global.localStorage, global.toast, global.registerActivity, global.confirmAction, global.saveGame, global.render, global.flushSave);
const state = w.loadState();
const openRename = w.openRename, saveFighterName = w.saveFighterName, enterArena = w.enterArena;
const ARENA_RANKS = w.ARENA_RANKS;
const ARENA_BOTS = w.ARENA_BOTS;
const BREED_COUNTER = w.BREED_COUNTER;
const SFX = w.SFX;

console.log('\n== 1. Carrega sem erro + SFX definido ==');
check(!!SFX && typeof SFX.hit === 'function', 'window.SFX definido com métodos');
check(SFX.available() === false, 'available() false em node (sem AudioContext)');

console.log('\n== 2. Gestos de desbloqueio registrados ==');
check((documentListeners['pointerdown']||[]).length > 0, 'listener pointerdown registrado para unlock');
check((documentListeners['keydown']||[]).length > 0, 'listener keydown registrado para unlock');

console.log('\n== 3. Renomear galo ==');
// Inicializa o estado como o loadGame faria, com uma ave de combate pronta.
state.fighters.push({ id: w.fighterId(), name:'Trovão', forca:40, velocidade:30, resistencia:25, instinto:20,
  breedType:'shamo', lineage:'comum', generation:1, quality:2, diversity:'boa', wins:0, losses:0, winStreak:0,
  potential:{ forca:100, velocidade:100, resistencia:100, instinto:100 } });
state.fighters.push({ id: w.fighterId(), name:'Relâmpago', forca:40, velocidade:30, resistencia:25, instinto:20,
  breedType:'indio', lineage:'comum', generation:1, quality:2, diversity:'boa', wins:0, losses:0, winStreak:0,
  potential:{ forca:100, velocidade:100, resistencia:100, instinto:100 } });
const f0 = state.fighters[0];
check(!!f0, 'state.fighters tem ave (state inicial gera aves)');
openRename(f0.id);
check(ids['rename-input'].value === (f0.name||''), 'openRename preenche input com nome atual');
ids['rename-input'].value = '  Truvão<>"`  ';
saveFighterName();
const renamed = state.fighters.find(x=>x.id===f0.id);
check(renamed.name === 'Truvão', `sanitiza nome: "${renamed.name}"`);
ids['rename-input'].value = '   ';
saveFighterName();
check(state.fighters.find(x=>x.id===f0.id).name === 'Truvão', 'nome vazio mantém o antigo');

console.log('\n== 4. Gate de linhagem ==');
// Faz o plantel ter linhagem elite (rank vira Veterano) mas luta com ave comum.
const vet = ARENA_RANKS[2];
const fLow = state.fighters.find(x=>x.id!==f0.id) || f0;
fLow.lineage = 'comum';
fLow.forca = 100; fLow.velocidade = 100; fLow.resistencia = 100; fLow.instinto = 100; // poder ~100
fLow.wins = vet.minWins; // 18
state.fighters.forEach(f=>{ f.wins = Math.max(f.wins, vet.minWins); f.lineage = f.lineage||'comum'; });
state.fighters.forEach(f=>{ if(f!==fLow) f.lineage = 'elite'; }); // plantel elite → rankVeterano
state.arena = state.arena || { records:{}, titles:{} };
enterArena(fLow.id);
check(toastTexts().some(t=>/linhagem/.test(t)), 'bloqueia com toast de linhagem (comum < selecionada)');
clearToasts();

console.log('\n== 5. Luta com recompensa (emoji fallback) ==');
// Ave elite que passa no gate do rank 2 (minLineage selecionada).
const fElite = state.fighters.find(x=>x.id!==fLow.id) || f0;
fElite.lineage = 'elite';
fElite.forca = 90; fElite.velocidade = 80; fElite.resistencia = 80; fElite.instinto = 70;
fElite.wins = vet.minWins;
fElite.winStreak = 0;
fElite.restUntil = 0; fElite.trainingUntil = 0;
const moneyBefore = state.money;
const winsBefore = fElite.wins;
(async ()=>{
  // Luta determinística: Math.random fixo em 0.5 → simulateFight pré-rola 'a'
  // como vencedor (pA ≥ 0.526 em qualquer cenário de raça no rank 2).
  const realRandom = Math.random;
  Math.random = () => 0.5;
  enterArena(fElite.id);
  // confirmAction real liga onYes em #confirm-yes → simula o clique
  const yesBtn = ids['confirm-yes'];
  check(typeof yesBtn.onclick === 'function', 'confirmAction ligou onYes em #confirm-yes');
  yesBtn.onclick();
  // ArenaScene indisponível (PIXI undefined) → emoji fallback (8 rounds × 200ms)
  await sleep(2200);
  Math.random = realRandom;
  check(state.money > moneyBefore, `recompensa aplicada (${moneyBefore} → ${state.money})`);
  check(fElite.wins === winsBefore + 1, 'vitória registrada');
  check(toastTexts().some(t=>/Vitória/.test(t)), 'toast de vitória com nome do bot');

  console.log('\n== 6. Mudo persiste via Storage ==');
  SFX.setMuted(true);
  check(SFX.isMuted() === true, 'isMuted() true após setMuted(true)');
  await sleep(50);
  check(kv.get('sfx-muted') === '1', 'Storage registra sfx-muted=1');
  SFX.setMuted(false);
  await sleep(50);
  check(kv.get('sfx-muted') === '0', 'Storage registra sfx-muted=0');

  console.log('\n== 7. Dados de Arena consistentes ==');
  check(ARENA_RANKS.length === 5, '5 ranks');
  check(ARENA_BOTS.length === 20, '20 bots (4 por rank)');
  ARENA_RANKS.forEach((r,i)=>{
    const count = ARENA_BOTS.filter(b=>b.rank===i).length;
    if(count !== 4) check(false, `rank ${i} tem ${count} bots`);
  });
  check(Object.keys(BREED_COUNTER).length === 5, 'BREED_COUNTER cobre as 5 raças');

  console.log('\n'+ (fails===0 ? '✅ TODOS OS CHECKS PASSARAM' : '❌ '+fails+' CHECKS FALHARAM'));
  process.exit(fails===0?0:1);
})();
