/* =========================================================
   DADOS DO JOGO
========================================================= */
/* Ciclos de produção agora são a "batida" do jogo: 15s na caipira (compressão
   de ~5.760× vs uma galinha real, que bota 1 ovo/dia). O ritmo é mais calmo e
   realista; quem está ONLINE joga com o Bônus de Atividade (até +50%), então a
   sensação de recompensa vem de estar jogando, não de clicar o tempo todo. */
const BREEDS = [
  { id:'caipira',  name:'Galinha Caipira',   tierReq:0, cost:25,     eggTime:15,  eggsPerCycle:1,  feedPerCycle:1.5,  glow:'#C9A063', emoji:'🐔' },
  { id:'vermelha', name:'Galinha Vermelha',  tierReq:1, cost:300,    eggTime:13,  eggsPerCycle:3,  feedPerCycle:3,    glow:'#B5423F', emoji:'🐓' },
  { id:'dourada',  name:'Galinha Dourada',   tierReq:3, cost:3500,   eggTime:12,  eggsPerCycle:7,  feedPerCycle:6,    glow:'#E8A93A', emoji:'🐤' },
  { id:'cristal',  name:'Galinha de Cristal',tierReq:5, cost:35000,  eggTime:11,  eggsPerCycle:16, feedPerCycle:11,   glow:'#66C6D9', emoji:'🐣' },
  { id:'lendaria', name:'Galinha Lendária',  tierReq:7, cost:400000, eggTime:10,  eggsPerCycle:45, feedPerCycle:22,   glow:'#FF7CD1', emoji:'🦚' },
];
const breedById = id => BREEDS.find(b=>b.id===id);
const breedIndex = id => BREEDS.findIndex(b=>b.id===id);
const CHICKEN_PRICE_GROWTH = 1.12;
function chickenPrice(bid){
  const owned = state.coop[bid]?.count||0;
  return Math.round(breedById(bid).cost * Math.pow(CHICKEN_PRICE_GROWTH, owned));
}

const TIERS = [
  { name:'Miserável',  min:0,        stage:0 },
  { name:'Pobre',      min:800,      stage:0 },
  { name:'Camponês',   min:5000,     stage:1 },
  { name:'Fazendeiro', min:30000,    stage:1 },
  { name:'Próspero',   min:150000,   stage:2 },
  { name:'Rico',       min:700000,   stage:2 },
  { name:'Magnata',    min:3000000,  stage:3 },
  { name:'Lendário',   min:15000000, stage:3 },
];

/* Cruza: o caminho da paciência. Fazer uma cruza bem-sucedida sai SEMPRE mais
   barato do que comprar a ave direto na Loja (custo esperado ≈ 60-70% do preço
   de compra). A Loja vira o atalho caro e imediato; a cruza, a progressão
   inteligente. */
const BREED_TRANSITION = [
  { cost:150,   duration:25,  chance:0.55, hatch:30  },
  { cost:1800,  duration:40,  chance:0.45, hatch:50  },
  { cost:13000, duration:65,  chance:0.35, hatch:80  },
  { cost:160000,duration:100, chance:0.25, hatch:130 },
];

const PLOT_BASE_GROW = 20;
const PLOT_BASE_YIELD = 10;
const EGG_SELL_BASE = 1.5;
/* Ração comprada custa MENOS que 1 ovo (que vale $1,5): uma caipira que se
   sustenta com ração comprada dá empate técnico (1,5 ração × $1,0 = $1,5 = 1 ovo).
   Canteiros deixam de ser obrigação e viram MARGEM — quem planta ganha mais. */
const FEED_BUY_PRICE = 1.0;

