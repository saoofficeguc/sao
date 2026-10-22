// Sign-in: scrypt password hashes, sign-in tokens (kept only as a SHA-256 hash), and a lock after repeated wrong passwords.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

const SESSION_DAYS = 7;
const LOCK_AFTER = 8, LOCK_MS = 15 * 60000;   // 8 wrong passwords (same email or same address) -> 15 minutes locked

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function checkPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
  const want = Buffer.from(hashHex, 'hex');
  return want.length === hash.length && crypto.timingSafeEqual(hash, want);
}
export function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 8) return 'The password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'The password must contain letters and numbers.';
  return null;
}
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');

export function createAuth(store) {
  async function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    await store.sessions.create(sha(token), userId, Date.now() + SESSION_DAYS * 86400000);
    return token;
  }
  const endSession = async token => { if (token) await store.sessions.del(sha(token)); };
  const endAllSessions = userId => store.sessions.delUser(userId);
  async function sessionUser(token) {
    if (!token) return null;
    const row = await store.sessions.get(sha(token));
    if (!row || Number(row.expires) < Date.now()) { if (row) await endSession(token); return null; }
    const u = await store.users.get(row.user_id);
    return u && !u.disabled ? u : null;
  }

  const isLocked = async key => { const f = await store.failures.get(key); return !!f && Number(f.until) > Date.now(); };
  async function recordFailure(key) {
    const f = await store.failures.get(key);
    let count = (f ? Number(f.count) : 0) + 1, until = f ? Number(f.until) : 0;
    if (count >= LOCK_AFTER) { until = Date.now() + LOCK_MS; count = 0; }
    await store.failures.set(key, count, until);
  }

  async function login(email, password, ip) {
    const keys = [`e:${String(email || '').toLowerCase()}`, `ip:${ip || '?'}`];
    for (const k of keys) if (await isLocked(k)) return { error: 'Too many wrong attempts. Try again in 15 minutes.', status: 429 };
    const row = await store.users.byEmail(email);
    const ok = row && row.pass && checkPassword(password, row.pass) && !JSON.parse(row.data).disabled;
    if (!ok) { for (const k of keys) await recordFailure(k); return { error: 'Wrong email or password.', status: 401 }; }
    for (const k of keys) await store.failures.del(k);
    await store.sessions.purge();
    return { token: await createSession(row.id), userId: row.id };
  }

  return { hashPassword, checkPassword, passwordProblem, createSession, endSession, endAllSessions, sessionUser, login };
}
