// Data access. Works on Supabase (Postgres) and on a single computer (SQLite) through a small "driver":
//   driver.query(sql, params) -> rows      ($1, $2 ... placeholders, each used once and in order)
//   driver.exec(sql)                       (several statements, no parameters)
//   driver.transaction(fn)                 (runs fn alone, all-or-nothing)
//   driver.dialect                         ('pg' or 'sqlite')
// Records are kept as JSON text, with the columns we search on (club, email) kept separately.

const DOC_TABLES = { clubs: 1, requests: 1, transactions: 1, announcements: 1 };

const SCHEMA = {
  common: `
    CREATE TABLE IF NOT EXISTS users         (id TEXT PRIMARY KEY, email TEXT UNIQUE, pass TEXT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS clubs         (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests      (id TEXT PRIMARY KEY, club_id TEXT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS transactions  (id TEXT PRIMARY KEY, club_id TEXT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, club_id TEXT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS signatures    (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files         (id TEXT PRIMARY KEY, name TEXT, type TEXT, size INTEGER, uploaded_by TEXT,
                                              club_id TEXT, request_id TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS sessions      (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta          (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS login_failures (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS req_club ON requests(club_id);
    CREATE INDEX IF NOT EXISTS tx_club  ON transactions(club_id);
    CREATE INDEX IF NOT EXISTS ann_club ON announcements(club_id);`,
  sqlite: `CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, user_id TEXT, action TEXT, detail TEXT);`,
  // Postgres: lock every table so Supabase's public API keys cannot read or change anything.
  // Only this function (connected as the database owner) can.
  pg: `CREATE TABLE IF NOT EXISTS audit (id BIGSERIAL PRIMARY KEY, at TEXT, user_id TEXT, action TEXT, detail TEXT);
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;          ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE requests ENABLE ROW LEVEL SECURITY;       ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;  ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;
    ALTER TABLE files ENABLE ROW LEVEL SECURITY;          ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE meta ENABLE ROW LEVEL SECURITY;           ALTER TABLE login_failures ENABLE ROW LEVEL SECURITY;
    ALTER TABLE audit ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON users, clubs, requests, transactions, announcements, signatures, files, sessions, meta, login_failures, audit FROM anon, authenticated;`,
};
export const ensureSchema = driver => driver.transaction(() => driver.exec(SCHEMA.common + '\n' + (driver.dialect === 'pg' ? SCHEMA.pg : SCHEMA.sqlite)));

export function createStore(driver) {
  const q = (sql, params = []) => driver.query(sql, params);
  const one = async (sql, params) => (await q(sql, params))[0] || null;
  const parse = row => row && JSON.parse(row.data);
  const check = table => { if (!DOC_TABLES[table]) throw new Error('bad table'); };
  const userRow = row => row && { ...JSON.parse(row.data), id: row.id, email: row.email || null, hasLogin: !!row.pass };

  return {
    driver,
    // everything inside fn is saved together, or not at all (requests are already wrapped, so this simply runs fn)
    tx: fn => driver.transaction(fn),

    // ---- documents (clubs, requests, transactions, announcements) ----
    async all(table) { check(table); return (await q(`SELECT data FROM ${table}`)).map(parse); },
    async byClub(table, clubId) {
      check(table); if (table === 'clubs') throw new Error('bad table');
      return (await q(`SELECT data FROM ${table} WHERE club_id = $1`, [clubId])).map(parse);
    },
    async get(table, id) { check(table); return parse(await one(`SELECT data FROM ${table} WHERE id = $1`, [id])); },
    async put(table, obj) {
      check(table);
      if (table === 'clubs') await q('INSERT INTO clubs (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [obj.id, JSON.stringify(obj)]);
      else await q(`INSERT INTO ${table} (id, club_id, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET club_id = EXCLUDED.club_id, data = EXCLUDED.data`,
        [obj.id, obj.clubId ?? null, JSON.stringify(obj)]);
      return obj;
    },

    // ---- users (login email and password hash are kept outside the JSON) ----
    users: {
      all: async () => (await q('SELECT * FROM users')).map(userRow),
      get: async id => userRow(await one('SELECT * FROM users WHERE id = $1', [id])),
      byEmail: email => one('SELECT * FROM users WHERE email = $1', [String(email || '').trim().toLowerCase()]),
      async put(u) {
        const { id, email, hasLogin, pass, ...data } = u;
        await q('INSERT INTO users (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [id, JSON.stringify(data)]);
        return u;
      },
      setLogin: (id, email, passHash) => q('UPDATE users SET email = $1, pass = COALESCE($2, pass) WHERE id = $3',
        [email ? email.trim().toLowerCase() : null, passHash || null, id]),
      count: async () => Number((await one('SELECT COUNT(*) AS n FROM users')).n),
    },

    signatures: {
      get: async userId => (await one('SELECT data FROM signatures WHERE user_id = $1', [userId]))?.data ?? null,
      set: (userId, dataUrl) => q('INSERT INTO signatures (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data', [userId, dataUrl]),
      del: userId => q('DELETE FROM signatures WHERE user_id = $1', [userId]),
    },

    // small key/value settings (counters, demo flag)
    meta: {
      get: async key => (await one('SELECT value FROM meta WHERE key = $1', [key]))?.value ?? null,
      set: (key, value) => q('INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, String(value)]),
    },

    audit: (userId, action, detail) => q('INSERT INTO audit (at, user_id, action, detail) VALUES ($1, $2, $3, $4)',
      [new Date().toISOString(), userId || null, action, detail ? JSON.stringify(detail).slice(0, 2000) : null]),

    files: {
      insert: f => q('INSERT INTO files (id, name, type, size, uploaded_by, club_id, request_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [f.id, f.name, f.type, f.size, f.uploaded_by, f.club_id ?? null, null, new Date().toISOString()]),
      get: id => one('SELECT * FROM files WHERE id = $1', [String(id)]),
      link: (id, requestId, clubId) => q('UPDATE files SET request_id = $1, club_id = $2 WHERE id = $3', [requestId, clubId, id]),
    },

    sessions: {
      create: (hash, userId, expires) => q('INSERT INTO sessions (token, user_id, expires) VALUES ($1, $2, $3)', [hash, userId, expires]),
      get: hash => one('SELECT user_id, expires FROM sessions WHERE token = $1', [hash]),
      del: hash => q('DELETE FROM sessions WHERE token = $1', [hash]),
      delUser: userId => q('DELETE FROM sessions WHERE user_id = $1', [userId]),
      purge: () => q('DELETE FROM sessions WHERE expires < $1', [Date.now()]),
    },

    // wrong-password counts (kept in the database so every server copy sees them)
    failures: {
      get: key => one('SELECT count, until FROM login_failures WHERE key = $1', [key]),
      set: (key, count, until) => q('INSERT INTO login_failures (key, count, until) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET count = EXCLUDED.count, until = EXCLUDED.until', [key, count, until]),
      del: key => q('DELETE FROM login_failures WHERE key = $1', [key]),
    },

    // raw access for the one-time import
    raw: q,
  };
}