// --- Aves de combate ---
const FIGHT_BREEDS_TYPES = [
  { id:'shamo',   name:'Shamo',         emoji:'🐓', cost:280,
    desc:'Gigante e brutal, golpes fortíssimos, mas mais lento.',
    bias:{ forca:[38,50], velocidade:[6,14], resistencia:[22,30], instinto:[16,24] } },
  { id:'indio',   name:'Índio',         emoji:'🐓', cost:180,
    desc:'Extremamente ágil e rápido, especialista em velocidade.',
    bias:{ forca:[10,18], velocidade:[40,50], resistencia:[10,18], instinto:[23,31] } },
  { id:'ingles',  name:'Bôody Inglês',  emoji:'🐓', cost:150,
    desc:'Raça clássica e equilibrada, boa em tudo, nunca desiste.',
    bias:{ forca:[22,28], velocidade:[22,28], resistencia:[22,28], instinto:[22,28] } },
  { id:'calcuta', name:'Calcutá',       emoji:'🐓', cost:260,
    desc:'Pesado e poderoso, pernas fortíssimas, pouca velocidade.',
    bias:{ forca:[36,46], velocidade:[4,10], resistencia:[28,36], instinto:[16,24] } },
  { id:'barbudo', name:'Barbudo',       emoji:'🐓', cost:170,
    desc:'Rústico e tenaz, resistência muito acima da média.',
    bias:{ forca:[16,24], velocidade:[16,24], resistencia:[36,44], instinto:[16,24] } },
];
function fightBreedById(id){ return FIGHT_BREEDS_TYPES.find(b=>b.id===id); }
function rollStatsForBreed(breedId){
  const b = fightBreedById(breedId);
  if(!b) return { forca:randInt(15,30), velocidade:randInt(15,30), resistencia:randInt(15,30), instinto:randInt(15,30) };
  // Cada raça distribui SEMPRE 100 pontos, respeitando seus traços (bias):
  // rola cada atributo dentro do seu range e depois NORMALIZA para a soma ser
  // exatamente 100 (com as sobras de arredondamento pingadas de volta).
  const roll = s => randInt(s[0], s[1]);
  const strong = {
    forca:  roll(b.bias.forca),
    velocidade: roll(b.bias.velocidade),
    resistencia: roll(b.bias.resistencia),
    instinto: roll(b.bias.instinto),
  };
  const keys = ['forca','velocidade','resistencia','instinto'];
  const sum = keys.reduce((s,k)=> s + strong[k], 0);
  const factor = 100 / sum;
  const out = {};
  let total = 0;
  keys.forEach(k=>{
    out[k] = Math.max(5, Math.round(strong[k] * factor));
    total += out[k];
  });
  // pinga as sobras de arredondamento (e conserta excedente) até fechar 100
  let diff = 100 - total;
  let guard = 0;
  while(diff !== 0 && guard < 20){
    if(diff > 0){
      const idx = keys.findIndex(k=> out[k] < 100);
      if(idx<0) break;
      out[keys[idx]]++; diff--; guard++;
    } else {
      const idx = keys.findIndex(k=> out[k] > 5);
      if(idx<0) break;
      out[keys[idx]]--; diff++; guard++;
    }
  }
  return out;
}

/* --- Etapa 1: DNA (Linhagem, Qualidade Genética, Potencial Máximo) --- */
const LINEAGE_TIERS = [
  { id:'comum',       name:'Comum' },
  { id:'selecionada', name:'Selecionada' },
  { id:'elite',       name:'Elite' },
  { id:'imperial',    name:'Imperial' },
  { id:'mitica',      name:'Mítica' },
];
function computeGenetics(stats, diversityId){
  const avg = (stats.forca + stats.velocidade + stats.resistencia + stats.instinto) / 4;
  let potentialMax = Math.max(5, Math.min(100, Math.round(avg + GENETIC_TRAIN_HEADROOM)));
  const penaltyMult = DIVERSITY_POTENTIAL_MULT[diversityId] ?? 1;
  if(penaltyMult < 1) potentialMax = Math.max(5, Math.round(potentialMax*penaltyMult));
  const quality = Math.max(1, Math.min(5, Math.ceil(potentialMax/20)));
  const lineageTier = LINEAGE_TIERS[quality-1].id;
  return { potentialMax, quality, lineageTier };
}
const FIGHTER_NAMES = ['Trovão','Imperador','Relâmpago','Furacão','Sultão','Guerreiro','Faísca','Coronel','Vulcão','Predador','Tornado','Rei Leão','Aço','Bravo','Duque','General','Fúria','Marechal','Titã','Zeus'];
function randomFighterName(){ return FIGHTER_NAMES[randInt(0, FIGHTER_NAMES.length-1)]; }

