// Security check: signs in as different people and confirms the server only shows and allows what it should.
// Usage (with the portal running on demo data):  node scripts/security-check.js http://localhost:5173
const BASE = process.argv[2] || 'http://localhost:5173';
const PASS = 'Demo1234';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

async function session(email, password = PASS) {
  const res = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SAO': '1' }, body: JSON.stringify({ email, password }) });
  const token = res.ok ? (await res.json()).token : '';
  const call = async (method, path, body, extra = {}) => {
    const r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-SAO': '1', ...extra }, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch { /* not json */ }
    return { status: r.status, data };
  };
  return { ok: res.ok, status: res.status, get: p => call('GET', p), post: (p, b, h) => call('POST', p, b, h) };
}

(async () => {
  const bad = await session('rep-1@demo.local', 'wrong-password');
  ok(bad.status === 401, 'Wrong password is refused');

  // ---- club representative (Robotics Club = club-1) ----
  const rep = await session('rep-1@demo.local');
  ok(rep.ok, 'Club rep can sign in');
  const rs = (await rep.get('/api/state')).data;
  ok(rs.transactions.length > 0 && rs.transactions.every(t => t.clubId === 'club-1'), 'Rep sees only their own club\'s bank transactions');
  ok(rs.requests.every(r => r.clubId === 'club-1'), 'Rep sees only their own club\'s requests');
  ok(!rs.users.some(u => 'email' in u), 'Rep does not receive other people\'s emails');
  ok((await rep.post('/api/actions/deposit', { clubId: 'club-2', gross: 1000, source: 'cash' })).status === 403, 'Rep cannot add money to another club');
  ok((await rep.post('/api/actions/withdraw', { clubId: 'club-2', amount: 10, note: 'x' })).status === 403, 'Rep cannot withdraw from another club');
  ok((await rep.post('/api/actions/withdraw', { clubId: 'club-1', amount: 99999999, note: 'x' })).status === 400, 'Rep cannot withdraw more than the balance');
  ok((await rep.post('/api/actions/deposit', { clubId: 'sao', gross: 1000, source: 'cash' })).status === 403, 'Rep cannot touch the SAO Office account');
  const anyReq = rs.requests[0];
  ok((await rep.post('/api/actions/approveRequest', { id: anyReq.id })).status === 403, 'Rep cannot approve requests');
  ok((await rep.post('/api/actions/saveClub', { name: 'Hack Club', advisorId: '__new', newAdvisorName: 'X' })).status === 403, 'Rep cannot create clubs');
  ok((await rep.post('/api/actions/saveAccount', { id: 'sao', name: 'x', email: 'evil@example.test', password: 'Hacked123' })).status === 403, 'Rep cannot change other accounts');
  ok((await rep.post('/api/actions/deposit', { clubId: 'club-1', gross: 1000, source: 'cash' }, { 'X-SAO': '' })).status === 403, 'Changes without the app\'s header are refused');
  const dep = await rep.post('/api/actions/deposit', { clubId: 'club-1', gross: 1000, source: 'cash', note: 'test' });
  ok(dep.status === 200 && dep.data.tax === 140 && dep.data.net === 860, 'Rep deposit to own club works and the server applies the 14% tax');
  const fakeTax = await rep.post('/api/actions/deposit', { clubId: 'club-1', gross: 1000, source: 'allocation' });
  ok(fakeTax.status === 400, 'Rep cannot avoid tax by calling it a university allocation');

  // file upload + access
  const up = await fetch(BASE + '/api/files', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SAO': '1' }, body: Buffer.from('%PDF-1.4 test') });
  ok(up.status === 401, 'Uploading without signing in is refused');

  // ---- another club's rep ----
  const rep2 = await session('rep-2@demo.local');
  const r2 = (await rep2.get('/api/state')).data;
  ok(r2.transactions.every(t => t.clubId === 'club-2') && !r2.transactions.some(t => t.clubId === 'club-1'), 'Another club cannot see Robotics Club money');

  // ---- academic advisor ----
  const adv = await session('adv-1@demo.local');
  const as = (await adv.get('/api/state')).data;
  ok(as.transactions.length === 0, 'Advisor receives no bank data');
  ok(as.requests.every(r => r.status === 'advisor'), 'Advisor receives only papers waiting for them');
  ok((await adv.post('/api/actions/deposit', { clubId: 'club-1', gross: 100, source: 'cash' })).status === 403, 'Advisor cannot add money');

  // ---- vice president ----
  const vp = await session('vp@demo.local');
  const vs = (await vp.get('/api/state')).data;
  ok(vs.requests.every(r => r.status === 'vp'), 'VP receives only papers waiting for the VP');
  ok(vs.transactions.length === 0, 'VP receives no bank data');

  // ---- SAO Office sees everything ----
  const sao = await session(process.env.SAO_EMAIL || 'sao@demo.local', process.env.SAO_PASSWORD || PASS);
  const ss = (await sao.get('/api/state')).data;
  ok(ss.transactions.some(t => t.clubId === 'club-1') && ss.transactions.some(t => t.clubId === 'sao'), 'SAO Office sees all accounts');

  // ---- signed out ----
  const anon = await fetch(BASE + '/api/state');
  ok(anon.status === 401, 'Nothing is visible without signing in');
  for (const p of ['/server.js', '/supabase/functions/_shared/core/app.mjs', '/supabase/functions/sao/index.ts', '/data/sao.db', '/.gitignore', '/package.json']) {
    ok((await fetch(BASE + p)).status === 404, `${p} cannot be downloaded`);
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
