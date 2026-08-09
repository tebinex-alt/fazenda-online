/* =========================================================
   BACKEND — Fazenda Real
   Servidor Node.js puro (sem dependências externas).
   - Serve os arquivos estáticos do frontend
   - API com autenticação por sessão + SQLite (node:sqlite)
========================================================= */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { apiLimiter } = require('./ratelimit');
const { route } = require('./routes');
const { DB_FILE, closeDb } = require('./db');

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.json':'application/json',
  '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon'
};

function serveStatic(req, res, pathname){
  const rel = path.normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\])+/, '');
  const filePath = path.join(FRONTEND_DIR, rel);
  if(!filePath.startsWith(FRONTEND_DIR + path.sep) && filePath !== FRONTEND_DIR){
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data)=>{
    if(err){ res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------- servidor ---------- */
const server = http.createServer((req, res)=>{
  const parsed = url.parse(req.url, true);
  parsed.query = parsed.query || {};
  if(parsed.pathname.startsWith('/api/')){
    apiLimiter(req, res, ()=> route(req, res));
  }else{
    serveStatic(req, res, parsed.pathname);
  }
});

server.listen(PORT, ()=>{
  console.log(`Fazenda Real rodando em http://localhost:${PORT}`);
  console.log(`Banco SQLite: ${DB_FILE}`);
});

/* ---------- encerramento gracioso ----------
   Sem isso, um `kill`/deploy/restart pode encerrar o processo com o WAL
   ainda não sincronizado com o .db — foi exatamente o que corrompeu o
   fazenda.db anterior. server.close() para de aceitar novas conexões;
   closeDb() força o checkpoint final e fecha o arquivo com segurança. */
function shutdown(signal){
  console.log(`[server] ${signal} recebido, encerrando...`);
  server.close(()=>{
    closeDb();
    process.exit(0);
  });
  // se algo travar, força saída depois de 5s
  setTimeout(()=>process.exit(1), 5000).unref();
}
process.on('SIGINT', ()=>shutdown('SIGINT'));
process.on('SIGTERM', ()=>shutdown('SIGTERM'));