/* --- Etapa 4: Consanguinidade / Diversidade genética --- */
/* (também serve de base de dados pra Etapa 8, árvore genealógica) */
const DIVERSITY_TIERS = {
  excelente: { name:'Excelente', emoji:'🟢' },
  boa:       { name:'Boa',       emoji:'🟢' },
  normal:    { name:'Normal',    emoji:'🟡' },
  baixa:     { name:'Baixa',     emoji:'🟠' },
  critica:   { name:'Crítica',   emoji:'🔴' },
};
const DIVERSITY_POTENTIAL_MULT = { excelente:1, boa:1, normal:0.97, baixa:0.9, critica:0.75 };
function diversityLabel(id){
  const t = DIVERSITY_TIERS[id] || DIVERSITY_TIERS.excelente;
  return t.emoji+' '+t.name;
}
// Congela até 3 gerações de ancestrais (pai/avô/bisavô) junto com o filhote,
// só com os dados leves necessários pra árvore/consanguinidade — evita que o
// save cresça sem limite conforme as gerações avançam.
function ancestorSnapshot(f, depth){
  if(!f || depth<=0) return null;
  return {
    id: f.id, name: f.name, gender: f.gender, lineage: f.lineage, generation: f.generation,
    parents: f.parents ? f.parents.map(p=>ancestorSnapshot(p, depth-1)) : null,
  };
}
function collectAncestorIds(node, maxDepth, acc, depth){
  if(!node || !node.parents || depth>maxDepth) return;
  node.parents.forEach(p=>{
    if(p){ acc.add(p.id); collectAncestorIds(p, maxDepth, acc, depth+1); }
  });
}
function ancestorIdSet(f, maxDepth=4){
  const acc = new Set();
  collectAncestorIds(f, maxDepth, acc, 1);
  return acc;
}
function computeDiversity(a, b){
  const directRelation = !!((a.parents && a.parents.some(p=>p && p.id===b.id))
                          || (b.parents && b.parents.some(p=>p && p.id===a.id)));
  const isSibling = !!(a.parents && b.parents && a.parents.length===2 && b.parents.length===2
                    && a.parents.every(pa=> pa && b.parents.some(pb=>pb && pb.id===pa.id)));
  const ancA = ancestorIdSet(a);
  const ancB = ancestorIdSet(b);
  let overlap = 0;
  ancA.forEach(id=>{ if(ancB.has(id)) overlap++; });

  let id;
  if(directRelation || isSibling || overlap>=4) id='critica';
  else if(overlap===3) id='baixa';
  else if(overlap===2) id='normal';
  else if(overlap===1) id='boa';
  else id='excelente';
  return { id, name: DIVERSITY_TIERS[id].name, emoji: DIVERSITY_TIERS[id].emoji };
}

/* --- Etapa 6: Fenômenos --- */
// Chance extremamente pequena (1 em 20.000) de nascer um exemplar perfeito,
// não importa a raça, os pais ou a qualidade rolada normalmente. Fica marcado
// pra sempre — não é um bônus temporário, é uma característica do indivíduo.
const PHENOMENAL_CHANCE = 1/20000;
function rollPhenomenal(){ return Math.random() < PHENOMENAL_CHANCE; }
function applyPhenomenalBoost(stats){
  // eleva todos os atributos, mas ainda respeitando o teto de 100 —
  // não é sempre um "100 em tudo" cravado, mas sempre algo excepcional.
  const boosted = {};
  for(const k of ['forca','velocidade','resistencia','instinto']){
    boosted[k] = Math.max(stats[k], Math.min(100, stats[k] + randInt(30, 45)));
  }
  return boosted;
}
const FIGHT_STAGE_TIME = { ovo: 60, pintinho: 90, frango: 120 };
const FIGHT_FEED_COST = { pintinho:5, frango:8 };
const FIGHT_BREED_COST = 400;

