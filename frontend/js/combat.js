/* =========================================================
   MOTOR DE COMBATE DA ARENA
   Funções PURAS (sem DOM, sem estado global) — testáveis com node.
   Todos os stats da ave influenciam o resultado:
   - forca/velocidade/resistencia/instinto: atributos base
   - quality (1-5★): multiplicador de rating
   - diversity (excelente..critica): multiplicador
   - generation: pequeno prestígio de linhagem
   - isPhenomenal: 1 em 20.000 — bônus forte
   - potential: quanto do teto o treino aproveitou
========================================================= */
(function(){
"use strict";

const MAX_ROUNDS = 12;
const MIN_ROUNDS = 6;
const CRIT_CHANCE_BASE = 0.08;

/* Quanto o treino atual aproveitou do teto de potencial (0-1). */
function potentialRatio(f){
  const pot = f.potential || {};
  const sum = (f.forca||0) + (f.velocidade||0) + (f.resistencia||0) + (f.instinto||0);
  const potSum = (pot.forca||100) + (pot.velocidade||100) + (pot.resistencia||100) + (pot.instinto||100);
  return potSum > 0 ? Math.min(1, sum/potSum) : 1;
}

/* Rating de combate: todos os stats importam.
   Escala parecida com fighterPower (max ~100), mas com multiplicadores
   genéticos — uma ave perfeita passa de 100. */
function combatRating(f){
  const QUALITY_MULT = [0.85, 0.95, 1.05, 1.18, 1.35];
  const DIVERSITY_MULT = { excelente:1, boa:0.98, normal:0.95, baixa:0.9, critica:0.82 };
  const base = (f.forca||0)*0.4 + (f.velocidade||0)*0.3 + (f.resistencia||0)*0.3 + (f.instinto||0)*0.2;
  const mult = (QUALITY_MULT[((f.quality||1)-1)] || 1)
             * (DIVERSITY_MULT[f.diversity] || 1)
             * (1 + Math.min(0.15, (f.generation||1) * 0.015))
             * (f.isPhenomenal ? 1.25 : 1)
             * (0.92 + 0.08*potentialRatio(f));
  return Math.round(base * mult * 10) / 10;
}

/* Gera um bot da Arena: pega a identidade (nome/raça/linhagem) do ARENA_BOTS
   e rola stats escalados para chegar perto do combatRating alvo do rank.
   O bot "parece" um galo de verdade (raça com bias próprio + genética). */
function buildBotOpponent(bot, targetPower){
  const breedType = (typeof FIGHT_BREEDS_TYPES !== 'undefined') ? FIGHT_BREEDS_TYPES.find(b=>b.id===bot.breedId) : null;
  const genMult = (function(){
    const QUALITY_MULT = [0.85, 0.95, 1.05, 1.18, 1.35];
    const DIVERSITY_MULT = { excelente:1, boa:0.98, normal:0.95, baixa:0.9, critica:0.82 };
    return (QUALITY_MULT[((bot.quality||1)-1)] || 1)
         * (DIVERSITY_MULT[bot.diversity] || 1)
         * (1 + Math.min(0.15, (bot.generation||1) * 0.015));
  })();
  // "raw" alvo: quanto os stats somados devem dar ANTES dos multiplicadores
  // genéticos — o combatRating reaplica o genMult, então escalar o raw pelo
  // alvo cheio faria o bot estourar o rating (ex.: mitica ×1.35 vira 130+).
  // O potential 1.0 do bot não mexe aqui (fator ~1).
  const rawTarget = targetPower / genMult;
  // Proporções por raça: o bias define o "estilo" (shamo = força, índio = velocidade).
  const bias = breedType ? breedType.bias : { forca:[25,40], velocidade:[15,30], resistencia:[20,30], instinto:[15,25] };
  const mid = s => (s[0]+s[1])/2;
  const mids = { forca:mid(bias.forca), velocidade:mid(bias.velocidade), resistencia:mid(bias.resistencia), instinto:mid(bias.instinto) };
  const totalMid = mids.forca + mids.velocidade + mids.resistencia + mids.instinto;
  // Escala cada stat para que a soma ponderada (0.4/0.3/0.3/0.2) bata no raw.
  const pond = { forca:0.4, velocidade:0.3, resistencia:0.3, instinto:0.2 };
  const scale = rawTarget / (mids.forca*pond.forca + mids.velocidade*pond.velocidade + mids.resistencia*pond.resistencia + mids.instinto*pond.instinto);
  const raw = {
    forca: Math.max(5, Math.min(100, Math.round((mids.forca * scale) * (totalMid/100)))),
    velocidade: Math.max(5, Math.min(100, Math.round((mids.velocidade * scale) * (totalMid/100)))),
    resistencia: Math.max(5, Math.min(100, Math.round((mids.resistencia * scale) * (totalMid/100)))),
    instinto: Math.max(5, Math.min(100, Math.round((mids.instinto * scale) * (totalMid/100)))),
  };
  // Correção de deficit: devolve o que falta pro alvo nos stats (igual ao
  // buildOpponentFrom — mantém o rating do bot perto do alvo do rank).
  const cur = raw.forca*pond.forca + raw.velocidade*pond.velocidade + raw.resistencia*pond.resistencia + raw.instinto*pond.instinto;
  let deficit = rawTarget - cur;
  let guard = 0;
  while(deficit > 0.5 && guard < 20){
    const k = deficit >= 4 ? 'forca' : (deficit >= 2 ? 'velocidade' : (Math.random()<0.5 ? 'resistencia' : 'instinto'));
    if(raw[k] < 100){ raw[k]++; deficit -= pond[k]; }
    else break;
    guard++;
  }
  const name = bot.name || 'Oponente da Arena';
  const taunt = bot.taunt || 'Vamos ver o que você tem!';
  const nick = 'Bot da Arena';
  return {
    forca: raw.forca, velocidade: raw.velocidade, resistencia: raw.resistencia, instinto: raw.instinto,
    quality: bot.quality||2, diversity: bot.diversity||'normal',
    lineage: bot.lineage||'comum', generation: bot.generation||1,
    isPhenomenal: !!bot.isPhenomenal,
    breedType: bot.breedId || null,
    name, taunt,
    nickname: nick,
    potential:{ forca:100, velocidade:100, resistencia:100, instinto:100 },
    _bot:true,
  };
}

/* Normaliza um oponente para o formato de ave de combate:
   - online: snapshot do multiplayer (já tem todos os stats)
   - rank: distribui o oppPower alvo pelos 4 stats + rola genética plausível */
function buildOpponentFrom(src){
  if(src && src.forca !== undefined && src.velocidade !== undefined){
    return {
      forca:src.forca||0, velocidade:src.velocidade||0, resistencia:src.resistencia||0,
      instinto:src.instinto||0,
      quality:src.quality||2, diversity:src.diversity||'normal',
      lineage:src.lineage||'selecionada', generation:src.generation||1,
      isPhenomenal:!!src.isPhenomenal,
      name:src.name || src.nickname || 'Oponente',
      potential: src.potential || { forca:100, velocidade:100, resistencia:100, instinto:100 },
    };
  }
  // Gerado de um rank: src = { oppPower, rankIndex }
  const target = src.oppPower;
  // Força alvo distribuída pelos stats respeitando o bias do fighterPower
  // + uma fatia de instinto (que também conta no rating).
  const raw = { forca:target*0.46, velocidade:target*0.30, resistencia:target*0.24, instinto:target*0.14 };
  const total = raw.forca + raw.velocidade + raw.resistencia + raw.instinto;
  const bias = 0.4*raw.forca + 0.3*raw.velocidade + 0.3*raw.resistencia + 0.2*raw.instinto;
  const scale = total > 0 ? bias/target : 1;
  let forca = Math.min(100, Math.round(raw.forca/scale));
  let velocidade = Math.min(100, Math.round(raw.velocidade/scale));
  let resistencia = Math.min(100, Math.round(raw.resistencia/scale));
  let instinto = Math.min(100, Math.round(raw.instinto/scale));
  // Ajuste fino: joga o resto do "target" de volta nos stats (mantém o rating
  // perto do alvo do rank mesmo depois do arredondamento).
  const deficit = target - (forca*0.4 + velocidade*0.3 + resistencia*0.3 + instinto*0.2);
  if(deficit > 0){
    forca = Math.min(100, forca + Math.round(deficit/2));
    velocidade = Math.min(100, velocidade + Math.round(deficit/4));
    instinto = Math.min(100, instinto + Math.round(deficit/4));
  }
  // Genética plausível pro rank: quanto maior o rank, melhor a linhagem.
  const rankIdx = src.rankIndex || 0;
  const quality = Math.max(1, Math.min(5, rankIdx + 1));
  return {
    forca, velocidade, resistencia, instinto,
    quality,
    diversity: rankIdx >= 4 ? 'boa' : (rankIdx >= 2 ? 'normal' : 'baixa'),
    lineage: ['comum','selecionada','elite','imperial','mitica'][quality-1],
    generation: Math.max(1, rankIdx),
    isPhenomenal: false,
    name:'Oponente da Arena',
    potential:{ forca:100, velocidade:100, resistencia:100, instinto:100 },
  };
}

/* Dano de um golpe (stats do atacante e do defensor). Retorna
   { dmg, crit, evaded } — dmg 0 significa que esquivou. */
function rollHit(att, def, opts){
  opts = opts || {};
  // Esquiva: velocidade + instinto do defensor contra instinto do atacante.
  const evadeChance = Math.min(0.30,
    (def.velocidade||0)*0.0014 + (def.instinto||0)*0.0008 - (att.instinto||0)*0.0003);
  if(Math.random() < Math.max(0, evadeChance)){
    return { dmg:0, crit:false, evaded:true };
  }
  // Crítico: instinto do atacante, reduzido pela velocidade do defensor.
  const critChance = CRIT_CHANCE_BASE + (att.instinto||0)*0.0006 - (def.velocidade||0)*0.0003;
  const crit = Math.random() < Math.max(0.01, critChance);
  let dmg = 6 + (att.forca||0)*0.16 + (att.instinto||0)*0.06;
  dmg *= 0.9 + Math.random()*0.2;                      // variância ±10%
  dmg *= 1 - Math.min(0.5, (def.resistencia||0)/220);  // defesa
  // Vantagem de raça: se a raça do atacante countera a do defensor, dano +12%;
  // se for o contrário, -10%. Só vale quando os dois têm raça definida.
  if(att.breedType && def.breedType && typeof BREED_COUNTER !== 'undefined'){
    if(BREED_COUNTER[att.breedType] === def.breedType) dmg *= 1.12;
    else if(BREED_COUNTER[def.breedType] === att.breedType) dmg *= 0.90;
  }
  if(crit) dmg *= 1.4;
  dmg = Math.max(1, Math.round(dmg));
  return { dmg, crit, evaded:false };
}

/* HP inicial: baseado em resistência + instinto, com teto pra luta não
   virar "bater até cansar" — o rating decide quem vence na média. */
function maxHp(f){
  return Math.round(60 + (f.resistencia||0)*0.35 + (f.instinto||0)*0.15);
}

/* Simulação completa da luta. PRÉ-ROLADA: decide o vencedor primeiro
   (preserva a economia de win chance do rank), depois preenche os rounds
   garantindo MIN_ROUNDS..MAX_ROUNDS e o HP do perdedor zerando no final.
   A animação é um PLAYBACK fiel deste resultado. */
function simulateFight(fA, fB, opts){
  opts = opts || {};
  const ratingA = combatRating(fA), ratingB = combatRating(fB);
  // Vantagem de raça também entra na chance de vitória (pré-rolada) — senão
  // o ×1.12/×0.90 do rollHit só moldaria a barra no playback e escolher a
  // raça certa nunca mudaria o resultado de verdade.
  let effA = ratingA, effB = ratingB;
  if(fA.breedType && fB.breedType && typeof BREED_COUNTER !== 'undefined'){
    if(BREED_COUNTER[fA.breedType] === fB.breedType) effA *= 1.12;
    else if(BREED_COUNTER[fB.breedType] === fA.breedType) effB *= 1.12;
  }
  const pA = Math.pow(effA, 2) / (Math.pow(effA, 2) + Math.pow(effB, 2));
  const winner = Math.random() < pA ? 'a' : 'b';

  const stats = { a: fA, b: fB };
  const hp = { a: maxHp(fA), b: maxHp(fB) };
  const hpStart = { a: hp.a, b: hp.b };
  const rounds = [];
  const loser = winner === 'a' ? 'b' : 'a';

  // O VENCEDOR dá o golpe final (playback dramático: K.O. nas mãos dele).
  // roundsCount ímpar → 'a' ataca por último; par → 'b' ataca por último.
  let roundsCount = MIN_ROUNDS + Math.floor(Math.random() * (MAX_ROUNDS - MIN_ROUNDS + 1));
  const lastAttacker = (roundsCount % 2 === 0) ? 'b' : 'a';
  if(lastAttacker !== winner){
    roundsCount = (roundsCount < MAX_ROUNDS) ? roundsCount + 1 : roundsCount - 1;
  }

  // HP de cada round: o perdedor desce em degraus até zerar no último round.
  const loserStart = hp[loser];
  const hpPerRound = loserStart / roundsCount;

  for(let i=0; i<roundsCount; i++){
    const attacker = (i % 2 === 0) ? 'a' : 'b';
    const defender = attacker === 'a' ? 'b' : 'a';
    const atkStats = stats[attacker], defStats = stats[defender];
    const hit = rollHit(atkStats, defStats, opts);
    const isLoser = defender === loser;
    const isFinal = i === roundsCount-1;
    let dmg = hit.dmg;
    if(isFinal && isLoser){
      // K.O. garantido: o golpe final do vencedor não pode ser esquivado
      // e zera exatamente o HP do perdedor.
      hit.evaded = false;
      dmg = hp[defender];
    } else if(isLoser){
      // Degraus: o perdedor desce até a linha do próximo round, sem zerar
      // antes do final (a barra contradizeria o resultado no playback).
      const target = Math.max(0, Math.round(loserStart - hpPerRound*(i+1)));
      dmg = Math.max(0, Math.min(dmg, hp[defender] - target));
    }
    if(hit.evaded) dmg = 0;
    if(!isLoser){
      // O vencedor nunca zera: mantém um piso visível de 6% pra barra dele não
      // contradizer o resultado no playback (só o perdedor chega a 0, no K.O.).
      const floor = Math.max(1, Math.round(hpStart[defender]*0.06));
      dmg = Math.max(0, Math.min(dmg, hp[defender] - floor));
    }
    hp[defender] = Math.max(0, hp[defender] - dmg);

    rounds.push({
      round: i+1,
      attacker,
      dmg,
      crit: hit.crit,
      evaded: hit.evaded,
      hpA: hp.a,
      hpB: hp.b,
    });
  }

  return {
    winner,
    ratingA, ratingB,
    rounds,
    roundsCount,
    hpA: hp.a, hpB: hp.b,
    hpAStart: hpStart.a, hpBStart: hpStart.b,
  };
}

window.Combat = {
  combatRating,
  simulateFight,
  buildOpponentFrom,
  buildBotOpponent,
  rollHit,
  maxHp,
  MAX_ROUNDS,
  MIN_ROUNDS,
};

})();
