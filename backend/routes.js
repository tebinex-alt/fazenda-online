/* =========================================================
   ROTAS — API com autenticação
   - /api/auth/* (register, login, logout, me)
   - /api/kv* (mesma semântica do storage-client, agora por sessão)
   - /api/challenges (registro de desafios no servidor)
========================================================= */
const url = require('url');
const { stmt } = require('./db');
const auth = require('./auth');

const MAX_BODY_BYTES = 256 * 1024;
const MAX_VALUE_LENGTH = 256 * 1024;   // blob de save maior que o JSON legado
const MAX_KEY_LENGTH = 200;
const MAX_LIST_KEYS = 500;
const MAX_LOG_BYTES = 64 * 1024;

function isValidKey(key){
  return typeof key === 'string'
    && key.length > 0
    && key.length <= MAX_KEY_LENGTH
    && !key.includes('\u0000')
    && !(key === '__proto__' || key === 'prototype' || key === 'constructor');
}
function readBody(req){
  return new Promise((resolve, reject)=>{
    let chunks = '';
    let size = 0;
    let aborted = false;
    req.on('data', c=>{
      size += c.length;
      if(size > MAX_BODY_BYTES){
        aborted = true;
        req.destroy();
        reject(Object.assign(new Error('corpo da requisição muito grande'), { status: 413 }));
        return;
      }
      chunks += c;
    });
    req.on('end', ()=>{
      if(aborted) return;
      if(!chunks) return resolve({});
      try{ resolve(JSON.parse(chunks)); }
      catch(e){ reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function roomOfSharedKey(key){
  if(key.startsWith('mp:')){
    const parts = key.split(':');
    return parts[1] || '_';
  }
  return '_';
}
function isOwnedSharedKey(key){
  // Chaves de ave publicada têm dono; log e outros são coletivos
  return key.startsWith('mp:') && key.includes(':bird:');
}

async function handleApi(req, res, parsed){
  const pathname = parsed.pathname;
  try{
    /* ---------- auth ---------- */
    if(pathname === '/api/auth/register' && req.method === 'POST'){
      const body = await readBody(req);
      return auth.register(req, body, res);
    }
    if(pathname === '/api/auth/login' && req.method === 'POST'){
      const body = await readBody(req);
      return auth.login(req, body, res);
    }
    if(pathname === '/api/auth/logout' && req.method === 'POST'){
      return auth.logout(req, res);
    }
    if(pathname === '/api/auth/me' && req.method === 'GET'){
      return auth.me(req, res);
    }

    /* ---------- o resto exige sessão ---------- */
    const user = auth.requireAuth(req, res);
    if(!user) return;

    // GET /api/kv/list?prefix=&shared=&values=true
    if(req.method === 'GET' && pathname === '/api/kv/list'){
      const shared = parsed.query.shared === 'true';
      const prefix = parsed.query.prefix || '';
      if(prefix.length > MAX_KEY_LENGTH) return auth.sendError(res, 400, 'prefix muito longo');
      let rows, entries;
      if(shared){
        const room = roomOfSharedKey(prefix);
        const list = stmt.sharedList.all(room);
        rows = list.filter(r=>r.key.startsWith(prefix)).slice(0, MAX_LIST_KEYS);
      }else{
        // Lista pessoal: só a chave fazenda-save importa; aqui devolve vazio para
        // prefixos desconhecidos (compat com o cliente que lista saves).
        rows = [];
      }
      const keys = rows.map(r=>r.key);
      const result = { keys, prefix, shared };
      if(parsed.query.values === 'true'){
        result.entries = rows.map(r=>({ key: r.key, value: r.value }));
      }
      return auth.sendJSON(res, 200, result);
    }

    // GET /api/kv?key=&shared=
    if(req.method === 'GET' && pathname === '/api/kv'){
      const shared = parsed.query.shared === 'true';
      const key = parsed.query.key || '';
      if(!isValidKey(key)) return auth.sendError(res, 400, 'chave inválida');
      if(shared){
        const row = stmt.sharedByKey.get(key);
        if(!row) return auth.sendJSON(res, 404, { error: 'not found' });
        return auth.sendJSON(res, 200, { key, value: row.value, shared });
      }
      if(key === 'fazenda-save'){
        const save = stmt.getSave.get(user.id);
        if(!save) return auth.sendJSON(res, 404, { error: 'not found' });
        return auth.sendJSON(res, 200, { key, value: save.data, shared });
      }
      const row = stmt.getPersonal.get(user.id, key);
      if(!row) return auth.sendJSON(res, 404, { error: 'not found' });
      return auth.sendJSON(res, 200, { key, value: row.value, shared });
    }

    // PUT /api/kv  { key, value, shared }
    if(req.method === 'PUT' && pathname === '/api/kv'){
      const body = await readBody(req);
      const shared = !!body.shared;
      const key = body.key;
      if(!isValidKey(key)) return auth.sendError(res, 400, 'chave inválida');
      if(typeof body.value !== 'string' || body.value.length > MAX_VALUE_LENGTH){
        return auth.sendError(res, 400, 'valor muito grande');
      }
      if(!shared){
        if(key === 'fazenda-save'){
          // Save principal: grava por sessão, ignora qualquer owner enviado
          stmt.putSave.run(user.id, body.value);
        } else {
          // Qualquer outra chave pessoal (ex: mp-identity) vai pra sua própria
          // tabela — NUNCA deve sobrescrever o save principal do jogador.
          stmt.putPersonal.run(user.id, key, body.value);
        }
        return auth.sendJSON(res, 200, { key, value: body.value, shared });
      }
      // Compartilhado: verifica posse se for ave publicada
      if(isOwnedSharedKey(key)){
        const existing = stmt.sharedByKey.get(key);
        if(existing){
          if(existing.owner_user_id !== null && existing.owner_user_id !== user.id){
            return auth.sendError(res, 403, 'Essa ave pertence a outro jogador.');
          }
        }
        const room = roomOfSharedKey(key);
        stmt.sharedPut.run(room, key, body.value, user.id);
        return auth.sendJSON(res, 200, { key, value: body.value, shared });
      }
      // Chaves coletivas (log da sala, etc): qualquer logado grava
      const room = roomOfSharedKey(key);
      stmt.sharedPut.run(room, key, body.value, null);
      return auth.sendJSON(res, 200, { key, value: body.value, shared });
    }

    // DELETE /api/kv?key=&shared=
    if(req.method === 'DELETE' && pathname === '/api/kv'){
      const shared = parsed.query.shared === 'true';
      const key = parsed.query.key || '';
      if(!isValidKey(key)) return auth.sendError(res, 400, 'chave inválida');
      if(shared && isOwnedSharedKey(key)){
        const existing = stmt.sharedByKey.get(key);
        if(existing && existing.owner_user_id !== null && existing.owner_user_id !== user.id){
          return auth.sendError(res, 403, 'Essa ave pertence a outro jogador.');
        }
        stmt.sharedDelete.run(key);
        return auth.sendJSON(res, 200, { key, deleted: true, shared });
      }
      if(shared){
        stmt.sharedDelete.run(key);
        return auth.sendJSON(res, 200, { key, deleted: true, shared });
      }
      if(key === 'fazenda-save'){
        // O save principal nunca é apagado por essa rota (proteção contra perda
        // acidental de progresso) — só é sobrescrito via PUT.
        return auth.sendJSON(res, 200, { key, deleted: false, shared });
      }
      stmt.deletePersonal.run(user.id, key);
      return auth.sendJSON(res, 200, { key, deleted: true, shared });
    }

    // POST /api/challenges  { room, opponentKey, won }
    if(req.method === 'POST' && pathname === '/api/challenges'){
      const body = await readBody(req);
      const room = String(body.room || '').trim();
      const opponentKey = String(body.opponentKey || '');
      if(!room || room.length > 8) return auth.sendError(res, 400, 'sala inválida');
      if(!isValidKey(opponentKey) || !opponentKey.startsWith('mp:'+room+':bird:')){
        return auth.sendError(res, 400, 'galo do oponente inválido');
      }
      const birdRow = stmt.sharedByKey.get(opponentKey);
      if(!birdRow) return auth.sendError(res, 404, 'ave não encontrada');
      let bird;
      try{ bird = JSON.parse(birdRow.value); }catch(e){ return auth.sendError(res, 500, 'ave corrompida'); }
      // Só o dono da ave pode sofrer mudança de stats; o desafiante manda o
      // resultado (cálculo igual ao do cliente) e o servidor atualiza atômicamente.
      bird.updatedAt = Date.now();
      if(body.won){ bird.losses = (bird.losses||0)+1; }
      else { bird.wins = (bird.wins||0)+1; }
      stmt.sharedPut.run(birdRow.room, opponentKey, JSON.stringify(bird), birdRow.owner_user_id);

      // Log da sala — anexado no servidor (não confia no cliente)
      let log = [];
      const logRow = stmt.sharedByKey.get('mp:'+room+':log');
      if(logRow){
        try{ log = JSON.parse(logRow.value); }catch(e){ log = []; }
      }
      log.unshift({
        t: Date.now(),
        from: user.username,
        fromBird: body.fromBird || 'ave',
        to: body.to || 'jogador',
        toBird: body.toBird || 'ave',
        won: !!body.won,
      });
      log = log.slice(0, 25);
      const logValue = JSON.stringify(log);
      if(Buffer.byteLength(logValue) <= MAX_LOG_BYTES){
        stmt.sharedPut.run(room, 'mp:'+room+':log', logValue, null);
      }
      return auth.sendJSON(res, 200, { ok: true });
    }

    return auth.sendError(res, 404, 'rota não encontrada');
  }catch(e){
    return auth.sendError(res, e.status || 500, e.message || 'erro interno');
  }
}

function route(req, res){
  const parsed = url.parse(req.url, true);
  parsed.query = parsed.query || {};
  req.path = parsed.pathname;
  handleApi(req, res, parsed);
}

module.exports = { route };
