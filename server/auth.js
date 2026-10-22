// Sign-in: scrypt password hashes, session cookies, and a lock after repeated wrong passwords
const crypto = require('crypto');
const { db, users } = require('./db');

const SESSION_DAYS = 7;
const COOKIE = 'sao_session';
const SECURE = process.env.SAO_SECURE_COOKIES === '1';   // set to 1 when the site runs on https

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function checkPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}
function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 8) return 'The password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'The password must contain letters and numbers.';
  return null;
}

const sha = t => crypto.createHash('sha256').update(t).digest('hex');
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').run(sha(token), userId, Date.now() + SESSION_DAYS * 86400000);
  return token;
}
function endSession(token) { if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(token)); }
function endAllSessions(userId) { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); }
function sessionUser(token) {
  if (!token) return null;
  const row = db.prepare('SELECT user_id, expires FROM sessions WHERE token = ?').get(sha(token));
  if (!row || row.expires < Date.now()) { if (row) endSession(token); return null; }
  const u = users.get(row.user_id);
  return u && !u.disabled ? u : null;
}
db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());

function readCookie(req, name = COOKIE) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
const sessionCookie = token => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${SECURE ? '; Secure' : ''}`;
const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE ? '; Secure' : ''}`;

// After 8 wrong passwords for the same email (or from the same address) sign-in is locked for 15 minutes
const failures = new Map();
const LOCK_AFTER = 8, LOCK_MS = 15 * 60000;
function isLocked(key) { const f = failures.get(key); return f && f.until && f.until > Date.now(); }
function recordFailure(key) {
  const f = failures.get(key) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= LOCK_AFTER) { f.until = Date.now() + LOCK_MS; f.count = 0; }
  failures.set(key, f);
}

function login(email, password, ip) {
  const keys = [`e:${String(email).toLowerCase()}`, `ip:${ip}`];
  if (keys.some(isLocked)) return { error: 'Too many wrong attempts. Try again in 15 minutes.', status: 429 };
  const row = users.byEmail(email);
  const ok = row && row.pass && checkPassword(password, row.pass) && !JSON.parse(row.data).disabled;
  if (!ok) { keys.forEach(recordFailure); return { error: 'Wrong email or password.', status: 401 }; }
  keys.forEach(k => failures.delete(k));
  return { token: createSession(row.id), userId: row.id };
}

module.exports = { hashPassword, checkPassword, passwordProblem, createSession, endSession, endAllSessions, sessionUser, readCookie, sessionCookie, clearCookie, login };
