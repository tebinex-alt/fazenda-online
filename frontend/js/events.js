/* =========================================================
   EVENTOS
========================================================= */
// Cartas de galo viradas (verso exposto): sobrevive aos re-renders do
// renderTick (1s) para que a carta só volte à frente com outro clique.
const flippedCards = new Set();
document.getElementById('tabs').addEventListener('click', e=>{
  const btn = e.target.closest('.tab');
  if(!btn) return;
  const prev = activeTab;                     // aba antes da troca
  activeTab = btn.dataset.tab;
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t===btn));
  renderTab();
  // Animação só na troca real de aba — o rebuild de 1s (tickTab→renderTab)
  // chama renderTab() sem mudar activeTab e não deve re-disparar.
  if(prev !== activeTab){
    const main = document.getElementById('main-content');
    main.classList.remove('tab-enter');
    void main.offsetWidth;                    // reflow: reinicia a animação
    main.classList.add('tab-enter');
  }
  if(activeTab==='online' && mpIdentity) refreshOnlineData();
});

function bindDynamicEvents(){
  const main = document.getElementById('main-content');
  main.querySelectorAll('[data-buy-chicken]').forEach(el=>el.onclick=()=>buyChicken(el.dataset.buyChicken));
  main.querySelectorAll('[data-sell-chicken]').forEach(el=>el.onclick=()=>sellChicken(el.dataset.sellChicken));
  main.querySelectorAll('[data-buy-upgrade]').forEach(el=>el.onclick=()=>buyUpgrade(el.dataset.buyUpgrade));
  const sellBtn = main.querySelector('#sell-eggs'); if(sellBtn) sellBtn.onclick = sellEggs;
  const feedBtn = main.querySelector('#buy-feed-10'); if(feedBtn) feedBtn.onclick = ()=>buyFeed(10);
  main.querySelectorAll('[data-plot]').forEach(el=>{
    const i = +el.dataset.plot;
    el.onclick = ()=>{
      const p = state.plots[i];
      if(p.ready) harvestPlot(i);
      else if(!p.planted) plantPlot(i);
    };
  });
  main.querySelectorAll('[data-inc-slot]').forEach(el=>el.onclick=()=>fillIncubatorSlot(+el.dataset.incSlot));
  main.querySelectorAll('[data-inc-collect]').forEach(el=>el.onclick=()=>collectIncubatorSlot(+el.dataset.incCollect));
  main.querySelectorAll('[data-select-breed]').forEach(el=>el.onclick=()=>selectBreedTarget(el.dataset.selectBreed));
  main.querySelectorAll('[data-start-pen]').forEach(el=>el.onclick=()=>startBreeding(+el.dataset.startPen));
  main.querySelectorAll('[data-buy-egg]').forEach(el=>el.onclick=()=>buyFightEgg(el.dataset.buyEgg));
  main.querySelectorAll('[data-feed-cage]').forEach(el=>el.onclick=()=>feedCage(+el.dataset.feedCage));
  main.querySelectorAll('[data-collect-fighter]').forEach(el=>el.onclick=()=>collectFighter(+el.dataset.collectFighter));
  main.querySelectorAll('[data-select-fighter]').forEach(el=>el.onclick=()=>{
    const id = el.dataset.selectFighter;
    const f = state.fighters.find(x=>x.id===id);
    if(!f) return;
    selectFighter(f.gender==='M'?'A':'B', id);
  });
  main.querySelectorAll('[data-train]').forEach(el=>el.onclick=()=>{
    const [id, stat] = el.dataset.train.split('|');
    trainFighter(id, stat);
  });
  main.querySelectorAll('[data-sell-fighter]').forEach(el=>el.onclick=()=>sellFighter(el.dataset.sellFighter));
  main.querySelectorAll('[data-toggle-breeder]').forEach(el=>el.onclick=()=>toggleBreeder(el.dataset.toggleBreeder));
  main.querySelectorAll('[data-genealogy]').forEach(el=>el.onclick=()=>showGenealogy(el.dataset.genealogy));
  main.querySelectorAll('[data-rename-fighter]').forEach(el=>el.onclick=()=>openRename(el.dataset.renameFighter));
  const breedFightersBtn = main.querySelector('#do-breed-fighters'); if(breedFightersBtn) breedFightersBtn.onclick = breedFighters;
  main.querySelectorAll('[data-enter-arena]').forEach(el=>el.onclick=()=>enterArena(el.dataset.enterArena));
  main.querySelectorAll('[data-toggle-auto-plot]').forEach(el=>el.onclick=()=>{
    state.autoPlot = !state.autoPlot;
    registerActivity('buy');
    saveGame(); render();
    toast(state.autoPlot ? '🚜 Trator ligado: colhe e planta sozinho!' : '🚜 Trator desligado.');
  });
  const mpJoinBtn = main.querySelector('#mp-join-btn');
  if(mpJoinBtn) mpJoinBtn.onclick = ()=>{
    const nick = main.querySelector('#mp-nickname').value;
    const room = main.querySelector('#mp-room').value;
    joinRoom(nick, room);
  };
  const mpLeaveBtn = main.querySelector('#mp-leave-btn'); if(mpLeaveBtn) mpLeaveBtn.onclick = leaveRoom;
  const mpRefreshBtn = main.querySelector('#mp-refresh-btn'); if(mpRefreshBtn) mpRefreshBtn.onclick = refreshOnlineData;
  main.querySelectorAll('[data-publish-fighter]').forEach(el=>el.onclick=()=>publishFighter(el.dataset.publishFighter));
  main.querySelectorAll('[data-select-arena-fighter]').forEach(el=>el.onclick=()=>selectArenaFighter(el.dataset.selectArenaFighter));
  main.querySelectorAll('[data-challenge-online]').forEach(el=>el.onclick=()=>challengeOnlineBird(el.dataset.challengeOnline));
  // Card de galo frente/verso: vira SÓ com clique esquerdo direto no card.
  // Cliques em botões/links/inputs internos (data-*) nunca viram a carta.
  // O estado virado sobrevive aos re-renders de 1s (renderTick): guardamos por
  // id da ave num WeakSet aqui na closure, e restauramos a classe ao montar.
  main.querySelectorAll('[data-flip]').forEach(el=>{
    const fId = el.dataset.flip;
    if(fId && flippedCards.has(fId)) el.classList.add('flipped');
    el.onclick = (e)=>{
      if(e.button!==0) return;
      if(e.target.closest('[data-buy-egg],[data-feed-cage],[data-collect-fighter],[data-select-fighter],[data-train],[data-sell-fighter],[data-toggle-breeder],[data-genealogy],[data-rename-fighter],[data-enter-arena],[data-challenge-online],[data-publish-fighter],[data-select-arena-fighter],button,a,input')){
        return;
      }
      el.classList.toggle('flipped');
      if(fId){
        if(el.classList.contains('flipped')) flippedCards.add(fId);
        else flippedCards.delete(fId);
      }
    };
  });
}

