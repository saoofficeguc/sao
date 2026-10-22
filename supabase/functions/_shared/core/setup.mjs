// First run: the database is empty, so the person installing the portal creates the SAO Office account.
// Optionally they can load demo data (made by the browser's demo generator) to try the portal.
export const DEMO_PASSWORD = 'Demo1234';

export function createSetup(store, auth) {
  const needsSetup = async () => (await store.users.count()) === 0;
  const isDemo = async () => (await store.meta.get('demo')) === '1';

  async function setup(b) {
    if (!(await needsSetup())) return { status: 409, body: { error: 'The portal is already set up.' } };
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: 400, body: { error: 'Type a valid email address.' } };
    const problem = auth.passwordProblem(b.password);
    if (problem) return { status: 400, body: { error: problem } };
    const name = String(b.name || '').trim() || 'SAO Office';
    const signName = String(b.signName || '').trim() || name;

    if (b.demo && b.demoState && typeof b.demoState === 'object') {
      const d = b.demoState;
      const demoHash = auth.hashPassword(DEMO_PASSWORD);
      for (const u of d.users || []) {
        const { id, ...rest } = u;
        if (id === 'sao') { await store.users.put({ ...rest, id, name: 'SAO Office', signName, title: 'Youth Welfare Director' }); await store.users.setLogin(id, email, auth.hashPassword(b.password)); }
        else { await store.users.put({ ...rest, id }); await store.users.setLogin(id, `${id}@demo.local`, demoHash); }
      }
      for (const c of d.clubs || []) await store.put('clubs', c);
      for (const t of d.transactions || []) await store.put('transactions', t);
      for (const r of d.requests || []) await store.put('requests', r);
      for (const a of d.announcements || []) await store.put('announcements', a);
      const maxSeq = Math.max(0, ...(d.requests || []).map(r => Number(String(r.id).split('-').pop()) || 0));
      await store.meta.set('req_seq', maxSeq);
      await store.meta.set('demo', '1');
    } else {
      await store.users.put({ id: 'sao', role: 'sao', name, title: 'Youth Welfare Director', signName });
      await store.users.setLogin('sao', email, auth.hashPassword(b.password));
      await store.users.put({ id: 'vp', role: 'vp', name: 'Vice President', title: 'GUC Vice President', signName: 'Vice President' });
      await store.users.put({ id: 'clinic', role: 'clinic', name: 'GUC Clinic', title: 'GUC Clinic', signName: 'GUC Clinic' });
      await store.meta.set('req_seq', 0);
    }
    await store.audit('sao', 'setup', { demo: !!b.demo });
    return { status: 200, body: { ok: true } };
  }

  // Demo mode only: list the demo sign-ins so testers can try every role
  async function demoAccounts() {
    if (!(await isDemo())) return null;
    return (await store.users.all()).filter(u => u.email && u.email.endsWith('@demo.local') && !u.disabled)
      .map(u => ({ email: u.email, name: u.name, role: u.role, clubId: u.clubId || null }));
  }

  return { setup, needsSetup, isDemo, demoAccounts, DEMO_PASSWORD };
}
