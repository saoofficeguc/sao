// First run: the database is empty, so the person installing the portal creates the SAO Office account.
// Optionally they can load demo data (made by the browser's demo generator) to try the portal.
const store = require('./db');
const auth = require('./auth');

const DEMO_PASSWORD = 'Demo1234';
const needsSetup = () => store.users.count() === 0;
const isDemo = () => store.meta.get('demo') === '1';

function setup(b) {
  if (!needsSetup()) return { status: 409, body: { error: 'The portal is already set up.' } };
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: 400, body: { error: 'Type a valid email address.' } };
  const problem = auth.passwordProblem(b.password);
  if (problem) return { status: 400, body: { error: problem } };
  const name = String(b.name || '').trim() || 'SAO Office';
  const signName = String(b.signName || '').trim() || name;

  store.tx(() => {
    if (b.demo && b.demoState && typeof b.demoState === 'object') {
      const d = b.demoState;
      const demoHash = auth.hashPassword(DEMO_PASSWORD);
      for (const u of d.users || []) {
        const { id, ...rest } = u;
        if (id === 'sao') { store.users.put({ ...rest, id, name: 'SAO Office', signName, title: 'Youth Welfare Director' }); store.users.setLogin(id, email, auth.hashPassword(b.password)); }
        else { store.users.put({ ...rest, id }); store.users.setLogin(id, `${id}@demo.local`, demoHash); }
      }
      for (const c of d.clubs || []) store.put('clubs', c);
      for (const t of d.transactions || []) store.put('transactions', t);
      for (const r of d.requests || []) store.put('requests', r);
      for (const a of d.announcements || []) store.put('announcements', a);
      const maxSeq = Math.max(0, ...(d.requests || []).map(r => Number(String(r.id).split('-').pop()) || 0));
      store.meta.set('req_seq', maxSeq);
      store.meta.set('demo', '1');
    } else {
      store.users.put({ id: 'sao', role: 'sao', name, title: 'Youth Welfare Director', signName });
      store.users.setLogin('sao', email, auth.hashPassword(b.password));
      store.users.put({ id: 'vp', role: 'vp', name: 'Vice President', title: 'GUC Vice President', signName: 'Vice President' });
      store.users.put({ id: 'clinic', role: 'clinic', name: 'GUC Clinic', title: 'GUC Clinic', signName: 'GUC Clinic' });
      store.meta.set('req_seq', 0);
    }
    store.audit('sao', 'setup', { demo: !!b.demo });
  });
  return { status: 200, body: { ok: true } };
}

// Demo mode only: list the demo sign-ins so testers can try every role
function demoAccounts() {
  if (!isDemo()) return null;
  return store.users.all().filter(u => u.email && u.email.endsWith('@demo.local') && !u.disabled)
    .map(u => ({ email: u.email, name: u.name, role: u.role, clubId: u.clubId || null }));
}

module.exports = { setup, needsSetup, isDemo, demoAccounts, DEMO_PASSWORD };
