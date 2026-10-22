// The SAO Portal server, written once and run in two places:
//   - Supabase Edge Function (Deno + Postgres + Supabase Storage)  -> supabase/functions/sao/index.ts
//   - a normal computer (Node + SQLite + files on disk)             -> server.js
// handle(Request) -> Response, using standard web Request/Response objects.
import { createStore, ensureSchema } from './store.mjs';
import { createAuth } from './auth.mjs';
import { createAccess } from './access.mjs';
import { createActions, uid } from './actions.mjs';
import { createSetup, DEMO_PASSWORD } from './setup.mjs';
import { createAi } from './ai.mjs';

const MAX_FILE = 10 * 1024 * 1024;
const FILE_TYPES = /^(application\/pdf|image\/(png|jpeg|webp)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/msword)$/;

// Sign-in travels as "Authorization: Bearer <token>" (no cookies), so any web address may call the API safely.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-sao, x-file-name, x-client-info, apikey',
  'Access-Control-Max-Age': '86400',
};
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, ...SECURITY, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

class Rollback extends Error { constructor(result) { super('rollback'); this.result = result; } }

/**
 * deps.driver   database driver (see store.mjs)
 * deps.storage  { get(key) -> Uint8Array|null, put(key, bytes, type), del(key) } for uploaded files and the one-time import
 * deps.forms    the shared forms rules (forms.js)
 * deps.Anthropic optional Anthropic SDK class, deps.env.ANTHROPIC_API_KEY optional key
 */
