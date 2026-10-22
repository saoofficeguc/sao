// One-time move: copies this computer's portal data (data/sao.db + data/uploads) into Supabase Storage.
// The Supabase function loads it into its database the first time it starts with an empty database.
//
// Easiest: double-click deploy\move-data-to-supabase.cmd (it asks for the key).
// Or, in Command Prompt from the project folder:
//   set SUPABASE_URL=https://xxxx.supabase.co
//   set SUPABASE_SERVICE_KEY=your-secret-key
//   node deploy/upload-to-supabase.js
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = 'sao-data';
const DATA = process.env.SAO_DATA_DIR || path.join(__dirname, '..', 'data');

// New-style secret keys (sb_secret_...) go in the apikey header only; legacy service_role keys also as Bearer
const auth = (extra = {}) => (KEY.startsWith('sb_') ? { apikey: KEY, ...extra } : { Authorization: `Bearer ${KEY}`, apikey: KEY, ...extra });
const objectUrl = key => `${BASE}/storage/v1/object/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
async function ensureBucket() {
  const r = await fetch(`${BASE}/storage/v1/bucket`, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
  if (r.ok) return;
  const t = await r.text();
  if (r.status !== 409 && !/already exists|Duplicate/i.test(t)) throw new Error(`Supabase did not accept the key or address (${r.status}): ${t.slice(0, 200)}`);
}
async function upload(key, body, type) {
  const r = await fetch(objectUrl(key), { method: 'POST', headers: auth({ 'Content-Type': type, 'x-upsert': 'true' }), body });
  if (!r.ok) throw new Error(`Upload of ${key} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

(async () => {
  if (!BASE || !KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY first (see the top of this file).'); process.exit(1); }
  const dbFile = path.join(DATA, 'sao.db');
  if (!fs.existsSync(dbFile)) { console.error('No data found at ' + dbFile); process.exit(1); }
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const rows = t => { try { return db.prepare(`SELECT * FROM ${t}`).all(); } catch { return []; } };
  const dump = {
    version: 1, exportedAt: new Date().toISOString(),
    users: rows('users'), clubs: rows('clubs'), requests: rows('requests'), transactions: rows('transactions'),
    announcements: rows('announcements'), signatures: rows('signatures'), files: rows('files'), meta: rows('meta'),
    audit: rows('audit').map(({ id, ...a }) => a),
  };
  await ensureBucket();
  await upload('import/sao-dump.json', JSON.stringify(dump), 'application/json');
  console.log(`Data uploaded: ${dump.users.length} accounts, ${dump.clubs.length} clubs, ${dump.requests.length} requests, ${dump.transactions.length} money records`);

  const dir = path.join(DATA, 'uploads');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^file-[a-z0-9]+$/.test(n)) : [];
  const types = Object.fromEntries(dump.files.map(f => [f.id, f.type]));
  for (const n of names) await upload(`uploads/${n}`, fs.readFileSync(path.join(dir, n)), types[n] || 'application/octet-stream');
  console.log(`${names.length} attached file(s) copied`);
  console.log('\nDone. The portal on Supabase loads this data the first time it starts.');
  console.log('Stop using the portal on this computer now, so nobody keeps changing the old copy.');
})().catch(e => { console.error(e.message); process.exit(1); });