// --- Arena mais difícil ---
// Poder máximo teórico de uma ave é 100 (forca 100*0.4 + velocidade 100*0.3 + resistencia 100*0.3).
// Os limiares abaixo foram recalibrados para caber dentro desse teto — antes, "Campeão Regional" (130)
// e "Lenda da Arena" (200) exigiam poder acima do máximo possível e nunca podiam ser alcançados.
const ARENA_RANKS = [
  { name:'Novato da Arena',      minWins:0,   minPower:0,  reward:60,   oppPower:[10,25], penalty:0, minLineage:'comum' },
  { name:'Desafiante',           minWins:5,   minPower:30, reward:200,  oppPower:[35,50], penalty:1, minLineage:'comum' },
  { name:'Veterano de Terreiro', minWins:18,  minPower:55, reward:500,  oppPower:[55,70], penalty:2, minLineage:'selecionada' },
  { name:'Campeão Regional',     minWins:42,  minPower:75, reward:1200, oppPower:[75,88], penalty:4, minLineage:'elite' },
  { name:'Lenda da Arena',       minWins:85,  minPower:92, reward:3200, oppPower:[90,100],penalty:6, minLineage:'imperial' },
];

/* Ciclo de vantagem de raça ("X countera Y"):
   índio > shamo > inglês > calcutá > barbudo > índio. */
const BREED_COUNTER = {
  indio:   'shamo',
  shamo:   'ingles',
  ingles:  'calcuta',
  calcuta: 'barbudo',
  barbudo: 'indio',
};

/* Bots da Arena: identidade de verdade por rank. A linhagem/qualidade sobe
   junto com o rank — o jogador sente a progressão nos adversários. */
const ARENA_BOTS = [
  { rank:0, name:'Zé do Terreiro',     breedId:'shamo',   quality:1, lineage:'comum',       generation:1, diversity:'baixa', taunt:'Bicho criado no terreiro, mas te derruba!' },
  { rank:0, name:'Dona Benta',         breedId:'ingles',  quality:1, lineage:'comum',       generation:1, diversity:'normal', taunt:'Meu inglês não é de brincadeira.' },
  { rank:0, name:'Seu Nicanor',        breedId:'barbudo', quality:2, lineage:'comum',       generation:1, diversity:'normal', taunt:'Rústico é o meu galo. E você?' },
  { rank:0, name:'Chico da Venda',     breedId:'calcuta', quality:1, lineage:'comum',       generation:1, diversity:'baixa', taunt:'Calcutá pesado, perna de ferro.' },
  { rank:1, name:'Pedro Voador',       breedId:'indio',   quality:2, lineage:'selecionada', generation:2, diversity:'boa', taunt:'Rápido demais pra você.' },
  { rank:1, name:'Tonho Malandro',     breedId:'shamo',   quality:2, lineage:'selecionada', generation:2, diversity:'normal', taunt:'Shamo de raça, golpe de ferro.' },
  { rank:1, name:'Zefa do Sítio',      breedId:'ingles',  quality:2, lineage:'selecionada', generation:2, diversity:'boa', taunt:'Meu galo nunca desiste.' },
  { rank:1, name:'Bastião Barbudo',    breedId:'barbudo', quality:3, lineage:'selecionada', generation:2, diversity:'normal', taunt:'Enquanto você cansa, o meu aguenta.' },
  { rank:2, name:'Coronel Ferro',      breedId:'barbudo', quality:3, lineage:'elite',       generation:3, diversity:'boa', taunt:'Elite de geração. Se renda.' },
  { rank:2, name:'Major Trinca-Ferro', breedId:'calcuta', quality:3, lineage:'elite',       generation:3, diversity:'boa', taunt:'Calcutá elite: pesado e implacável.' },
  { rank:2, name:'Sargento Bico-Fino', breedId:'ingles',  quality:3, lineage:'elite',       generation:3, diversity:'boa', taunt:'Disciplina inglesa na arena.' },
  { rank:2, name:'Dama Índia',         breedId:'indio',   quality:4, lineage:'elite',       generation:3, diversity:'boa', taunt:'Velocidade de elite, golpe certeiro.' },
  { rank:3, name:'Barão dos Aços',     breedId:'ingles',  quality:4, lineage:'imperial',    generation:4, diversity:'boa', taunt:'O Barão não perde pra ninguém.' },
  { rank:3, name:'Visconde Calcutá',   breedId:'calcuta', quality:4, lineage:'imperial',    generation:4, diversity:'excelente', taunt:'Pernas imperiais de aço.' },
  { rank:3, name:'Condessa do Vale',   breedId:'shamo',   quality:4, lineage:'imperial',    generation:4, diversity:'boa', taunt:'Shamo imperial, golpe de lenda.' },
  { rank:3, name:'Marquês Veloz',      breedId:'indio',   quality:5, lineage:'imperial',    generation:4, diversity:'excelente', taunt:'Ninguém alcança meu índio.' },
  { rank:4, name:'General Mítico',     breedId:'calcuta', quality:5, lineage:'mitica',      generation:5, diversity:'excelente', taunt:'Mitica. O fim da linha pra você.' },
  { rank:4, name:'Imperatriz Pluma',   breedId:'indio',   quality:5, lineage:'mitica',      generation:5, diversity:'excelente', taunt:'Nascida pra reinar.' },
  { rank:4, name:'Titã de Ferro',      breedId:'shamo',   quality:5, lineage:'mitica',      generation:5, diversity:'boa', taunt:'Golpe de titã, sem piedade.' },
  { rank:4, name:'Lorde Barba-Branca', breedId:'barbudo', quality:5, lineage:'mitica',      generation:5, diversity:'excelente', taunt:'A lenda viva do sertão.' },
];