export function createApp({ driver, storage, forms, Anthropic = null, env = {}, allowSetup = true }) {
  const store = createStore(driver);
  const auth = createAuth(store);
  const access = createAccess(store, forms);
  const actions = createActions({ store, auth, access, forms });
  const setup = createSetup(store, auth);
  const ai = createAi(Anthropic, env.ANTHROPIC_API_KEY);

  // A change that fails part-way is undone completely
  async function inTx(fn) {
    try {
      return await store.tx(async () => { const out = await fn(); if (out && out.status >= 400) throw new Rollback(out); return out; });
    } catch (e) { if (e instanceof Rollback) return e.result; throw e; }
  }

  // ---- one-time import: an empty database is filled from import/sao-dump.json (made by deploy/upload-to-supabase.js) ----
  async function importIfEmpty() {
    if (!storage || (await store.users.count()) > 0) return;
    const raw = await storage.get('import/sao-dump.json');
    if (!raw) return;
    const d = JSON.parse(new TextDecoder().decode(raw));
    const q = store.raw;
    for (const u of d.users || []) await q('INSERT INTO users (id, email, pass, data) VALUES ($1, $2, $3, $4)', [u.id, u.email ?? null, u.pass ?? null, u.data]);
    for (const c of d.clubs || []) await q('INSERT INTO clubs (id, data) VALUES ($1, $2)', [c.id, c.data]);
    for (const t of ['requests', 'transactions', 'announcements'])
      for (const r of d[t] || []) await q(`INSERT INTO ${t} (id, club_id, data) VALUES ($1, $2, $3)`, [r.id, r.club_id ?? null, r.data]);
    for (const s of d.signatures || []) await q('INSERT INTO signatures (user_id, data) VALUES ($1, $2)', [s.user_id, s.data]);
    for (const f of d.files || []) await q('INSERT INTO files (id, name, type, size, uploaded_by, club_id, request_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [f.id, f.name, f.type, f.size, f.uploaded_by, f.club_id ?? null, f.request_id ?? null, f.created_at ?? null]);
    for (const m of d.meta || []) await q('INSERT INTO meta (key, value) VALUES ($1, $2)', [m.key, m.value]);
    for (const a of d.audit || []) await q('INSERT INTO audit (at, user_id, action, detail) VALUES ($1, $2, $3, $4)', [a.at, a.user_id, a.action, a.detail]);
    await store.audit(null, 'import', { users: (d.users || []).length, clubs: (d.clubs || []).length, requests: (d.requests || []).length });
    await storage.put(`import/loaded-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, raw, 'application/json');
    await storage.del('import/sao-dump.json');
    console.log('Imported the data from import/sao-dump.json');
  }

  // Tables are created once; while the database is still empty, look for the import (at most every 20 seconds)
  let schemaP = null, lastImportCheck = 0, hasUsers = false;
  async function ready() {
    if (!schemaP) schemaP = ensureSchema(driver).catch(e => { schemaP = null; throw e; });
    await schemaP;
    if (hasUsers || Date.now() - lastImportCheck < 20000) return;
    lastImportCheck = Date.now();
    await store.tx(importIfEmpty);
    hasUsers = (await store.users.count()) > 0;
  }

  // ---- uploaded files ----
  async function saveUpload(user, name, type, bytes) {
    if (!bytes.length) return { status: 400, body: { error: 'The file is empty.' } };
    if (bytes.length > MAX_FILE) return { status: 413, body: { error: 'The file is larger than 10 MB.' } };
    if (!FILE_TYPES.test(type)) return { status: 415, body: { error: 'Only PDF, Word, Excel and image files can be attached.' } };
    const id = 'file-' + uid('f').split('-').pop() + Math.random().toString(16).slice(2, 10);
    const safeName = String(name || 'file').replace(/[\\/:*?"<>|\r\n]+/g, '-').slice(0, 150);
    await storage.put(`uploads/${id}`, bytes, type);
    await store.files.insert({ id, name: safeName, type, size: bytes.length, uploaded_by: user.id, club_id: user.clubId || null });
    return { status: 200, body: { id, name: safeName, size: bytes.length, type } };
  }
  // The uploader, the SAO Office, the club's own rep, or someone who can see the request it belongs to
  async function canOpen(user, row) {
    if (user.role === 'sao' || row.uploaded_by === user.id) return true;
    if (user.role === 'rep' && row.club_id && row.club_id === user.clubId) return true;
    if (row.request_id) { const r = await store.get('requests', row.request_id); return !!r && access.canSeeRequest(user, r); }
    return false;
  }

  async function readBody(req, limit) {
    const len = Number(req.headers.get('content-length') || 0);
    if (len > limit) return null;
    const buf = new Uint8Array(await req.arrayBuffer());
    return buf.length > limit ? null : buf;
  }
  async function readJson(req, limit = 6 * 1024 * 1024) {
    const buf = await readBody(req, limit);
    if (!buf) throw Object.assign(new Error('Too large'), { status: 413 });
    try { return JSON.parse(new TextDecoder().decode(buf) || '{}'); } catch { throw Object.assign(new Error('Bad request'), { status: 400 }); }
  }

  async function handle(req, info = {}) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      try { await ready(); }
      catch (e) { console.error('Database not ready:', e); return json(503, { error: 'The portal database is not available. Try again in a minute.' }); }

      // works for /api/..., /sao/api/... and /functions/v1/sao/api/...
      let path;
      try { path = decodeURIComponent(new URL(req.url).pathname); } catch { return json(400, { error: 'Bad request' }); }
      const at = path.indexOf('/api/');
      if (at < 0) return json(404, { error: 'Not found' });
      path = path.slice(at);

      const authz = req.headers.get('authorization') || '';
      const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : null;
      const fromApp = req.headers.get('x-sao') === '1';
      const post = req.method === 'POST';
      if (post && !fromApp) return json(403, { error: 'Forbidden' });
      const user = await auth.sessionUser(token);

      if (path === '/api/session' && req.method === 'GET') {
        const empty = await setup.needsSetup();
        if (empty && !allowSetup) return json(503, { error: 'The portal is waiting for its data to be moved in. Try again in a minute.' });
        return json(200, { user: user ? { id: user.id, name: user.name, role: user.role } : null, needsSetup: empty,
          demo: await setup.isDemo(), demoAccounts: !user ? await setup.demoAccounts() : null, demoPassword: (await setup.isDemo()) && !user ? DEMO_PASSWORD : null });
      }
      if (path === '/api/setup' && post) {
        // On Supabase the portal starts from the imported data; the "create the SAO account" screen is off
        if (!allowSetup) return json(403, { error: 'Setup is turned off on this server. Move your data in with deploy/move-data-to-supabase.cmd.' });
        const b = await readJson(req, 40 * 1024 * 1024);
        const out = await inTx(() => setup.setup(b));
        return json(out.status, out.body);
      }
      if (path === '/api/login' && post) {
        const b = await readJson(req, 10000);
        // not rolled back on a wrong password: the wrong-attempt count must be kept
        const out = await store.tx(async () => {
          const r = await auth.login(b.email, b.password, info.ip);
          if (!r.error) await store.audit(r.userId, 'login');
          return r;
        });
        return out.error ? json(out.status, { error: out.error }) : json(200, { ok: true, token: out.token });
      }
      if (path === '/api/logout' && post) {
        await store.tx(() => auth.endSession(token));
        return json(200, { ok: true });
      }

      // everything below needs a signed-in person
      if (!user) return json(401, { error: 'Please sign in again.' });

      if (path === '/api/state' && req.method === 'GET') return json(200, await access.stateFor(user));

      const m = path.match(/^\/api\/actions\/([A-Za-z]+)$/);
      if (m && post) {
        const b = await readJson(req);
        const out = await inTx(() => actions.run(m[1], user, b));
        return json(out.status, out.body);
      }

      if (path === '/api/files' && post) {
        const bytes = await readBody(req, MAX_FILE + 1);
        if (!bytes) return json(413, { error: 'The file is larger than 10 MB.' });
        let name = 'file'; try { name = decodeURIComponent(req.headers.get('x-file-name') || 'file'); } catch { /* keep default */ }
        const out = await inTx(() => saveUpload(user, name, String(req.headers.get('content-type') || '').split(';')[0], bytes));
        return json(out.status, out.body);
      }
      const f = path.match(/^\/api\/files\/(file-[a-z0-9]+)$/);
      if (f && req.method === 'GET') {
        const row = await store.files.get(f[1]);
        const bytes = row && (await canOpen(user, row)) ? await storage.get(`uploads/${row.id}`) : null;
        if (!bytes) return json(404, { error: 'File not found.' });   // same answer for "missing" and "not allowed"
        return new Response(bytes, { status: 200, headers: { ...CORS, ...SECURITY, 'Content-Type': row.type, 'Cache-Control': 'private, no-store',
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.name)}` } });
      }

      if (path === '/api/memo-draft' && post) {
        const out = await ai.draftMemo(await readJson(req, 20000));
        return json(out.error ? (out.status || 422) : 200, out);
      }
      return json(404, { error: 'Not found' });
    } catch (e) {
      if (e.status) return json(e.status, { error: e.message });
      console.error(e);
      return json(500, { error: 'Something went wrong on the server.' });
    }
  }

  return { handle, ready, store };
}
