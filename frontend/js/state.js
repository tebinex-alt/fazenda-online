/* =========================================================
   ESTADO
========================================================= */
let state = null;
function freshState(){
  return {
    money: 60,
    eggs: 0,
    feed: 10,
    totalEarned: 0,
    tierIndex: 0,
    coop: { caipira: { count:1, progress:0 } },
    plots: [ mkPlot(), mkPlot(), mkPlot() ],
    incubator: [ mkIncSlot(), mkIncSlot() ],
    fertileQueue: [],
    breedPens: [ mkPen() ],
    upgrades: { coopCap:0, eggCap:0, feedCap:0, plots:0, plotSpeed:0, plotYield:0, incSlots:0, incSpeed:0, breedPens:0, sellPrice:0, cages:0, roster:0 },
    selectedBreedForBreed: null,
    cages: [ mkCage(), mkCage() ],
    fighters: [],
    selectedFighterA: null,
    selectedFighterB: null,
    selectedArenaFighter: null,
    lastSaved: Date.now(),
    dnaVersion: 2,
    /* Bônus de Atividade: sobe com cada ação do jogador (até +50% de produção
       no galinheiro) e decai quando ele fica parado. É o que torna estar
       ONLINE mais recompensador do que esperar offline. */
    activity: { level:0, lastAction:Date.now() },
    /* Trator de Canteiros: quando ativado, colhe e replanta sozinho. */
    autoPlot: false,
    /* Mural de Feitos da Arena: recordes + títulos desbloqueados. */
    arena: {
      records: { bestPower:0, mostWins:0, longestStreak:0 },
      titles: {},
    },
  };
}
function mkPlot(){ return { planted:false, plantedAt:0, ready:false }; }
function mkIncSlot(){ return { filled:false, breedTarget:null, startedAt:0, hatchTime:0, ready:false }; }
function mkPen(){ return { active:false, breedFrom:null, startedAt:0, duration:0 }; }
function mkCage(){ return { occupied:false, stage:null, stageStartedAt:0, careFed:{pintinho:false,frango:false}, gender:null, baseForca:0, baseVel:0, baseRes:0, baseInstinto:0, lineage:null, generation:1, diversity:'excelente', parents:null, ready:false }; }
function fighterId(){ return 'f'+Math.random().toString(36).slice(2,9); }

