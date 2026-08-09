/* =========================================================
   INICIALIZAÇÃO — só roda o jogo com sessão ativa
========================================================= */
async function init(){
  // 1. Verifica sessão
  let authed = null;
  try{
    authed = await Auth.me();
  }catch(e){}
  if(!authed){
    showAuthScreen();
    return;
  }
  document.getElementById('auth-overlay').classList.add('hidden');
  const userBtn = document.getElementById('user-btn');
  if(userBtn) userBtn.style.display = '';
  // 2. Carrega o jogo (o save vem pela sessão)
  await loadGame();
  await applyOfflineProgress();
  await loadMpIdentity();
  // 2.5 Modo teste: abre a URL com ?dinheiro para ter grana infinita
  if(new URLSearchParams(location.search).has('dinheiro')){
    state.money = 1000000000;
    toast('💰 Modo teste: dinheiro infinito ativo! (console: debugMoney())');
  }
  window.debugMoney = function(){ state.money = 1000000000; saveGame(); toast('💰 Dinheiro reabastecido!'); };
  render();
  // 3. Loop do jogo
  setInterval(gameTick, 1000);
  window.addEventListener('beforeunload', flushSave);
  setInterval(flushSave, 30000);
}

/* ---------- tela de login/registro ---------- */
let authMode = 'login';

function showAuthScreen(){
  const overlay = document.getElementById('auth-overlay');
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  document.getElementById('auth-title').textContent = '🐔 Fazenda Real';
  document.getElementById('auth-subtitle').textContent =
    'Entre para continuar sua fazenda ou crie uma conta nova.';
  document.getElementById('auth-error').textContent = '';
  document.getElementById('auth-overlay').dataset.mode = authMode;
}

async function handleAuthSubmit(e){
  e.preventDefault();
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const claim = document.getElementById('auth-claim').value.trim();
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  try{
    if(authMode === 'register'){
      await Auth.register(username, password, claim || undefined);
      // Reivindicou o save antigo? O token não serve mais — apaga o resíduo.
      if(claim) clearLegacyUserId();
    }else{
      await Auth.login(username, password);
    }
    // Sucesso: recarrega com a sessão ativa
    location.reload();
  }catch(err){
    errEl.textContent = err.message;
  }
}

function toggleAuthMode(){
  authMode = authMode === 'login' ? 'register' : 'login';
  const overlay = document.getElementById('auth-overlay');
  overlay.dataset.mode = authMode;
  document.getElementById('auth-title').textContent =
    authMode === 'login' ? '🐔 Fazenda Real' : '🐔 Criar conta';
  document.getElementById('auth-claim-wrap').style.display =
    authMode === 'register' ? '' : 'none';
  // No modo cadastro, sugere o código do save antigo (se existir no navegador).
  if(authMode === 'register'){
    const claim = document.getElementById('auth-claim');
    if(claim && !claim.value) claim.value = getUserId() || '';
  }
}

async function handleLogout(){
  await Auth.logout();
  location.reload();
}

window.addEventListener('DOMContentLoaded', init);
