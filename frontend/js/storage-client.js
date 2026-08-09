/* =========================================================
   STORAGE CLIENT — fala com o backend real via HTTP
   - A sessão vem do cookie (HttpOnly) — o frontend NÃO envia owner;
     o servidor identifica o jogador pela sessão.
========================================================= */
let lastAuthErrorAt = 0;

async function api(path, opts){
  opts = opts || {};
  opts.credentials = 'include';
  if(opts.body !== undefined && typeof opts.body !== 'string'){
    opts.body = JSON.stringify(opts.body);
  }
  let res;
  try{
    res = await fetch(path, opts);
  }catch(e){
    throw new Error('Sem conexão com o servidor. Verifique se o backend está rodando.');
  }
  if(res.status === 401 && Date.now() - lastAuthErrorAt > 3000){
    lastAuthErrorAt = Date.now();
    showAuthScreen();   // sessão expirada → volta para o login
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(()=>({})) : null;
  if(!res.ok){
    const err = new Error((data && data.error) || 'Erro do servidor ('+res.status+')');
    err.status = res.status;
    throw err;
  }
  return data;
}

const Storage = {
  async get(key, shared){
    const q = 'key='+encodeURIComponent(key)+'&shared='+(shared ? 'true' : 'false');
    return api('/api/kv?'+q);
  },
  async set(key, value, shared){
    return api('/api/kv', { method:'PUT', body:{ key, value, shared: !!shared } });
  },
  async delete(key, shared){
    const q = 'key='+encodeURIComponent(key)+'&shared='+(shared ? 'true' : 'false');
    return api('/api/kv?'+q, { method:'DELETE' });
  },
  async list(prefix, shared, withValues){
    let q = 'prefix='+encodeURIComponent(prefix||'')+'&shared='+(shared ? 'true' : 'false');
    if(withValues) q += '&values=true';
    return api('/api/kv/list?'+q);
  }
};

/* Helper legado: devolve o código do save antigo (u_...) que o jogo
   gravava em localStorage antes das contas. Usado na tela de cadastro
   para reivindicar a fazenda antiga. Retorna null se não houver. */
function getUserId(){
  try{ return localStorage.getItem('fazenda-user-id') || null; }catch(e){ return null; }
}
/* Apaga o código do save antigo após a reivindicação ser concluída no
   cadastro: a partir daí o save vive na conta, o token não serve mais. */
function clearLegacyUserId(){
  try{ localStorage.removeItem('fazenda-user-id'); }catch(e){}
}

const Auth = {
  async register(username, password, claimToken){
    return api('/api/auth/register', { method:'POST', body:{ username, password, claimToken } });
  },
  async login(username, password){
    return api('/api/auth/login', { method:'POST', body:{ username, password } });
  },
  async logout(){
    return api('/api/auth/logout', { method:'POST' }).catch(()=>null);
  },
  async me(){
    return api('/api/auth/me');
  }
};
