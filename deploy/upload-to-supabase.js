// One-time move: copies this computer's portal data (data/sao.db + data/uploads) into the Supabase bucket
// that the Render version loads on start.
//
// Windows (Command Prompt), from the project folder:
//   set SUPABASE_URL=https://xxxx.supabase.co
//   set SUPABASE_SERVICE_KEY=your-service-role-key
//   node deploy/upload-to-supabase.js
//
// If Supabase already holds a database it stops, so live data is never overwritten by accident;
// add --replace only when you really mean to replace it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cloud = require('../server/cloud');

const DATA = process.env.SAO_DATA_DIR || path.join(__dirname, '..', 'data');
const replace = process.argv.includes('--replace');

(async () => {
  if (!cloud.enabled) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY first (see the top of this file).'); process.exit(1); }
  const dbFile = path.join(DATA, 'sao.db');
  if (!fs.existsSync(dbFile)) { console.error('No data found at ' + dbFile); process.exit(1); }

  await cloud.ensureBucket();
  if (!replace && await cloud.download('db/sao.db')) {
    console.error('Supabase already has a database. Nothing was changed.\nRun again with --replace only if you want to overwrite it with this computer\'s data.');
    process.exit(1);
  }

  // a consistent copy, even if the portal is still running on this computer
  const tmp = path.join(os.tmpdir(), `sao-upload-${Date.now()}.db`);
  new DatabaseSync(dbFile).exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const buf = fs.readFileSync(tmp); fs.rmSync(tmp, { force: true });
  await cloud.upload('db/sao.db', buf);
  await cloud.upload(`backups/sao-${new Date().toISOString().slice(0, 10)}-moved-from-laptop.db`, buf);
  console.log(`Database uploaded (${Math.round(buf.length / 1024)} KB)`);

  const dir = path.join(DATA, 'uploads');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^file-[a-f0-9]+$/.test(n)) : [];
  for (const n of names) await cloud.upload(`uploads/${n}`, fs.readFileSync(path.join(dir, n)));
  console.log(`${names.length} uploaded file(s) copied`);
  console.log('\nDone. Stop the portal on this computer now, so nobody keeps changing the old copy.');
})().catch(e => { console.error(e.message); process.exit(1); });
