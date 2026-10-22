// Every change to the data goes through one of these actions. Each checks who is asking and validates the input.
// (Same rules as before; each call runs inside one transaction, so a failed action changes nothing.)
import crypto from 'node:crypto';
import { SAO_ACCOUNT, inProgress, canSeeFinance } from './access.mjs';

export const TAX_RATE = 0.14;
const UNTAXED = ['allocation', 'transfer'];
const OUT_CATEGORIES = ['Events & activities', 'Printing & marketing', 'Equipment & materials', 'Catering', 'Transportation', 'Competition fees', 'Expense approvals', 'Other'];
const SOURCES = ['sponsor', 'cash', 'other', 'allocation', 'transfer'];

export class ActionError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const fail = (msg, status) => { throw new ActionError(msg, status); };
const need = (cond, msg, status) => { if (!cond) fail(msg, status); };
const onlySao = u => need(u.role === 'sao', 'Only the SAO Office can do this.', 403);

const round2 = n => Math.round(n * 100) / 100;
export const uid = p => `${p}-${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
const pad2 = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const text = (v, max = 5000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim().slice(0, max);
export const isImageData = (v, maxBytes, types = ['png', 'jpeg', 'webp']) =>
  typeof v === 'string' && new RegExp(`^data:image/(${types.join('|')});base64,[A-Za-z0-9+/=]+$`).test(v) && v.length * 0.75 <= maxBytes;

export function createActions({ store, auth, access, forms }) {
  const { FORMS, SERVICE_GROUPS, DESIGN_GROUPS, LATE_LIMIT, LATE_BLOCK_MONTHS, workingDaysUntil } = forms;
  const { stagesFor, canAct } = access;

  const balance = async accountId => round2((await store.byClub('transactions', accountId)).reduce((a, t) => a + (t.type === 'deposit' ? t.net : -t.amount), 0));
  const activeClub = async id => { const c = await store.get('clubs', id); need(c && !c.archived, 'Club not found.', 404); return c; };

  // Late submissions: LATE_LIMIT allowed, then late requests are blocked for LATE_BLOCK_MONTHS months
  async function lateInfo(club) {
    if (club.lateBlockUntil && new Date(club.lateBlockUntil) <= new Date()) {
      club.lateResetAt = club.lateBlockUntil; club.lateBlockUntil = null; await store.put('clubs', club);
    }
    const since = club.lateResetAt || '';
    const used = (await store.byClub('requests', club.id)).filter(r => r.late && r.createdAt > since).length;
    return { used, blockedUntil: club.lateBlockUntil || null };
  }
  const needsDesign = services => DESIGN_GROUPS.some(g => (services?.[g]?.items || []).length);
  const saoChecks = r => (FORMS[r.type].saoChecks || []).filter(c => c.when(r.data || {}));
  const needsHardCopy = r => !!(r.data?.design || needsDesign(r.data?.services));

  // A file the person uploaded and has not used in a request yet
  async function ownFreshFile(meta, user) {
    if (!meta || typeof meta !== 'object' || !meta.id) return null;
    const row = await store.files.get(meta.id);
    need(row && row.uploaded_by === user.id && !row.request_id, 'An attached file is missing - please attach it again.');
    return { id: row.id, name: row.name, size: Number(row.size), type: row.type };
  }

  const actions = {
    // ---------------- money ----------------
    async deposit(user, b) {
      const accountId = String(b.clubId);
      need(canSeeFinance(user, accountId), 'You cannot add money to this account.', 403);
      if (accountId !== SAO_ACCOUNT) await activeClub(accountId);
      const gross = round2(Number(b.gross));
      need(gross > 0 && gross < 1e9, 'Enter an amount greater than zero.');
      const source = String(b.source);
      need(SOURCES.includes(source) && source !== 'transfer', 'Choose where the money came from.');
      need(source !== 'allocation' || accountId === SAO_ACCOUNT, 'University allocations go to the SAO Office account only.');
      const sponsor = text(b.sponsor, 200);
      need(source !== 'sponsor' || sponsor, 'Enter the sponsor name.');
      const date = isDate(b.date) && b.date <= todayISO() ? b.date : todayISO();
      const tax = UNTAXED.includes(source) ? 0 : round2(gross * TAX_RATE);
      const t = { id: uid('tx'), clubId: accountId, type: 'deposit', source, sponsor: source === 'sponsor' ? sponsor : '', gross, tax, net: round2(gross - tax),
        note: text(b.note, 300), date, by: user.id, at: new Date().toISOString() };
      await store.put('transactions', t);
      return { net: t.net, tax };
    },
    async withdraw(user, b) {
      const accountId = String(b.clubId);
      need(canSeeFinance(user, accountId), 'You cannot withdraw from this account.', 403);
      if (accountId !== SAO_ACCOUNT) await activeClub(accountId);
      const amount = round2(Number(b.amount));
      need(amount > 0, 'Enter an amount greater than zero.');
      const bal = await balance(accountId);
      need(amount <= bal, `Not enough money. Available: EGP ${bal.toFixed(2)}`);
      const note = text(b.note, 300);
      need(note, 'Enter the purpose of this withdrawal.');
      const category = OUT_CATEGORIES.includes(b.category) ? b.category : 'Other';
      let requestId = null;
      if (b.requestId) {
        const r = await store.get('requests', String(b.requestId));
        need(r && r.clubId === accountId && r.status === 'completed' && r.type === 'expense', 'That approval cannot be linked.');
        requestId = r.id;
      }
      const date = isDate(b.date) && b.date <= todayISO() ? b.date : todayISO();
      await store.put('transactions', { id: uid('tx'), clubId: accountId, type: 'withdraw', amount, note, category, requestId, date, by: user.id, at: new Date().toISOString() });
      return {};
    },

    // ---------------- paperwork ----------------
    async createRequest(user, b) {
      need(user.role === 'rep', 'Only club representatives submit requests.', 403);
      const club = await activeClub(user.clubId);
      need(club.advisorId, 'Your club has no Academic Advisor yet. Ask the SAO Office to assign one before sending papers.');
      const def = FORMS[b.type];
      need(def, 'Unknown form.');
      const input = b.data && typeof b.data === 'object' ? b.data : {};
      const data = {}, missing = [];
      for (const f of def.fields) {
        if (!f.k) continue;
        const v = input[f.k];
        if (f.t === 'file') { const m = await ownFreshFile(v, user); if (m) data[f.k] = m; }
        else if (f.t === 'signature') { if (isImageData(v, 400000, ['png'])) data[f.k] = v; }
        else if (f.t === 'speakers') data[f.k] = Array.isArray(v) ? v.slice(0, f.n || 3).map(x => text(x, 200)) : [];
        else if (f.t === 'number') data[f.k] = v === '' || v == null || isNaN(Number(v)) ? '' : String(Number(v));
        else if (f.t === 'radio' || f.t === 'select') data[f.k] = text(v, 200);
        else data[f.k] = text(v);
        const needed = f.req || (f.reqIf && data[f.reqIf[0]] === f.reqIf[1]);
        const has = f.t === 'speakers' ? data[f.k].some(Boolean) : !!data[f.k];
        if (needed && !has) missing.push(f.label);
        if (f.t === 'number' && data[f.k] !== '') {
          const n = Number(data[f.k]);
          if (f.min != null && n < f.min) missing.push(`${f.label} (at least ${f.min})`);
          if (f.max != null && n > f.max) missing.push(`${f.label} (at most ${f.max})`);
        }
      }
      if (def.services) {
        data.services = {};
        for (const g of def.services) {
          const s = input.services?.[g] || {};
          const allowed = SERVICE_GROUPS[g].items;
          data.services[g] = { items: (Array.isArray(s.items) ? s.items : []).filter(x => allowed.includes(x)), other: text(s.other, 200) };
        }
        if (needsDesign(data.services)) {
          const m = await ownFreshFile(input.design, user);
          if (m) data.design = m; else missing.push('Design (you ticked a Marketing or Printing service)');
        }
      }
      if (data.startDate && data.endDate && data.endDate < data.startDate) missing.push('End Date must be on or after Start Date');
      need(!missing.length, 'Please fix: ' + missing.slice(0, 5).join(', '));

      // late submission (checked on the server, not trusted from the browser)
      const wd = def.deadline && data.startDate ? workingDaysUntil(data.startDate) : null;
      const late = wd != null && wd < def.deadline;
      if (late) {
        const li = await lateInfo(club);
        need(!li.blockedUntil, `Late requests are blocked until ${String(li.blockedUntil).slice(0, 10)} (all ${LATE_LIMIT} late submissions used).`);
      }
      const year = new Date().getFullYear();
      const seq = Number((await store.meta.get('req_seq')) || 0) + 1;
      await store.meta.set('req_seq', seq);
      const r = { id: `REQ-${year}-${String(seq).padStart(4, '0')}`, clubId: club.id, type: def.key, data,
        title: text(data[def.titleKey], 200) || def.name, amount: round2(Number(data[def.amountKey]) || 0), eventDate: data.startDate || data.neededDate || '',
        createdBy: user.id, createdAt: new Date().toISOString(), status: stagesFor(def.key)[0], approvals: [], rejection: null, completedAt: null,
        late: late ? { workingDays: wd } : null };
      await store.put('requests', r);
      // link the uploaded files to this request
      const ids = [];
      for (const f of def.fields) if (f.t === 'file' && data[f.k]) ids.push(data[f.k].id);
      if (data.design) ids.push(data.design.id);
      for (const id of ids) await store.files.link(id, r.id, club.id);
      if (late && (await lateInfo(club)).used >= LATE_LIMIT) {
        const until = new Date(); until.setMonth(until.getMonth() + LATE_BLOCK_MONTHS);
        club.lateBlockUntil = until.toISOString(); await store.put('clubs', club);
      }
      if (input.repSignatureRemember && data.repSignature) await store.signatures.set(user.id, data.repSignature);
      return { id: r.id, status: r.status };
    },
    async approveRequest(user, b) {
      const r = await store.get('requests', String(b.id));
      need(r, 'Request not found.', 404);
      need(await canAct(user, r), 'This request is not waiting for your signature.', 403);
      let signature = b.signature;
      if (!signature) signature = await store.signatures.get(user.id);
      need(isImageData(signature, 400000, ['png']), 'Please draw your signature first.');
      const now = new Date().toISOString();
      if (user.role === 'sao') {
        if (needsHardCopy(r)) { need(b.hardCopy === true, 'Tick "Hard copy of the design received" before approving.'); r.hardCopyAt = r.hardCopyAt || now; }
        const missingCheck = saoChecks(r).find(c => !(b.checks && b.checks[c.key] === true));
        need(!missingCheck, missingCheck ? `Tick "${missingCheck.label}" before approving.` : '');
        r.checks = r.checks || {};
        saoChecks(r).forEach(c => { r.checks[c.key] = r.checks[c.key] || now; });
      }
      r.approvals.push({ stage: r.status, userId: user.id, name: user.signName || user.name, title: user.title, signature, comment: text(b.comment, 1000), at: now });
      const order = stagesFor(r.type), next = order[order.indexOf(r.status) + 1];
      if (next) r.status = next;
      else {
        r.status = 'completed'; r.completedAt = now;
        // an approved expense is taken from the club account automatically
        if (r.type === 'expense' && !(await store.byClub('transactions', r.clubId)).some(t => t.requestId === r.id)) {
          await store.put('transactions', { id: uid('tx'), clubId: r.clubId, type: 'withdraw', amount: r.amount, note: `Expense ${r.id} - ${r.title}`,
            category: 'Expense approvals', requestId: r.id, date: todayISO(), by: user.id, at: now, auto: true });
        }
      }
      await store.put('requests', r);
      if (b.remember && b.signature) await store.signatures.set(user.id, signature);
      return { status: r.status, next: next || null };
    },
    async rejectRequest(user, b) {
      const r = await store.get('requests', String(b.id));
      need(r, 'Request not found.', 404);
      need(await canAct(user, r), 'This request is not waiting for your signature.', 403);
      const comment = text(b.comment, 1000);
      need(comment, 'Write a comment explaining the rejection.');
      r.rejection = { stage: r.status, userId: user.id, name: user.signName || user.name, comment, at: new Date().toISOString() };
      r.status = 'rejected';
      await store.put('requests', r);
      return {};
    },

    // ---------------- signatures ----------------
    async saveSignature(user, b) {
      need(['sao', 'vp', 'advisor', 'clinic', 'rep'].includes(user.role), 'Not allowed.', 403);
      need(isImageData(b.signature, 400000, ['png']), 'Draw your signature first.');
      await store.signatures.set(user.id, b.signature);
      return {};
    },
    async deleteSignature(user) { await store.signatures.del(user.id); return {}; },

    // ---------------- announcements ----------------
    async createAnnouncement(user, b) {
      need(user.role === 'rep' || user.role === 'sao', 'Not allowed.', 403);
      if (user.role === 'rep') await activeClub(user.clubId);
      const title = text(b.title, 90), body = text(b.body, 300);
      need(title && body, 'Add a title and a message.');
      const start = isDate(b.start) ? b.start : todayISO(), end = isDate(b.end) ? b.end : '';
      need(!end || end >= start, '"Show until" must be after "Show from".');
      let image = null;
      if (b.image) { need(isImageData(b.image, 2500000), 'The image is too large or not a picture.'); image = b.image; }
      const isSao = user.role === 'sao', now = new Date().toISOString();
      await store.put('announcements', { id: uid('ann'), clubId: isSao ? null : user.clubId, title, body, start, end, image,
        status: isSao ? 'approved' : 'pending', createdBy: user.id, createdAt: now, reviewedAt: isSao ? now : null });
      return {};
    },
    async reviewAnnouncement(user, b) {
      onlySao(user);
      const a = await store.get('announcements', String(b.id));
      need(a, 'Announcement not found.', 404);
      if (b.decision === 'approve') { a.status = 'approved'; a.reviewedAt = new Date().toISOString(); }
      else if (b.decision === 'reject') { a.status = 'rejected'; a.reason = text(b.reason, 300); a.reviewedAt = new Date().toISOString(); }
      else if (b.decision === 'remove') a.status = 'archived';
      else fail('Unknown decision.');
      await store.put('announcements', a);
      return {};
    },

    // ---------------- clubs & advisors (SAO Office) ----------------
    async setClubLogo(user, b) {
      const c = await activeClub(String(b.clubId));
      need(user.role === 'sao' || (user.role === 'rep' && user.clubId === c.id), 'Not allowed.', 403);
      if (b.logo == null) delete c.logo;
      else { need(isImageData(b.logo, 400000, ['png', 'jpeg']), 'Please choose a smaller image.'); c.logo = b.logo; }
      await store.put('clubs', c);
      return {};
    },
    async saveClub(user, b) {
      onlySao(user);
      const name = text(b.name, 100);
      need(name, 'Type the club name.');
      const clubs = (await store.all('clubs')).filter(c => !c.archived);
      const club = b.id ? await activeClub(String(b.id)) : null;
      need(!clubs.some(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== club?.id), 'A club with that name already exists.');
      // A club may have no advisor yet ("__none"); it cannot send papers until the SAO Office assigns one
      let advisorId = b.advisorId && b.advisorId !== '__none' ? String(b.advisorId) : null;
      if (advisorId === '__new') {
        const advName = text(b.newAdvisorName, 100);
        need(advName, "Type the new advisor's name.");
        advisorId = uid('adv');
        await store.users.put({ id: advisorId, name: advName, role: 'advisor', title: 'Academic Advisor', signName: advName });
      }
      if (advisorId) {
        const adv = await store.users.get(advisorId);
        need(adv && adv.role === 'advisor' && !adv.disabled, 'Choose an Academic Advisor.');
        const taken = clubs.find(c => c.advisorId === advisorId && c.id !== club?.id);
        need(!taken, `${adv.name} already advises ${taken?.name}.`);
      }
      const repName = text(b.repName, 100) || `${name} Rep`;
      let c = club;
      if (c) { c.name = name; c.advisorId = advisorId; }
      else {
        const n = (await store.all('clubs')).length + 1;
        c = { id: uid('club'), name, advisorId, accountNo: `1-C15-01-SC-${String(n).padStart(3, '0')}-000-1`, createdAt: new Date().toISOString() };
      }
      await store.put('clubs', c);
      const rep = (await store.users.all()).find(u => u.role === 'rep' && u.clubId === c.id && !u.disabled);
      if (rep) { rep.name = repName; await store.users.put(rep); }
      else await store.users.put({ id: uid('rep'), name: repName, role: 'rep', clubId: c.id, title: 'Club Representative' });
      return { id: c.id };
    },
    async removeClub(user, b) {
      onlySao(user);
      const club = await activeClub(String(b.id));
      need(text(b.confirmName).toLowerCase() === club.name.toLowerCase(), 'Type the club name exactly to confirm.');
      const now = new Date().toISOString(), day = todayISO(), bal = await balance(club.id);
      if (bal > 0) {
        await store.put('transactions', { id: uid('tx'), clubId: club.id, type: 'withdraw', amount: bal, category: 'Other', note: 'Balance moved to the SAO Office account (club removed)', date: day, by: user.id, at: now });
        await store.put('transactions', { id: uid('tx'), clubId: SAO_ACCOUNT, type: 'deposit', source: 'transfer', sponsor: '', gross: bal, tax: 0, net: bal, note: `From ${club.name} (club removed)`, date: day, by: user.id, at: now });
      }
      for (const r of (await store.byClub('requests', club.id)).filter(inProgress)) {
        r.rejection = { stage: r.status, userId: user.id, name: 'SAO Office', comment: 'Closed because the club was removed.', at: now };
        r.status = 'rejected'; await store.put('requests', r);
      }
      for (const u of (await store.users.all()).filter(u => u.role === 'rep' && u.clubId === club.id)) {
        u.disabled = true; await store.users.put(u); await auth.endAllSessions(u.id);
      }
      club.archived = true; club.archivedAt = now;
      await store.put('clubs', club);
      return { moved: bal > 0 ? bal : 0 };
    },
    async saveAdvisor(user, b) {
      onlySao(user);
      const name = text(b.name, 100);
      need(name, 'Type the name.');
      if (b.id) {
        const a = await store.users.get(String(b.id));
        need(a && a.role === 'advisor', 'Advisor not found.', 404);
        a.name = name; a.signName = name; await store.users.put(a);
      } else await store.users.put({ id: uid('adv'), name, role: 'advisor', title: 'Academic Advisor', signName: name });
      return {};
    },
    async removeAdvisor(user, b) {
      onlySao(user);
      const a = await store.users.get(String(b.id));
      need(a && a.role === 'advisor', 'Advisor not found.', 404);
      need(!(await store.all('clubs')).some(c => !c.archived && c.advisorId === a.id), 'Give their club another advisor first.');
      a.disabled = true; await store.users.put(a); await auth.endAllSessions(a.id);
      return {};
    },

    // ---------------- accounts ----------------
    async saveAccount(user, b) {
      onlySao(user);
      const roles = ['sao', 'vp', 'clinic'];
      let u = b.id ? await store.users.get(String(b.id)) : null;
      if (b.id) need(u, 'Account not found.', 404);
      else { need(roles.includes(b.role), 'Choose a role.'); u = { id: uid(b.role), role: b.role }; }
      const name = text(b.name, 100);
      need(name, 'Type the name.');
      u.name = name;
      if (u.role !== 'rep') { u.title = text(b.title, 100) || u.title || ''; u.signName = text(b.signName, 100) || name; }
      const email = text(b.email, 200).toLowerCase();
      if (email) {
        need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Type a valid email address.');
        const other = await store.users.byEmail(email);
        need(!other || other.id === u.id, 'Another account already uses that email.');
      }
      let hash = null;
      if (b.password) { const p = auth.passwordProblem(b.password); need(!p, p); hash = auth.hashPassword(b.password); }
      need(!(hash && !email), 'Add an email for this login.');
      await store.users.put(u);
      if (email || hash) await store.users.setLogin(u.id, email || null, hash);
      if (hash) await auth.endAllSessions(u.id);     // a new password signs the person out everywhere
      return { id: u.id };
    },
    async setAccountDisabled(user, b) {
      onlySao(user);
      const u = await store.users.get(String(b.id));
      need(u, 'Account not found.', 404);
      need(u.id !== user.id, 'You cannot disable your own account.');
      u.disabled = !!b.disabled; await store.users.put(u);
      if (u.disabled) await auth.endAllSessions(u.id);
      return {};
    },
    async changePassword(user, b) {
      const row = await store.users.byEmail(user.email);
      need(row && auth.checkPassword(String(b.current || ''), row.pass), 'Your current password is not correct.');
      const p = auth.passwordProblem(b.next); need(!p, p);
      await store.users.setLogin(user.id, user.email, auth.hashPassword(b.next));
      return {};
    },
  };

  // Runs an action, records it in the audit log, and turns errors into a clear message
  async function run(name, user, body) {
    const fn = Object.prototype.hasOwnProperty.call(actions, name) ? actions[name] : null;
    if (!fn) return { status: 404, body: { error: 'Unknown action.' } };
    try {
      const out = (await fn(user, body || {})) || {};
      await store.audit(user.id, name, { ...(body || {}), signature: undefined, image: undefined, logo: undefined, password: undefined, current: undefined, next: undefined, data: undefined });
      return { status: 200, body: { ok: true, ...out } };
    } catch (e) {
      if (e instanceof ActionError) return { status: e.status, body: { error: e.message } };
      console.error(`Action ${name} failed:`, e);
      return { status: 500, body: { error: 'Something went wrong on the server.' } };
    }
  }
  return { run };
}
