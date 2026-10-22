// SAO Portal on a normal computer:  node server.js  ->  http://localhost:5173
// Runs the same server code as the Supabase version (supabase/functions/_shared/core), with
// SQLite (data/sao.db) and uploaded files in data/uploads. Used for local testing and for a self-hosted server.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { AsyncLocalStorage } = require('node:async_hooks');

const root = __dirname;
const port = Number(process.env.PORT) || 5173;
const DATA_DIR = process.env.SAO_DATA_DIR || path.join(root, 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
// Only these files are served to browsers - never the server code, the database or uploads
const PUBLIC = new Set(['/index.html', '/app.js', '/forms.js', '/docfill.js', '/styles.css', '/config.js', '/manifest.webmanifest']);
const PUBLIC_DIRS = ['/assets/', '/templates/'];
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };

// ---- SQLite driver: one transaction at a time ($1.. placeholders become ?) ----
function sqliteDriver(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  const als = new AsyncLocalStorage();
  let chain = Promise.resolve();
  const conv = sql => sql.replace(/\$\d+/g, '?');
  return {
    dialect: 'sqlite',
    async query(sql, params = []) {
      const st = db.prepare(conv(sql));
      if (/^\s*(SELECT|WITH)\b/i.test(sql)) return st.all(...params);
      st.run(...params); return [];
    },
    async exec(sql) { db.exec(sql); },
    transaction(fn) {
      if (als.getStore()) return fn();
      const run = async () => {
        db.exec('BEGIN IMMEDIATE');
        try { const out = await als.run(true, fn); db.exec('COMMIT'); return out; }
        catch (e) { db.exec('ROLLBACK'); throw e; }
      };
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    },
  };
}
// ---- files on disk ----
const keyPath = key => {
  const parts = String(key).split('/').filter(p => p && p !== '.' && p !== '..').map(p => p.replace(/[^\w.\-]/g, '_'));
  return path.join(DATA_DIR, ...parts);
};
const diskStorage = {
  async get(key) { const p = keyPath(key); return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null; },
  async put(key, bytes) { const p = keyPath(key); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); },
  async del(key) { fs.rmSync(keyPath(key), { force: true }); },
};

let Anthropic = null;
try { const mod = require('@anthropic-ai/sdk'); Anthropic = mod.default || mod; } catch { /* AI drafting off */ }

function readAll(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveStatic(res, urlPath) {
  const p = urlPath === '/' ? '/index.html' : urlPath;
  if (!PUBLIC.has(p) && !PUBLIC_DIRS.some(d => p.startsWith(d))) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
  const file = path.join(root, p);
  if (!file.startsWith(root + path.sep) || p.includes('..')) { res.writeHead(403, SECURITY_HEADERS); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

(async () => {
  const { createApp } = await import('./supabase/functions/_shared/core/app.mjs');
  const app = createApp({
    driver: sqliteDriver(path.join(DATA_DIR, 'sao.db')),
    storage: diskStorage,
    forms: require('./forms.js'),
    Anthropic,
    env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
  });
  await app.ready();

  http.createServer(async (req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end('Bad request'); }
    if (!urlPath.startsWith('/api/')) return serveStatic(res, urlPath);
    try {
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readAll(req, 41 * 1024 * 1024);
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
      const request = new Request(`http://localhost${req.url}`, { method: req.method, headers, body });
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const response = await app.handle(request, { ip });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      if (!res.headersSent) res.writeHead(e.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.status ? e.message : 'Something went wrong on the server.' }));
      if (!e.status) console.error(e);
    }
  }).listen(port, process.env.HOST || undefined, () => {
    console.log(`SAO Portal running at http://localhost:${port}`);
    console.log(`  Database: ${path.join(DATA_DIR, 'sao.db')}`);
  });
})().catch(e => { console.error('Could not start:', e); process.exit(1); });
