/* =========================================================
   MULTIPLAYER (Online, via backend real)
========================================================= */
let mpIdentity = null;
let mpCache = { birds: [], log: [], loading:false, error:null, publishedFighterId:null };

function randomRoomCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<5;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}
async function loadMpIdentity(){
  try{
    const res = await Storage.get('mp-identity', false);
    if(res && res.value) mpIdentity = JSON.parse(res.value);
  }catch(e){}
}
async function saveMpIdentity(){
  try{ await Storage.set('mp-identity', JSON.stringify(mpIdentity), false); }catch(e){}
}
/* Sanitiza o apelido: remove caracteres de controle e qualquer coisa que
   possa virar HTML/atributo. A exibição ainda passa por esc() — isto é
   defesa em profundidade e mantém o apelido seguro para uso em chaves. */
function sanitizeNickname(nick){
  return String(nick||'').trim()
    .replace(/[\u0000-\u001F\u007F<>"'`]/g, '')
    .slice(0,16);
}

function fighterSnapshot(f, room, nickname){
  return {
    nickname, room, ownerId: mpIdentity && mpIdentity.pubId,
    gender:f.gender, lineage:f.lineage, quality:f.quality, name:f.name, generation:f.generation, diversity:f.diversity, isPhenomenal:f.isPhenomenal,
    forca:f.forca, velocidade:f.velocidade, resistencia:f.resistencia, instinto:f.instinto,
    wins:f.wins, losses:f.losses, updatedAt:Date.now(), sourceFighterId:f.id,
  };
}
async function joinRoom(nickname, room){
  nickname = sanitizeNickname(nickname);
  room = (room||'').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,8);
  if(!nickname){ toast('Escolha um nome de jogador.'); return; }
  if(!room) room = randomRoomCode();
  if(mpIdentity && mpIdentity.pubId){
    // Já tem identidade: mantém o pubId para continuar dono do galo publicado.
    mpIdentity.nickname = nickname;
    mpIdentity.room = room;
  } else {
    // pubId é a chave de posse do galo publicado. Como ele é aleatório e fica
    // guardado só no seu navegador, ninguém mais consegue sobrescrever sua ave.
    mpIdentity = { nickname, room, pubId: 'p'+Math.random().toString(36).slice(2,12)+Date.now().toString(36) };
  }
  await saveMpIdentity();
  toast('Entrou na sala '+room+' como '+nickname+'!');
  render();
  refreshOnlineData();
}
function leaveRoom(){
  mpIdentity = null;
  mpCache = { birds: [], log: [], loading:false, error:null, publishedFighterId:null };
  saveMpIdentity();
  render();
}
async function refreshOnlineData(){
  if(!mpIdentity) return;
  mpCache.loading = true; mpCache.error=null; render();
  try{
    const prefix = 'mp:'+mpIdentity.room+':bird:';
    // Lista com valores em UMA requisição (antes era 1 request por galo = N+1).
    const listRes = await Storage.list(prefix, true, true);
    const entries = (listRes && listRes.entries) || [];
    const birds = [];
    for(const en of entries){
      try{
        const bird = JSON.parse(en.value);
        bird._key = en.key;
        birds.push(bird);
      }catch(e){}
    }
    // Fallback p/ backend antigo que não suporta values=true.
    if(!birds.length && listRes && listRes.keys && listRes.keys.length){
      for(const k of listRes.keys){
        try{
          const r = await Storage.get(k, true);
          if(r && r.value){ const bird = JSON.parse(r.value); bird._key = k; birds.push(bird); }
        }catch(e){}
      }
    }
    birds.sort((a,b)=> (b.forca+b.velocidade+b.resistencia)-(a.forca+a.velocidade+a.resistencia));
    mpCache.birds = birds;

    const logRes = await Storage.get('mp:'+mpIdentity.room+':log', true);
    mpCache.log = logRes && logRes.value ? JSON.parse(logRes.value) : [];
  }catch(e){
    mpCache.error = 'Não foi possível carregar os dados da sala agora. Tente de novo em alguns segundos.';
  }
  mpCache.loading = false;
  render();
}
async function publishFighter(fighterId){
  if(!mpIdentity) return;
  const f = state.fighters.find(x=>x.id===fighterId);
  if(!f) return;
  try{
    const key = 'mp:'+mpIdentity.room+':bird:'+mpIdentity.pubId;
    await Storage.set(key, JSON.stringify(fighterSnapshot(f, mpIdentity.room, mpIdentity.nickname)), true);
    mpCache.publishedFighterId = fighterId;
    toast('📡 '+lineageLabel(f.lineage)+' publicado na sala para seus amigos desafiarem!');
    refreshOnlineData();
  }catch(e){
    toast('Não foi possível publicar agora. Tente de novo.');
  }
}
function challengeOnlineBird(oppKey){
  if(!mpIdentity) return;
  // oppKey é a chave de storage do galo (ex: mp:SALA:bird:pXXXX). Aceita também
  // apelido como fallback p/ dados antigos sem _key.
  let opp = mpCache.birds.find(b=>b._key===oppKey);
  if(!opp) opp = mpCache.birds.find(b=>b.nickname===oppKey);
  if(!opp){ toast('Esse jogador não tem galo publicado agora.'); return; }
  const myId = state.selectedArenaFighter;
  const f = state.fighters.find(x=>x.id===myId);
  if(!f){ toast('Selecione um dos seus galos disponíveis primeiro.'); return; }
  if(isResting(f)){ toast('Essa ave ainda está descansando.'); return; }
  if(f.trainingUntil>Date.now()){ toast('Essa ave está em treino.'); return; }
  const rankIdx = arenaRankIndex();
  const rank = ARENA_RANKS[rankIdx];
  confirmAction({
    icon:'🌍', title:'Desafiar '+opp.nickname+'?',
    text:'Seu '+lineageLabel(f.lineage)+' (poder '+Math.round(fighterPower(f))+') vs o '+lineageLabel(opp.lineage)+' de '+opp.nickname+' (poder '+Math.round(fighterPower(opp))+'). Prêmio se vencer: '+money(rank.reward)+'. Depois, sua ave precisa descansar.',
    // O resultado sai do MESMO motor de combate da Arena local: a cena
    // animada (PIXI) usa os stats reais do snapshot do oponente e o vencedor
    // é decidido por Combat.simulateFight — o callback aplica as recompensas.
    onYes: ()=>{
      showFightScene(f, opp, { rank, online:true, nickname:opp.nickname }, async (won)=>{
        f.restUntil = Date.now()+FIGHT_REST_TIME*1000;
        if(won){
          f.wins++; f.winStreak = (f.winStreak||0)+1;
          state.money += rank.reward; state.totalEarned += rank.reward; checkTierUp();
          toast('🏆 Vitória online contra '+opp.nickname+'! Ganhou '+money(rank.reward)+'.');
        } else {
          f.losses++;
          // derrota online NÃO zera a sequência — só derrota local quebra a streak
          toast('😔 Perdeu para o galo de '+opp.nickname+' desta vez.');
        }
        updateArenaFeats(f);
        saveGame();
        // Registro no servidor: atualiza win/loss da ave do oponente e anexa o
        // resultado ao log da sala de forma atômica (o cliente não grava mais
        // no galo alheio nem no log — o backend faz isso).
        try{
          await api('/api/challenges', {
            method:'POST', body:{
              room: mpIdentity.room,
              opponentKey: opp._key,
              won,
              fromBird: lineageLabel(f.lineage),
              to: opp.nickname,
              toBird: lineageLabel(opp.lineage),
            }
          });
        }catch(e){}
        publishFighter(f.id);
        render();
      });
    }
  });
}

