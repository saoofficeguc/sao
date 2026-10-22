// Who may see and do what. The server sends each person only the data they are allowed to see.
const store = require('./db');
const { FORMS } = require('../forms.js');

const SAO_ACCOUNT = 'sao';
const STAGES = ['advisor', 'sao', 'vp'];
const ALL_STAGES = ['clinic', 'advisor', 'sao', 'vp'];
const stagesFor = type => FORMS[type]?.stages || STAGES;
const inProgress = r => ALL_STAGES.includes(r.status);
const isSigner = u => ['advisor', 'vp', 'clinic'].includes(u.role);

function canAct(user, r, clubs) {
  if (!user || r.status !== user.role) return false;
  if (user.role === 'advisor') {
    const club = (clubs || [store.get('clubs', r.clubId)]).find(c => c && c.id === r.clubId);
    return !!club && !club.archived && club.advisorId === user.id;
  }
  return ['sao', 'vp', 'clinic'].includes(user.role);
}
// Club money: a club rep sees only their own club; the SAO Office sees every account
const canSeeFinance = (user, accountId) => user.role === 'sao' || (user.role === 'rep' && user.clubId === accountId && accountId !== SAO_ACCOUNT);
function canSeeRequest(user, r) {
  if (user.role === 'sao') return true;
  if (user.role === 'rep') return r.clubId === user.clubId;
  return canAct(user, r);
}

// What a user record looks like to others (no email, no login details)
const publicUser = u => ({ id: u.id, name: u.name, role: u.role, title: u.title, signName: u.signName, clubId: u.clubId || undefined, disabled: !!u.disabled });

// Everything the signed-in person is allowed to see, in the shape the app uses
function stateFor(user) {
  const clubs = store.all('clubs');
  const allUsers = store.users.all();
  const today = new Date().toISOString().slice(0, 10);
  let requests, transactions, announcements;
  if (user.role === 'sao') {
    requests = store.all('requests');
    transactions = store.all('transactions');
    announcements = store.all('announcements');
  } else if (user.role === 'rep') {
    requests = store.byClub('requests', user.clubId);
    transactions = store.byClub('transactions', user.clubId);
    announcements = store.all('announcements').filter(a => a.clubId === user.clubId || a.status === 'approved');
  } else {
    requests = store.all('requests').filter(r => canAct(user, r, clubs));
    transactions = [];
    announcements = store.all('announcements').filter(a => a.status === 'approved' && (!a.end || a.end >= today));
  }
  const users = user.role === 'sao'
    ? allUsers.map(u => ({ ...publicUser(u), email: u.email, hasLogin: u.hasLogin }))
    : allUsers.map(publicUser);
  const sig = store.signatures.get(user.id);
  return {
    me: { ...publicUser(user), email: user.email },
    clubs, users, requests, transactions, announcements,
    signatures: sig ? { [user.id]: sig } : {},
    demo: store.meta.get('demo') === '1',
  };
}

module.exports = { SAO_ACCOUNT, STAGES, ALL_STAGES, stagesFor, inProgress, isSigner, canAct, canSeeFinance, canSeeRequest, publicUser, stateFor };
