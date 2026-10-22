// Who may see and do what. The server sends each person only the data they are allowed to see.
export const SAO_ACCOUNT = 'sao';
export const STAGES = ['advisor', 'sao', 'vp'];
export const ALL_STAGES = ['clinic', 'advisor', 'sao', 'vp'];
export const inProgress = r => ALL_STAGES.includes(r.status);
export const isSigner = u => ['advisor', 'vp', 'clinic'].includes(u.role);
// What a user record looks like to others (no email, no login details)
export const publicUser = u => ({ id: u.id, name: u.name, role: u.role, title: u.title, signName: u.signName, clubId: u.clubId || undefined, disabled: !!u.disabled });
// Club money: a club rep sees only their own club; the SAO Office sees every account
export const canSeeFinance = (user, accountId) => user.role === 'sao' || (user.role === 'rep' && user.clubId === accountId && accountId !== SAO_ACCOUNT);

export function createAccess(store, forms) {
  const stagesFor = type => forms.FORMS[type]?.stages || STAGES;

  // Is this request waiting for this person's signature? (clubs: the loaded clubs list, to avoid a database read)
  function canActWith(user, r, clubs) {
    if (!user || r.status !== user.role) return false;
    if (user.role === 'advisor') {
      const club = clubs.find(c => c && c.id === r.clubId);
      return !!club && !club.archived && club.advisorId === user.id;
    }
    return ['sao', 'vp', 'clinic'].includes(user.role);
  }
  async function canAct(user, r) {
    const clubs = user && user.role === 'advisor' ? [await store.get('clubs', r.clubId)] : [];
    return canActWith(user, r, clubs);
  }
  async function canSeeRequest(user, r) {
    if (user.role === 'sao') return true;
    if (user.role === 'rep') return r.clubId === user.clubId;
    return canAct(user, r);
  }

  // Everything the signed-in person is allowed to see, in the shape the app uses
  async function stateFor(user) {
    const clubs = await store.all('clubs');
    const allUsers = await store.users.all();
    const today = new Date().toISOString().slice(0, 10);
    let requests, transactions, announcements;
    if (user.role === 'sao') {
      [requests, transactions, announcements] = await Promise.all([store.all('requests'), store.all('transactions'), store.all('announcements')]);
    } else if (user.role === 'rep') {
      requests = await store.byClub('requests', user.clubId);
      transactions = await store.byClub('transactions', user.clubId);
      announcements = (await store.all('announcements')).filter(a => a.clubId === user.clubId || a.status === 'approved');
    } else {
      requests = (await store.all('requests')).filter(r => canActWith(user, r, clubs));
      transactions = [];
      announcements = (await store.all('announcements')).filter(a => a.status === 'approved' && (!a.end || a.end >= today));
    }
    const users = user.role === 'sao'
      ? allUsers.map(u => ({ ...publicUser(u), email: u.email, hasLogin: u.hasLogin }))
      : allUsers.map(publicUser);
    const sig = await store.signatures.get(user.id);
    return {
      me: { ...publicUser(user), email: user.email },
      clubs, users, requests, transactions, announcements,
      signatures: sig ? { [user.id]: sig } : {},
      demo: (await store.meta.get('demo')) === '1',
    };
  }

  return { SAO_ACCOUNT, stagesFor, inProgress, isSigner, canActWith, canAct, canSeeRequest, canSeeFinance, publicUser, stateFor };
}
