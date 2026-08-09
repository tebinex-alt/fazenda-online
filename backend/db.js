/* =========================================================
   BANCO DE DADOS — SQLite (node:sqlite, zero dependências)
   - Schema: users, sessions, saves, kv_shared, pending_claims
   - Migração automática 1x do store.json antigo → .bak
========================================================= */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'fazenda.db');
const LEGACY_FILE = path.join(DATA_DIR, 'store.json');

if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash  TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS saves (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data    TEXT NOT NULL
  );

  -- Armazenamento pessoal genérico (chave->valor por usuário), usado para
  -- tudo que NÃO é o save principal (ex: identidade do multiplayer). O save
  -- principal ('fazenda-save') continua na tabela 'saves' por compatibilidade
  -- com bancos já migrados.
  CREATE TABLE IF NOT EXISTS kv_personal (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );

  CREATE TABLE IF NOT EXISTS kv_shared (
    room          TEXT NOT NULL,
    key           TEXT NOT NULL,
    value         TEXT NOT NULL,
    owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (room, key)
  );
  CREATE INDEX IF NOT EXISTS idx_kv_shared_room ON kv_shared(room);

  -- Save antigo (store.json) reivindicado: owner_token → user_id (1x)
  CREATE TABLE IF NOT EXISTS pending_claims (
    owner_token TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    claimed_by  INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL
  );
`);

/* ---------- migração do store.json legado (1x) ---------- */
function migrateLegacy(){
  if(!fs.existsSync(LEGACY_FILE)) return;
  try{
    const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
    const personal = (legacy && legacy.personal) || {};
    const shared = (legacy && legacy.shared) || {};

    const insertClaim = db.prepare(
      'INSERT OR IGNORE INTO pending_claims (owner_token, data, claimed_by) VALUES (?, ?, NULL)'
    );
    const insertShared = db.prepare(
      'INSERT OR IGNORE INTO kv_shared (room, key, value, owner_user_id) VALUES (?, ?, ?, NULL)'
    );
    const tx = db.exec('BEGIN');
    try{
      for(const owner of Object.keys(personal)){
        let blob = personal[owner];
        // Formato antigo: personal[owner] = { "fazenda-save": "<blob>" }
        if(blob && typeof blob === 'object' && typeof blob['fazenda-save'] === 'string'){
          blob = blob['fazenda-save'];
        }
        if(typeof blob !== 'string') continue;
        insertClaim.run(owner, blob);
      }
      for(const key of Object.keys(shared)){
        const value = shared[key];
        if(typeof value !== 'string') continue;
        const room = key.startsWith('mp:') ? key.split(':')[1] : '_';
        insertShared.run(room, key, value);
      }
      db.exec('COMMIT');
    }catch(e){
      db.exec('ROLLBACK');
      throw e;
    }
    // Backup — preserva o save antigo como resgate
    fs.renameSync(LEGACY_FILE, path.join(DATA_DIR, 'store.json.bak'));
    console.log('[db] store.json migrado para SQLite (backup: data/store.json.bak)');
  }catch(e){
    console.error('[db] Falha na migração do store.json:', e.message);
  }
}
migrateLegacy();

/* ---------- helpers de sessão ---------- */
const stmt = {
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  createUser: db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)'),
  createSession: db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)'
  ),
  sessionByTokenHash: db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
  touchSession: db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  getSave: db.prepare('SELECT data FROM saves WHERE user_id = ?'),
  putSave: db.prepare(
    'INSERT INTO saves (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data'
  ),
  getPersonal: db.prepare('SELECT value FROM kv_personal WHERE user_id = ? AND key = ?'),
  putPersonal: db.prepare(
    'INSERT INTO kv_personal (user_id, key, value) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value'
  ),
  deletePersonal: db.prepare('DELETE FROM kv_personal WHERE user_id = ? AND key = ?'),
  claimByToken: db.prepare('SELECT * FROM pending_claims WHERE owner_token = ?'),
  claimSetUser: db.prepare('UPDATE pending_claims SET claimed_by = ? WHERE owner_token = ?'),
  sharedByKey: db.prepare('SELECT * FROM kv_shared WHERE key = ?'),
  sharedList: db.prepare('SELECT * FROM kv_shared WHERE room = ?'),
  sharedPut: db.prepare(
    'INSERT INTO kv_shared (room, key, value, owner_user_id) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(room, key) DO UPDATE SET value = excluded.value, owner_user_id = COALESCE(kv_shared.owner_user_id, excluded.owner_user_id)'
  ),
  sharedDelete: db.prepare('DELETE FROM kv_shared WHERE key = ?'),
};

/* Limpeza de sessões expiradas (a cada boot e a cada hora) */
function cleanupSessions(){
  try{ stmt.deleteExpiredSessions.run(Date.now()); }catch(e){}
}
cleanupSessions();
setInterval(cleanupSessions, 3600 * 1000).unref();

module.exports = { db, stmt, DB_FILE };
