// SQLite database (built into Node.js 22.5+). One file: data/sao.db
// Records are stored as JSON documents, with the columns we search on (club, email) kept separately.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.SAO_DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'sao.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users         (id TEXT PRIMARY KEY, email TEXT UNIQUE, pass TEXT, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS clubs         (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS requests      (id TEXT PRIMARY KEY, club_id TEXT, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS transactions  (id TEXT PRIMARY KEY, club_id TEXT, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, club_id TEXT, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS signatures    (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS files         (id TEXT PRIMARY KEY, name TEXT, type TEXT, size INTEGER, uploaded_by TEXT,
                                            club_id TEXT, request_id TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS sessions      (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS meta          (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS audit         (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, user_id TEXT, action TEXT, detail TEXT);
  CREATE INDEX IF NOT EXISTS req_club ON requests(club_id);
  CREATE INDEX IF NOT EXISTS tx_club  ON transactions(club_id);
  CREATE INDEX IF NOT EXISTS ann_club ON announcements(club_id);
`);

const DOC_TABLES = { clubs: 1, requests: 1, transactions: 1, announcements: 1 };
const parse = row => row && JSON.parse(row.data);

// ---- documents (clubs, requests, transactions, announcements) ----
function all(table) {
  if (!DOC_TABLES[table]) throw new Error('bad table');
  return db.prepare(`SELECT data FROM ${table}`).all().map(parse);
}
function byClub(table, clubId) {
  if (!DOC_TABLES[table] || table === 'clubs') throw new Error('bad table');
  return db.prepare(`SELECT data FROM ${table} WHERE club_id = ?`).all(clubId).map(parse);
}
function get(table, id) {
  if (!DOC_TABLES[table]) throw new Error('bad table');
  return parse(db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id));
}
function put(table, obj) {
  if (!DOC_TABLES[table]) throw new Error('bad table');
  if (table === 'clubs') db.prepare('INSERT OR REPLACE INTO clubs (id, data) VALUES (?, ?)').run(obj.id, JSON.stringify(obj));
  else db.prepare(`INSERT OR REPLACE INTO ${table} (id, club_id, data) VALUES (?, ?, ?)`).run(obj.id, obj.clubId ?? null, JSON.stringify(obj));
  return obj;
}

// ---- users (login email and password hash are kept outside the JSON) ----
const userRow = row => row && { ...JSON.parse(row.data), id: row.id, email: row.email || null, hasLogin: !!row.pass };
const users = {
  all: () => db.prepare('SELECT * FROM users').all().map(userRow),
  get: id => userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(id)),
  byEmail: email => db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase()),
  put(u) {
    const { id, email, hasLogin, pass, ...data } = u;
    const existing = db.prepare('SELECT email, pass FROM users WHERE id = ?').get(id);
    db.prepare('INSERT OR REPLACE INTO users (id, email, pass, data) VALUES (?, ?, ?, ?)')
      .run(id, existing ? existing.email : null, existing ? existing.pass : null, JSON.stringify(data));
    return u;
  },
  setLogin(id, email, passHash) {
    db.prepare('UPDATE users SET email = ?, pass = COALESCE(?, pass) WHERE id = ?').run(email ? email.trim().toLowerCase() : null, passHash || null, id);
  },
  count: () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
};

// ---- signatures ----
const signatures = {
  get: userId => { const r = db.prepare('SELECT data FROM signatures WHERE user_id = ?').get(userId); return r ? r.data : null; },
  set: (userId, dataUrl) => db.prepare('INSERT OR REPLACE INTO signatures (user_id, data) VALUES (?, ?)').run(userId, dataUrl),
  del: userId => db.prepare('DELETE FROM signatures WHERE user_id = ?').run(userId),
};

// ---- small key/value settings (counters, demo flag) ----
const meta = {
  get: key => { const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key); return r ? r.value : null; },
  set: (key, value) => db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, String(value)),
};

function audit(userId, action, detail) {
  db.prepare('INSERT INTO audit (at, user_id, action, detail) VALUES (?, ?, ?, ?)').run(new Date().toISOString(), userId || null, action, detail ? JSON.stringify(detail).slice(0, 2000) : null);
}

// Runs fn inside one transaction: everything is saved, or nothing is
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, DATA_DIR, UPLOAD_DIR, all, byClub, get, put, users, signatures, meta, audit, tx };
