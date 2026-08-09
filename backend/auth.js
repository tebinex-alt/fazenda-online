/* =========================================================
   AUTENTICAÇÃO — hash scrypt + sessões server-side
   - Senha: salt(16B) + scrypt(64B), comparação timingSafeEqual
   - Sessão: token aleatório 32B; no banco só sha256(token)
========================================================= */
const crypto = require('crypto');
const { stmt } = require('./db');
const { recordLoginFail, loginBlocked, clearLoginFails } = require('./ratelimit');

const SESSION_DAYS = 30;
const COOKIE_NAME = 'fazenda_sid';

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

function hashPassword(password){
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(password, stored){
  const [salt, hash] = String(stored).split(':');
  if(!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/* ---------- sessões ---------- */
function createSession(userId){
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  stmt.createSession.run(tokenHash, userId, now, now + SESSION_DAYS * 86400 * 1000, now);
  return token;
}
function destroySession(token){
  if(!token) return;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  stmt.deleteSession.run(tokenHash);
}
function resolveUserFromRequest(req){
  const cookie = parseCookies(req)[COOKIE_NAME];
  if(!cookie) return null;
  const tokenHash = crypto.createHash('sha256').update(cookie).digest('hex');
  const sess = stmt.sessionByTokenHash.get(tokenHash);
  if(!sess) return null;
  if(sess.expires_at < Date.now()){ destroySession(cookie); return null; }
  const user = stmt.userById.get(sess.user_id);
  if(!user) return null;
  // renova last_seen (sem estender expiração)
  try{ stmt.touchSession.run(Date.now(), tokenHash); }catch(e){}
  return { id: user.id, username: user.username };
}
function setSessionCookie(res, token){
  const secure = (process.env.TRUST_PROXY === 'true' || process.env.COOKIE_SECURE === 'true') ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    COOKIE_NAME + '=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + (SESSION_DAYS * 86400) + secure);
}
function clearSessionCookie(res){
  res.setHeader('Set-Cookie', COOKIE_NAME + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}
function parseCookies(req){
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(part=>{
    const i = part.indexOf('=');
    if(i > -1) out[part.slice(0,i).trim()] = part.slice(i+1).trim();
  });
  return out;
}
function ipOf(req){
  if(process.env.TRUST_PROXY === 'true'){
    const fwd = req.headers['x-forwarded-for'];
    if(fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/* ---------- handlers ---------- */
function register(req, body, res){
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const claimToken = body.claimToken ? String(body.claimToken).trim() : '';

  if(!USERNAME_RE.test(username)) return sendError(res, 400, 'Usuário inválido — use 3 a 20 caracteres (letras, números ou _).');
  if(password.length < 8) return sendError(res, 400, 'A senha precisa de pelo menos 8 caracteres.');

  const exists = stmt.userByUsername.get(username);
  if(exists) return sendError(res, 409, 'Esse nome de usuário já está em uso.');

  // Reivindica o save antigo (se houver token válido) — antes de criar a conta
  let legacyData = null;
  if(claimToken){
    const claim = stmt.claimByToken.get(claimToken);
    if(!claim) return sendError(res, 400, 'Código do save antigo não encontrado.');
    if(claim.claimed_by !== null) return sendError(res, 409, 'Esse código de save antigo já foi usado.');
    legacyData = claim.data;
  }

  const createdAt = Date.now();
  let userId;
  try{
    const r = stmt.createUser.run(username, hashPassword(password), createdAt);
    userId = Number(r.lastInsertRowid);
  }catch(e){
    return sendError(res, 409, 'Não foi possível criar a conta agora. Tente outro nome.');
  }

  // Transfere o save antigo para a conta nova (1x)
  if(legacyData !== null){
    try{
      stmt.putSave.run(userId, legacyData);
      stmt.claimSetUser.run(userId, claimToken);
    }catch(e){ /* se falhar, o jogador começa do zero; o claim continua disponível */ }
  }

  const token = createSession(userId);
  setSessionCookie(res, token);
  return sendJSON(res, 201, { username });
}

function login(req, body, res){
  const ip = ipOf(req);
  if(loginBlocked(ip)) return sendError(res, 429, 'Muitas tentativas de login. Aguarde 15 minutos.');

  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const user = stmt.userByUsername.get(username);
  if(!user || !verifyPassword(password, user.pass_hash)){
    recordLoginFail(ip);
    return sendError(res, 401, 'Usuário ou senha incorretos.');
  }
  clearLoginFails(ip);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  return sendJSON(res, 200, { username: user.username });
}

function logout(req, res){
  const token = parseCookies(req)[COOKIE_NAME];
  destroySession(token);
  clearSessionCookie(res);
  return sendJSON(res, 200, { ok: true });
}

function me(req, res){
  const user = resolveUserFromRequest(req);
  if(!user) return sendError(res, 401, 'Não autenticado.');
  return sendJSON(res, 200, { username: user.username });
}

function requireAuth(req, res){
  const user = resolveUserFromRequest(req);
  if(!user){
    sendError(res, 401, 'Sessão expirada. Entre de novo.');
    return null;
  }
  return user;
}

/* ---------- helpers ---------- */
function sendJSON(res, status, obj){
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
function sendError(res, status, message){
  sendJSON(res, status, { error: message });
}

module.exports = { register, login, logout, me, requireAuth, setSessionCookie, clearSessionCookie, sendJSON, sendError, parseCookies, ipOf, COOKIE_NAME };
