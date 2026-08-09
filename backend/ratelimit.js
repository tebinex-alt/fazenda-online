/* =========================================================
   RATE LIMIT — janela fixa em memória por IP
   - Auth: 10 req/min por IP + lockout de login após falhas
   - API geral: 120 req/min por IP
========================================================= */
const buckets = new Map();   // ip -> { counts: Map<kind, {count, resetAt}>, loginFails: {count, resetAt} }

/* IP real do jogador: atrás de proxy (TRUST_PROXY=true) usa X-Forwarded-For */
function ipOf(req){
  const trust = process.env.TRUST_PROXY === 'true';
  if(trust){
    const xff = req.headers['x-forwarded-for'];
    if(xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

const WINDOW_MS = 60 * 1000;
const AUTH_MAX = 10;
const API_MAX = 120;
const LOGIN_FAIL_MAX = 10;
const LOGIN_FAIL_WINDOW = 15 * 60 * 1000;   // 15 min
const LOCKOUT_MS = 15 * 60 * 1000;          // 15 min

function bucketFor(ip){
  let b = buckets.get(ip);
  if(!b){ b = { counts: new Map(), loginFails: { count:0, resetAt: Date.now()+LOGIN_FAIL_WINDOW } }; buckets.set(ip, b); }
  return b;
}
function prune(){
  const now = Date.now();
  for(const [ip, b] of buckets){
    for(const [kind, e] of b.counts){
      if(now > e.resetAt) b.counts.delete(kind);
    }
    if(b.counts.size === 0 && now > b.loginFails.resetAt && b.loginFails.count === 0) buckets.delete(ip);
  }
}
setInterval(prune, 60 * 1000).unref();

function hit(ip, kind, max, windowMs){
  const b = bucketFor(ip);
  const now = Date.now();
  let e = b.counts.get(kind);
  if(!e || now > e.resetAt){ e = { count:0, resetAt: now+windowMs }; b.counts.set(kind, e); }
  e.count++;
  return e.count <= max;
}

/* Middleware: aplica o limite por tipo de rota */
function apiLimiter(req, res, next){
  const ip = ipOf(req);
  const isAuth = (req.url || '').startsWith('/api/auth/');
  const max = isAuth ? AUTH_MAX : API_MAX;
  const kind = isAuth ? 'auth' : 'api';
  if(!hit(ip, kind, max, WINDOW_MS)){
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Muitas requisições — aguarde um instante e tente de novo.' }));
  }
  next();
}

/* Registra falha de login (por IP + username) — lockout após 10 falhas/15min */
function recordLoginFail(ip){
  const b = bucketFor(ip);
  const now = Date.now();
  if(now > b.loginFails.resetAt){ b.loginFails = { count:0, resetAt: now+LOGIN_FAIL_WINDOW }; }
  b.loginFails.count++;
}
function loginBlocked(ip){
  const b = buckets.get(ip);
  if(!b) return false;
  const now = Date.now();
  if(now > b.loginFails.resetAt) return false;
  return b.loginFails.count >= LOGIN_FAIL_MAX;
}
function clearLoginFails(ip){
  const b = buckets.get(ip);
  if(b) b.loginFails.count = 0;
}

module.exports = { apiLimiter, recordLoginFail, loginBlocked, clearLoginFails };