// --- Títulos da Arena (Etapa: Feitos) ---
// Feitos de longo prazo que recompensam buscar galos MELHORES (poder, linhagem,
// genética), não só grindar vitórias. Cada título paga UMA única recompensa em
// dinheiro no momento do desbloqueio. Os checks são funções puras sobre state.
const ARENA_TITLES = [
  { id:'firstWin',  name:'Campeão Iniciante',   emoji:'🎖️', reward:150,
    desc:'Vença a sua primeira luta na Arena.',
    check:s=> s.fighters.some(f=>f.wins>0) },
  { id:'fiveWins',  name:'Guerreiro de Terreiro', emoji:'⚔️', reward:500,
    desc:'Uma única ave alcance 5 vitórias.',
    check:s=> s.fighters.some(f=>f.wins>=5) },
  { id:'streak5',   name:'Sequência Imparável', emoji:'🔥', reward:800,
    desc:'Uma única ave vença 5 lutas seguidas.',
    check:s=> s.fighters.some(f=>(f.winStreak||0)>=5) },
  { id:'power75',   name:'Poder Absoluto',      emoji:'💪', reward:2000,
    desc:'Uma ave com poder de combate 75+ (treine e cruze!).',
    check:s=> s.fighters.some(f=>fighterPower(f)>=75) },
  { id:'imperial',  name:'Linhagem Imperial',   emoji:'👑', reward:3000,
    desc:'Crie uma ave com linhagem Imperial ou Mítica.',
    check:s=> s.fighters.some(f=>f.lineage==='imperial'||f.lineage==='mitica') },
  { id:'allBreeds', name:'Colecionador de Raças', emoji:'🐓', reward:4000,
    desc:'Tenha no plantel uma ave de cada uma das 5 raças.',
    check:s=> FIGHT_BREEDS_TYPES.every(bt=> s.fighters.some(f=>f.breedType===bt.id)) },
  { id:'phenomenal',name:'Lenda Viva',           emoji:'✨', reward:8000,
    desc:'Crie uma ave Fenomenal (1 em 20.000!).',
    check:s=> s.fighters.some(f=>f.isPhenomenal) },
  { id:'lendaRank', name:'Lenda da Arena',       emoji:'🏆', reward:6000,
    desc:'Alcance o último posto do ranking da Arena.',
    check:s=> arenaRankIndex()>=ARENA_RANKS.length-1 },
];

// --- Treino mais lento e custoso ---
const FIGHT_TRAIN_COST = 200;
const FIGHT_TRAIN_FEED = 5;
const FIGHT_TRAIN_TIME = 90;
const FIGHT_TRAIN_GAIN_BASE = 2;
const FIGHT_TRAIN_GAIN_DECAY = 0.03;

