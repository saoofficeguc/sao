// SAO Portal server:  npm install, then  node server.js  ->  http://localhost:5173
// Everything is stored in data/sao.db (SQLite) and data/uploads. People sign in with email + password;
// the server decides what each person may see and do.
const http = require('http');
const fs = require('fs');
const path = require('path');

const store = require('./server/db');
const auth = require('./server/auth');
const { stateFor } = require('./server/access');
const actions = require('./server/actions');
const setup = require('./server/setup');
const files = require('./server/files');
const { toPdf, converterName } = require('./server/pdf');
const { draftMemo } = require('./server/ai');

const root = __dirname;
const port = Number(process.env.PORT) || 5173;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
// Only these files are served to browsers - never the server code, the database or uploads
const PUBLIC = new Set(['/index.html', '/app.js', '/forms.js', '/docfill.js', '/styles.css', '/manifest.webmanifest']);
const PUBLIC_DIRS = ['/assets/', '/templates/'];

// ---------- helpers ----------
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {}), ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit = 6 * 1024 * 1024) {
  const buf = await readBody(req, limit);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('Bad request'), { status: 400 }); }
}
const clientIp = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
// Requests that change data must come from the app itself (custom header + same-site cookie)
const fromApp = req => req.headers['x-sao'] === '1';

// ---------- API ----------
async function api(req, res, urlPath) {
  const user = auth.sessionUser(auth.readCookie(req));

  if (urlPath === '/api/session' && req.method === 'GET') {
    return send(res, 200, { user: user ? { id: user.id, name: user.name, role: user.role } : null, needsSetup: setup.needsSetup(),
      demo: setup.isDemo(), demoAccounts: !user ? setup.demoAccounts() : null, demoPassword: setup.isDemo() && !user ? setup.DEMO_PASSWORD : null });
  }
  if (urlPath === '/api/setup' && req.method === 'POST') {
    if (!fromApp(req)) return send(res, 403, { error: 'Forbidden' });
    const out = setup.setup(await readJson(req, 40 * 1024 * 1024));
    return send(res, out.status, out.body);
  }
  if (urlPath === '/api/login' && req.method === 'POST') {
    if (!fromApp(req)) return send(res, 403, { error: 'Forbidden' });
    const b = await readJson(req, 10000);
    const out = auth.login(b.email, b.password, clientIp(req));
    if (out.error) return send(res, out.status, { error: out.error });
    store.audit(out.userId, 'login');
    return send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(out.token) });
  }
  if (urlPath === '/api/logout' && req.method === 'POST') {
    auth.endSession(auth.readCookie(req));
    return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }

  // everything below needs a signed-in person
  if (!user) return send(res, 401, { error: 'Please sign in again.' });

  if (urlPath === '/api/state' && req.method === 'GET') return send(res, 200, stateFor(user));

  const m = urlPath.match(/^\/api\/actions\/([A-Za-z]+)$/);
  if (m && req.method === 'POST') {
    if (!fromApp(req)) return send(res, 403, { error: 'Forbidden' });
    const out = actions.run(m[1], user, await readJson(req));
    return send(res, out.status, out.body);
  }

  if (urlPath === '/api/files' && req.method === 'POST') {
    if (!fromApp(req)) return send(res, 403, { error: 'Forbidden' });
    const buf = await readBody(req, files.MAX_BYTES + 1);
    const name = decodeURIComponent(req.headers['x-file-name'] || 'file');
    const out = files.saveUpload(user, name, String(req.headers['content-type'] || '').split(';')[0], buf);
    return send(res, out.status, out.body);
  }
  const f = urlPath.match(/^\/api\/files\/(file-[a-f0-9]+)$/);
  if (f && req.method === 'GET') {
    const file = files.openFile(user, f[1]);
    if (!file) return send(res, 404, { error: 'File not found.' });
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': file.type, 'Content-Length': file.size, 'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}` });
    return fs.createReadStream(file.path).pipe(res);
  }

  if (urlPath === '/api/pdf' && req.method === 'POST') {
    if (!fromApp(req)) return send(res, 403, { error: 'Forbidden' });
    const buf = await readBody(req, 20 * 1024 * 1024);
    if (buf.slice(0, 2).toString() !== 'PK') return send(res, 400, { error: 'Not a .docx file' });
    try { return send(res, 200, await toPdf(buf), { 'Content-Type': 'application/pdf' }); }
    catch (e) { console.error('PDF conversion failed:', e.message); return send(res, 500, { error: 'PDF conversion failed' }); }
  }
  if (urlPath === '/api/memo-draft' && req.method === 'POST') {
    if (!fromApp(req)) return send(res, 403, { error: 'Forbidden' });
    const out = await draftMemo(await readJson(req, 20000));
    return send(res, out.error ? (out.status || 422) : 200, out);
  }
  return send(res, 404, { error: 'Not found' });
}

// ---------- static files ----------
function serveStatic(res, urlPath) {
  const p = urlPath === '/' ? '/index.html' : urlPath;
  if (!PUBLIC.has(p) && !PUBLIC_DIRS.some(d => p.startsWith(d))) return send(res, 404, 'Not found');
  const file = path.join(root, p);
  if (!file.startsWith(root + path.sep) || p.includes('..')) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

http.createServer(async (req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch { return send(res, 400, 'Bad request'); }
  try {
    if (urlPath.startsWith('/api/')) return await api(req, res, urlPath);
    return serveStatic(res, urlPath);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on the server.' });
    if (!e.status) console.error(e);
  }
}).listen(port, () => {
  console.log(`SAO Portal running at http://localhost:${port}`);
  console.log(`  Database: ${path.join(store.DATA_DIR, 'sao.db')}   PDF converter: ${converterName()}`);
  if (setup.needsSetup()) console.log('  First run: open the address above to create the SAO Office account.');
});
