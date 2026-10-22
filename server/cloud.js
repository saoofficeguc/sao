// Free cloud hosting (Render): Render's disk is wiped whenever the service sleeps or redeploys,
// so the database and uploaded files are kept in a private Supabase Storage bucket.
//  - on start: the latest database is downloaded before anything else runs
//  - after every change: a consistent copy is uploaded (within ~2 seconds), plus one dated backup per day (30 kept)
//  - uploaded files are stored there too and fetched back when someone opens them
// Turned on only when SUPABASE_URL and SUPABASE_SERVICE_KEY are set; on a normal server it does nothing.
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'sao-data';
const enabled = !!(BASE && KEY);
const KEEP_DAILY = 30;

// New-style Supabase secret keys (sb_secret_...) go in the apikey header only; legacy service_role keys (JWTs) also as Bearer
const auth = (extra = {}) => (KEY.startsWith('sb_') ? { apikey: KEY, ...extra } : { Authorization: `Bearer ${KEY}`, apikey: KEY, ...extra });
const objectUrl = key => `${BASE}/storage/v1/object/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function download(key) {
  const r = await fetch(objectUrl(key), { headers: auth() });
  if (r.ok) return Buffer.from(await r.arrayBuffer());
  const body = await r.text();
  if (r.status === 404 || /not.?found/i.test(body)) return null;
  throw new Error(`Supabase download ${key} failed (${r.status}): ${body.slice(0, 200)}`);
}
async function upload(key, buffer, type = 'application/octet-stream') {
  const r = await fetch(objectUrl(key), { method: 'POST', headers: auth({ 'Content-Type': type, 'x-upsert': 'true' }), body: buffer });
  if (!r.ok) throw new Error(`Supabase upload ${key} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
}
async function ensureBucket() {
  const r = await fetch(`${BASE}/storage/v1/bucket`, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
  if (r.ok) return;
  const body = await r.text();
  if (/already exists|Duplicate/i.test(body) || r.status === 409) return;
  throw new Error(`Supabase bucket check failed (${r.status}): ${body.slice(0, 200)}`);
}

// Before the database opens: bring back the latest copy (an empty start only if none was ever saved)
async function restore(dataDir) {
  await ensureBucket();
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const buf = await download('db/sao.db');
  for (const f of ['sao.db', 'sao.db-wal', 'sao.db-shm']) fs.rmSync(path.join(dataDir, f), { force: true });
  if (buf) fs.writeFileSync(path.join(dataDir, 'sao.db'), buf);
  console.log(buf ? `Restored the database from Supabase (${Math.round(buf.length / 1024)} KB)` : 'No saved database in Supabase yet - starting empty');
  return !!buf;
}

// ---- saving after changes ----
let timer = null, running = null, again = false, lastDaily = '';
const today = () => new Date().toISOString().slice(0, 10);
async function saveNow(db) {
  const tmp = path.join(os.tmpdir(), `sao-snapshot-${process.pid}.db`);
  fs.rmSync(tmp, { force: true });
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);   // a consistent copy, even while the portal is in use
  const buf = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  await upload('db/sao.db', buf);
  const day = today();
  if (day !== lastDaily) {
    await upload(`backups/sao-${day}.db`, buf);
    lastDaily = day;
    pruneBackups().catch(e => console.error('Backup clean-up:', e.message));
  }
}
async function pruneBackups() {
  const r = await fetch(`${BASE}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix: 'backups/', limit: 1000, sortBy: { column: 'name', order: 'asc' } }) });
  if (!r.ok) return;
  const names = (await r.json()).map(o => o.name).filter(n => /^sao-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort();
  const old = names.slice(0, Math.max(0, names.length - KEEP_DAILY)).map(n => `backups/${n}`);
  if (old.length) await fetch(`${BASE}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: old }) });
}
function run(db) {
  if (running) { again = true; return running; }
  running = saveNow(db)
    .catch(e => console.error('Saving to Supabase failed:', e.message))
    .finally(() => { running = null; if (again) { again = false; run(db); } });
  return running;
}
function scheduleSave(db) {
  if (!enabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => run(db), 1500);
}
async function flush(db) {
  if (!enabled) return;
  clearTimeout(timer);
  if (running) await running;
  await run(db);
}

// ---- uploaded files ----
async function putUpload(id, filePath, type) { if (enabled) await upload(`uploads/${id}`, fs.readFileSync(filePath), type); }
async function ensureUpload(id, filePath) {
  if (!enabled || fs.existsSync(filePath)) return;
  const buf = await download(`uploads/${id}`);
  if (buf) fs.writeFileSync(filePath, buf);
}

module.exports = { enabled, BUCKET, restore, scheduleSave, flush, putUpload, ensureUpload, ensureBucket, upload, download };