// --- Venda de aves de combate (Etapa 5) ---
// Propositalmente conservador: vender um ovo recém-comprado sem treinar vale
// MENOS do que o custo do ovo + ração, pra não virar exploit de "comprar e
// revender". O valor só fica bom de verdade em aves treinadas/bem geradas.
const FIGHT_SELL_STAT_RATE = 0.6;       // $ por ponto somado dos 4 atributos atuais (máx. 400 pontos)
const FIGHT_SELL_POTENTIAL_RATE = 1.5;  // $ por ponto do Potencial Máximo (0-100)
const FIGHT_SELL_WIN_BONUS = 20;        // $ por vitória na Arena
const FIGHT_SELL_GENERATION_BONUS = 10; // $ extra por geração acima de F1 (prestígio de linhagem)
const FIGHT_SELL_QUALITY_MULT = [0.5, 0.7, 0.9, 1.3, 2.0]; // por índice de qualidade (1..5 estrelas)
function fighterSellPrice(f){
  const statSum = f.forca + f.velocidade + f.resistencia + f.instinto;
  const mult = FIGHT_SELL_QUALITY_MULT[(f.quality||1)-1] || FIGHT_SELL_QUALITY_MULT[0];
  const raw = (FIGHT_SELL_STAT_RATE*statSum + FIGHT_SELL_POTENTIAL_RATE*(f.potential?.forca||0)) * mult
            + FIGHT_SELL_WIN_BONUS*(f.wins||0)
            + FIGHT_SELL_GENERATION_BONUS*Math.max(0,(f.generation||1)-1);
  const phenomenalMult = f.isPhenomenal ? 4 : 1; // uma ave 1 em 20.000 vale muito mais que o normal
  return Math.max(20, Math.round(raw*phenomenalMult));
}

// --- Genética mais dura ---
const CROSSBREED_SUCCESS_CHANCE = 0.15;
const GENETIC_TRAIN_HEADROOM = 12;
const GENETIC_DEGRADATION = 0.05;

const FIGHT_REST_TIME = 5*60;
const ARENA_ANIMATION_DURATION = 2200;

const UPGRADE_DEFS = {
  coopCap:   { name:'Ampliar Galinheiro',  desc:'+5 de capacidade no galinheiro', base:350,   mult:1.6,  max:20, step:5,   icon:'🏠' },
  eggCap:    { name:'Silo de Ovos',        desc:'+50 de capacidade de ovos',      base:250,   mult:1.55, max:20, step:50,  icon:'🥚' },
  feedCap:   { name:'Celeiro de Ração',    desc:'+40 de capacidade de ração',     base:220,   mult:1.55, max:20, step:40,  icon:'🌾' },
  plots:     { name:'Novo Canteiro',       desc:'+1 canteiro de plantação',       base:450,   mult:1.9,  max:9,  step:1,   icon:'🌱' },
  plotSpeed: { name:'Fertilizante Turbo',  desc:'-8% no tempo de crescimento',    base:500,   mult:2.0,  max:8,  step:0.08,icon:'⚡' },
  plotYield: { name:'Adubo Premium',       desc:'+20% na colheita de ração',      base:480,   mult:1.95, max:8,  step:0.2, icon:'📦' },
  incSlots:  { name:'Bandeja da Incubadora', desc:'+1 espaço na incubadora',      base:700,   mult:2.1,  max:6,  step:1,   icon:'🐣' },
  incSpeed:  { name:'Incubadora Turbo',    desc:'-10% no tempo de incubação',     base:900,   mult:2.0,  max:6,  step:0.1, icon:'⏱️' },
  breedPens: { name:'Novo Curral de Cruza',desc:'+1 curral simultâneo de cruza',  base:2500,  mult:2.3,  max:3,  step:1,   icon:'💞' },
  sellPrice: { name:'Contrato de Vendas',  desc:'+$0.8 no preço de venda do ovo', base:1200,  mult:2.2,  max:10, step:0.8, icon:'📈' },
  cages:     { name:'Nova Gaiola de Cria', desc:'+1 gaiola para criar aves de combate', base:600, mult:2.0, max:6, step:1, icon:'🐣' },
  roster:    { name:'Ampliar Plantel',     desc:'+2 vagas no plantel de aves de combate adultas', base:3000, mult:1.9, max:14, step:2, icon:'🐓' },
  tractor:   { name:'Trator de Canteiros', desc:'Colhe e planta sozinho (sem cliques)', base:3500, mult:2.0, max:1, step:1, icon:'🚜' },
};

