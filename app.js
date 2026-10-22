/* SAO Portal - Student Activities Office
 * The browser part. All data lives on the server (server.js + SQLite); the server sends each person only
 * what they may see, and every change goes through a server action that checks permissions.
 */
(() => {
'use strict';

// ---------- Settings ----------
const TAX_RATE = 0.14;               // deducted from every deposit
const CURRENCY = 'EGP';
const MAX_FILE_MB = 10;

const STAGES = ['advisor', 'sao', 'vp'];            // default signing order
const ALL_STAGES = ['clinic', 'advisor', 'sao', 'vp']; // every possible signer step
const STAGE_LABEL = { clinic: 'GUC Clinic', advisor: 'Academic Advisor', sao: 'SAO Office Head', vp: 'Vice President' };
const ROLE_LABEL = { rep: 'Club Representative', advisor: 'Academic Advisor', sao: 'SAO Office', vp: 'Vice President', clinic: 'GUC Clinic' };
const { FORMS, SERVICE_GROUPS, CATS, DESIGN_GROUPS, LATE_LIMIT, LATE_BLOCK_MONTHS, workingDaysUntil } = window.SAO_FORMS;
const formName = type => FORMS[type]?.name || type;
// Signing order for a request (or form type): most forms use STAGES; F&B agreements start with the Clinic
const stagesFor = rOrType => FORMS[typeof rOrType === 'string' ? rOrType : rOrType.type]?.stages || STAGES;
const inProgress = r => ALL_STAGES.includes(r.status);

// Uploaded files are stored on the server. Requests keep only {id, name, size, type}.
const FILE_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const FileStore = {
  async upload(file) {
    const type = file.type || FILE_TYPES[(file.name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
    const res = await fetch(API + '/api/files', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': type, 'X-File-Name': encodeURIComponent(file.name), 'X-SAO': '1' }, body: file });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'The file could not be uploaded.');
    return out;
  },
  async get(id) {
    const res = await fetch(API + '/api/files/' + encodeURIComponent(id), { headers: authHeaders() });
    return res.ok ? res.blob() : null;
  },
};
async function openStoredFile(meta) {
  try {
    const blob = await FileStore.get(meta.id);
    if (!blob) return toast('This file is not available.', 'error');
    window.open(URL.createObjectURL(blob), '_blank');
  } catch (e) { toast('Could not open the file.', 'error'); }
}
const blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
const SOURCES = { sponsor: 'Sponsor', cash: 'Cash', other: 'Other', allocation: 'University allocation', transfer: 'Transfer from removed club' };
const UNTAXED = ['allocation', 'transfer'];   // not taxed: university budget and money moved from a removed club
const OUT_CATEGORIES = ['Events & activities', 'Printing & marketing', 'Equipment & materials', 'Catering', 'Transportation', 'Competition fees', 'Expense approvals', 'Other'];
const SAO_ACCOUNT = 'sao';                    // the SAO Office's own bank account
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COLORS = { in: '#121212', out: '#E31E24', last: '#BDBDB6', sponsor: '#FFD500', cash: '#121212', other: '#E31E24' };   // brand kit colours

const NAV = {
  rep:     [['home', 'Home'], ['finance', 'Finance'], ['paperwork', 'Paperwork'], ['announcements', 'Announcements'], ['club', 'Club Profile'], ['signature', 'My E-Signature']],
  advisor: [['home', 'Home'], ['approvals', 'Approvals'], ['signature', 'My E-Signature']],
  sao:     [['home', 'Home'], ['approvals', 'Approvals'], ['paperwork', 'Paperwork'], ['finance', 'Finance'], ['announcements', 'Announcements'], ['clubs', 'Clubs'], ['accounts', 'Accounts'], ['signature', 'My E-Signature']],
  vp:      [['home', 'Home'], ['approvals', 'Approvals'], ['signature', 'My E-Signature']],
  clinic:  [['home', 'Home'], ['approvals', 'Approvals'], ['signature', 'My E-Signature']],
};

// ---------- Helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = n => Math.round(n * 100) / 100;
const money = n => CURRENCY + ' ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyShort = n => CURRENCY + ' ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const sum = (arr, f) => round2(arr.reduce((a, x) => a + (f(x) || 0), 0));
const pad2 = n => String(n).padStart(2, '0');
const isoDate = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayISO = () => { const d = new Date(); return isoDate(d.getFullYear(), d.getMonth(), d.getDate()); };
const yearOf = d => Number(String(d).slice(0, 4));
const monthOf = d => Number(String(d).slice(5, 7)) - 1;
const fmtDate = d => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const fmtDateTime = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const thisYear = () => new Date().getFullYear();

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- Server connection ----------
// `state` holds only what the server sends for the signed-in person. Changes go through act(), then the data is reloaded.
let state = null;
// The server address (config.js): empty = same address as the pages; on GitHub Pages it is the Supabase function.
const API = String(window.SAO_API || '').replace(/[/]+$/, '');
// Sign-in token, kept in this browser until sign-out (sent as "Authorization: Bearer ...")
let authToken = (() => { try { return localStorage.getItem('sao-token') || ''; } catch (e) { return ''; } })();
function setToken(t) { authToken = t || ''; try { if (t) localStorage.setItem('sao-token', t); else localStorage.removeItem('sao-token'); } catch (e) { /* this page only */ } }
const authHeaders = () => authToken ? { Authorization: 'Bearer ' + authToken } : {};
async function apiGet(url) {
  const res = await fetch(API + url, { headers: { Accept: 'application/json', ...authHeaders() } });
  if (res.status === 401) { setToken(''); state = null; await boot(); throw new Error('Please sign in again.'); }
  if (!res.ok) throw new Error('The server did not answer. Check your connection.');
  return res.json();
}
async function apiPost(url, body) {
  const res = await fetch(API + url, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json', 'X-SAO': '1' }, body: JSON.stringify(body || {}) });
  const out = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') { setToken(''); state = null; await boot(); throw new Error('Please sign in again.'); }
  if (url === '/api/login' && res.ok && out.token) setToken(out.token);
  if (!res.ok) throw new Error(out.error || 'Something went wrong.');
  return out;
}
async function refresh() { state = await apiGet('/api/state'); }
// Runs a server action, reloads the data and redraws. Returns the result, or null if it failed (the reason is shown).
let busy = false;
async function act(name, payload, okMessage) {
  if (busy) return null;
  busy = true;
  try {
    const out = await apiPost('/api/actions/' + name, payload);
    await refresh();
    closeModal(); render();
    if (okMessage) toast(typeof okMessage === 'function' ? okMessage(out) : okMessage, 'success');
    return out;
  } catch (e) { toast(e.message, 'error'); return null; }
  finally { busy = false; }
}

// ---------- Demo data ----------
function makeSignature(name) {
  const c = document.createElement('canvas');
  c.width = 420; c.height = 130;
  const x = c.getContext('2d');
  let size = 44;
  const font = s => `italic ${s}px 'Segoe Script','Brush Script MT','Lucida Handwriting',cursive`;
  x.font = font(size);
  while (x.measureText(name).width > 390 && size > 18) { size -= 2; x.font = font(size); }
  x.fillStyle = '#1b2a6b'; x.textBaseline = 'middle';
  x.fillText(name, 14, 60);
  x.strokeStyle = '#1b2a6b'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(14, 102); x.bezierCurveTo(120, 114, 260, 90, 400, 106); x.stroke();
  return c.toDataURL('image/png');
}

function seed() {
  const rnd = mulberry32(2026);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const clubNames = ['Robotics Club', 'Debate Society', 'Photography Club', 'Music Club', 'Drama & Theatre Club',
    'Entrepreneurship Club', 'IEEE Student Branch', 'Model United Nations', 'Environmental Club', 'Chess Club',
    'Art & Design Club', 'Volunteering Club', 'Sports Club', 'Coding Club', 'Literature Club', 'Film Society'];
  // one Academic Advisor per club
  const advisors = ['Dr. Sara Ahmed', 'Dr. Omar Hassan', 'Dr. Mona Khaled', 'Dr. Youssef Ali', 'Dr. Hany Fathy', 'Dr. Nadia Samir', 'Dr. Karim Mostafa', 'Dr. Laila Mansour',
    'Dr. Tarek Nabil', 'Dr. Rania Adel', 'Dr. Ahmed Shawky', 'Dr. Dina Farouk', 'Dr. Mahmoud Saad', 'Dr. Heba Lotfy', 'Dr. Amr Zaki', 'Dr. Yasmin Hussein']
    .map((name, i) => ({ id: 'adv-' + (i + 1), name }));
  const users = [
    { id: 'sao', name: 'SAO Office', role: 'sao', title: 'Youth Welfare Director', signName: 'Mr. Yehia Al-Razaz' },
    { id: 'vp', name: 'Dr. Ehab Abo El-Kheir', role: 'vp', title: 'GUC Vice President', signName: 'Dr. Ehab Abo El-Kheir' },
    { id: 'clinic', name: 'GUC Clinic', role: 'clinic', title: 'GUC Clinic', signName: 'GUC Clinic' },
    ...advisors.map(a => ({ ...a, role: 'advisor', title: 'Academic Advisor', signName: a.name })),
  ];
  const clubs = clubNames.map((n, i) => ({ id: 'club-' + (i + 1), name: n, advisorId: advisors[i].id, accountNo: `1-C15-01-SC-${String(i + 1).padStart(3, '0')}-000-1` }));
  clubs.forEach((c, i) => users.push({ id: 'rep-' + (i + 1), name: c.name + ' Rep', role: 'rep', clubId: c.id, title: 'Club Representative' }));

  // Transactions: last year + this year up to today
  const sponsors = ['Nile Tech', 'Delta Foods', 'Horizon Bank', 'Pyramid Telecom', 'Sunrise Media', 'Atlas Motors', 'Lotus Pharma', 'Cairo Print House'];
  const purposes = [['Event venue & equipment', 'Events & activities'], ['Printing & banners', 'Printing & marketing'], ['Workshop materials', 'Equipment & materials'],
    ['Catering', 'Catering'], ['Transportation', 'Transportation'], ['Competition fees', 'Competition fees'], ['Club merchandise', 'Other']];
  const transactions = [];
  const now = new Date(), cy = now.getFullYear(), cm = now.getMonth();
  let n = 0;
  clubs.forEach(club => {
    const rep = users.find(u => u.clubId === club.id);
    let bal = 0;
    for (let y = cy - 1; y <= cy; y++) {
      const lastM = y === cy ? cm : 11;
      for (let m = 0; m <= lastM; m++) {
        const maxDay = (y === cy && m === cm) ? Math.max(1, now.getDate()) : 28;
        const day = (lo, hi) => Math.min(maxDay, lo + Math.floor(rnd() * (hi - lo + 1)));
        const deps = [];
        if (rnd() < .35) deps.push(['sponsor', Math.round(5000 + rnd() * 35000)]);
        if (rnd() < .65) deps.push(['cash', Math.round(800 + rnd() * 7000)]);
        if (rnd() < .15) deps.push(['other', Math.round(500 + rnd() * 3000)]);
        deps.forEach(([source, gross]) => {
          const tax = round2(gross * TAX_RATE), net = round2(gross - tax);
          bal += net;
          transactions.push({ id: 'tx-' + (++n), clubId: club.id, type: 'deposit', source, sponsor: source === 'sponsor' ? pick(sponsors) : '',
            gross, tax, net, note: source === 'cash' ? 'Event ticket sales' : source === 'other' ? 'Merch sales' : 'Sponsorship package',
            date: isoDate(y, m, day(1, 14)), by: rep.id });
        });
        if (rnd() < .55) {
          const amount = Math.round(1000 + rnd() * 9000);
          if (amount <= bal) {
            bal -= amount;
            const [note, category] = pick(purposes);
            transactions.push({ id: 'tx-' + (++n), clubId: club.id, type: 'withdraw', amount, note, category, date: isoDate(y, m, day(15, 28)), by: rep.id });
          }
        }
      }
    }
  });

  // The SAO Office's own account: university allocations each semester, university-wide sponsors, office spending
  {
    let bal = 0;
    const saoOut = [['Orientation week', 'Events & activities'], ['Activities Fair setup', 'Events & activities'], ['Printing for university events', 'Printing & marketing'],
      ['Sound system rental', 'Equipment & materials'], ['Graduation ushers catering', 'Catering'], ['Buses for student trip', 'Transportation'], ['Inter-university competition fees', 'Competition fees']];
    for (let y = cy - 1; y <= cy; y++) {
      const lastM = y === cy ? cm : 11;
      for (let m = 0; m <= lastM; m++) {
        const maxDay = (y === cy && m === cm) ? Math.max(1, now.getDate()) : 28;
        const day = (lo, hi) => Math.min(maxDay, lo + Math.floor(rnd() * (hi - lo + 1)));
        const deps = [];
        if (m === 1 || m === 8) deps.push(['allocation', 250000, 'Semester activities budget']);
        if (rnd() < .3) deps.push(['sponsor', Math.round(20000 + rnd() * 60000), 'University-wide event sponsor']);
        if (rnd() < .4) deps.push(['cash', Math.round(3000 + rnd() * 12000), 'Ticket sales']);
        deps.forEach(([source, gross, note]) => {
          const tax = UNTAXED.includes(source) ? 0 : round2(gross * TAX_RATE), net = round2(gross - tax);
          bal += net;
          transactions.push({ id: 'tx-' + (++n), clubId: SAO_ACCOUNT, type: 'deposit', source, sponsor: source === 'sponsor' ? pick(sponsors) : '', gross, tax, net, note, date: isoDate(y, m, day(1, 12)), by: 'sao' });
        });
        for (let k = 0; k < 2; k++) {
          if (rnd() < .7) {
            const amount = Math.round(4000 + rnd() * 30000);
            if (amount <= bal) { bal -= amount; const [note, category] = pick(saoOut);
              transactions.push({ id: 'tx-' + (++n), clubId: SAO_ACCOUNT, type: 'withdraw', amount, note, category, date: isoDate(y, m, day(13, 28)), by: 'sao' }); }
          }
        }
      }
    }
  }

  // Paperwork requests at different stages
  const sig = {};
  users.filter(u => u.role !== 'rep').forEach(u => { sig[u.id] = makeSignature(u.signName); });
  const fut = k => { const d = new Date(now.getTime() + k * 86400000); return isoDate(d.getFullYear(), d.getMonth(), d.getDate()); };
  const svc = (obj) => Object.fromEntries(Object.entries(obj).map(([g, items]) => [g, { items, other: '' }]));
  const reqSeed = [
    [0, 'general', 'completed', { eventName: 'Annual Robotics Competition', venue: 'Main Hall', startDate: fut(20), endDate: fut(21), marketingPlan: 'Social media campaign, posters in boxes, ON SPOT mail.', eventManager: 'Ahmed Samir', description: 'Inter-university robotics competition with 20 teams.', slot: 'Normal Hours', activities: '09:00 Registration\n10:00 Qualifiers\n14:00 Finals\n16:00 Awards', services: svc({ it: ['Projector', 'Microphones', 'Speakers'], marketing: ['MPC Coverage', 'ON SPOT Mail'], technical: ['Electricity'] }) }],
    [1, 'expense', 'vp', { requestedDate: fut(-3), requestedBy: 'Debate Society Rep', amount: 6500, justification: 'Trophies and certificates for the national debate tournament.', memoTo: 'Mr. Yehia Al-Razaz, Youth Welfare Director', memoSubject: 'Trophies for the national debate tournament', memoBody: 'The Debate Society kindly requests approval to spend EGP 6,500 from the club account on trophies and certificates for the national debate tournament hosted on campus next month.\n\nThe tournament brings together twelve university teams, and the awards recognise the finalists and the best speakers.\n\nWe would be grateful for your approval of this request.' }],
    [2, 'booth', 'sao', { eventName: 'Photo Exhibition', boothNo: 'B-12', boothCount: '1', startDate: fut(15), endDate: fut(17), marketingPlan: 'Instagram posts and flyers.', boothManager: 'Nour Adel', description: 'Exhibition of members\' photos during Activities Fair week.', slot: 'Normal Hours', activities: 'Photo display, live portrait corner, member sign-up.', services: svc({ furnitureBooth: ['Table "1"', 'Chairs "2"'], technicalBooth: ['Electricity'] }) }],
    [5, 'sponsorAgreement', 'advisor', { sponsorName: 'Horizon Bank', category: 'Banks', boothNo: 'B-01', agreedFees: 30000, startDate: fut(25), endDate: fut(31), sponsorDescription: 'Student accounts and cards stand.', boothType: 'GUC Booth', academicContent: 'No', services: svc({ agreed: ['Booth'], sponsorTech: ['Electricity'], logSponsor: ['Laptop'] }) }],
    [6, 'educational', 'completed', { eventName: 'IEEE Tech Day', venue: 'Conference Hall', startDate: fut(14), endDate: fut(14), speakers: ['Eng. Karim Fathy', 'Dr. Laila Nabil', ''], description: 'One-day technical conference with talks and hands-on workshops.', slot: 'Normal Hours', content: 'Talks on AI in industry and embedded systems careers.', eventType: 'Conference', services: svc({ it: ['Projector', 'Microphones'], marketing: ['MPC Coverage'] }) }],
    [7, 'general', 'rejected', { eventName: 'MUN Simulation Day', venue: 'Hall H3', startDate: fut(30), endDate: fut(30), marketingPlan: 'Social media and posters.', eventManager: 'Salma Hany', description: 'One-day Model UN simulation with 60 delegates.', slot: 'Normal Hours', activities: 'Opening, committee sessions, closing.', services: svc({ it: ['Microphones'] }) }],
    [12, 'sports', 'advisor', { eventName: 'Inter-faculty Football League', venue: 'Football Field', startDate: fut(18), endDate: fut(40), description: 'League between faculties, matches every Tuesday.', slot: 'After Hours', plan: '16 teams, 2 groups, 20-minute matches, top 2 qualify.', eventType: 'Football', services: svc({ it: ['Speakers'] }) }],
    [13, 'entertainment', 'sao', { eventName: '24h Hackathon Night', venue: 'Engineering Building', startDate: fut(22), endDate: fut(23), marketingPlan: 'Social media + flyers', eventManager: 'Youssef Tarek', description: 'Overnight hackathon with music and games.', slot: 'After Hours', activities: 'Opening, hacking, midnight games, demos, awards.', services: svc({ it: ['Projector', 'Speakers'], technical: ['Electricity', 'AC/ON'], logistics: ['Screen'] }) }],
    [3, 'recruitment', 'vp', { eventName: 'Music Club Recruitment', boothNo: 'B-03', boothCount: '2', startDate: fut(12), endDate: fut(13), marketingPlan: 'Live performance at the booth.', boardTraining: 'Interview skills workshop for board members.', description: 'Recruiting new members for the spring season.', location: 'On Campus', recruitmentPlan: '150 interviewees, 30 new members.', services: svc({ furnitureBooth: ['Table "1"', 'Chairs "2"'], logistics: ['Speakers'] }) }],
    [9, 'fnbAgreement', 'advisor', { sponsorName: 'Delta Foods', category: 'Food and Beverages', eventName: 'Chess Open', boothNo: 'F-02', startDate: fut(16), endDate: fut(18), agreedFees: 9000, sponsorDescription: 'Sandwiches and hot drinks during the chess tournament.', boothType: 'Private Booth/Truck', totalKw: '4', deviceKw: '1.5', services: svc({ agreed: ['Booth', 'ONSPOT'], logFnb: ['Truck', 'Coffee Machine'] }) }],
  ];
  let reqNo = 0;
  const requests = reqSeed.map(([ci, type, status, data], i) => {
    const club = clubs[ci];
    const rep = users.find(u => u.clubId === club.id);
    const created = new Date(now.getTime() - (20 - i) * 86400000);
    const f = FORMS[type];
    const r = { id: `REQ-${cy}-${String(++reqNo).padStart(4, '0')}`, clubId: club.id, type, data, title: data[f.titleKey] || f.name, amount: Number(data[f.amountKey]) || 0,
      eventDate: data.startDate || '', createdBy: rep.id, createdAt: created.toISOString(), status, approvals: [], rejection: null, completedAt: null };
    const order = f.stages || STAGES;
    const upto = status === 'completed' ? order.length : status === 'rejected' ? order.indexOf('sao') : order.indexOf(status);
    for (let s = 0; s < upto; s++) {
      const stage = order[s];
      const signer = stage === 'advisor' ? users.find(u => u.id === club.advisorId) : users.find(u => u.role === stage);
      r.approvals.push({ stage, userId: signer.id, name: signer.signName || signer.name, title: signer.title, signature: sig[signer.id],
        comment: '', at: new Date(created.getTime() + (s + 1) * 86400000).toISOString() });
    }
    if (status === 'rejected') {
      r.rejection = { stage: 'sao', userId: 'sao', name: 'SAO Head', comment: 'Budget exceeds this semester\'s travel allowance. Please resubmit with a reduced number of delegates.', at: new Date(created.getTime() + 2 * 86400000).toISOString() };
    }
    if (status === 'completed') r.completedAt = r.approvals[r.approvals.length - 1].at;
    return r;
  });

  const day = k => new Date(now.getTime() + k * 86400000);
  const dISO = d => isoDate(d.getFullYear(), d.getMonth(), d.getDate());
  const announcements = [
    { id: 'ann-1', clubId: 'club-1', title: 'Robotics Competition registration is open!', body: 'Form a team of 3-5 and register before the end of the month. Prizes for the top three teams.', start: dISO(day(-5)), end: dISO(day(25)), status: 'approved', createdBy: 'rep-1', createdAt: day(-6).toISOString(), reviewedAt: day(-5).toISOString() },
    { id: 'ann-2', clubId: 'club-7', title: 'IEEE Tech Day - free workshops', body: 'Join hands-on workshops on AI, embedded systems and cloud. Seats are limited.', start: dISO(day(-3)), end: dISO(day(14)), status: 'approved', createdBy: 'rep-7', createdAt: day(-4).toISOString(), reviewedAt: day(-3).toISOString() },
    { id: 'ann-3', clubId: null, title: 'Activities Fair next week', body: 'All clubs will have booths in the main corridor. Come meet the clubs and sign up!', start: dISO(day(-1)), end: dISO(day(10)), status: 'approved', createdBy: 'sao', createdAt: day(-1).toISOString(), reviewedAt: day(-1).toISOString() },
    { id: 'ann-4', clubId: 'club-14', title: '24h Hackathon - call for participants', body: 'Teams of up to 4. Food, mentors and prizes provided.', start: dISO(day(1)), end: dISO(day(30)), status: 'pending', createdBy: 'rep-14', createdAt: day(0).toISOString() },
    { id: 'ann-5', clubId: 'club-5', title: 'Drama club auditions', body: 'Auditions for the spring play are open to all students. No experience needed.', start: dISO(day(0)), end: dISO(day(12)), status: 'pending', createdBy: 'rep-5', createdAt: day(0).toISOString() },
  ];

  requests.filter(r => r.type === 'expense').forEach(r => {
    const bal = round2(transactions.filter(t => t.clubId === r.clubId).reduce((a, t) => a + (t.type === 'deposit' ? t.net : -t.amount), 0));
    r.data.availableBalance = bal; r.data.remainingBalance = round2(bal - r.amount);
  });
  return { version: 2, users, clubs, transactions, requests, announcements, signatures: {}, counters: { req: reqNo } };
}

// ---------- Lookups & permissions ----------
// The signed-in person, as the server knows them
const me = () => (state && state.me ? { ...(state.users.find(u => u.id === state.me.id) || {}), ...state.me } : null);
const clubById = id => state.clubs.find(c => c.id === id);
const userById = id => state.users.find(u => u.id === id);
const clubName = id => !id || id === SAO_ACCOUNT ? 'SAO Office' : (clubById(id)?.name || 'Unknown club');
const activeClubs = () => state.clubs.filter(c => !c.archived);

function visibleClubs(u) {
  if (u.role === 'rep') return state.clubs.filter(c => c.id === u.clubId);
  if (u.role === 'advisor') return activeClubs().filter(c => c.advisorId === u.id);
  return state.clubs;
}
const isSigner = u => ['advisor', 'vp', 'clinic'].includes(u.role);
function visibleRequests(u) {
  if (isSigner(u)) return pendingForMe(u).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ids = new Set(visibleClubs(u).map(c => c.id));
  return state.requests.filter(r => ids.has(r.clubId) && (u.role !== 'clinic' || stagesFor(r).includes('clinic')))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function canAct(u, r) {
  if (r.status !== u.role) return false;
  if (u.role === 'advisor') return clubById(r.clubId)?.advisorId === u.id;
  return u.role === 'sao' || u.role === 'vp' || u.role === 'clinic';
}
const pendingForMe = u => state.requests.filter(r => canAct(u, r));
// Finance is private: a club rep sees only their own club; SAO Office oversees all clubs.
const canSeeFinance = (u, clubId) => u.role === 'sao' || (u.role === 'rep' && u.clubId === clubId && clubId !== SAO_ACCOUNT);

const lateBadge = r => (r.late ? ' <span class="badge red">Late</span>' : '') + (overBalance(r) ? ' <span class="badge amber">Over balance</span>' : '');
const chip = (kind, label) => `<span class="chip-status ${kind}">${label}</span>`;   // kind: review | approved | action | draft
function statusBadge(r) {
  if (r.status === 'completed') return chip('approved', 'Approved - signed form with SAO');
  if (r.status === 'rejected') return chip('action', `Returned by ${esc(STAGE_LABEL[r.rejection?.stage] || '')}`);
  return chip('review', `In review: ${esc(STAGE_LABEL[r.status])}`);
}
function annBadge(a) {
  return { pending: chip('review', 'In review'), approved: chip('approved', 'Approved'),
    rejected: chip('action', 'Rejected'), archived: chip('draft', 'Removed') }[a.status];
}

// ---------- UI primitives ----------
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
function openModal({ title, body, foot = '', wide = false, onMount }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><div>${title}</div><button class="x" aria-label="Close" data-close>&times;</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div></div>`;
  const back = $('.modal-backdrop', root);
  back.addEventListener('mousedown', e => { if (e.target === back) closeModal(); });
  $$('[data-close]', root).forEach(b => b.addEventListener('click', closeModal));
  onMount && onMount($('.modal', root));
}
function closeModal() { $('#modal-root').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---------- Light / dark mode (each browser remembers its choice; "auto" follows the device) ----------
const themePref = () => { try { return localStorage.getItem('sao-theme') || 'auto'; } catch (e) { return 'auto'; } };
const isDark = () => document.documentElement.dataset.theme === 'dark';
const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme(pref = themePref()) {
  const dark = pref === 'dark' || (pref === 'auto' && !!darkQuery?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
function setTheme(pref) {
  try { localStorage.setItem('sao-theme', pref); } catch (e) { /* this page only */ }
  const was = isDark(); applyTheme(pref);
  if (was !== isDark() && charts.length) render();   // redraw charts in the new colours
}
darkQuery?.addEventListener?.('change', () => { if (themePref() === 'auto') { const was = isDark(); applyTheme(); if (was !== isDark() && charts.length) render(); } });
applyTheme();

let charts = [];
// On-screen charts in dark mode: black marks turn light and labels lighten. PDF charts (chartImage) always stay light.
const DARK_SWAP = { '#121212': '#F2F2EE', '#3A3A3A': '#8A8A85', '#5C5C5C': '#A6A69F', '#BDBDB6': '#6E6E68', '#FFF4B3': '#8A7A2A', '#FDE3E4': '#8A4A4D', '#fff': '#1C1C1C' };
function themed(cfg) {
  if (!isDark()) return cfg;
  const sw = v => Array.isArray(v) ? v.map(sw) : (typeof v === 'string' && DARK_SWAP[v]) || v;
  const o = { ...(cfg.options || {}), color: '#C9C9C2' };
  if (cfg.type === 'bar' || cfg.type === 'line') {
    o.scales = { ...(o.scales || {}) };
    for (const ax of ['x', 'y']) { const s = o.scales[ax] || {}; o.scales[ax] = { ...s, ticks: { ...(s.ticks || {}), color: '#A6A69F' }, grid: { ...(s.grid || {}), color: '#2E2E2E' } }; }
  }
  return { ...cfg, options: o, data: { ...cfg.data, datasets: cfg.data.datasets.map(d => ({ ...d, backgroundColor: sw(d.backgroundColor), borderColor: sw(d.borderColor) })) } };
}
function chart(canvas, cfg) {
  if (!canvas) return;
  if (!window.Chart) { canvas.parentElement.innerHTML = '<p class="muted">Charts need an internet connection to load.</p>'; return; }
  charts.push(new Chart(canvas, themed(cfg)));
}
function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; }
const moneyTooltip = { callbacks: { label: c => `${c.dataset.label || c.label}: ${money(c.parsed.y ?? c.parsed.x ?? c.parsed)}` } };

function createPad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false, empty = true, last = null;
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = ctx.fillStyle = '#1b2a6b';
  const pos = e => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  canvas.addEventListener('pointerdown', e => {
    drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId);
    ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2); ctx.fill(); empty = false;
    const hint = canvas.parentElement.querySelector('.hint'); if (hint) hint.style.display = 'none';
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => canvas.addEventListener(ev, () => { drawing = false; }));
  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; const h = canvas.parentElement.querySelector('.hint'); if (h) h.style.display = ''; },
    isEmpty: () => empty,
    toDataURL: () => trimSignature(canvas),
  };
}
// Crop empty space around the drawing and shrink it, so stored signatures and PDFs stay small.
function trimSignature(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return canvas.toDataURL('image/png');
  const m = 6; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, k = Math.min(1, 400 / cw, 140 / ch);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cw * k)); out.height = Math.max(1, Math.round(ch * k));
  out.getContext('2d').drawImage(canvas, x0, y0, cw, ch, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
const padHTML = id => `<div class="pad-wrap"><canvas id="${id}"></canvas><span class="hint">Sign here with your mouse, finger or stylus</span></div>`;

// ---------- Router / shell ----------
let bannerTimer = null;
let financeSel = 'all';
const PAGES = { accounts: pageAccounts, club: pageClub, clubs: pageClubs, home: pageHome, finance: pageFinance, paperwork: pagePaperwork, approvals: pageApprovals, announcements: pageAnnouncements, signature: pageSignature };
const PAGE_TITLE = { accounts: 'Accounts', club: 'Club Profile', clubs: 'Clubs', home: 'Home', finance: 'Finance', paperwork: 'Paperwork', approvals: 'Approvals', announcements: 'Announcements', signature: 'My E-Signature' };

// ---------- Icons (line icons on a 24px grid, drawn with the text colour) ----------
const ICON_PATHS = {
  home: 'M4 11l8-7 8 7v9h-5v-6h-6v6H4z',
  approvals: 'M7 3h7l4 4v14H7z M14 3v4h4 M9.5 14.5l2 2 4-4.5',
  paperwork: 'M7 3h7l4 4v14H7z M14 3v4h4 M10 12h5 M10 16h5',
  finance: 'M3 7h18v12H3z M3 11h18 M16 15h2',
  announcements: 'M4 10v4h3l6 4V6L7 10H4z M16.5 9a4 4 0 0 1 0 6 M19 6.5a7.5 7.5 0 0 1 0 11',
  club: 'M6 21V4 M6 4h11l-2.5 4 2.5 4H6',
  clubs: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14.8c2 .8 3.2 2.6 3.5 5.2',
  accounts: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c1-4 4.5-6 8-6s7 2 8 6',
  signature: 'M4 20h4L19 9l-4-4L4 16v4z M13.5 6.5l4 4',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  logout: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10',
  lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  plus: 'M12 5v14 M5 12h14',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z M10 20.5h4',
  report: 'M7 3h7l4 4v14H7z M14 3v4h4 M10 17v-2 M12.5 17v-4 M15 17v-3',
  deposit: 'M12 4v10 M8 10l4 4 4-4 M4 19h16',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
};
const icon = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[name] || ICON_PATHS.more}"/></svg>`;
// Short names for the phone tab bar, and which pages get a tab first (the rest go under "More")
const TAB_LABEL = { paperwork: 'Papers', announcements: 'News', signature: 'Signature', club: 'Club', accounts: 'Accounts' };
const TAB_FIRST = { rep: ['home', 'paperwork', 'finance', 'announcements'], sao: ['home', 'approvals', 'finance', 'paperwork'] };
const initials = s => String(s || '?').replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const avatar = u => u.role === 'rep' ? clubLogo(u.clubId, 'av') : `<span class="avatar">${esc(initials(u.name))}</span>`;
const whoName = u => u.role === 'rep' ? clubName(u.clubId) : u.name;
const whoRole = u => u.role === 'rep' ? 'Club Representative' : (u.title || ROLE_LABEL[u.role]);

async function signOut() { try { await apiPost('/api/logout'); } catch (e) { /* signed out anyway */ } setToken(''); state = null; location.hash = ''; boot(); }

function render() {
  destroyCharts(); clearInterval(bannerTimer); clearTimeout(bannerTimer); closeSheet();
  if (!state) return;
  const u = me();
  if (!u) { boot(); return; }
  let page = location.hash.slice(1) || 'home';
  if (!NAV[u.role].some(n => n[0] === page)) page = 'home';
  document.title = `${PAGE_TITLE[page]} - SAO Portal`;
  const counts = {
    approvals: pendingForMe(u).length,
    announcements: u.role === 'sao' ? state.announcements.filter(a => a.status === 'pending').length : 0,
  };
  const items = NAV[u.role].map(([k, label]) => ({ k, label, count: counts[k] || 0 }));
  const first = TAB_FIRST[u.role] || items.map(i => i.k);
  const tabs = first.map(k => items.find(i => i.k === k)).filter(Boolean).slice(0, 4);
  const rest = items.filter(i => !tabs.includes(i));
  const badge = n => n ? `<span class="count">${n}</span>` : '';
  const closed = sidebarClosed();
  $('#app').innerHTML = `${brandHeader(u, counts, closed)}<div class="layout${closed ? ' side-closed' : ''}">
    <aside class="sidebar" id="sidebar">
      <nav class="nav" aria-label="Main">${items.map(i => `<a href="#${i.k}" class="${i.k === page ? 'active' : ''}" title="${i.label}"${i.k === page ? ' aria-current="page"' : ''}>${icon(i.k)}<span class="lbl">${i.label}</span>${badge(i.count)}</a>`).join('')}</nav>
      <div class="side-user">${avatar(u)}<div class="who"><b>${esc(whoName(u))}</b><span>${esc(whoRole(u))}</span></div>
        <button class="icon-btn" data-act="password" title="Change password" aria-label="Change password">${icon('lock')}</button>
        <button class="icon-btn" data-act="logout" title="Sign out" aria-label="Sign out">${icon('logout')}</button></div>
      ${state.demo ? '<div class="side-foot"><span class="badge amber">Demo data</span></div>' : ''}
    </aside>
    <div class="main-col"><main class="main" id="main"></main>${GUC_FOOT}</div></div>
    <nav class="tabbar" aria-label="Main">${tabs.map(i => `<a href="#${i.k}" class="tab ${i.k === page ? 'active' : ''}"${i.k === page ? ' aria-current="page"' : ''}><span class="tab-ic">${icon(i.k)}${i.count ? `<i class="tab-badge">${i.count}</i>` : ''}</span><span class="tab-lbl">${TAB_LABEL[i.k] || i.label}</span></a>`).join('')}
      <button type="button" class="tab ${rest.some(i => i.k === page) ? 'active' : ''}" data-act="more"><span class="tab-ic">${icon('more')}${rest.some(i => i.count) ? '<i class="tab-dot"></i>' : ''}</span><span class="tab-lbl">More</span></button></nav>`;
  $$('[data-act="logout"]').forEach(b => b.onclick = signOut);
  $$('[data-act="password"]').forEach(b => b.onclick = () => passwordModal());
  $$('[data-act="more"]').forEach(b => b.onclick = () => openSheet(u, rest, page, 'More'));
  // The account button (top right) holds only the person's own things: e-signature, password, sign out
  $$('[data-act="account"]').forEach(b => b.onclick = () => openSheet(u, items.filter(i => i.k === 'signature'), page, 'Account'));
  $$('[data-act="side"]').forEach(b => b.onclick = () => toggleSidebar(b));
  PAGES[page]($('#main'), u);
}

// The left menu can be closed to a slim icon bar; each browser remembers the choice
function sidebarClosed() { try { return localStorage.getItem('sao-sidebar') === 'closed'; } catch (e) { return false; } }
function toggleSidebar(btn) {
  const layout = $('.layout');
  const closed = layout.classList.toggle('side-closed');
  try { localStorage.setItem('sao-sidebar', closed ? 'closed' : 'open'); } catch (e) { /* remembered for this page only */ }
  btn.setAttribute('aria-expanded', String(!closed));
  btn.title = closed ? 'Open menu' : 'Close menu';
  btn.setAttribute('aria-label', btn.title);
}

// A menu sheet: from the account button, or the "More" tab on phones (pages without a tab).
// Both end with Change password and Sign out.
function closeSheet() { const s = $('#sheet'); if (s) s.remove(); document.removeEventListener('keydown', sheetKey); }
function sheetKey(e) { if (e.key === 'Escape') closeSheet(); }
function openSheet(u, rest, page, label = 'Menu') {
  closeSheet();
  const el = document.createElement('div');
  el.id = 'sheet'; el.className = 'sheet-backdrop' + (label === 'Account' ? ' account' : '');
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${label}">
    <div class="sheet-handle"></div>
    <div class="sheet-user">${avatar(u)}<div class="who"><b>${esc(whoName(u))}</b><span>${esc(whoRole(u))}</span></div></div>
    ${rest.map(i => `<a class="sheet-row ${i.k === page ? 'active' : ''}" href="#${i.k}">${icon(i.k)}<span>${i.label}</span>${i.count ? `<span class="count">${i.count}</span>` : icon('arrow', 'ic chev')}</a>`).join('')}
    ${rest.length ? '<div class="sheet-sep"></div>' : ''}
    <div class="theme-row">${icon('moon')}<span>Appearance</span><div class="seg" role="group" aria-label="Appearance">${[['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']].map(([k, l]) => `<button type="button" data-theme-pick="${k}" aria-pressed="${themePref() === k}" title="${k === 'auto' ? 'Follow this device' : l + ' mode'}">${l}</button>`).join('')}</div></div>
    <button type="button" class="sheet-row" data-sheet="password">${icon('lock')}<span>Change password</span></button>
    <button type="button" class="sheet-row danger" data-sheet="logout">${icon('logout')}<span>Sign out</span></button>
  </div>`;
  document.body.appendChild(el);
  el.onclick = e => { if (e.target === el || e.target.closest('a.sheet-row')) closeSheet(); };
  $$('[data-theme-pick]', el).forEach(b => b.onclick = () => {
    $$('[data-theme-pick]', el).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    setTheme(b.dataset.themePick);
  });
  $('[data-sheet="password"]', el).onclick = () => { closeSheet(); passwordModal(); };
  $('[data-sheet="logout"]', el).onclick = () => { closeSheet(); signOut(); };
  document.addEventListener('keydown', sheetKey);
  requestAnimationFrame(() => el.classList.add('open'));
}
window.addEventListener('hashchange', render);

// ---------- Start: first-run setup, sign-in, or the app ----------
// Opening intro from the brand kit: shown on the first visit in this browser only, skipped on click.
function playIntro() {
  let seen = false;
  try { seen = localStorage.getItem('sao-intro-seen') === '1'; localStorage.setItem('sao-intro-seen', '1'); } catch (e) { seen = true; }
  if (seen) return Promise.resolve();
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = 'intro' + (reduced ? ' still' : '');
  el.setAttribute('role', 'presentation');
  el.innerHTML = `<div class="intro-stage">
      <svg viewBox="0 0 120 120" width="170" height="170" aria-hidden="true">
        <rect class="l" x="34" y="30" width="52" height="70" rx="10" fill="#E31E24"/>
        <rect class="r" x="34" y="30" width="52" height="70" rx="10" fill="#FFD500"/>
        <g class="f"><rect x="34" y="26" width="52" height="74" rx="10" fill="#FFFFFF" stroke="#121212" stroke-width="3"/>
          <path class="c" d="M47 63 L56 72 L73 52" fill="none" stroke="#121212" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></g>
      </svg>
      <div class="wm">SAO</div>
      <div class="bars"><span></span><span></span><span></span></div>
      <div class="sub"><div>Student Activities Office</div><div lang="ar" dir="rtl">مكتب الأنشطة الطلابية</div></div>
      <div class="tag">Papers, payments, permits — sorted.</div>
    </div><div class="intro-foot">German University in Cairo</div>`;
  document.body.appendChild(el);
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => el.remove(), 450); resolve(); };
    el.addEventListener('click', finish);
    setTimeout(finish, reduced ? 1200 : 2800);
  });
}

async function boot() {
  await playIntro();
  let s;
  try {
    s = await (await fetch(API + '/api/session', { headers: authHeaders() })).json();
    if (s.error) { $('#app').innerHTML = `<div class="login"><div class="login-card login-narrow">${loginHead}<h2>Almost ready</h2><p class="muted">${esc(s.error)}</p><button class="btn key login-btn" onclick="location.reload()">Try again</button></div></div>`; return; }
  }
  catch (e) { $('#app').innerHTML = '<div class="login"><div class="login-card login-narrow"><h2>Can\'t reach the portal</h2><p class="muted">Check your internet connection and try again. If it keeps happening, the portal\'s server may be starting up - wait a minute.</p><button class="btn key login-btn" onclick="location.reload()">Try again</button></div></div>'; return; }
  if (s.needsSetup) return renderSetup();
  if (!s.user) return renderLogin(s);
  try { await refresh(); } catch (e) { return; }
  render();
}
const SAO_MARK = '<img class="sao-mark" src="assets/brand/sao-mark-color.svg" alt="">';
const BRAND_BARS = '<span class="brand-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
const loginHead = `<div class="login-head">${SAO_MARK.replace('sao-mark', 'sao-mark lg')}
      <div class="lockup"><b>SAO</b>${BRAND_BARS}<span>Student Activities Office</span><span class="ar" lang="ar" dir="rtl">مكتب الأنشطة الطلابية</span></div></div>`;
const GUC_FOOT = '<footer class="guc-foot"><img src="assets/guc-logo.jpg" alt="German University in Cairo"><span>Student Activities Office &middot; German University in Cairo</span></footer>';

function renderLogin(s = {}) {
  document.title = 'Sign in - SAO Portal';
  const demo = s.demoAccounts || [];
  const groups = [['sao', 'SAO Office'], ['vp', 'Vice President'], ['clinic', 'GUC Clinic'], ['advisor', 'Academic Advisors'], ['rep', 'Club Representatives']];
  $('#app').innerHTML = `<div class="login"><div class="login-card login-narrow">${loginHead}
    <form id="loginForm" autocomplete="on">
      <div class="field"><label for="lEmail">Email</label><input id="lEmail" type="email" autocomplete="username" required placeholder="name@guc.edu.eg"></div>
      <div class="field"><label for="lPass">Password</label><input id="lPass" type="password" autocomplete="current-password" required></div>
      <div id="lErr"></div>
      <button class="btn key login-btn" type="submit">Sign in</button>
      <p class="small muted" style="margin-top:12px">Forgot your password? Ask the SAO Office to set a new one.</p>
    </form>
    ${demo.length ? `<div class="demo-box"><b>Demo accounts</b> <span class="small muted">- password <code>${esc(s.demoPassword)}</code>. Click one to fill it in.</span>
      ${groups.map(([role, label]) => { const list = demo.filter(d => d.role === role); return list.length ? `<div class="demo-group"><span class="small muted">${label}</span>${list.map(d => `<button type="button" class="chip" data-demo="${esc(d.email)}">${esc(d.name)}</button>`).join('')}</div>` : ''; }).join('')}</div>` : ''}
  </div>${GUC_FOOT}</div>`;
  $$('[data-demo]').forEach(b => b.onclick = () => { $('#lEmail').value = b.dataset.demo; $('#lPass').value = s.demoPassword; $('#lPass').focus(); });
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#loginForm button[type=submit]'); btn.disabled = true;
    try {
      await apiPost('/api/login', { email: $('#lEmail').value.trim(), password: $('#lPass').value });
      location.hash = '#home'; await boot();
    } catch (err) { $('#lErr').innerHTML = `<div class="alert red small">${esc(err.message)}</div>`; btn.disabled = false; }
  };
  $('#lEmail').focus();
}

// First run: create the SAO Office account (optionally with demo data to try the portal)
function renderSetup() {
  document.title = 'Set up - SAO Portal';
  $('#app').innerHTML = `<div class="login"><div class="login-card login-narrow">${loginHead}
    <h2>Welcome - let's set up the portal</h2>
    <p class="muted small">Create the SAO Office account. This account manages clubs, advisors and everyone's sign-in.</p>
    <form id="setupForm">
      <div class="field"><label for="sName">Office name</label><input id="sName" value="SAO Office"></div>
      <div class="field"><label for="sSign">Name on signatures (Youth Welfare Director)</label><input id="sSign" placeholder="e.g. Mr. Yehia Al-Razaz" required></div>
      <div class="field"><label for="sEmail">Email (to sign in)</label><input id="sEmail" type="email" autocomplete="username" required></div>
      <div class="form-row"><div class="field"><label for="sPass">Password</label><input id="sPass" type="password" autocomplete="new-password" required></div>
        <div class="field"><label for="sPass2">Repeat password</label><input id="sPass2" type="password" autocomplete="new-password" required></div></div>
      <label class="chk" style="margin:4px 0 14px"><input type="checkbox" id="sDemo"> Fill with demo data (16 sample clubs, requests and money) to try the portal</label>
      <div id="sErr"></div>
      <button class="btn key login-btn" type="submit">Create the SAO Office account</button>
      <p class="small muted" style="margin-top:10px">At least 8 characters with letters and numbers.</p>
    </form></div>${GUC_FOOT}</div>`;
  $('#setupForm').onsubmit = async e => {
    e.preventDefault();
    const err = msg => { $('#sErr').innerHTML = `<div class="alert red small">${esc(msg)}</div>`; };
    if ($('#sPass').value !== $('#sPass2').value) return err('The two passwords are different.');
    const btn = $('#setupForm button[type=submit]'); btn.disabled = true; btn.textContent = 'Setting up...';
    try {
      const demo = $('#sDemo').checked;
      await apiPost('/api/setup', { name: $('#sName').value.trim(), signName: $('#sSign').value.trim(), email: $('#sEmail').value.trim(),
        password: $('#sPass').value, demo, demoState: demo ? seed() : null });
      await apiPost('/api/login', { email: $('#sEmail').value.trim(), password: $('#sPass').value });
      location.hash = '#home'; await boot();
      toast('The portal is ready', 'success');
    } catch (ex) { err(ex.message); btn.disabled = false; btn.textContent = 'Create the SAO Office account'; }
  };
}

// Anyone: change their own password
function passwordModal() {
  openModal({
    title: '<h2>Change your password</h2>',
    body: `<div class="field"><label for="pCur">Current password</label><input id="pCur" type="password" autocomplete="current-password"></div>
      <div class="form-row"><div class="field"><label for="pNew">New password</label><input id="pNew" type="password" autocomplete="new-password"></div>
        <div class="field"><label for="pNew2">Repeat new password</label><input id="pNew2" type="password" autocomplete="new-password"></div></div>
      <p class="small muted">At least 8 characters with letters and numbers.</p>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="pSave">Change password</button>',
    onMount: m => {
      $('#pSave', m).onclick = () => {
        if ($('#pNew', m).value !== $('#pNew2', m).value) return toast('The two new passwords are different.', 'error');
        act('changePassword', { current: $('#pCur', m).value, next: $('#pNew', m).value }, 'Password changed');
      };
    },
  });
}

// SAO Office: everyone's sign-in (email + password)
function pageAccounts(el, u) {
  const groups = [['sao', 'SAO Office'], ['vp', 'Vice President'], ['clinic', 'GUC Clinic'], ['advisor', 'Academic Advisors'], ['rep', 'Club representatives']];
  const people = state.users.filter(x => !(x.role === 'rep' && clubById(x.clubId)?.archived));
  el.innerHTML = `<div class="page-head"><div><h1>Accounts</h1><p class="muted">Give each person an email and a password to sign in. They can change their password after signing in. Advisors and club reps are created on the Clubs page.</p></div>
      <div class="actions"><button class="btn primary" id="addAcc">+ Add account</button></div></div>
    ${groups.map(([role, label]) => { const list = people.filter(x => x.role === role); return !list.length ? '' : `<div class="card"><h2>${label}</h2><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>${role === 'rep' || role === 'advisor' ? 'Club' : 'Title'}</th><th>Email (sign-in)</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(x => { const ac = role === 'advisor' ? advisorClub(x.id) : null; return `<tr><td><b>${esc(x.name)}</b>${x.id === u.id ? ' <span class="small muted">(you)</span>' : ''}</td>
        <td>${role === 'rep' ? clubCell(x.clubId) : role === 'advisor' ? (ac ? clubCell(ac.id) : '<span class="badge amber">No club</span>') : esc(x.title || '')}</td>
        <td>${x.email ? esc(x.email) : '<span class="muted">-</span>'}</td>
        <td>${x.disabled ? '<span class="badge gray">Disabled</span>' : x.hasLogin ? '<span class="badge green">Can sign in</span>' : '<span class="badge amber">No login yet</span>'}</td>
        <td class="num"><button class="btn sm" data-acc="${x.id}">${x.hasLogin ? 'Edit' : 'Set login'}</button>
          ${x.id !== u.id ? `<button class="btn sm ${x.disabled ? '' : 'ghost-danger'}" data-dis="${x.id}" data-v="${x.disabled ? 0 : 1}">${x.disabled ? 'Enable' : 'Disable'}</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div></div>`; }).join('')}`;
  $('#addAcc').onclick = () => accountModal(null);
  $$('[data-acc]', el).forEach(b => b.onclick = () => accountModal(userById(b.dataset.acc)));
  $$('[data-dis]', el).forEach(b => b.onclick = () => {
    const x = userById(b.dataset.dis), disable = b.dataset.v === '1';
    if (disable && !confirm(`Disable ${x.name}? They will be signed out and cannot sign in until enabled again.`)) return;
    act('setAccountDisabled', { id: x.id, disabled: disable }, disable ? 'Account disabled' : 'Account enabled');
  });
}
function accountModal(x) {
  const isNew = !x;
  const randomPassword = () => { const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const a = new Uint32Array(10); crypto.getRandomValues(a); return [...a].map(n => c[n % c.length]).join('') + '7'; };
  openModal({
    title: `<h2>${isNew ? 'Add an account' : esc(x.name)}</h2>${isNew ? '' : `<div class="small muted">${esc(ROLE_LABEL[x.role])}</div>`}`,
    body: `${isNew ? `<div class="field"><label for="acRole">Role</label><select id="acRole"><option value="sao">SAO Office staff</option><option value="vp">Vice President</option><option value="clinic">GUC Clinic</option></select></div>` : ''}
      <div class="form-row"><div class="field"><label for="acName">Name</label><input id="acName" value="${esc(x?.name || '')}"></div>
        ${x?.role === 'rep' ? '' : `<div class="field"><label for="acTitle">Title</label><input id="acTitle" value="${esc(x?.title || '')}" placeholder="e.g. GUC Vice President"></div>`}</div>
      ${x?.role === 'rep' ? '' : `<div class="field"><label for="acSign">Name on signatures</label><input id="acSign" value="${esc(x?.signName || '')}" placeholder="e.g. Dr. Ehab Abo El-Kheir"></div>`}
      <div class="field"><label for="acEmail">Email (to sign in)</label><input id="acEmail" type="email" value="${esc(x?.email || '')}" placeholder="name@guc.edu.eg"></div>
      <div class="field"><label for="acPass">${x?.hasLogin ? 'New password (leave empty to keep the current one)' : 'Password'}</label>
        <div style="display:flex;gap:8px"><input id="acPass" type="text" autocomplete="off"><button class="btn sm" type="button" id="acGen">Generate</button></div>
        <span class="small muted">Give it to the person privately; they can change it after signing in.</span></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="acSave">Save</button>`,
    onMount: m => {
      $('#acGen', m).onclick = () => { $('#acPass', m).value = randomPassword(); };
      $('#acSave', m).onclick = () => act('saveAccount', {
        id: x?.id, role: isNew ? $('#acRole', m).value : x.role, name: $('#acName', m).value, title: $('#acTitle', m)?.value, signName: $('#acSign', m)?.value,
        email: $('#acEmail', m).value, password: $('#acPass', m).value || undefined,
      }, 'Account saved');
    },
  });
}

// ---------- Late submissions ----------
// Each club may submit LATE_LIMIT late requests. After the last one, late requests are blocked for
// LATE_BLOCK_MONTHS months; when the block ends the count starts again.
function lateInfo(clubId) {
  const club = clubById(clubId);
  const blockOver = club.lateBlockUntil && new Date(club.lateBlockUntil) <= new Date();   // the server resets it on the next request
  const since = blockOver ? club.lateBlockUntil : (club.lateResetAt || '');
  if (blockOver) return { used: 0, left: LATE_LIMIT, blockedUntil: null };
  const used = state.requests.filter(r => r.clubId === clubId && r.late && r.createdAt > since).length;
  return { used, left: Math.max(0, LATE_LIMIT - used), blockedUntil: club.lateBlockUntil || null };
}
function lateOverviewHTML() {
  const rows = activeClubs().map(c => ({ c, ...lateInfo(c.id) })).filter(x => x.used || x.blockedUntil).sort((a, b) => b.used - a.used);
  return `<div class="card"><h2>Late submissions by club</h2>${!rows.length ? '<div class="empty">No late submissions.</div>' : `<div class="table-wrap"><table><thead><tr><th>Club</th><th class="num">Used</th><th>Status</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td>${esc(x.c.name)}</td><td class="num">${x.used} / ${LATE_LIMIT}</td><td>${x.blockedUntil ? `<span class="badge red">Blocked until ${fmtDate(x.blockedUntil)}</span>` : `<span class="badge amber">${x.left} left</span>`}</td></tr>`).join('')}
    </tbody></table></div>`}</div>`;
}
const needsHardCopy = r => !!(r.data?.design || needsDesign(r.data?.services));
// An expense still waiting for signatures that is larger than the club's current balance
// (only the SAO Office receives club balances, so only they see this warning)
const overBalance = r => r.type === 'expense' && inProgress(r) && me()?.role === 'sao' && r.amount > clubFinance(r.clubId).balance;

// ---------- AI memo draft ----------
// The server asks Claude for a draft. Without API credentials it answers 503 and a simple ready-made draft is used.
function basicMemoDraft(x) {
  return `The ${x.club} kindly requests approval to spend ${x.amount ? money(x.amount) : 'the requested amount'} from the club account${x.subject ? ' for ' + x.subject.charAt(0).toLowerCase() + x.subject.slice(1) : ''}.\n\n${x.justification || ''}\n\nWe would be grateful for your approval of this request.`;
}
async function aiDraftMemo(m, ctx) {
  const v = k => ($('#' + fid(k), m)?.value || '').trim();
  const input = { club: ctx.club.name, requestedBy: v('requestedBy'), advisor: userById(ctx.club.advisorId)?.name || '',
    amount: v('amount'), subject: v('memoSubject'), justification: v('justification'), current: v('memoBody') };
  if (!input.amount || !input.justification) return toast('Fill in the amount and the justification first.', 'error');
  const btn = $('#aiDraft', m), status = $('#aiStatus', m);
  btn.disabled = true; status.textContent = 'Drafting...';
  try {
    const res = await fetch(API + '/api/memo-draft', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json', 'X-SAO': '1' }, body: JSON.stringify(input) });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.body) { $('#' + fid('memoBody'), m).value = out.body; status.textContent = 'AI draft inserted - review and edit it before submitting.'; }
    else if (out.error === 'ai_unavailable') { $('#' + fid('memoBody'), m).value = basicMemoDraft(input); status.textContent = 'AI is not set up on this server yet - a basic draft was inserted. Edit it as needed.'; }
    else { status.textContent = out.error || 'Could not draft the memo.'; }
  } catch (e) { $('#' + fid('memoBody'), m).value = basicMemoDraft(input); status.textContent = 'Could not reach the AI - a basic draft was inserted.'; }
  finally { btn.disabled = false; }
}
const saoChecks = r => (FORMS[r.type].saoChecks || []).filter(c => c.when(r.data || {}));

// ---------- Brand header & club logos ----------
function brandHeader(u, counts = {}, closed = false) {
  // The bell leads to whatever is waiting for this person
  const waiting = (counts.approvals || 0) + (counts.announcements || 0);
  const bellHref = counts.approvals ? '#approvals' : counts.announcements ? '#announcements' : '#home';
  return `<header class="topbar"><div class="topbar-inner">
      <button type="button" class="icon-btn menu-btn" data-act="side" aria-controls="sidebar" aria-expanded="${!closed}" title="${closed ? 'Open menu' : 'Close menu'}" aria-label="${closed ? 'Open menu' : 'Close menu'}">${icon('menu')}</button>
      <a class="sao-brand" href="#home" aria-label="SAO home">${SAO_MARK}<div class="sao-title"><b>SAO</b><span>Student Activities Office</span></div></a>
      <div class="spacer"></div>
      <a class="icon-btn bell" href="${bellHref}" title="${waiting ? waiting + ' waiting for you' : 'Nothing waiting'}" aria-label="${waiting ? waiting + ' items waiting for you' : 'Nothing waiting for you'}">${icon('bell')}${waiting ? `<i class="tab-badge">${waiting}</i>` : ''}</a>
      <button type="button" class="user-chip" data-act="account" aria-label="Account menu">${avatar(u)}<span class="who"><b>${esc(whoName(u))}</b><span>${esc(whoRole(u))}</span></span></button>
    </div><div class="tricolor"></div></header>`;
}
const LOGO_COLORS = ['#e31e24', '#1c1917', '#b8161b', '#a16207', '#57534e', '#7f1d1d'];
function clubLogo(clubId, size = '') {
  if (clubId === SAO_ACCOUNT) return `<img class="club-logo sao ${size}" src="assets/brand/sao-mark-color.svg" alt="SAO Office">`;
  const c = clubById(clubId);
  if (!c) return '';
  if (c.logo) return `<img class="club-logo ${size}" src="${c.logo}" alt="${esc(c.name)} logo">`;
  const initials = c.name.replace(/&/g, ' ').split(/\s+/).filter(w => /^[A-Za-z]/.test(w) && !/^(club|society|of|the|and)$/i.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || c.name[0];
  const color = LOGO_COLORS[[...c.id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % LOGO_COLORS.length];
  return `<span class="club-logo initials ${size}" style="background:${color}" aria-label="${esc(c.name)}">${esc(initials)}</span>`;
}
const clubCell = clubId => `<span class="club-cell">${clubLogo(clubId)}${esc(clubName(clubId))}</span>`;
// Shrinks an uploaded image so it stays small in storage (logos: 256px PNG/JPEG, posters: 1000px JPEG)
function resizeImage(file, max = 256, quality = 0.88) {
  if (!/^image\//.test(file.type)) return Promise.reject(new Error('Please choose an image (PNG, JPG or WebP).'));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(file.type === 'image/png' && max <= 256 ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('That file is not an image.'));
    img.src = URL.createObjectURL(file);
  });
}
const resizeLogo = file => resizeImage(file, 256, 0.88);
const annThumb = a => a.image
  ? `<button class="ann-thumb" data-ann-img="${a.id}" aria-label="View image"><img src="${a.image}" alt=""></button>`
  : '<span class="ann-thumb empty"><img src="assets/guc-emblem.png" alt=""></span>';
async function setClubLogo(clubId, file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) return toast('Please choose an image (PNG, JPG or SVG).', 'error');
  let logo;
  try { logo = await resizeLogo(file); } catch (e) { return toast(e.message, 'error'); }
  act('setClubLogo', { clubId, logo }, 'Logo updated');
}
function removeClubLogo(clubId) { act('setClubLogo', { clubId, logo: null }, 'Logo removed'); }

// Club reps: their club's profile and logo
function pageClub(el, u) {
  const c = clubById(u.clubId);
  el.innerHTML = `<div class="page-head"><div><h1>Club Profile</h1><p class="muted">Your club's logo appears on the sign-in screen, the announcement banner and your requests.</p></div></div>
    <div class="card"><div class="logo-upload">${clubLogo(c.id, 'lg')}
      <div><h2 style="margin-bottom:4px">${esc(c.name)}</h2>
        <div class="small muted" style="margin-bottom:10px">Academic Advisor: ${esc(userById(c.advisorId)?.name || 'not assigned yet - the SAO Office will add one')}</div>
        <div class="actions"><label class="btn primary" for="logoFile">${c.logo ? 'Change logo' : 'Upload logo'}</label>
          <input id="logoFile" type="file" accept="image/png,image/jpeg,image/svg+xml" class="hidden">
          ${c.logo ? '<button class="btn" id="logoRemove">Remove</button>' : ''}</div>
        <div class="small muted" style="margin-top:8px">PNG with a transparent background looks best. It is resized automatically.</div></div></div></div>`;
  $('#logoFile').onchange = e => setClubLogo(c.id, e.target.files[0]);
  if ($('#logoRemove')) $('#logoRemove').onclick = () => removeClubLogo(c.id);
}
// SAO Office: every club and its logo
// SAO Office: manage clubs and Academic Advisors (one advisor per club)
const advisorClub = advisorId => activeClubs().find(c => c.advisorId === advisorId);
const freeAdvisors = (exceptClubId) => state.users.filter(x => x.role === 'advisor' && !x.disabled && (!advisorClub(x.id) || advisorClub(x.id).id === exceptClubId));
function advisorPicker(id, currentId, exceptClubId) {
  const free = freeAdvisors(exceptClubId);
  const none = !currentId && (exceptClubId || !free.length);
  return `<select id="${id}">${free.map(a => `<option value="${a.id}" ${a.id === currentId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
    <option value="__none" ${none ? 'selected' : ''}>No advisor yet</option>
    <option value="__new">+ New advisor...</option></select>
    <input id="${id}New" class="hidden" placeholder="New advisor's full name, e.g. Dr. Nour Adel" style="margin-top:6px">`;
}
function bindAdvisorPicker(m, id) {
  const sel = $('#' + id, m), inp = $('#' + id + 'New', m);
  const upd = () => inp.classList.toggle('hidden', sel.value !== '__new');
  sel.onchange = upd; upd();
  // the chosen advisor (the server creates a new one when "__new" is chosen)
  return () => ({ advisorId: sel.value, newAdvisorName: inp.value.trim() });
}

function pageClubs(el) {
  const clubs = activeClubs();
  const advisors = state.users.filter(x => x.role === 'advisor' && !x.disabled);
  const removed = state.clubs.filter(c => c.archived);
  el.innerHTML = `<div class="page-head"><div><h1>Clubs</h1><p class="muted">${clubs.length} Active Working Groups. Each club has one Academic Advisor, and an advisor can advise only one club.</p></div>
      <div class="actions"><button class="btn primary" id="addClub">+ Add club</button></div></div>
    <div class="clubs-grid">${clubs.map(c => {
      const rep = state.users.find(x => x.role === 'rep' && x.clubId === c.id && !x.disabled);
      return `<div class="card club-card">${clubLogo(c.id, 'lg2')}
      <div class="info"><b>${esc(c.name)}</b>
        <div class="small muted">Advisor: ${c.advisorId ? esc(userById(c.advisorId)?.name || '-') : '<span class="badge amber">No advisor yet</span>'}</div>
        <div class="small muted">Rep: ${esc(rep?.name || '-')} &middot; Balance ${moneyShort(clubFinance(c.id).balance)}</div>
        <div class="actions"><button class="btn sm" data-edit-club="${c.id}">Edit</button>
          <label class="btn sm" for="lf-${c.id}">${c.logo ? 'Logo' : 'Add logo'}</label>
          <input id="lf-${c.id}" data-logo="${c.id}" type="file" accept="image/png,image/jpeg,image/svg+xml" class="hidden">
          <button class="btn sm ghost-danger" data-remove-club="${c.id}">Remove</button></div></div></div>`; }).join('')}</div>
    <div class="card" style="margin-top:16px"><div class="page-head" style="margin-bottom:8px"><div><h2>Academic Advisors</h2><p class="muted small">An advisor without a club can be given to a new club or removed.</p></div>
      <button class="btn sm" id="addAdvisor">+ Add advisor</button></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Club</th><th></th></tr></thead><tbody>
      ${advisors.map(a => { const c = advisorClub(a.id); return `<tr><td><b>${esc(a.name)}</b></td><td>${c ? clubCell(c.id) : '<span class="badge amber">No club</span>'}</td>
        <td class="num"><button class="btn sm" data-rename-adv="${a.id}">Rename</button> ${c ? '' : `<button class="btn sm ghost-danger" data-remove-adv="${a.id}">Remove</button>`}</td></tr>`; }).join('')}
      </tbody></table></div></div>
    ${removed.length ? `<div class="card" style="margin-top:16px"><h2>Removed clubs</h2><p class="muted small">Their past paperwork stays in the history. Remaining money was moved to the SAO Office account.</p>
      ${removed.map(c => `<div class="list-item">${clubCell(c.id)}<span class="small muted">removed ${fmtDate(c.archivedAt)}</span></div>`).join('')}</div>` : ''}`;
  $$('[data-logo]', el).forEach(i => i.onchange = e => setClubLogo(i.dataset.logo, e.target.files[0]));
  $('#addClub').onclick = () => clubModal(null);
  $$('[data-edit-club]', el).forEach(b => b.onclick = () => clubModal(clubById(b.dataset.editClub)));
  $$('[data-remove-club]', el).forEach(b => b.onclick = () => removeClubModal(clubById(b.dataset.removeClub)));
  $('#addAdvisor').onclick = () => advisorModal(null);
  $$('[data-rename-adv]', el).forEach(b => b.onclick = () => advisorModal(userById(b.dataset.renameAdv)));
  $$('[data-remove-adv]', el).forEach(b => b.onclick = () => {
    const a = userById(b.dataset.removeAdv);
    if (!confirm(`Remove ${a.name}? They will no longer be able to sign in.`)) return;
    act('removeAdvisor', { id: a.id }, 'Advisor removed');
  });
}

// Add a club, or edit its name / advisor / rep
function clubModal(club) {
  const rep = club && state.users.find(x => x.role === 'rep' && x.clubId === club.id && !x.disabled);
  openModal({
    title: `<h2>${club ? 'Edit club' : 'Add a club'}</h2>`,
    body: `<div class="field"><label for="cName">Club name</label><input id="cName" value="${esc(club?.name || '')}" placeholder="e.g. Astronomy Club"></div>
      <div class="field"><label for="cAdv">Academic Advisor</label>${advisorPicker('cAdv', club?.advisorId, club?.id)}
        <span class="small muted">Only advisors without a club are listed - an advisor can advise one club only.</span></div>
      <div class="field"><label for="cRep">Club representative (account name)</label><input id="cRep" value="${esc(rep?.name || '')}" placeholder="e.g. Astronomy Club Rep"></div>
      ${club && club.advisorId ? '<p class="small muted">If you change the advisor, requests waiting for the advisor\'s signature move to the new advisor.</p>' : ''}`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="cSave">${club ? 'Save' : 'Add club'}</button>`,
    onMount: m => {
      const pickAdvisor = bindAdvisorPicker(m, 'cAdv');
      $('#cSave', m).onclick = () => {
        const name = $('#cName', m).value.trim();
        if (!name) return toast('Type the club name.', 'error');
        act('saveClub', { id: club?.id, name, ...pickAdvisor(), repName: $('#cRep', m).value.trim() },
          club ? 'Club updated' : `${name} added - set the rep's sign-in on the Accounts page`);
      };
    },
  });
}

// Remove a club: its money goes to the SAO Office account, open requests are closed, the rep can no longer sign in
function removeClubModal(club) {
  const bal = clubFinance(club.id).balance;
  const open = state.requests.filter(r => r.clubId === club.id && inProgress(r));
  openModal({
    title: `<h2>Remove ${esc(club.name)}?</h2>`,
    body: `<div class="alert red">This removes the club from the portal.</div>
      <ul class="small" style="padding-left:18px;line-height:1.8">
        <li>${bal > 0 ? `The remaining balance of <b>${money(bal)}</b> moves to the <b>SAO Office account</b>.` : `The club's balance is ${money(bal)}; nothing is moved.`}</li>
        <li>${open.length ? `<b>${open.length}</b> request(s) still in progress will be closed.` : 'No requests are in progress.'}</li>
        <li>The club representative can no longer sign in, and the advisor becomes free for another club.</li>
        <li>Past paperwork stays in the history.</li></ul>
      <div class="field"><label for="rmConfirm">Type the club name to confirm</label><input id="rmConfirm" placeholder="${esc(club.name)}"></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn danger" id="rmGo">Remove club</button>`,
    onMount: m => {
      $('#rmGo', m).onclick = () => {
        if ($('#rmConfirm', m).value.trim().toLowerCase() !== club.name.toLowerCase()) return toast('Type the club name exactly to confirm.', 'error');
        act('removeClub', { id: club.id, confirmName: $('#rmConfirm', m).value.trim() }, `${club.name} removed`);
      };
    },
  });
}

// Add or rename an Academic Advisor
function advisorModal(adv) {
  openModal({
    title: `<h2>${adv ? 'Rename advisor' : 'Add an Academic Advisor'}</h2>`,
    body: `<div class="field"><label for="aName">Full name</label><input id="aName" value="${esc(adv?.name || '')}" placeholder="e.g. Dr. Nour Adel"></div>
      ${adv ? '' : '<p class="small muted">The new advisor has no club yet. Give them one by adding a club or editing a club.</p>'}`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="aSave">${adv ? 'Save' : 'Add advisor'}</button>`,
    onMount: m => {
      $('#aSave', m).onclick = () => {
        const name = $('#aName', m).value.trim();
        if (!name) return toast('Type the name.', 'error');
        act('saveAdvisor', { id: adv?.id, name }, adv ? 'Advisor renamed' : 'Advisor added - set their sign-in on the Accounts page');
      };
    },
  });
}

// ---------- Home ----------
function activeAnnouncements() {
  const t = todayISO();
  return state.announcements
    .filter(a => a.status === 'approved' && (!a.start || a.start <= t) && (!a.end || a.end >= t))
    .sort((a, b) => (b.reviewedAt || '').localeCompare(a.reviewedAt || ''));
}
const HERO_MS = 7000;
function bannerHTML() {
  const anns = activeAnnouncements();
  // the GUC logo sits still and transparent behind every slide, including slides with a photo
  const watermark = '<img class="hero-watermark" src="assets/guc-emblem.png" alt="">';
  if (!anns.length) return `<section class="hero" aria-label="Announcements">
    <article class="hero-slide active">${watermark}<div class="hero-text"><div class="hero-kicker"><span class="hero-tag">Announcements</span></div>
      <h2>No announcements right now</h2><p>Approved club announcements will appear here.</p></div></article></section>`;
  return `<section class="hero" aria-label="Announcements" aria-roledescription="carousel">
    ${anns.map((a, i) => `<article class="hero-slide ${i === 0 ? 'active' : ''} ${a.image ? 'has-image' : ''}" aria-label="${i + 1} of ${anns.length}">
      ${a.image ? `<div class="hero-bg" style="background-image:url('${a.image}')"></div><div class="hero-shade"></div>` : ''}${watermark}
      <div class="hero-text">
        <div class="hero-kicker"><span class="hero-tag">${a.clubId ? clubLogo(a.clubId) : '<img class="hero-tag-emblem" src="assets/brand/sao-mark-color.svg" alt="">'}${esc(clubName(a.clubId))}</span>
          ${a.end ? `<span class="hero-date">Until ${fmtDate(a.end)}</span>` : ''}
          ${a.image ? `<button class="hero-date hero-view" data-poster="${a.id}">View photo</button>` : ''}</div>
        <h2>${esc(a.title)}</h2><p>${esc(a.body)}</p>
      </div>
    </article>`).join('')}
    ${anns.length > 1 ? `<div class="hero-controls">
      <div class="hero-dots">${anns.map((_, i) => `<button class="${i === 0 ? 'active' : ''}" data-dot="${i}" aria-label="Show announcement ${i + 1}"></button>`).join('')}</div>
      <span class="hero-count"><b id="heroNum">1</b> / ${anns.length}</span>
      <div class="hero-arrows"><button id="heroPrev" aria-label="Previous announcement">&#8249;</button><button id="heroNext" aria-label="Next announcement">&#8250;</button></div>
    </div><div class="hero-progress"><span id="heroBar"></span></div>` : ''}
  </section>`;
}
function startBanner() {
  $$('[data-poster]').forEach(b => b.onclick = () => openPoster(state.announcements.find(a => a.id === b.dataset.poster)));
  const slides = $$('.hero-slide'), dots = $$('[data-dot]');
  if (slides.length < 2) return;
  let i = 0, paused = false;
  const bar = $('#heroBar');
  const restartBar = () => {
    if (!bar) return;
    bar.style.animation = 'none'; void bar.offsetWidth;
    bar.style.animation = `heroFill ${HERO_MS}ms linear forwards`;
    bar.style.animationPlayState = paused ? 'paused' : 'running';
  };
  const schedule = () => { clearTimeout(bannerTimer); if (!paused) bannerTimer = setTimeout(() => go(i + 1), HERO_MS); };
  const go = n => {
    slides[i].classList.remove('active'); dots[i].classList.remove('active');
    i = (n + slides.length) % slides.length;
    slides[i].classList.add('active'); dots[i].classList.add('active');
    $('#heroNum').textContent = i + 1;
    restartBar(); schedule();
  };
  dots.forEach(d => d.onclick = () => go(Number(d.dataset.dot)));
  $('#heroPrev').onclick = () => go(i - 1);
  $('#heroNext').onclick = () => go(i + 1);
  const hero = $('.hero');
  hero.onmouseenter = () => { paused = true; clearTimeout(bannerTimer); if (bar) bar.style.animationPlayState = 'paused'; };
  hero.onmouseleave = () => { paused = false; restartBar(); schedule(); };
  restartBar(); schedule();
}
function openPoster(a) {
  if (!a || !a.image) return;
  openModal({ wide: true, title: `<div class="small muted">${esc(clubName(a.clubId))}</div><h2>${esc(a.title)}</h2>`,
    body: `<img class="poster-full" src="${a.image}" alt="${esc(a.title)}"><p>${esc(a.body)}</p>` });
}
function requestTable(list, opts = {}) {
  if (!list.length) return `<div class="empty">${opts.empty || 'Nothing here yet.'}</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>ID</th>${opts.hideClub ? '' : '<th>Club</th>'}<th>Type</th><th>Title</th><th>Submitted</th><th>Status</th></tr></thead><tbody>
    ${list.map(r => `<tr class="clickable" data-req="${r.id}"><td>${r.id}</td>${opts.hideClub ? '' : `<td>${clubCell(r.clubId)}</td>`}<td>${esc(formName(r.type))}</td><td class="wrap">${esc(r.title)}${lateBadge(r)}</td><td>${fmtDate(r.createdAt)}</td><td>${statusBadge(r)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function bindRequestRows(el) { $$('[data-req]', el).forEach(tr => tr.onclick = () => openRequest(tr.dataset.req)); }

// A request as a row: form icon, title, form and date, then a status chip and the step it is at
function requestRowsHTML(list, opts = {}) {
  if (!list.length) return `<div class="empty-state">${icon(opts.emptyIcon || 'check', 'ic big')}<b>${esc(opts.emptyTitle || 'Nothing here yet')}</b><span>${esc(opts.empty || '')}</span></div>`;
  const step = r => {
    if (r.status === 'completed' || r.status === 'rejected') return '';
    const order = stagesFor(r), i = order.indexOf(r.status);
    return `<span class="steps" aria-label="Step ${i + 1} of ${order.length}">${order.map((_, j) => `<i class="${j < i ? 'done' : j === i ? 'now' : ''}"></i>`).join('')}</span>`;
  };
  return `<div class="req-list">${list.map(r => `<button type="button" class="req-row" data-req="${r.id}">
      <span class="req-ic ${r.status === 'completed' ? 'done' : r.status === 'rejected' ? 'back' : ''}">${icon(r.status === 'completed' ? 'approvals' : 'paperwork')}</span>
      <span class="req-main"><b>${esc(r.title)}</b><span>${opts.showClub ? esc(clubName(r.clubId)) + ' &middot; ' : ''}${esc(formName(r.type))} &middot; ${fmtDate(r.createdAt)}${r.late ? ' &middot; <em class="late">Late</em>' : ''}</span></span>
      <span class="req-side">${statusBadge(r)}${step(r)}</span>
    </button>`).join('')}</div>`;
}
const tile = (href, ic, title, sub, attrs = '') => `<a class="tile" href="${href}"${attrs}>${icon(ic)}<span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></a>`;
const BARS = '<span class="mini-bars" aria-hidden="true"><i></i><i></i><i></i></span>';

function pageHome(el, u) {
  const greet = `<div class="home-head"><div><p>${u.role === 'rep' ? 'Signed in as the representative of' : 'Signed in as'}</p><h1>${esc(whoName(u))}</h1>${u.role === 'rep' ? '' : `<p>${esc(whoRole(u))}</p>`}</div>${u.role === 'rep' ? clubLogo(u.clubId, 'lg2') : ''}</div>`;
  let body = '';
  if (u.role === 'rep') {
    const s = clubFinance(u.clubId);
    const mine = visibleRequests(u).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const li = lateInfo(u.clubId);
    const annPending = state.announcements.filter(a => a.clubId === u.clubId && a.status === 'pending').length;
    body = `<div class="home-grid">
      <div class="home-col">
        <section class="money-card">
          <div class="mc-top"><span class="mc-label">Club balance</span>${BARS}</div>
          <div class="mc-amount">${money(s.balance)}</div>
          <div class="mc-sub">${moneyShort(s.y.gross)} received in ${thisYear()} &middot; before 14% tax</div>
          <div class="mc-actions"><button type="button" class="btn key" id="hNewReq">${icon('plus')} New request</button><a class="btn ghost-light" href="#finance">${icon('finance')} Finance</a></div>
        </section>
        <div class="tiles">
          ${tile('#finance', 'report', 'Statement', 'PDF or Excel', ' id="hStatement"')}
          ${tile('#announcements', 'announcements', 'Announce', annPending ? `${annPending} waiting for SAO` : 'Post club news')}
          ${tile('#club', 'club', 'Club profile', 'Logo and details')}
          ${tile('#signature', 'signature', 'E-signature', 'Draw it once')}
        </div>
        <section class="card late-meter ${li.blockedUntil ? 'blocked' : ''}">
          <div><b>Late submissions</b><span>${li.blockedUntil ? `Late requests blocked until ${fmtDate(li.blockedUntil)}` : `${li.left} of ${LATE_LIMIT} left before a ${LATE_BLOCK_MONTHS}-month block`}</span></div>
          <span class="dots" aria-label="${li.used} of ${LATE_LIMIT} used">${Array.from({ length: LATE_LIMIT }, (_, i) => `<i class="${i < li.used ? 'used' : ''}"></i>`).join('')}</span>
        </section>
      </div>
      <section class="card list-card">
        <div class="list-head"><h2>Your requests</h2><a href="#paperwork">See all</a></div>
        ${requestRowsHTML(mine.slice(0, 6), { emptyIcon: 'paperwork', emptyTitle: 'No requests yet', empty: 'Tap New request to send your first form.' })}
      </section>
    </div>`;
  } else {
    const pending = pendingForMe(u);
    const vis = visibleRequests(u);
    const annPending = u.role === 'sao' ? state.announcements.filter(a => a.status === 'pending').length : 0;
    const card = `<section class="money-card">
        <div class="mc-top"><span class="mc-label">Waiting for your signature</span>${BARS}</div>
        <div class="mc-amount">${pending.length}</div>
        <div class="mc-sub">${pending.length ? `as ${esc(STAGE_LABEL[u.role])}` : 'You are all caught up.'}</div>
        <div class="mc-actions">${pending.length ? `<button type="button" class="btn key" id="hReview">${icon('signature')} Review &amp; sign</button>` : ''}<a class="btn ghost-light" href="#approvals">${icon('approvals')} All approvals</a></div>
      </section>`;
    const stats = u.role === 'sao' ? `<div class="stat-row">
        <a class="stat" href="#paperwork"><b>${vis.filter(inProgress).length}</b><span>In progress</span></a>
        <a class="stat" href="#paperwork"><b>${vis.filter(r => r.status === 'completed').length}</b><span>Fully approved</span></a>
        <a class="stat ${annPending ? 'attn' : ''}" href="#announcements"><b>${annPending}</b><span>News to review</span></a>
        <a class="stat" href="#clubs"><b>${activeClubs().length}</b><span>Clubs</span></a>
      </div>
      <div class="tiles">
        ${tile('#finance', 'finance', 'Finance', 'All club accounts')}
        ${tile('#clubs', 'clubs', 'Clubs', 'Clubs and advisors')}
        ${tile('#accounts', 'accounts', 'Accounts', 'Sign-ins')}
        ${tile('#announcements', 'announcements', 'News', annPending ? `${annPending} to review` : 'Banner')}
      </div>` : `<div class="tiles">
        ${tile('#approvals', 'approvals', 'Approvals', 'Everything waiting')}
        ${tile('#signature', 'signature', 'E-signature', 'Draw it once')}
      </div>`;
    body = `<div class="home-grid">
      <div class="home-col">${card}${stats}</div>
      <div class="home-col">
        <section class="card list-card">
          <div class="list-head"><h2>Waiting for you</h2><a href="#approvals">See all</a></div>
          ${requestRowsHTML(pending.slice(0, 6), { showClub: true, emptyTitle: 'All caught up', empty: 'Nothing is waiting for your signature.' })}
        </section>
        ${u.role === 'sao' ? lateOverviewHTML() : ''}
      </div>
    </div>`;
  }
  el.innerHTML = `${greet}${bannerHTML()}${body}`;
  bindRequestRows(el);
  if ($('#hNewReq', el)) $('#hNewReq', el).onclick = () => pickFormModal(u);
  if ($('#hStatement', el)) $('#hStatement', el).onclick = e => { e.preventDefault(); statementModal(u, u.clubId); };
  if ($('#hReview', el)) $('#hReview', el).onclick = () => openRequest(pendingForMe(u)[0].id);
  startBanner();
}

// ---------- Finance ----------
// Accounts: every club has its own account; the SAO Office has a separate account (id 'sao').
function yearStats(tx, year) {
  const ty = tx.filter(t => yearOf(t.date) === year);
  const dep = ty.filter(t => t.type === 'deposit');
  const out = ty.filter(t => t.type === 'withdraw');
  const sp = dep.filter(t => t.source === 'sponsor');
  const bySource = k => sum(dep.filter(t => t.source === k), t => t.gross);
  return {
    gross: sum(dep, t => t.gross), net: sum(dep, t => t.net), taxes: sum(dep, t => t.tax),
    out: sum(out, t => t.amount),
    sponsorAmount: bySource('sponsor'), sponsorDeals: sp.length, sponsorCount: new Set(sp.map(t => (t.sponsor || t.id).toLowerCase())).size,
    cash: bySource('cash'), other: bySource('other'), allocation: bySource('allocation'), transfer: bySource('transfer'),
    outByCat: OUT_CATEGORIES.map(c => sum(out.filter(t => (t.category || 'Other') === c), t => t.amount)),
    tx: ty,
  };
}
const txEffect = t => t.type === 'deposit' ? t.net : -t.amount;
function balanceAt(accountId, isoDay) { // balance at the end of that day
  return sum(state.transactions.filter(t => t.clubId === accountId && t.date <= isoDay), txEffect);
}
function clubFinance(clubId) {
  const tx = state.transactions.filter(t => t.clubId === clubId).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const balance = sum(tx, txEffect);
  return { tx, balance, y: yearStats(tx, thisYear()), ly: yearStats(tx, thisYear() - 1) };
}
const sourceLabels = accountId => accountId === SAO_ACCOUNT ? ['University allocation', 'Sponsors', 'Cash', 'Other', 'Transfers from removed clubs'] : ['Sponsors', 'Cash', 'Other'];
const sourceValues = (accountId, s) => accountId === SAO_ACCOUNT ? [s.allocation, s.sponsorAmount, s.cash, s.other, s.transfer] : [s.sponsorAmount, s.cash, s.other];
const PIE_COLORS = ['#E31E24', '#121212', '#FFD500', '#BDBDB6', '#B3141A', '#5C5C5C', '#FFF4B3', '#3A3A3A', '#FDE3E4'];
const pieOptions = { maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.label}: ${money(c.parsed)}` } } } };

function pageFinance(el, u) {
  let view = u.role === 'rep' ? u.clubId : financeSel;
  if (view !== 'all' && !canSeeFinance(u, view)) view = u.role === 'rep' ? u.clubId : 'all';
  const tabs = u.role === 'sao' ? `<div class="fin-tabs">
      <button data-fin="all" class="${view === 'all' ? 'active' : ''}">All clubs</button>
      <button data-fin="sao" class="${view === SAO_ACCOUNT ? 'active' : ''}">SAO Office account</button>
      <select id="clubSel" class="${view !== 'all' && view !== SAO_ACCOUNT ? 'active' : ''}"><option value="">One club...</option>${activeClubs().map(c => `<option value="${c.id}" ${c.id === view ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    </div>` : '';
  if (view === 'all') financeOverview(el, u, tabs); else clubFinancePage(el, u, view, tabs);
  $$('[data-fin]', el).forEach(b => b.onclick = () => { financeSel = b.dataset.fin; render(); });
  const sel = $('#clubSel', el);
  if (sel) sel.onchange = () => { if (sel.value) { financeSel = sel.value; render(); } };
}

function financeOverview(el, u, tabs) {
  const y = thisYear();
  const rows = activeClubs().map(c => ({ c, ...clubFinance(c.id) }));
  const total = k => sum(rows, r => r.y[k]);
  const sao = clubFinance(SAO_ACCOUNT);
  el.innerHTML = `${tabs}<div class="page-head"><div><h1>Finance - all clubs</h1><p class="muted">Only the SAO Office can see this overview. Each club sees only its own account. The SAO Office account is separate.</p></div>
      <div class="actions"><button class="btn primary" id="btnYearAll">Year report (all clubs)</button></div></div>
    <div class="grid kpis">
      <div class="card kpi accent"><div class="label">Total in club accounts</div><div class="value">${moneyShort(sum(rows, r => r.balance))}</div><div class="sub">${rows.length} clubs</div></div>
      <div class="card kpi"><div class="label">Money in ${y}</div><div class="value">${moneyShort(total('gross'))}</div><div class="sub">net ${moneyShort(total('net'))}</div></div>
      <div class="card kpi"><div class="label">Taxes deducted ${y}</div><div class="value">${moneyShort(total('taxes'))}</div><div class="sub">14% of every deposit</div></div>
      <div class="card kpi"><div class="label">Sponsorship deals ${y}</div><div class="value">${sum(rows, r => r.y.sponsorDeals)}</div><div class="sub">${moneyShort(total('sponsorAmount'))}</div></div>
      <div class="card kpi clickable" data-fin="sao"><div class="label">SAO Office account</div><div class="value">${moneyShort(sao.balance)}</div><div class="sub">separate account - open</div></div>
    </div>
    <div class="grid two">
      <div class="card"><h2>Share of club money</h2><div class="chart-box"><canvas id="chShare"></canvas></div></div>
      <div class="card"><h2>Where club money came from - ${y}</h2><div class="chart-box"><canvas id="chSrcAll"></canvas></div></div>
      <div class="card"><h2>Where club money went - ${y}</h2><div class="chart-box"><canvas id="chOutAll"></canvas></div></div>
      <div class="card"><h2>Money in vs out by club - ${y}</h2><div class="chart-box"><canvas id="chInOut"></canvas></div></div>
    </div>
    <div class="card"><h2>Bank balance by club</h2><div class="chart-box" style="height:${Math.max(320, rows.length * 26)}px"><canvas id="chBal"></canvas></div></div>
    <div class="card"><h2>Clubs</h2><div class="table-wrap"><table><thead><tr><th>Club</th><th class="num">Balance</th><th class="num">In ${y} (gross)</th><th class="num">Out ${y}</th><th class="num">Sponsors ${y}</th><th class="num">vs ${y - 1} income</th></tr></thead><tbody>
      ${rows.map(r => { const d = r.ly.gross ? (r.y.gross - r.ly.gross) / r.ly.gross * 100 : 0; return `<tr class="clickable" data-club="${r.c.id}"><td>${clubCell(r.c.id)}</td><td class="num"><b>${money(r.balance)}</b></td><td class="num">${money(r.y.gross)}</td><td class="num">${money(r.y.out)}</td><td class="num">${r.y.sponsorCount}</td><td class="num ${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : ''}${d.toFixed(0)}%</td></tr>`; }).join('')}
    </tbody></table></div></div>`;
  $$('[data-club]', el).forEach(tr => tr.onclick = () => { financeSel = tr.dataset.club; render(); });
  $('#btnYearAll').onclick = () => reportModal(u, 'all');
  const sorted = [...rows].sort((a, b) => b.balance - a.balance);
  // pie: top 6 clubs + the rest
  const top = sorted.slice(0, 6), rest = sorted.slice(6);
  chart($('#chShare'), { type: 'pie', data: { labels: [...top.map(r => r.c.name), ...(rest.length ? [`Other ${rest.length} clubs`] : [])],
    datasets: [{ data: [...top.map(r => Math.max(0, r.balance)), ...(rest.length ? [sum(rest, r => Math.max(0, r.balance))] : [])], backgroundColor: PIE_COLORS, borderColor: '#fff' }] }, options: pieOptions });
  chart($('#chSrcAll'), { type: 'doughnut', data: { labels: ['Sponsors', 'Cash', 'Other'], datasets: [{ data: [total('sponsorAmount'), total('cash'), total('other')], backgroundColor: [COLORS.sponsor, COLORS.cash, COLORS.other], borderColor: '#fff' }] }, options: pieOptions });
  chart($('#chOutAll'), { type: 'doughnut', data: { labels: OUT_CATEGORIES, datasets: [{ data: OUT_CATEGORIES.map((_, i) => sum(rows, r => r.y.outByCat[i])), backgroundColor: PIE_COLORS, borderColor: '#fff' }] }, options: pieOptions });
  chart($('#chInOut'), { type: 'bar', data: { labels: rows.map(r => r.c.name), datasets: [
      { label: 'Money in (after tax)', data: rows.map(r => r.y.net), backgroundColor: COLORS.in, borderRadius: 3 },
      { label: 'Money out', data: rows.map(r => r.y.out), backgroundColor: COLORS.out, borderRadius: 3 }] },
    options: { maintainAspectRatio: false, plugins: { tooltip: moneyTooltip }, scales: { x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 45, font: { size: 10 } } } } } });
  chart($('#chBal'), { type: 'bar', data: { labels: sorted.map(r => r.c.name), datasets: [{ label: 'Balance', data: sorted.map(r => r.balance), backgroundColor: COLORS.in, borderRadius: 4 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => money(c.parsed.x) } } } } });
}

function clubFinancePage(el, u, clubId, tabs) {
  const f = clubFinance(clubId), y = thisYear(), isSao = clubId === SAO_ACCOUNT;
  const canEdit = (u.role === 'rep' && u.clubId === clubId) || u.role === 'sao';
  const years = [...new Set(f.tx.map(t => yearOf(t.date)))].sort((a, b) => b - a);
  const delta = (a, b) => b ? `${a >= b ? '+' : ''}${((a - b) / b * 100).toFixed(0)}% vs ${y - 1}` : '';
  el.innerHTML = `${tabs}<div class="page-head"><div style="display:flex;gap:14px;align-items:center">${clubLogo(clubId, 'md')}<div><h1>${esc(clubName(clubId))} - Bank account</h1>
      <p class="muted">${isSao ? 'The SAO Office account, separate from the clubs. University allocations and transfers are not taxed; other deposits have 14% tax.' : `Private to this club${u.role === 'sao' ? ' (you are viewing as SAO Office)' : ''}. A 14% tax is deducted from every amount added.`}</p></div></div>
      <div class="actions">${canEdit ? `<button class="btn success" id="btnDep">+ Add money</button><button class="btn" id="btnWd">- Withdraw money</button>` : ''}
        <button class="btn" id="btnStatement">Bank statement</button><button class="btn primary" id="btnYear">Year report</button></div></div>
    <div class="grid kpis">
      <div class="card kpi accent"><div class="label">Current balance</div><div class="value">${money(f.balance)}</div><div class="sub">after taxes and withdrawals</div></div>
      <div class="card kpi"><div class="label">Money in ${y}</div><div class="value">${moneyShort(f.y.gross)}</div><div class="sub">${delta(f.y.gross, f.ly.gross)}</div></div>
      ${isSao ? `<div class="card kpi"><div class="label">University allocation ${y}</div><div class="value">${moneyShort(f.y.allocation)}</div><div class="sub">no tax</div></div>` : ''}
      <div class="card kpi"><div class="label">Sponsors ${y}</div><div class="value">${f.y.sponsorCount}</div><div class="sub">${f.y.sponsorDeals} deals - ${moneyShort(f.y.sponsorAmount)}</div></div>
      <div class="card kpi"><div class="label">Cash in ${y}</div><div class="value">${moneyShort(f.y.cash)}</div><div class="sub">${delta(f.y.cash, f.ly.cash)}</div></div>
      <div class="card kpi"><div class="label">Taxes paid ${y}</div><div class="value">${moneyShort(f.y.taxes)}</div><div class="sub">14% of deposits</div></div>
      <div class="card kpi"><div class="label">Money out ${y}</div><div class="value">${moneyShort(f.y.out)}</div><div class="sub">${delta(f.y.out, f.ly.out)}</div></div>
    </div>
    <div class="grid two">
      <div class="card"><h2>Money in vs out by month - ${y}</h2><div class="chart-box"><canvas id="chMonthly"></canvas></div></div>
      <div class="card"><h2>${y} vs ${y - 1} - total income so far</h2><div class="chart-box"><canvas id="chCum"></canvas></div></div>
      <div class="card"><h2>Where the money came from - ${y}</h2><div class="chart-box"><canvas id="chSource"></canvas></div></div>
      <div class="card"><h2>Where the money went - ${y}</h2><div class="chart-box"><canvas id="chOut"></canvas></div></div>
    </div>
    <div class="card"><h2>Year comparison</h2><div class="chart-box"><canvas id="chCompare"></canvas></div></div>
    <div class="card"><div class="page-head" style="margin-bottom:8px"><h2>Transactions</h2>
      <select id="txYear" style="width:auto"><option value="">All years</option>${years.map(v => `<option ${v === y ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div id="txTable"></div></div>`;

  const drawTx = () => {
    const yv = $('#txYear').value;
    const list = f.tx.filter(t => !yv || yearOf(t.date) === Number(yv));
    $('#txTable').innerHTML = !list.length ? '<div class="empty">No transactions.</div> ' : `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Source / purpose</th><th class="num">Amount</th><th class="num">Tax 14%</th><th class="num">Effect on balance</th></tr></thead><tbody>
      ${list.map(t => t.type === 'deposit'
        ? `<tr><td>${fmtDate(t.date)}</td><td><span class="badge green">Money in</span></td><td class="wrap">${esc(SOURCES[t.source] || t.source)}${t.sponsor ? ': <b>' + esc(t.sponsor) + '</b>' : ''}${t.note ? ' <span class="muted">- ' + esc(t.note) + '</span>' : ''}</td><td class="num">${money(t.gross)}</td><td class="num ${t.tax ? 'neg' : 'muted'}">${t.tax ? '-' + money(t.tax) : 'no tax'}</td><td class="num pos">+${money(t.net)}</td></tr>`
        : `<tr><td>${fmtDate(t.date)}</td><td><span class="badge red">Money out</span></td><td class="wrap"><span class="badge gray">${esc(t.category || 'Other')}</span> ${esc(t.note)}${t.requestId ? ' <span class="muted">(' + esc(t.requestId) + ')</span>' : ''}</td><td class="num">${money(t.amount)}</td><td class="num muted">-</td><td class="num neg">-${money(t.amount)}</td></tr>`).join('')}
    </tbody></table></div>`;
  };
  $('#txYear').onchange = drawTx; drawTx();
  if (canEdit) { $('#btnDep').onclick = () => depositModal(u, clubId); $('#btnWd').onclick = () => withdrawModal(u, clubId, f.balance); }
  $('#btnStatement').onclick = () => statementModal(u, clubId);
  $('#btnYear').onclick = () => reportModal(u, clubId);

  // Charts
  const inM = Array(12).fill(0), outM = Array(12).fill(0);
  f.y.tx.forEach(t => { const m = monthOf(t.date); if (t.type === 'deposit') inM[m] += t.net; else outM[m] += t.amount; });
  chart($('#chMonthly'), { type: 'bar', data: { labels: MONTHS, datasets: [
      { label: 'Money in (after tax)', data: inM.map(round2), backgroundColor: COLORS.in, borderRadius: 4 },
      { label: 'Money out', data: outM.map(round2), backgroundColor: COLORS.out, borderRadius: 4 }] },
    options: { maintainAspectRatio: false, plugins: { tooltip: moneyTooltip } } });
  const cum = year => {
    const arr = Array(12).fill(0);
    f.tx.filter(t => t.type === 'deposit' && yearOf(t.date) === year).forEach(t => { arr[monthOf(t.date)] += t.gross; });
    let run = 0; const curM = new Date().getMonth();
    return arr.map((v, i) => (year === y && i > curM) ? null : round2(run += v));
  };
  chart($('#chCum'), { type: 'line', data: { labels: MONTHS, datasets: [
      { label: String(y), data: cum(y), borderColor: COLORS.out, backgroundColor: 'rgba(227,30,36,.10)', fill: true, tension: .3 },
      { label: String(y - 1), data: cum(y - 1), borderColor: COLORS.last, borderDash: [6, 4], tension: .3 }] },
    options: { maintainAspectRatio: false, plugins: { tooltip: moneyTooltip } } });
  chart($('#chSource'), { type: 'pie', data: { labels: sourceLabels(clubId), datasets: [{ data: sourceValues(clubId, f.y), backgroundColor: PIE_COLORS, borderColor: '#fff' }] }, options: pieOptions });
  chart($('#chOut'), { type: 'doughnut', data: { labels: OUT_CATEGORIES, datasets: [{ data: f.y.outByCat, backgroundColor: PIE_COLORS, borderColor: '#fff' }] }, options: pieOptions });
  chart($('#chCompare'), { type: 'bar', data: { labels: ['Total in', 'Sponsors', 'Cash', 'Money out', 'Taxes'], datasets: [
      { label: String(y - 1), data: [f.ly.gross, f.ly.sponsorAmount, f.ly.cash, f.ly.out, f.ly.taxes], backgroundColor: COLORS.last, borderRadius: 4 },
      { label: String(y), data: [f.y.gross, f.y.sponsorAmount, f.y.cash, f.y.out, f.y.taxes], backgroundColor: COLORS.out, borderRadius: 4 }] },
    options: { maintainAspectRatio: false, plugins: { tooltip: moneyTooltip } } });
}

function depositModal(u, clubId) {
  const isSao = clubId === SAO_ACCOUNT;
  openModal({
    title: `<h2>Add money</h2><div class="muted small">${esc(clubName(clubId))}</div>`,
    body: `<form id="depForm">
      <div class="form-row">
        <div class="field"><label for="dGross">Amount received (${CURRENCY})</label><input id="dGross" type="number" min="1" step="0.01" required placeholder="0.00"></div>
        <div class="field"><label for="dSrc">Source</label><select id="dSrc">${isSao ? '<option value="allocation">University allocation (no tax)</option>' : ''}<option value="cash">Cash</option><option value="sponsor">Sponsor</option><option value="other">Other</option></select></div>
      </div>
      <div class="form-row hidden" id="spField">
        <div class="field"><label for="dAgr">Approved sponsorship agreement</label><select id="dAgr"><option value="">None / not listed</option>${state.requests.filter(r => r.clubId === clubId && r.status === 'completed' && FORMS[r.type]?.sponsor).map(r => `<option value="${r.id}">${r.id} - ${esc(r.title)} (${money(r.amount)})</option>`).join('')}</select></div>
        <div class="field"><label for="dSponsor">Sponsor name</label><input id="dSponsor" placeholder="Company / organisation"></div>
      </div>
      <div class="form-row">
        <div class="field"><label for="dDate">Date</label><input id="dDate" type="date" value="${todayISO()}" max="${todayISO()}" required></div>
        <div class="field"><label for="dNote">Note</label><input id="dNote" placeholder="e.g. Ticket sales - Music Night"></div>
      </div>
      <div class="breakdown" id="dBreak"></div>
    </form>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn success" id="dSave">Add to bank account</button>`,
    onMount: m => {
      const taxFor = (g, src) => UNTAXED.includes(src) ? 0 : round2(g * TAX_RATE);
      const upd = () => {
        const g = Number($('#dGross', m).value) || 0, src = $('#dSrc', m).value, tax = taxFor(g, src);
        $('#dBreak', m).innerHTML = `<div><span>Amount received</span><span>${money(g)}</span></div><div class="${tax ? 'neg' : 'muted'}"><span>Tax (14%)</span><span>${tax ? '-' + money(tax) : 'not taxed'}</span></div><div class="total"><span>Added to balance</span><span class="pos">${money(g - tax)}</span></div>`;
        $('#spField', m).classList.toggle('hidden', src !== 'sponsor');
      };
      $('#dGross', m).oninput = upd; $('#dSrc', m).onchange = upd; upd();
      $('#dAgr', m).onchange = () => {
        const r = state.requests.find(x => x.id === $('#dAgr', m).value);
        if (r) { $('#dSponsor', m).value = r.data?.sponsorName || r.title; $('#dGross', m).value = r.amount; $('#dNote', m).value = `${r.id} - ${formName(r.type)}`; upd(); }
      };
      $('#dSave', m).onclick = () => {
        const gross = round2(Number($('#dGross', m).value)), source = $('#dSrc', m).value, sponsor = $('#dSponsor', m).value.trim();
        if (!(gross > 0)) return toast('Enter an amount greater than zero.', 'error');
        if (source === 'sponsor' && !sponsor) return toast('Enter the sponsor name.', 'error');
        act('deposit', { clubId, gross, source, sponsor, note: $('#dNote', m).value.trim(), date: $('#dDate', m).value || todayISO() },
          out => out.tax ? `${money(out.net)} added after 14% tax` : `${money(out.net)} added`);
      };
    },
  });
}

function withdrawModal(u, clubId, balance) {
  const approved = state.requests.filter(r => r.clubId === clubId && r.status === 'completed' && r.type === 'expense');
  openModal({
    title: `<h2>Withdraw money</h2><div class="muted small">${esc(clubName(clubId))} - available ${money(balance)}</div>`,
    body: `<div class="form-row">
        <div class="field"><label for="wAmt">Amount (${CURRENCY})</label><input id="wAmt" type="number" min="1" step="0.01" max="${balance}" required></div>
        <div class="field"><label for="wDate">Date</label><input id="wDate" type="date" value="${todayISO()}" max="${todayISO()}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label for="wCat">Category</label><select id="wCat">${OUT_CATEGORIES.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label for="wNote">Purpose</label><input id="wNote" placeholder="e.g. Printing banners for Tech Day" required></div>
      </div>
      ${clubId === SAO_ACCOUNT ? '' : `<div class="field"><label for="wReq">Linked approved paperwork (optional)</label><select id="wReq"><option value="">None</option>${approved.map(r => `<option value="${r.id}">${r.id} - ${esc(r.title)} (${money(r.amount)})</option>`).join('')}</select></div>`}`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn danger" id="wSave">Withdraw</button>`,
    onMount: m => {
      $('#wSave', m).onclick = () => {
        const amount = round2(Number($('#wAmt', m).value)), note = $('#wNote', m).value.trim();
        if (!(amount > 0)) return toast('Enter an amount greater than zero.', 'error');
        if (amount > balance) return toast(`Not enough money. Available: ${money(balance)}`, 'error');
        if (!note) return toast('Enter the purpose of this withdrawal.', 'error');
        act('withdraw', { clubId, amount, note, category: $('#wCat', m).value, requestId: $('#wReq', m)?.value || null, date: $('#wDate', m).value || todayISO() },
          `${money(amount)} withdrawn`);
      };
    },
  });
}

// ---------- Reports: bank statement and year report (PDF / Excel) ----------
let logoDataUrl = null;
async function gucLogo() {
  if (logoDataUrl) return logoDataUrl;
  const blob = await (await fetch('assets/guc-logo.jpg')).blob();
  return (logoDataUrl = await blobToDataURL(blob));
}
const accountNumber = id => id === SAO_ACCOUNT ? 'SAO-1-C15-01-000' : (clubById(id)?.accountNo || '-');
const fileSafe = s => String(s).replace(/[\\\\/:*?"<>|]+/g, '-');
function statementModal(u, accountId) {
  const y = thisYear();
  openModal({
    title: `<h2>Bank statement</h2><div class="muted small">${esc(clubName(accountId))}</div>`,
    body: `<div class="form-row"><div class="field"><label for="stFrom">From</label><input id="stFrom" type="date" value="${y}-01-01"></div>
      <div class="field"><label for="stTo">To</label><input id="stTo" type="date" value="${todayISO()}" max="${todayISO()}"></div></div>
      <div class="field"><label>Format</label><div class="radio-row"><label class="chk"><input type="radio" name="stFmt" value="pdf" checked> PDF</label><label class="chk"><input type="radio" name="stFmt" value="xlsx"> Excel</label></div></div>
      <p class="small muted">Lists every transaction in the period with the running balance, the opening and closing balance, and totals.</p>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="stGo">Download</button>`,
    onMount: m => {
      $('#stGo', m).onclick = async () => {
        const from = $('#stFrom', m).value, to = $('#stTo', m).value, fmt = $('input[name="stFmt"]:checked', m).value;
        if (!from || !to || to < from) return toast('Choose a valid period.', 'error');
        try { await (fmt === 'pdf' ? statementPDF : statementXLSX)(accountId, from, to); closeModal(); toast('Statement downloaded', 'success'); }
        catch (e) { toast('Could not build the statement: ' + e.message, 'error'); }
      };
    },
  });
}
function reportModal(u, accountId) {
  const tx = accountId === 'all' ? state.transactions.filter(t => t.clubId !== SAO_ACCOUNT) : state.transactions.filter(t => t.clubId === accountId);
  const years = [...new Set(tx.map(t => yearOf(t.date)))].sort((a, b) => b - a);
  openModal({
    title: `<h2>Year report</h2><div class="muted small">${accountId === 'all' ? 'All clubs' : esc(clubName(accountId))}</div>`,
    body: `<div class="form-row"><div class="field"><label for="yrYear">Year</label><select id="yrYear">${(years.length ? years : [thisYear()]).map(v => `<option>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Format</label><div class="radio-row"><label class="chk"><input type="radio" name="yrFmt" value="pdf" checked> PDF (with charts)</label><label class="chk"><input type="radio" name="yrFmt" value="xlsx"> Excel</label></div></div></div>
      <p class="small muted">${accountId === 'all' ? 'Totals for every club, charts, and a table per club.' : 'Summary, monthly figures, where the money came from and went, sponsors, and charts.'}</p>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="yrGo">Download</button>`,
    onMount: m => {
      $('#yrGo', m).onclick = async () => {
        const year = Number($('#yrYear', m).value), fmt = $('input[name="yrFmt"]:checked', m).value;
        const btn = $('#yrGo', m); btn.disabled = true; btn.textContent = 'Preparing...';
        try {
          if (accountId === 'all') await (fmt === 'pdf' ? allClubsPDF : allClubsXLSX)(year);
          else await (fmt === 'pdf' ? yearPDF : yearXLSX)(accountId, year);
          closeModal(); toast('Report downloaded', 'success');
        } catch (e) { toast('Could not build the report: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Download'; }
      };
    },
  });
}

// --- data for the reports ---
function statementData(accountId, from, to) {
  const dayBefore = d => { const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() - 1); return isoDate(t.getFullYear(), t.getMonth(), t.getDate()); };
  const opening = balanceAt(accountId, dayBefore(from));
  const list = state.transactions.filter(t => t.clubId === accountId && t.date >= from && t.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let bal = opening;
  const rows = list.map(t => {
    bal = round2(bal + txEffect(t));
    const desc = t.type === 'deposit' ? `${SOURCES[t.source] || t.source}${t.sponsor ? ': ' + t.sponsor : ''}${t.note ? ' - ' + t.note : ''}` : `${t.category || 'Other'} - ${t.note}${t.requestId ? ' (' + t.requestId + ')' : ''}`;
    return { date: t.date, desc, gross: t.type === 'deposit' ? t.gross : 0, tax: t.type === 'deposit' ? t.tax : 0, out: t.type === 'withdraw' ? t.amount : 0, balance: bal };
  });
  return { opening, closing: bal, rows, totalIn: sum(rows, r => r.gross), totalTax: sum(rows, r => r.tax), totalOut: sum(rows, r => r.out) };
}
function yearData(accountId, year) {
  const tx = state.transactions.filter(t => t.clubId === accountId);
  const s = yearStats(tx, year);
  const months = MONTHS.map((name, i) => {
    const mt = s.tx.filter(t => monthOf(t.date) === i);
    const dep = mt.filter(t => t.type === 'deposit');
    const gross = sum(dep, t => t.gross), tax = sum(dep, t => t.tax), out = sum(mt.filter(t => t.type === 'withdraw'), t => t.amount);
    return { name, gross, tax, net: round2(gross - tax), out, change: round2(gross - tax - out) };
  });
  const sponsors = s.tx.filter(t => t.type === 'deposit' && t.source === 'sponsor').sort((a, b) => a.date.localeCompare(b.date));
  return { s, ly: yearStats(tx, year - 1), months, sponsors, opening: balanceAt(accountId, `${year - 1}-12-31`), closing: balanceAt(accountId, `${year}-12-31`) };
}

// --- charts as images for the PDF ---
function chartImage(cfg, w = 900, h = 420) {
  if (!window.Chart) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.style.cssText = 'position:fixed;left:-10000px;top:0'; document.body.appendChild(c);
  const ch = new Chart(c, { ...cfg, options: { ...(cfg.options || {}), responsive: false, animation: false, devicePixelRatio: 2, maintainAspectRatio: false } });
  const url = c.toDataURL('image/png');
  ch.destroy(); c.remove();
  return url;
}
const pdfPie = (labels, data) => chartImage({ type: 'pie', data: { labels, datasets: [{ data, backgroundColor: PIE_COLORS, borderColor: '#fff' }] },
  options: { plugins: { legend: { position: 'right', labels: { font: { size: 15 }, boxWidth: 16 } } } } }, 900, 420);

// --- PDF building blocks ---
const PDF_RED = [227, 30, 36], PDF_BLACK = [20, 20, 20], PDF_GREY = [107, 101, 96];
async function pdfStart(title, subtitle) {
  if (!window.jspdf) throw new Error('the PDF library did not load (needs internet)');
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 15;
  const logo = await gucLogo();
  doc.addImage(logo, 'JPEG', M, 10, 34, 17);
  doc.setDrawColor(220, 220, 220); doc.line(M + 38, 11, M + 38, 26);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...PDF_RED); doc.text('SAO', M + 42, 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...PDF_GREY); doc.text('Student Activities Office', M + 42, 23.5);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...PDF_BLACK); doc.text(title, W - M, 17, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...PDF_GREY); doc.text(subtitle, W - M, 23, { align: 'right' });
  // tricolour line
  doc.setFillColor(...PDF_BLACK); doc.rect(0, 31, W / 3, 1.4, 'F');
  doc.setFillColor(...PDF_RED); doc.rect(W / 3, 31, W / 3, 1.4, 'F');
  doc.setFillColor(255, 210, 0); doc.rect(2 * W / 3, 31, W / 3, 1.4, 'F');
  doc.setTextColor(...PDF_BLACK);
  return { doc, W, M, y: 40 };
}
function pdfInfo(p, pairs) {
  const { doc, M } = p;
  doc.setFontSize(9.5);
  pairs.forEach(([k, v], i) => {
    const x = M + (i % 2) * 92, yy = p.y + Math.floor(i / 2) * 6;
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...PDF_GREY); doc.text(k, x, yy);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_BLACK); doc.text(String(v), x + 30, yy);
  });
  p.y += Math.ceil(pairs.length / 2) * 6 + 3;
}
function pdfBoxes(p, boxes) {
  const { doc, M, W } = p, gap = 4, n = boxes.length, bw = (W - 2 * M - gap * (n - 1)) / n;
  boxes.forEach(([label, value, dark], i) => {
    const x = M + i * (bw + gap);
    if (dark) { doc.setFillColor(...PDF_BLACK); } else { doc.setFillColor(247, 246, 245); }
    doc.roundedRect(x, p.y, bw, 18, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...(dark ? [255, 210, 0] : PDF_GREY)); doc.text(label.toUpperCase(), x + 3, p.y + 6);
    // large amounts shrink to fit the box
    let fs = 11.5; doc.setFontSize(fs);
    while (doc.getTextWidth(value) > bw - 6 && fs > 6.5) { fs -= 0.5; doc.setFontSize(fs); }
    doc.setTextColor(...(dark ? [255, 255, 255] : PDF_BLACK)); doc.text(value, x + 3, p.y + 13.5);
  });
  doc.setTextColor(...PDF_BLACK);
  p.y += 24;
}
function pdfHeading(p, text) {
  const { doc, M } = p;
  if (p.y > 260) { doc.addPage(); p.y = 18; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...PDF_RED); doc.text(text, M, p.y);
  doc.setTextColor(...PDF_BLACK); p.y += 3;
}
function pdfTable(p, head, body, opts = {}) {
  p.doc.autoTable({ startY: p.y, head: [head], body, margin: { left: p.M, right: p.M }, theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, lineColor: [231, 229, 228], lineWidth: .2 },
    headStyles: { fillColor: PDF_BLACK, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    columnStyles: opts.columnStyles || {}, foot: opts.foot ? [opts.foot] : undefined,
    footStyles: { fillColor: [255, 246, 204], textColor: PDF_BLACK, fontStyle: 'bold' } });
  p.y = p.doc.lastAutoTable.finalY + 8;
}
function pdfImage(p, url, h = 70) {
  if (!url) return;
  if (p.y + h > 280) { p.doc.addPage(); p.y = 18; }
  const w = h * 900 / 420;
  p.doc.addImage(url, 'PNG', p.M, p.y, Math.min(w, p.W - 2 * p.M), h);
  p.y += h + 6;
}
function pdfFinish(p, filename) {
  const { doc, W } = p, n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(...PDF_GREY); doc.setFont('helvetica', 'normal');
    doc.text(`German University in Cairo - Student Activities Office - generated ${fmtDateTime(new Date().toISOString())}`, p.M, 290);
    doc.text(`Page ${i} of ${n}`, W - p.M, 290, { align: 'right' });
  }
  saveBlob(doc.output('blob'), filename);
  window.__lastReport = { name: filename, pages: n };
}
const num = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const right = { halign: 'right' };

// --- bank statement ---
async function statementPDF(accountId, from, to) {
  const d = statementData(accountId, from, to);
  const p = await pdfStart('Bank Statement', `${fmtDate(from)} - ${fmtDate(to)}`);
  pdfInfo(p, [['Account', clubName(accountId)], ['Account no.', accountNumber(accountId)], ['Period', `${fmtDate(from)} to ${fmtDate(to)}`], ['Currency', CURRENCY]]);
  pdfBoxes(p, [['Opening balance', money(d.opening)], ['Money in (gross)', money(d.totalIn)], ['Taxes (14%)', money(d.totalTax)], ['Money out', money(d.totalOut)], ['Closing balance', money(d.closing), true]]);
  pdfTable(p, ['Date', 'Description', 'Money in', 'Tax', 'Money out', 'Balance'],
    [[fmtDate(from), 'Opening balance', '', '', '', num(d.opening)], ...d.rows.map(r => [fmtDate(r.date), r.desc, r.gross ? num(r.gross) : '', r.tax ? num(r.tax) : '', r.out ? num(r.out) : '', num(r.balance)])],
    { columnStyles: { 0: { cellWidth: 22 }, 2: right, 3: right, 4: right, 5: { halign: 'right', fontStyle: 'bold' } },
      foot: ['', 'Totals / closing balance', num(d.totalIn), num(d.totalTax), num(d.totalOut), num(d.closing)] });
  pdfFinish(p, fileSafe(`Bank statement - ${clubName(accountId)} - ${from} to ${to}.pdf`));
}
function statementXLSX(accountId, from, to) {
  if (!window.XLSX) throw new Error('the Excel library did not load (needs internet)');
  const d = statementData(accountId, from, to);
  const aoa = [['Student Activities Office - Bank Statement'], ['Account', clubName(accountId)], ['Account no.', accountNumber(accountId)], ['Period', from, to], [],
    ['Date', 'Description', 'Money in', 'Tax 14%', 'Money out', 'Balance'], [from, 'Opening balance', null, null, null, d.opening],
    ...d.rows.map(r => [r.date, r.desc, r.gross || null, r.tax || null, r.out || null, r.balance]),
    [], ['', 'Totals', d.totalIn, d.totalTax, d.totalOut, d.closing]];
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 12 }, { wch: 60 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Statement');
  const name = fileSafe(`Bank statement - ${clubName(accountId)} - ${from} to ${to}.xlsx`);
  saveBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  window.__lastReport = { name, rows: d.rows.length };
}

// --- year report (one account) ---
async function yearPDF(accountId, year) {
  const d = yearData(accountId, year), s = d.s;
  const p = await pdfStart(`Annual Financial Report ${year}`, clubName(accountId));
  pdfInfo(p, [['Account', clubName(accountId)], ['Account no.', accountNumber(accountId)], ['Year', year], ['Currency', CURRENCY]]);
  pdfBoxes(p, [['Opening balance', money(d.opening)], ['Money in (gross)', money(s.gross)], ['Taxes paid', money(s.taxes)], ['Money out', money(s.out)], ['Closing balance', money(d.closing), true]]);
  const change = (a, b) => b ? `${a >= b ? '+' : ''}${((a - b) / b * 100).toFixed(0)}%` : '-';
  pdfHeading(p, 'Summary');
  pdfTable(p, ['', String(year), String(year - 1), 'Change'], [
    ['Money in (gross)', num(s.gross), num(d.ly.gross), change(s.gross, d.ly.gross)],
    ['Taxes paid (14%)', num(s.taxes), num(d.ly.taxes), change(s.taxes, d.ly.taxes)],
    ['Money out', num(s.out), num(d.ly.out), change(s.out, d.ly.out)],
    ['Sponsors (number / deals)', `${s.sponsorCount} / ${s.sponsorDeals}`, `${d.ly.sponsorCount} / ${d.ly.sponsorDeals}`, ''],
    ['Sponsorship amount', num(s.sponsorAmount), num(d.ly.sponsorAmount), change(s.sponsorAmount, d.ly.sponsorAmount)],
    ['Cash in', num(s.cash), num(d.ly.cash), change(s.cash, d.ly.cash)],
  ], { columnStyles: { 1: right, 2: right, 3: right } });
  pdfHeading(p, 'Money in vs out by month');
  pdfImage(p, chartImage({ type: 'bar', data: { labels: MONTHS, datasets: [
    { label: 'Money in (after tax)', data: d.months.map(m => m.net), backgroundColor: COLORS.in },
    { label: 'Money out', data: d.months.map(m => m.out), backgroundColor: COLORS.out }] },
    options: { plugins: { legend: { labels: { font: { size: 15 } } } }, scales: { x: { ticks: { font: { size: 14 } } }, y: { ticks: { font: { size: 13 } } } } } }), 70);
  pdfTable(p, ['Month', 'Money in (gross)', 'Tax', 'Net in', 'Money out', 'Net change'],
    d.months.map(m => [m.name, num(m.gross), num(m.tax), num(m.net), num(m.out), num(m.change)]),
    { columnStyles: { 1: right, 2: right, 3: right, 4: right, 5: right }, foot: ['Total', num(s.gross), num(s.taxes), num(s.net), num(s.out), num(s.net - s.out)] });
  pdfHeading(p, 'Where the money came from');
  pdfImage(p, pdfPie(sourceLabels(accountId), sourceValues(accountId, s)), 62);
  pdfHeading(p, 'Where the money went');
  pdfImage(p, pdfPie(OUT_CATEGORIES, s.outByCat), 62);
  pdfTable(p, ['Category', 'Amount', 'Share'], OUT_CATEGORIES.map((c, i) => [c, num(s.outByCat[i]), s.out ? (s.outByCat[i] / s.out * 100).toFixed(1) + '%' : '-']),
    { columnStyles: { 1: right, 2: right }, foot: ['Total', num(s.out), '100%'] });
  if (d.sponsors.length) {
    pdfHeading(p, 'Sponsors');
    pdfTable(p, ['Date', 'Sponsor', 'Amount (gross)', 'Tax', 'Net'], d.sponsors.map(t => [fmtDate(t.date), t.sponsor || '-', num(t.gross), num(t.tax), num(t.net)]),
      { columnStyles: { 2: right, 3: right, 4: right } });
  }
  pdfFinish(p, fileSafe(`Year report ${year} - ${clubName(accountId)}.pdf`));
}
function yearXLSX(accountId, year) {
  if (!window.XLSX) throw new Error('the Excel library did not load (needs internet)');
  const d = yearData(accountId, year), s = d.s, wb = XLSX.utils.book_new();
  const add = (name, aoa, cols) => { const ws = XLSX.utils.aoa_to_sheet(aoa); if (cols) ws['!cols'] = cols.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
  add('Summary', [[`Annual Financial Report ${year}`], ['Account', clubName(accountId)], ['Account no.', accountNumber(accountId)], [],
    ['', year, year - 1], ['Opening balance', d.opening, null], ['Money in (gross)', s.gross, d.ly.gross], ['Taxes paid', s.taxes, d.ly.taxes], ['Money out', s.out, d.ly.out],
    ['Sponsors', s.sponsorCount, d.ly.sponsorCount], ['Sponsorship amount', s.sponsorAmount, d.ly.sponsorAmount], ['Cash in', s.cash, d.ly.cash], ['Closing balance', d.closing, null]], [26, 16, 16]);
  add('Monthly', [['Month', 'Money in (gross)', 'Tax', 'Net in', 'Money out', 'Net change'], ...d.months.map(m => [m.name, m.gross, m.tax, m.net, m.out, m.change]),
    ['Total', s.gross, s.taxes, s.net, s.out, round2(s.net - s.out)]], [10, 16, 12, 14, 14, 14]);
  add('Money in by source', [['Source', 'Amount'], ...sourceLabels(accountId).map((l, i) => [l, sourceValues(accountId, s)[i]])], [30, 16]);
  add('Money out by category', [['Category', 'Amount'], ...OUT_CATEGORIES.map((c, i) => [c, s.outByCat[i]])], [26, 16]);
  add('Transactions', [['Date', 'Type', 'Source / category', 'Description', 'Gross', 'Tax', 'Net / out'],
    ...s.tx.slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => t.type === 'deposit'
      ? [t.date, 'Money in', SOURCES[t.source] || t.source, [t.sponsor, t.note].filter(Boolean).join(' - '), t.gross, t.tax, t.net]
      : [t.date, 'Money out', t.category || 'Other', t.note, null, null, -t.amount])], [12, 11, 22, 50, 14, 12, 14]);
  const name = fileSafe(`Year report ${year} - ${clubName(accountId)}.xlsx`);
  saveBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  window.__lastReport = { name, sheets: wb.SheetNames };
}

// --- year report (all clubs) ---
function allClubsData(year) {
  const rows = activeClubs().map(c => ({ c, ...yearData(c.id, year) }));
  const t = k => sum(rows, r => r.s[k]);
  return { rows, gross: t('gross'), taxes: t('taxes'), net: t('net'), out: t('out'), sponsorAmount: t('sponsorAmount'), sponsorDeals: t('sponsorDeals'), cash: t('cash'), other: t('other'),
    closing: sum(rows, r => r.closing), outByCat: OUT_CATEGORIES.map((_, i) => sum(rows, r => r.s.outByCat[i])) };
}
async function allClubsPDF(year) {
  const d = allClubsData(year);
  const p = await pdfStart(`Annual Financial Report ${year}`, 'All clubs');
  pdfInfo(p, [['Clubs', d.rows.length], ['Year', year], ['Currency', CURRENCY], ['Prepared by', 'SAO Office']]);
  pdfBoxes(p, [['Money in (gross)', money(d.gross)], ['Taxes paid', money(d.taxes)], ['Money out', money(d.out)], ['Sponsorship', money(d.sponsorAmount)], ['Total balance', money(d.closing), true]]);
  pdfHeading(p, 'Balance by club at year end');
  const sorted = [...d.rows].sort((a, b) => b.closing - a.closing);
  pdfImage(p, chartImage({ type: 'bar', data: { labels: sorted.map(r => r.c.name), datasets: [{ label: 'Balance', data: sorted.map(r => r.closing), backgroundColor: COLORS.out }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { y: { ticks: { font: { size: 13 } } } } } }, 900, 520), 82);
  pdfHeading(p, 'Clubs');
  pdfTable(p, ['Club', 'Money in', 'Taxes', 'Money out', 'Sponsors', 'Balance (year end)'],
    d.rows.map(r => [r.c.name, num(r.s.gross), num(r.s.taxes), num(r.s.out), String(r.s.sponsorCount), num(r.closing)]),
    { columnStyles: { 1: right, 2: right, 3: right, 4: right, 5: { halign: 'right', fontStyle: 'bold' } }, foot: ['Total', num(d.gross), num(d.taxes), num(d.out), String(sum(d.rows, r => r.s.sponsorCount)), num(d.closing)] });
  pdfHeading(p, 'Where club money came from');
  pdfImage(p, pdfPie(['Sponsors', 'Cash', 'Other'], [d.sponsorAmount, d.cash, d.other]), 62);
  pdfHeading(p, 'Where club money went');
  pdfImage(p, pdfPie(OUT_CATEGORIES, d.outByCat), 62);
  pdfFinish(p, `Year report ${year} - All clubs.pdf`);
}
function allClubsXLSX(year) {
  if (!window.XLSX) throw new Error('the Excel library did not load (needs internet)');
  const d = allClubsData(year), wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[`Annual Financial Report ${year} - All clubs`], [],
    ['Club', 'Opening balance', 'Money in (gross)', 'Taxes', 'Money out', 'Sponsors', 'Sponsorship amount', 'Balance (year end)'],
    ...d.rows.map(r => [r.c.name, r.opening, r.s.gross, r.s.taxes, r.s.out, r.s.sponsorCount, r.s.sponsorAmount, r.closing]),
    ['Total', sum(d.rows, r => r.opening), d.gross, d.taxes, d.out, sum(d.rows, r => r.s.sponsorCount), d.sponsorAmount, d.closing]]);
  ws['!cols'] = [{ wch: 26 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Clubs');
  const ws2 = XLSX.utils.aoa_to_sheet([['Category', 'Amount'], ...OUT_CATEGORIES.map((c, i) => [c, d.outByCat[i]])]); ws2['!cols'] = [{ wch: 26 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Money out by category');
  const name = `Year report ${year} - All clubs.xlsx`;
  saveBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  window.__lastReport = { name, sheets: wb.SheetNames };
}

// ---------- Paperwork ----------
const pwFilter = { status: '', type: '', club: '', q: '' };
function pagePaperwork(el, u) {
  const clubs = visibleClubs(u);
  el.innerHTML = `<div class="page-head"><div><h1>Paperwork</h1><p class="muted">${u.role === 'rep' ? 'All requests from your club and where each one is in the approval chain.' : 'Requests from the clubs you can see.'}</p></div>
      ${u.role === 'rep' ? '<button class="btn primary" id="newReq">+ New request</button>' : ''}</div>
    <div class="card">
      <div class="filters">
        <input id="fQ" placeholder="Search title or ID" value="${esc(pwFilter.q)}">
        <select id="fStatus"><option value="">All statuses</option><option value="progress">In progress</option><option value="completed">Fully approved</option><option value="rejected">Rejected</option></select>
        <select id="fType"><option value="">All forms</option>${CATS.map(c => `<optgroup label="${c}">${Object.values(FORMS).filter(f => f.cat === c).map(f => `<option value="${f.key}">${esc(f.name)}</option>`).join('')}</optgroup>`).join('')}</select>
        ${u.role === 'rep' ? '' : `<select id="fClub"><option value="">All clubs</option>${clubs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`}
      </div>
      <div id="pwList"></div>
    </div>`;
  $('#fStatus').value = pwFilter.status; $('#fType').value = pwFilter.type; if ($('#fClub')) $('#fClub').value = pwFilter.club;
  const draw = () => {
    pwFilter.q = $('#fQ').value; pwFilter.status = $('#fStatus').value; pwFilter.type = $('#fType').value; pwFilter.club = $('#fClub')?.value || '';
    const q = pwFilter.q.toLowerCase();
    const list = visibleRequests(u).filter(r =>
      (!pwFilter.status || (pwFilter.status === 'progress' ? inProgress(r) : r.status === pwFilter.status)) &&
      (!pwFilter.type || r.type === pwFilter.type) && (!pwFilter.club || r.clubId === pwFilter.club) &&
      (!q || r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)));
    $('#pwList').innerHTML = requestTable(list, { hideClub: u.role === 'rep', empty: 'No requests match.' });
    bindRequestRows($('#pwList'));
  };
  ['fQ', 'fStatus', 'fType', 'fClub'].forEach(id => { const x = $('#' + id); if (x) x.addEventListener(id === 'fQ' ? 'input' : 'change', draw); });
  draw();
  if ($('#newReq')) $('#newReq').onclick = () => pickFormModal(u);
}

// ----- Form picker -----
function pickFormModal(u) {
  if (!clubById(u.clubId)?.advisorId) return toast('Your club has no Academic Advisor yet. Ask the SAO Office to assign one before sending papers.', 'error');
  openModal({
    wide: true,
    title: `<h2>New request</h2><div class="muted small">Choose the official form. It goes to your Academic Advisor, then the SAO Office Head, then the Vice President.</div>`,
    body: CATS.map(c => `<h3 class="form-h">${c}</h3><div class="picker">${Object.values(FORMS).filter(f => f.cat === c).map(f =>
      `<button class="pick" data-form="${f.key}"><b>${esc(f.name)}</b><span>${esc(f.blurb)}</span>${f.memo ? '<span class="badge amber" style="margin-top:6px">Memo required</span>' : ''}</button>`).join('')}</div>`).join(''),
    onMount: m => $$('[data-form]', m).forEach(b => b.onclick = () => formModal(u, b.dataset.form)),
  });
}

// ----- Form rendering -----
function formCtx(u) {
  const club = clubById(u.clubId);
  return { user: u, club, today: todayISO(), balance: clubFinance(club.id).balance, saoName: state.users.find(x => x.role === 'sao')?.signName || 'SAO Office Head',
    requests: state.requests.filter(r => r.clubId === club.id) };
}
const fid = k => 'f_' + k;
function fieldHTML(f, v, ctx) {
  const cls = `field ${f.half ? '' : 'full'}`;
  const lab = f.label ? `<label for="${fid(f.k)}">${esc(f.label)}${f.req ? ' <span class="req">*</span>' : ''}</label>` : '';
  const val = v ?? (f.def ? f.def(ctx) : '');
  switch (f.t) {
    case 'text': case 'tel': case 'date':
      return `<div class="${cls}">${lab}<input id="${fid(f.k)}" type="${f.t}" value="${esc(val)}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}></div>`;
    case 'number':
      return `<div class="${cls}">${lab}<input id="${fid(f.k)}" type="number" value="${esc(val)}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} step="${f.step || (f.money ? '0.01' : '1')}"></div>`;
    case 'textarea':
      return `<div class="${cls}">${lab}<textarea id="${fid(f.k)}" class="${f.small ? 'sm' : ''} ${f.tall ? 'tall' : ''}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}>${esc(val)}</textarea></div>`;
    case 'select':
      return `<div class="${cls}">${lab}<select id="${fid(f.k)}"><option value="">Choose...</option>${f.opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    case 'radio': {
      const isOther = f.other && val && !f.opts.includes(val);
      return `<div class="${cls}"><label>${esc(f.label)}${f.req ? ' <span class="req">*</span>' : ''}</label><div class="radio-row">${f.opts.map(o =>
        `<label class="chk"><input type="radio" name="${fid(f.k)}" value="${esc(o)}" ${(o === val || (o === 'Others' && isOther)) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}
        ${f.other ? `<input id="${fid(f.k)}_other" class="inline-other" placeholder="Specify" value="${isOther ? esc(val) : ''}">` : ''}</div></div>`;
    }
    case 'speakers':
      return `<div class="${cls}"><label>${esc(f.label)}</label>${Array.from({ length: f.n }, (_, i) => `<input id="${fid(f.k)}_${i}" placeholder="${i + 1}-" value="${esc((val || [])[i] || '')}" style="margin-bottom:6px">`).join('')}</div>`;
    case 'file':
      return `<div class="${cls}${f.showIf ? ' hidden' : ''}"${f.showIf ? ` data-showif="${f.showIf[0]}=${esc(f.showIf[1])}"` : ''}>${lab}<input id="${fid(f.k)}" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xlsx">${v?.name ? `<span class="small muted">Previously attached: ${esc(v.name)} (attach again)</span>` : ''}</div>`;
    case 'checkfiles':
      return `<div class="field full"><div class="docs">${f.items.map((it, i) => `<div class="doc-row"><span>${esc(it)}</span><input id="${fid(f.k)}_${i}" type="file" accept=".pdf,.jpg,.jpeg,.png"></div>`).join('')}</div><span class="small muted">Optional now - required at the cashier before the money is withdrawn.</span></div>`;
    case 'link': {
      const opts = ctx.requests.filter(r => f.linkTypes.includes(r.type) && r.status !== 'rejected');
      return `<div class="${cls}">${lab}<select id="${fid(f.k)}"><option value="">None</option>${opts.map(r => `<option value="${r.id}" ${r.id === val ? 'selected' : ''}>${r.id} - ${esc(r.title)} (${r.status === 'completed' ? 'approved' : 'in progress'})</option>`).join('')}</select></div>`;
    }
    case 'heading': return `<h3 class="form-h full">${esc(f.label)}</h3>`;
    case 'balance': return `<div class="full breakdown" id="balBox"></div>`;
    case 'memo':
      return `<div class="field full">${lab}<textarea id="${fid(f.k)}" class="tall" placeholder="${esc(f.ph || '')}">${esc(val)}</textarea>
        <div class="actions" style="margin-top:6px;align-items:center"><button class="btn sm primary" type="button" id="aiDraft">Draft with AI</button><span class="small muted" id="aiStatus">Uses the amount, justification and subject above. Review and edit the draft before submitting.</span></div></div>`;
    case 'signature': {
      const saved = state.signatures[ctx.user.id];
      return `<div class="field full">${lab}${saved ? `<img class="sig-preview" src="${saved}" alt="Your saved signature"><span class="small muted">Your saved e-signature will be used. Change it in My E-Signature.</span>`
        : `${padHTML('repPad')}<div class="actions" style="margin-top:6px"><button class="btn sm" id="repClear" type="button">Clear</button><label class="small"><input type="checkbox" id="repRemember" checked style="width:auto"> Save as my signature</label></div>`}</div>`;
    }
    default: return '';
  }
}
function servicesHTML(def, data) {
  if (!def.services) return '';
  const cur = data?.services || {};
  return `<h3 class="form-h full">Needed Services</h3><div class="full svc-grid">${def.services.map(g => {
    const G = SERVICE_GROUPS[g], c = cur[g] || { items: [], other: '' };
    const otherBox = G.other || G.specify ? `<input data-svc-other="${g}" placeholder="${G.other ? 'Others - specify' : 'Specify'}" value="${esc(c.other || '')}">` : '';
    return `<div class="svc"><b>${esc(G.label)}</b>${G.items.map((it, i) => `<label class="chk"><input type="checkbox" data-svc="${g}" value="${esc(it)}" ${c.items.includes(it) ? 'checked' : ''}> ${esc(it)}</label>`).join('')}
      ${otherBox}</div>`;
  }).join('')}</div>
  ${def.services.some(g => DESIGN_GROUPS.includes(g)) ? `<div class="full design-box hidden" id="designBox"><div class="field"><label for="f_design">Design <span class="req">*</span></label>
    <input id="f_design" type="file" accept=".pdf,.jpg,.jpeg,.png">${data?.design?.name ? `<span class="small muted">Previously attached: ${esc(data.design.name)} (attach again)</span>` : ''}</div>
    <div class="alert amber small" style="margin:0">You ticked a Marketing or Printing service, so the design must be uploaded here <b>and</b> a hard copy handed in at the SAO Office. The SAO Office cannot approve until the hard copy is received.</div></div>` : ''}`;
}
const needsDesign = services => DESIGN_GROUPS.some(g => (services?.[g]?.items || []).length);

function formModal(u, type, prev = null) {
  const def = FORMS[type], ctx = formCtx(u);
  const allFields = def.fields;
  openModal({
    wide: true,
    title: `<div class="small muted">${esc(def.cat)} &middot; ${esc(clubName(u.clubId))}</div><h2>${esc(def.name)}</h2>`,
    body: `${def.rules.length ? `<details class="rules" open><summary>Rules from the Student Activities Guide</summary><ul>${def.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>` : ''}
      ${prev ? '<div class="alert blue small">Copied from your rejected request. Fix what was asked, re-attach files, and submit again.</div>' : ''}
      <div id="deadlineWarn"></div>
      <div class="fgrid">
        <div class="field half"><label>AWG Name</label><input value="${esc(clubName(u.clubId))}" disabled></div>
        ${def.fields.map(f => fieldHTML(f, prev?.[f.k], ctx)).join('')}
        ${servicesHTML(def, prev)}
      </div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn key" id="fSubmit">Submit for approval</button>`,
    onMount: m => {
      const val = k => $('#' + fid(k), m)?.value || '';
      const live = () => {
        // 10-working-day notice
        const wd = def.deadline && val('startDate') ? workingDaysUntil(val('startDate')) : null;
        const late = wd != null && wd < def.deadline, li = late ? lateInfo(u.clubId) : null;
        $('#deadlineWarn', m).innerHTML = !late ? '' : li.blockedUntil
          ? `<div class="alert red small"><b>Late submission blocked.</b> Your club has used all ${LATE_LIMIT} late submissions, so late requests are blocked until ${fmtDate(li.blockedUntil)}. Choose a start date at least ${def.deadline} working days away.</div>`
          : `<div class="alert amber small"><b>Late submission:</b> only ${wd} working day(s) before the start date (the guide asks for ${def.deadline}). This will use late submission ${li.used + 1} of ${LATE_LIMIT}.${li.used + 1 >= LATE_LIMIT ? ` After this one, late requests are blocked for ${LATE_BLOCK_MONTHS} months.` : ''}</div>`;
        $$('[data-showif]', m).forEach(box => {
          const [k, v] = box.dataset.showif.split('=');
          box.classList.toggle('hidden', $(`input[name="${fid(k)}"]:checked`, m)?.value !== v);
        });
        const db = $('#designBox', m);
        if (db) db.classList.toggle('hidden', !DESIGN_GROUPS.some(g => $$(`[data-svc="${g}"]:checked`, m).length));
        // Expense: balance check
        const bb = $('#balBox', m);
        if (bb) {
          const amt = Number(val('amount')) || 0, rem = round2(ctx.balance - amt);
          bb.innerHTML = `<div><span>Available Balance</span><span>${money(ctx.balance)}</span></div><div><span>Requested Amount</span><span class="neg">-${money(amt)}</span></div>
            <div class="total"><span>Remaining Balance</span><span class="${rem < 0 ? 'neg' : 'pos'}">${money(rem)}</span></div>${rem < 0 ? '<div class="small neg">The club account does not have enough money for this expense.</div>' : ''}`;
        }
      };
      m.addEventListener('input', live); m.addEventListener('change', live); live();
      if ($('#repPad', m)) { m.repPad = createPad($('#repPad', m)); $('#repClear', m).onclick = () => m.repPad.clear(); }
      if ($('#aiDraft', m)) $('#aiDraft', m).onclick = () => aiDraftMemo(m, ctx);
      $('#fSubmit', m).onclick = async () => {
        const btn = $('#fSubmit', m); btn.disabled = true;
        try { await submitForm(u, def, allFields, m, ctx); } finally { btn.disabled = false; }
      };
    },
  });
}

async function submitForm(u, def, fields, m, ctx) {
  const data = {}, errors = [], files = [];
  const get = id => $('#' + id, m);
  for (const f of fields) {
    if (!f.k) continue;
    switch (f.t) {
      case 'radio': {
        const c = $(`input[name="${fid(f.k)}"]:checked`, m);
        let v = c ? c.value : '';
        if (v === 'Others' && f.other) v = get(fid(f.k) + '_other').value.trim() || 'Others';
        data[f.k] = v; break;
      }
      case 'speakers': data[f.k] = Array.from({ length: f.n }, (_, i) => get(`${fid(f.k)}_${i}`).value.trim()); break;
      case 'file': {
        const file = get(fid(f.k)).files[0];
        if (file) files.push([f.k, null, file]);
        break;
      }
      case 'checkfiles': {
        data[f.k] = {};
        f.items.forEach((it, i) => { const file = get(`${fid(f.k)}_${i}`).files[0]; if (file) files.push([f.k, it, file]); });
        break;
      }
      case 'signature': {
        const saved = state.signatures[u.id];
        if (saved) data[f.k] = saved;
        else if (m.repPad && !m.repPad.isEmpty()) {
          data[f.k] = m.repPad.toDataURL();
          if ($('#repRemember', m)?.checked) data.repSignatureRemember = true;
        } else data[f.k] = '';
        break;
      }
      default: data[f.k] = (get(fid(f.k))?.value || '').trim();
    }
    const needed = f.req || (f.reqIf && data[f.reqIf[0]] === f.reqIf[1]);
    const has = f.t === 'file' ? files.some(x => x[0] === f.k) : f.t === 'speakers' ? data[f.k].some(Boolean) : !!data[f.k];
    if (needed && !has) errors.push(f.label || f.k);
    if (f.t === 'number' && data[f.k] !== '') {
      const n = Number(data[f.k]);
      if (f.min != null && n < f.min) errors.push(`${f.label}: must be at least ${f.min}`);
      if (f.max != null && n > f.max) errors.push(`${f.label}: must be at most ${f.max}`);
    }
  }
  if (def.services) {
    data.services = {};
    def.services.forEach(g => {
      data.services[g] = { items: $$(`[data-svc="${g}"]:checked`, m).map(c => c.value), other: ($(`[data-svc-other="${g}"]`, m)?.value || '').trim() };
    });
    if (needsDesign(data.services)) {
      const file = $('#f_design', m)?.files[0];
      if (file) files.push(['design', null, file]); else errors.push('Design (you ticked a Marketing or Printing service)');
    }
  }
  if (data.startDate && data.endDate && data.endDate < data.startDate) errors.push('End Date must be on or after Start Date');
  const big = files.find(x => x[2].size > MAX_FILE_MB * 1048576);
  if (big) errors.push(`${big[2].name} is larger than ${MAX_FILE_MB} MB`);
  if (errors.length) {
    toast('Please fix: ' + errors.slice(0, 4).join(', ') + (errors.length > 4 ? ` (+${errors.length - 4} more)` : ''), 'error');
    return;
  }
  // Warnings that need confirmation
  const warns = [];
  const wd = def.deadline && data.startDate ? workingDaysUntil(data.startDate) : null;
  const late = wd != null && wd < def.deadline;
  if (late) {
    const li = lateInfo(u.clubId);
    if (li.blockedUntil) { toast(`Late requests are blocked until ${fmtDate(li.blockedUntil)} (all ${LATE_LIMIT} late submissions used). Choose a start date at least ${def.deadline} working days away.`, 'error'); return; }
    warns.push(`This is a LATE submission: only ${wd} working day(s) before the start date (guide asks for ${def.deadline}).\nIt uses late submission ${li.used + 1} of ${LATE_LIMIT}.${li.used + 1 >= LATE_LIMIT ? ` After this, your club cannot submit late requests for ${LATE_BLOCK_MONTHS} months.` : ''}`);
  }
  if (def.memo && Number(data.amount) > ctx.balance) warns.push(`The amount (${money(data.amount)}) is more than your club balance (${money(ctx.balance)}). The SAO Office will see a warning.`);
  if (warns.length && !confirm(warns.join('\n') + '\n\nSubmit anyway?')) return;

  // Upload the attached files to the server, then send the request (the server checks everything again)
  toast('Sending...');
  try {
    for (const [k, item, file] of files) {
      const meta = await FileStore.upload(file);
      if (item) data[k][item] = meta; else data[k] = meta;
    }
  } catch (e) { toast(e.message, 'error'); return; }
  await act('createRequest', { type: def.key, data },
    out => `${out.id} sent to ${out.status === 'advisor' ? (userById(clubById(u.clubId).advisorId)?.name || 'your advisor') : STAGE_LABEL[out.status]}`);
}

// ----- Reading a submitted form back (used by the detail view and the PDF) -----
// Returns [{section, label, value, file?}] in form order.
function formRows(r) {
  const def = FORMS[r.type], d = r.data || {}, rows = [];
  let section = 'Details';
  const push = (label, value, file) => rows.push({ section, label, value: value == null || value === '' ? '-' : String(value), file });
  push('AWG Name', clubName(r.clubId));
  for (const f of def.fields) {
    const v = d[f.k];
    switch (f.t) {
      case 'heading': section = f.label; break;
      case 'balance':
        push('Available Balance', money(d.availableBalance)); push('Requested Amount', money(r.amount)); push('Remaining Balance', money(d.remainingBalance)); break;
      case 'date': push(f.label, v ? fmtDate(v) : ''); break;
      case 'number': push(f.label, v === '' || v == null ? '' : (f.money ? money(v) : v)); break;
      case 'speakers': push(f.label, (v || []).filter(Boolean).map((s, i) => `${i + 1}- ${s}`).join(', ')); break;
      case 'file': push(f.label, v ? v.name : 'Not attached', v); break;
      case 'signature': push(f.label, v ? 'Signed electronically' : 'Not signed'); break;
      case 'checkfiles': f.items.forEach(it => push(it, v?.[it] ? v[it].name : 'Not attached yet', v?.[it])); break;
      case 'link': { const l = state.requests.find(x => x.id === v); push(f.label, l ? `${l.id} - ${l.title}` : ''); break; }
      default: push(f.label, v);
    }
  }
  if (def.services) {
    section = 'Needed Services';
    def.services.forEach(g => {
      const s = d.services?.[g]; const items = [...(s?.items || []), ...(s?.other ? ['Others: ' + s.other] : [])];
      push(SERVICE_GROUPS[g].label, items.join(', ') || 'None');
    });
    if (d.design || needsDesign(d.services)) {
      push('Design', d.design ? d.design.name : 'Not attached', d.design);
      push('Design hard copy', r.hardCopyAt ? 'Received at the SAO Office on ' + fmtDate(r.hardCopyAt) : 'Not received yet');
    }
  }
  const checks = saoChecks(r);
  if (checks.length) {
    section = 'SAO Office checks';
    checks.forEach(c => push(c.label, r.checks?.[c.key] ? 'Done on ' + fmtDate(r.checks[c.key]) : 'Not yet'));
  }
  return rows;
}
function memoOf() { return null; }
function formDetailsHTML(r) {
  const rows = formRows(r), memo = memoOf(r);
  const files = [];
  const cell = row => { if (row.file) { files.push(row.file); return `<a href="#" data-file="${files.length - 1}">${esc(row.value)}</a>`; } return esc(row.value).replace(/\n/g, '<br>'); };
  const sections = [...new Set(rows.map(x => x.section))];
  const html = `${memo ? `<div class="memo-view"><div class="memo-head"><span class="badge amber">Memo</span></div>
      <div class="meta"><div><span>To</span>${esc(memo.to)}</div><div><span>From</span>${esc(memo.from)}</div><div><span>Date</span>${fmtDate(memo.date)}</div></div>
      <div><b>Subject:</b> ${esc(memo.subject)}</div><div class="desc" style="margin-top:8px">${esc(memo.body)}</div>
      ${memo.file ? `<div class="small">Signed memo: ${cell({ value: memo.file.name, file: memo.file })}</div>` : ''}</div>` : ''}
    ${sections.map(s => `<h3 class="form-h">${esc(s)}</h3><table class="kv"><tbody>${rows.filter(x => x.section === s).map(x => `<tr><th>${esc(x.label)}</th><td class="wrap">${cell(x)}</td></tr>`).join('')}</tbody></table>`).join('')}`;
  return { html, files };
}

function stepperHTML(r) {
  const steps = [['Submitted', 'done'], ...stagesFor(r).map(s => {
    const done = r.approvals.some(a => a.stage === s);
    const rej = r.status === 'rejected' && r.rejection?.stage === s;
    return [STAGE_LABEL[s], done ? 'done' : rej ? 'rejected' : r.status === s ? 'current' : ''];
  }), ['Signed form to SAO', r.status === 'completed' ? 'done' : '']];
  return `<div class="stepper">${steps.map(([l, c], i) => `<div class="step ${c}"><div class="dot">${c === 'done' ? '&#10003;' : c === 'rejected' ? '&times;' : i + 1}</div>${l}</div>`).join('')}</div>`;
}

function openRequest(id) {
  const u = me(), r = state.requests.find(x => x.id === id);
  if (!r || !visibleRequests(u).includes(r)) return toast('You cannot open this request.', 'error');
  const sigCards = stagesFor(r).map(s => {
    const a = r.approvals.find(x => x.stage === s);
    const who = s === 'advisor' ? userById(clubById(r.clubId).advisorId)?.name : STAGE_LABEL[s];
    return `<div class="sig-card"><div class="role">${STAGE_LABEL[s]}</div>
      ${a ? `${u.role === 'rep' ? '<div class="signed-ok">&#10003; Approved</div>' : `<img src="${a.signature}" alt="Signature of ${esc(a.name)}">`}<b>${esc(a.name)}</b><div class="small muted">${fmtDateTime(a.at)}</div>${a.comment ? `<div class="small">"${esc(a.comment)}"</div>` : ''}`
          : `<div class="pending">${r.status === 'rejected' && r.rejection?.stage === s ? 'Rejected' : 'Not signed yet'}</div><div class="small muted">${esc(who || '')}</div>`}
    </div>`;
  }).join('');
  const acting = canAct(u, r);
  const saved = state.signatures[u.id];
  const details = formDetailsHTML(r);
  const actPanel = !acting ? '' : `<div class="act-panel"><h3>Your decision as ${STAGE_LABEL[u.role]}</h3>
      <div class="field"><label for="aComment">Comment (required if you reject)</label><textarea id="aComment" style="min-height:60px"></textarea></div>
      ${saved ? `<div class="field"><label>Your saved e-signature will be applied</label><img class="sig-preview" src="${saved}" alt="Your signature"><span class="small muted">Change it in <a href="#signature" data-close>My E-Signature</a>.</span></div>`
              : `<div class="field"><label>Draw your e-signature</label>${padHTML('aPad')}<div class="actions" style="margin-top:6px"><button class="btn sm" id="aClear" type="button">Clear</button><label class="small"><input type="checkbox" id="aRemember" checked style="width:auto"> Save as my signature for next time</label></div></div>`}
      ${u.role === 'sao' && needsHardCopy(r) ? `<label class="chk hardcopy"><input type="checkbox" id="aHardCopy" ${r.hardCopyAt ? 'checked' : ''}> <b>Hard copy of the design received at the office</b></label>` : ''}
      ${u.role === 'sao' ? saoChecks(r).map(c => `<label class="chk hardcopy"><input type="checkbox" data-check="${c.key}" ${r.checks?.[c.key] ? 'checked' : ''}> <b>${esc(c.label)}</b></label>`).join('') : ''}
      <div class="actions"><button class="btn key" id="aApprove">Approve &amp; sign</button><button class="btn ghost-danger" id="aReject">Reject</button></div></div>`;
  const pdfBtn = u.role === 'rep' ? '' : r.status === 'completed'
    ? `<button class="btn primary" id="docxBtn">Download signed form (Word)</button>${attachmentsOf(r).length ? '<button class="btn" id="zipBtn">Form + attachments (.zip)</button>' : ''}`
    : `<button class="btn" id="docxBtn">${r.type === 'expense' ? 'Download memo + form so far' : 'Download form so far (.docx)'}</button>${attachmentsOf(r).length ? '<button class="btn" id="zipBtn">Form + attachments (.zip)</button>' : ''}`;
  const copyBtn = r.status === 'rejected' && u.role === 'rep' ? `<button class="btn" id="copyBtn">Edit &amp; resubmit as new</button>` : '';
  openModal({
    wide: true,
    title: `<div class="small muted">${r.id} - ${esc(formName(r.type))}</div><h2>${esc(r.title)}</h2><div style="margin-top:6px">${statusBadge(r)}${r.late ? ` <span class="badge red">Late submission - ${r.late.workingDays} working day(s) notice</span>` : ''}</div>`,
    body: `${stepperHTML(r)}
      ${r.status === 'rejected' ? `<div class="alert red"><b>Rejected by ${esc(r.rejection.name)} (${STAGE_LABEL[r.rejection.stage]})</b> on ${fmtDateTime(r.rejection.at)}<br>${esc(r.rejection.comment)}</div>` : ''}
      ${overBalance(r) ? `<div class="alert amber"><b>Warning:</b> ${money(r.amount)} requested, but the club balance is ${money(clubFinance(r.clubId).balance)}. Approving will take the account below zero.</div>` : ''}
      ${r.status === 'completed' ? `<div class="alert green">Fully approved on ${fmtDateTime(r.completedAt)}. The signed form is with the SAO Office (download it and save as PDF in Word).</div>` : ''}
      <div class="meta">
        <div><span>Club</span>${esc(clubName(r.clubId))}</div>
        <div><span>Submitted by</span>${esc(userById(r.createdBy)?.name || '')}</div>
        <div><span>Submitted on</span>${fmtDateTime(r.createdAt)}</div>
        ${r.amount ? `<div><span>Amount</span>${money(r.amount)}</div>` : ''}
      </div>
      ${details.html}
      <h3 class="form-h">${u.role === 'rep' ? 'Approval status' : 'Approvals &amp; e-signatures'}</h3><div class="sig-grid">${sigCards}</div>
      ${actPanel}`,
    foot: `${copyBtn}${pdfBtn}<button class="btn" data-close>Close</button>`,
    onMount: m => {
      if ($('#docxBtn', m)) $('#docxBtn', m).onclick = () => downloadDocx(r);
      if ($('#zipBtn', m)) $('#zipBtn', m).onclick = () => downloadPackage(r);
      if ($('#copyBtn', m)) $('#copyBtn', m).onclick = () => formModal(u, r.type, r.data);
      $$('[data-file]', m).forEach(a => a.onclick = e => { e.preventDefault(); openStoredFile(details.files[Number(a.dataset.file)]); });
      if (!acting) return;
      const pad = saved ? null : createPad($('#aPad', m));
      if (pad) $('#aClear', m).onclick = () => pad.clear();
      $('#aApprove', m).onclick = () => {
        if (u.role === 'sao' && needsHardCopy(r) && !$('#aHardCopy', m).checked) return toast('Tick "Hard copy of the design received" before approving.', 'error');
        const checks = {};
        if (u.role === 'sao') {
          const missingCheck = saoChecks(r).find(c => !$(`[data-check="${c.key}"]`, m).checked);
          if (missingCheck) return toast(`Tick "${missingCheck.label}" before approving.`, 'error');
          saoChecks(r).forEach(c => { checks[c.key] = true; });
        }
        let signature = null, remember = false;
        if (!saved) {
          if (pad.isEmpty()) return toast('Please draw your signature first.', 'error');
          signature = pad.toDataURL();
          remember = $('#aRemember', m).checked;
        }
        act('approveRequest', { id: r.id, signature, remember, comment: $('#aComment', m).value.trim(), hardCopy: !!$('#aHardCopy', m)?.checked, checks },
          out => out.next ? `Approved and sent to ${STAGE_LABEL[out.next]}` : 'Approved. The signed form is back with the SAO Office.');
      };
      $('#aReject', m).onclick = () => {
        const comment = $('#aComment', m).value.trim();
        if (!comment) return toast('Write a comment explaining the rejection.', 'error');
        act('rejectRequest', { id: r.id, comment }, 'Request rejected and returned to the club.');
      };
    },
  });
}

// ---------- Approvals ----------
function pageApprovals(el, u) {
  const allPending = pendingForMe(u).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lateFirst = u.role === 'sao';
  const flagged = r => r.late || overBalance(r);
  const pending = lateFirst ? allPending.filter(r => !flagged(r)) : allPending;
  const latePending = lateFirst ? allPending.filter(flagged) : [];
  const signedByMe = state.requests.filter(r => r.approvals.some(a => a.userId === u.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const completed = state.requests.filter(r => r.status === 'completed').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  el.innerHTML = `<div class="page-head"><div><h1>Approvals</h1><p class="muted">Requests waiting for your signature as ${STAGE_LABEL[u.role]}.</p></div></div>
    ${!state.signatures[u.id] ? `<div class="alert blue">Tip: <a href="#signature">save your e-signature</a> once so you can approve with one click.</div>` : ''}
    ${lateFirst ? `<div class="card late-card"><h2>Late submissions &amp; warnings (${latePending.length})</h2><p class="muted small">Late = less than the required working days' notice. Over balance = an expense larger than the club's current balance.</p>${requestTable(latePending, { empty: 'Nothing flagged.' })}</div>` : ''}
    <div class="card"><h2>${lateFirst ? 'On-time requests' : 'Waiting for you'} (${pending.length})</h2>${requestTable(pending, { empty: 'Nothing waiting for you.' })}</div>
    ${u.role === 'sao' ? `<div class="card"><h2>Final signed forms</h2><p class="muted small">Requests approved by the Vice President come back here as the official Word form with all signatures. Open it and save as PDF (File > Save As > PDF).</p>
      ${!completed.length ? '<div class="empty">No fully approved requests yet.</div>' : `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Club</th><th>Type</th><th>Title</th><th>Approved</th><th></th></tr></thead><tbody>
      ${completed.map(r => `<tr><td>${r.id}</td><td>${esc(clubName(r.clubId))}</td><td>${esc(formName(r.type))}</td><td class="wrap">${esc(r.title)}</td><td>${fmtDate(r.completedAt)}</td><td><button class="btn sm primary" data-docx="${r.id}">Signed form</button> <button class="btn sm" data-zip="${r.id}">+ Attachments</button> <button class="btn sm" data-open="${r.id}">View</button></td></tr>`).join('')}
      </tbody></table></div>`}</div>
      ${state.announcements.some(a => a.status === 'pending') ? `<div class="alert blue">${state.announcements.filter(a => a.status === 'pending').length} announcement request(s) are waiting. <a href="#announcements">Review them</a>.</div>` : ''}` : ''}
    ${u.role === 'sao' ? `<div class="card"><h2>Signed by me</h2>${requestTable(signedByMe, { empty: 'You have not signed anything yet.' })}</div>` : ''}`;
  bindRequestRows(el);
  $$('[data-docx]', el).forEach(b => b.onclick = () => downloadDocx(state.requests.find(r => r.id === b.dataset.docx)));
  $$('[data-zip]', el).forEach(b => b.onclick = () => downloadPackage(state.requests.find(r => r.id === b.dataset.zip)));
  $$('[data-open]', el).forEach(b => b.onclick = () => openRequest(b.dataset.open));
}

// ---------- Filled official forms (.docx) ----------
// The download is the SAO's own Word template with the club's answers, ticks and e-signatures filled in.
// dd/mm/yyyy. Plain dates are used as-is; timestamps (approval times) use the local date, not UTC.
const docDate = d => {
  if (!d) return '';
  if (String(d).length > 10) { const t = new Date(d); return `${pad2(t.getDate())}/${pad2(t.getMonth() + 1)}/${t.getFullYear()}`; }
  const [y, m, dd] = String(d).split('-'); return `${dd}/${m}/${y}`;
};
function buildDocSpec(r) {
  const def = FORMS[r.type], d = r.data || {};
  const sig = stage => { const a = r.approvals.find(x => x.stage === stage); return a ? { name: a.name, image: a.signature } : null; };
  if (r.type === 'expense') {
    // Financial Data and the Finance Department section stay empty for Finance to fill in
    return { serial: r.id, requestedDate: docDate(d.requestedDate), groupName: clubName(r.clubId), requestedBy: d.requestedBy, repSignature: d.repSignature,
      advisor: sig('advisor'), sao: sig('sao'), vp: sig('vp'), amount: money(r.amount), justification: d.justification,
      attachments: ['Memo', d.att2?.name, d.att3?.name, d.att4?.name] };
  }
  const spec = { fields: [{ label: 'AWG Name', value: clubName(r.clubId) }], radios: [], speakers: null, appends: [], groups: [],
    signatures: { advisor: sig('advisor'), sao: sig('sao'), vp: sig('vp') } };
  const clinic = r.approvals.find(x => x.stage === 'clinic');
  if (clinic) spec.boxSignatures = [{ label: 'Clinic Approval', name: clinic.name, image: clinic.signature, date: docDate(clinic.at) }];
  for (const f of def.fields) {
    if (!f.k) continue;
    const v = d[f.k], label = f.doc || f.label;
    if (f.t === 'radio') {
      if (f.docGroup) {
        const std = f.opts.includes(v) && v !== 'Others';
        spec.groups.push({ label: f.label, items: f.opts.filter(o => o !== 'Others'), checked: std ? [v] : (v ? ['Others'] : []), other: std || v === 'Others' ? '' : (v || '') });
      } else if (!f.noDoc) spec.radios.push({ options: f.opts, value: v });
    } else if (f.t === 'speakers') spec.speakers = v || [];
    else if (f.t === 'file') {
      if (f.docAppend) { if (v) spec.appends.push({ label: f.docAppend, text: 'Attached: ' + v.name }); }
      else if (f.doc) spec.fields.push({ label, value: v ? 'Attached: ' + v.name : '' });
    }
    else if (f.t === 'date') spec.fields.push({ label, value: docDate(v) });
    else if (f.t === 'number') spec.fields.push({ label, value: v === '' || v == null ? '' : (f.money ? money(v) : String(v)) });
    else if (['text', 'tel', 'textarea', 'select'].includes(f.t)) spec.fields.push({ label, value: v || '' });
  }
  if (d.design) spec.appends.push({ label: 'Design Must be', text: 'Attached: ' + d.design.name + (r.hardCopyAt ? ' (hard copy received)' : '') });
  (def.services || []).forEach(g => {
    const s = d.services?.[g] || { items: [], other: '' };
    spec.groups.push({ label: SERVICE_GROUPS[g].label, items: SERVICE_GROUPS[g].items, checked: s.items, other: s.other });
  });
  const cm = r.approvals.filter(a => a.comment).map(a => `${STAGE_LABEL[a.stage]}: ${a.comment}`);
  if (r.rejection) cm.push(`Rejected by ${STAGE_LABEL[r.rejection.stage]}: ${r.rejection.comment}`);
  const allCm = cm.join('\n');
  spec.comments = allCm.length > 180 ? allCm.slice(0, 170).trim() + '... (full comment in SAO Portal)' : allCm;
  const s = r.approvals.find(a => a.stage === 'sao');
  spec.officeReview = s ? `Reviewed ${docDate(s.at)}` : '';
  return spec;
}
const fileBase = r => `${r.id} - ${FORMS[r.type].name}`.replace(/[\\/:*?"<>|]+/g, '-');
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
async function filledForm(r) {
  const { blob, missing } = await DocFill.fill(FORMS[r.type].template, r.type === 'expense' ? 'expense' : 'table', buildDocSpec(r));
  if (missing.length) console.warn(`${r.id}: not found in template:`, missing);
  window.__lastFilled = { id: r.id, blob, missing };
  return blob;
}
// The memo for an Expense Approval: the SAO memo template with the text and the three signatures
async function memoDoc(r) {
  const d = r.data || {}, club = clubById(r.clubId);
  const sig = stage => r.approvals.find(x => x.stage === stage);
  const sao = state.users.find(u => u.role === 'sao'), vp = state.users.find(u => u.role === 'vp');
  const values = {
    TO: d.memoTo || '', FROM: `${clubName(r.clubId)} - ${d.requestedBy || ''}`, DATE: docDate(d.requestedDate || r.createdAt), REF: r.id,
    SUBJECT: d.memoSubject || '', BODY: d.memoBody || '',
    ADVISOR_NAME: sig('advisor')?.name || userById(club.advisorId)?.name || '', SAO_NAME: sig('sao')?.name || sao?.signName || '', VP_NAME: sig('vp')?.name || vp?.signName || '',
    SIG_ADVISOR: sig('advisor') ? { image: sig('advisor').signature } : '', SIG_SAO: sig('sao') ? { image: sig('sao').signature } : '', SIG_VP: sig('vp') ? { image: sig('vp').signature } : '',
  };
  const { blob, missing } = await DocFill.fill('templates/memo.docx', 'memo', values);
  if (missing.length) console.warn(`${r.id}: memo placeholders not filled:`, missing);
  window.__lastMemo = { id: r.id, blob, missing };
  return blob;
}
const isFinal = r => r.status === 'completed';
// The official Word form, filled in. When fully approved it carries every signature (the SAO saves it as PDF in Word).
// An Expense Approval comes with its memo: both in one zip.
async function downloadDocx(r) {
  const final = isFinal(r);
  toast(final ? 'Preparing the signed form...' : 'Filling the form...');
  try {
    if (r.type === 'expense') {
      const zip = new JSZip();
      zip.file(`${r.id} - Memo.docx`, await memoDoc(r));
      zip.file(fileBase(r) + '.docx', await filledForm(r));
      saveBlob(await zip.generateAsync({ type: 'blob' }), fileBase(r) + ' (memo + form).zip');
    } else saveBlob(await filledForm(r), fileBase(r) + '.docx');
    toast(final ? 'Signed form downloaded (Word)' : 'Form downloaded', 'success');
  } catch (e) { toast('Could not prepare the form: ' + e.message, 'error'); }
}
function attachmentsOf(r) {
  const out = [];
  FORMS[r.type].fields.forEach(f => { const v = r.data?.[f.k]; if (f.t === 'file' && v?.id) out.push({ label: f.label, ...v }); });
  if (r.data?.design?.id) out.push({ label: 'Design', ...r.data.design });
  return out;
}
// Zip: the filled form + every file the club attached (memo, approvals, invoices...)
async function downloadPackage(r) {
  try {
    const zip = new JSZip();
    zip.file(fileBase(r) + '.docx', await filledForm(r));
    if (r.type === 'expense') zip.file(`${r.id} - Memo.docx`, await memoDoc(r));
    let missingFiles = 0;
    for (const a of attachmentsOf(r)) {
      const blob = await FileStore.get(a.id).catch(() => null);
      if (blob) zip.file(`Attachments/${a.label} - ${a.name}`.replace(/[:*?"<>|]+/g, '-'), blob); else missingFiles++;
    }
    saveBlob(await zip.generateAsync({ type: 'blob' }), fileBase(r) + '.zip');
    toast(missingFiles ? `Downloaded (${missingFiles} attachment(s) are not stored in this browser)` : 'Form and attachments downloaded', 'success');
  } catch (e) { toast('Could not build the download: ' + e.message, 'error'); }
}

// ---------- Announcements ----------
function announcementForm(u) {
  return `<div class="card"><h2>${u.role === 'sao' ? 'Post an announcement' : 'Request an announcement'}</h2>
    <p class="muted small">${u.role === 'sao' ? 'Posts from the SAO Office go live immediately.' : 'The SAO Office Head reviews it before it appears on the main page banner.'}</p>
    <div class="field"><label for="anTitle">Title</label><input id="anTitle" maxlength="90" placeholder="e.g. Music Night this Thursday!"></div>
    <div class="field"><label for="anBody">Message</label><textarea id="anBody" maxlength="300" style="min-height:70px" placeholder="Short message shown on the banner (max 300 characters)"></textarea></div>
    <div class="field"><label for="anImage">Image (optional)</label>
      <div class="ann-upload"><div class="ann-preview" id="anPreview"><img src="assets/guc-emblem.png" alt=""><span>No image - the GUC emblem is shown</span></div>
        <div><label class="btn sm" for="anImage">Choose image</label><input id="anImage" type="file" accept="image/png,image/jpeg,image/webp" class="hidden">
          <button class="btn sm ghost-danger hidden" id="anImageClear" type="button">Remove</button>
          <div class="small muted" style="margin-top:6px">A poster or photo. It appears next to the text on the Home banner.</div></div></div></div>
    <div class="form-row"><div class="field"><label for="anStart">Show from</label><input id="anStart" type="date" value="${todayISO()}"></div>
      <div class="field"><label for="anEnd">Show until</label><input id="anEnd" type="date"></div></div>
    <button class="btn primary" id="anSave">${u.role === 'sao' ? 'Publish' : 'Send for approval'}</button></div>`;
}
function pageAnnouncements(el, u) {
  const list = (u.role === 'rep' ? state.announcements.filter(a => a.clubId === u.clubId) : state.announcements)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pending = list.filter(a => a.status === 'pending');
  el.innerHTML = `<div class="page-head"><div><h1>Announcements</h1><p class="muted">Approved announcements appear on the banner at the top of the main page for everyone.</p></div></div>
    ${u.role === 'sao' ? `<div class="card"><h2>Waiting for your approval (${pending.length})</h2>
      ${!pending.length ? '<div class="empty">No announcement requests waiting.</div>' : pending.map(a => `<div class="list-item">${annThumb(a)}<div style="flex:1;min-width:0"><span class="badge blue">${esc(clubName(a.clubId))}</span> <b>${esc(a.title)}</b><div>${esc(a.body)}</div><div class="small muted">Show ${fmtDate(a.start)} - ${a.end ? fmtDate(a.end) : 'no end date'} &middot; requested ${fmtDateTime(a.createdAt)}</div></div>
        <div class="actions"><button class="btn sm success" data-ann-ok="${a.id}">Approve</button><button class="btn sm ghost-danger" data-ann-no="${a.id}">Reject</button></div></div>`).join('')}</div>` : ''}
    <div class="grid two" style="align-items:start">
      ${announcementForm(u)}
      <div class="card"><h2>${u.role === 'rep' ? 'My requests' : 'All announcements'}</h2>
        ${!list.length ? '<div class="empty">None yet.</div>' : list.map(a => `<div class="list-item">${annThumb(a)}<div style="flex:1;min-width:0"><b>${esc(a.title)}</b>${u.role === 'sao' ? ` <span class="small muted">- ${esc(clubName(a.clubId))}</span>` : ''}<div class="small muted">${fmtDate(a.start)} - ${a.end ? fmtDate(a.end) : 'no end'}${a.reason ? ' &middot; Reason: ' + esc(a.reason) : ''}</div></div>
          <div class="actions">${annBadge(a)}${u.role === 'sao' && a.status === 'approved' ? `<button class="btn sm" data-ann-off="${a.id}">Remove</button>` : ''}</div></div>`).join('')}
      </div></div>`;
  const find = id => state.announcements.find(a => a.id === id);
  $$('[data-ann-img]', el).forEach(b => b.onclick = () => openPoster(find(b.dataset.annImg)));
  let image = null;
  const emptyPreview = '<img src="assets/guc-emblem.png" alt=""><span>No image - the GUC emblem is shown</span>';
  $('#anImage').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { image = await resizeImage(file, 1000, 0.82); } catch (err) { return toast(err.message, 'error'); }
    $('#anPreview').innerHTML = `<img class="has-img" src="${image}" alt="Preview">`;
    $('#anImageClear').classList.remove('hidden');
  };
  $('#anImageClear').onclick = () => { image = null; $('#anImage').value = ''; $('#anPreview').innerHTML = emptyPreview; $('#anImageClear').classList.add('hidden'); };
  $$('[data-ann-ok]', el).forEach(b => b.onclick = () => act('reviewAnnouncement', { id: b.dataset.annOk, decision: 'approve' }, 'Announcement is now on the banner'));
  $$('[data-ann-no]', el).forEach(b => b.onclick = () => {
    const reason = prompt('Reason for rejecting (shown to the club):'); if (reason === null) return;
    act('reviewAnnouncement', { id: b.dataset.annNo, decision: 'reject', reason }, 'Announcement rejected');
  });
  $$('[data-ann-off]', el).forEach(b => b.onclick = () => act('reviewAnnouncement', { id: b.dataset.annOff, decision: 'remove' }, 'Removed from banner'));
  $('#anSave').onclick = () => {
    const title = $('#anTitle').value.trim(), body = $('#anBody').value.trim(), start = $('#anStart').value, end = $('#anEnd').value;
    if (!title || !body) return toast('Add a title and a message.', 'error');
    if (end && start && end < start) return toast('"Show until" must be after "Show from".', 'error');
    act('createAnnouncement', { title, body, start, end, image }, u.role === 'sao' ? 'Published to the banner' : 'Sent to the SAO Office for approval');
  };
}

// ---------- Signature ----------
function pageSignature(el, u) {
  const saved = state.signatures[u.id];
  el.innerHTML = `<div class="page-head"><div><h1>My E-Signature</h1><p class="muted">This signature is stamped on every request you approve, together with your name, role and the exact time.</p></div></div>
    <div class="grid two" style="align-items:start">
      <div class="card"><h2>Draw your signature</h2>${padHTML('sigPad')}
        <div class="actions" style="margin-top:12px"><button class="btn" id="sClear">Clear</button><button class="btn primary" id="sSave">Save signature</button></div></div>
      <div class="card"><h2>Current signature</h2>${saved ? `<img class="sig-preview" src="${saved}" alt="Saved signature"><div class="actions" style="margin-top:12px"><button class="btn ghost-danger" id="sDel">Remove</button></div>` : '<div class="empty">No signature saved yet.</div>'}
        <p class="small muted" style="margin-top:12px">Signed as: <b>${esc(u.signName || u.name)}</b> - ${esc(u.title)}</p></div>
    </div>`;
  const pad = createPad($('#sigPad'));
  $('#sClear').onclick = () => pad.clear();
  $('#sSave').onclick = () => { if (pad.isEmpty()) return toast('Draw your signature first.', 'error'); act('saveSignature', { signature: pad.toDataURL() }, 'Signature saved'); };
  if ($('#sDel')) $('#sDel').onclick = () => act('deleteSignature', {}, 'Signature removed');
}

// ---------- Boot ----------
if (window.Chart) { Chart.defaults.font.family = '"Source Sans 3", system-ui, sans-serif'; Chart.defaults.color = '#5C5C5C'; }
boot();
})();
