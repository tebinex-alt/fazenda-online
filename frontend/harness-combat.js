/* Harness node do motor de combate (sem DOM).
   Verifica: bots dentro da faixa do rank, vantagem de raça, invariantes. */
const fs = require('fs');
const path = require('path');
const dir = __dirname;

// Stubs mínimos de globals usados pelos módulos.
global.window = global;
global.state = { fighters: [], arena: {} };
global.toast = () => {};
global.registerActivity = () => {};
global.confirmAction = () => {};
global.saveGame = () => {};
global.render = () => {};
global.Storage = { get: async()=>null, set: async()=>{}, list: async()=>({entries:[]}), remove: async()=>{} };
global.document = { getElementById: ()=>null, addEventListener: ()=>{}, createElement: ()=>({ classList:{add(){},remove(){}}, style:{}, appendChild(){}, addEventListener(){} }), querySelectorAll: ()=>[], querySelector: ()=>null };
global.PIXI = undefined;

// No browser, todos os scripts clássicos compartilham o mesmo escopo léxico
// global (consts ficam acessíveis entre arquivos). O harness concatena os
// arquivos num único escopo para reproduzir isso.
const combined = ['config.js','utils.js','combat.js']
  .map(f=>fs.readFileSync(path.join(dir,'js',f),'utf8'))
  .join('\n;\n');
const fn = new Function('window','document','Storage','PIXI','toast','registerActivity','confirmAction','saveGame','render',
  combined + '\nreturn { ARENA_RANKS, ARENA_BOTS, BREED_COUNTER, Combat: window.Combat, lineageTierIndex, arenaRankIndex };');
const w = fn(global.window, global.document, global.Storage, global.PIXI, global.toast, global.registerActivity, global.confirmAction, global.saveGame, global.render);

const Combat = w.Combat;
const ARENA_RANKS = w.ARENA_RANKS;
const ARENA_BOTS = w.ARENA_BOTS;
const BREED_COUNTER = w.BREED_COUNTER;

let fails = 0;
const check = (cond, msg) => { if(cond){ console.log('PASS: '+msg); } else { fails++; console.log('FAIL: '+msg); } };

/* 1. Todos os bots via buildBotOpponent → combatRating dentro do rank ±8 */
console.log('\n== 1. Bots dentro da faixa do rank ==');
const botsByRank = {};
ARENA_BOTS.forEach(b=>{ (botsByRank[b.rank] = botsByRank[b.rank]||[]).push(b); });
for(const rIdx of Object.keys(botsByRank).map(Number)){
  const rank = ARENA_RANKS[rIdx];
  const target = Math.round((rank.oppPower[0]+rank.oppPower[1])/2);
  for(const bot of botsByRank[rIdx]){
    const opp = Combat.buildBotOpponent(bot, target);
    const rating = Combat.combatRating(opp);
    const ok = Math.abs(rating - target) <= 8;
    check(ok, `rank ${rIdx} ${bot.name}: rating ${rating} ~ alvo ${target} (faixa ${rank.oppPower[0]}-${rank.oppPower[1]})`);
    // stats dentro de 5..100
    for(const k of ['forca','velocidade','resistencia','instinto']){
      if(opp[k] < 5 || opp[k] > 100) check(false, `  ${bot.name} ${k}=${opp[k]} fora de 5..100`);
    }
  }
}

/* 2. Vantagem de raça: atacante com raça counteradora vence mais */
console.log('\n== 2. Vantagem de raça (aviões idênticos exceto raça) ==');
function mkBird(breedType, seed){
  // stats fixos e iguais pros dois lados
  return { forca:40, velocidade:30, resistencia:25, instinto:20, breedType,
    quality:3, diversity:'boa', generation:2, potential:{forca:100,velocidade:100,resistencia:100,instinto:100} };
}
let winsAdv=0, total=0;
const attacks = ['shamo','indio','ingles','calcuta','barbudo'];
for(let i=0;i<30000;i++){
  const aBreed = attacks[i%5];
  const defBreed = BREED_COUNTER[aBreed]; // a countera def
  const a = mkBird(aBreed);
  const def = mkBird(defBreed);
  const f = Combat.simulateFight(a, def);
  total++;
  if(f.winner==='a') winsAdv++;
}
check(winsAdv/total >= 0.53, `atacante com contra-raça vence ${(100*winsAdv/total).toFixed(1)}% (≥53%)`);

/* 3. Invariantes do simulateFight (perdedor zera, rounds 6-12) */
console.log('\n== 3. Invariantes simulateFight ==');
let invOk = true;
for(let i=0;i<2000;i++){
  const a = mkBird('shamo');
  const def = mkBird('indio');
  const f = Combat.simulateFight(a, def);
  if(f.roundsCount < Combat.MIN_ROUNDS || f.roundsCount > Combat.MAX_ROUNDS){ invOk=false; break; }
  const loser = f.winner==='a' ? 'b' : 'a';
  if(f['hp'+loser.toUpperCase()] !== 0){ invOk=false; break; }
  const lastRound = f.rounds[f.rounds.length-1];
  if(lastRound.attacker !== f.winner){ invOk=false; break; }
}
check(invOk, '2000 sims: rounds 6-12, perdedor zera, vencedor dá golpe final');

/* 4. buildOpponentFrom (caminho rank antigo) intacto */
console.log('\n== 4. buildOpponentFrom rank path ==');
const oldOpp = Combat.buildOpponentFrom({ oppPower:60, rankIndex:2 });
check(Combat.combatRating(oldOpp) >= 52 && Combat.combatRating(oldOpp) <= 68, `rank path: rating ${Combat.combatRating(oldOpp)} ~ 60`);

console.log('\n'+ (fails===0 ? '✅ TODOS OS CHECKS PASSARAM' : '❌ '+fails+' CHECKS FALHARAM'));
process.exit(fails===0?0:1);
