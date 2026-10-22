// SAO Portal API as a Supabase Edge Function.
// Same server code as on a normal computer (../_shared/core), connected to Supabase's Postgres database and Storage.
// Supabase provides SUPABASE_DB_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY automatically.
// Optional secret: ANTHROPIC_API_KEY (AI memo drafting).
import postgres from 'npm:postgres@3.4.5';
import Anthropic from 'npm:@anthropic-ai/sdk@1.1.0';
import { AsyncLocalStorage } from 'node:async_hooks';
import '../_shared/forms.js';   // copied from the project's forms.js by the deploy job; sets globalThis.SAO_FORMS
import { createApp } from '../_shared/core/app.mjs';

const env = (k: string) => Deno.env.get(k) || '';

// ---- Postgres: one change at a time (a database lock), so counters and balances never clash ----
const sql = postgres(env('SUPABASE_DB_URL'), { prepare: false, max: 4, idle_timeout: 20 });
const als = new AsyncLocalStorage();
const driver = {
  dialect: 'pg',
  query: (text: string, params: unknown[] = []) => ((als.getStore() as any) || sql).unsafe(text, params as any[]),
  exec: (text: string) => ((als.getStore() as any) || sql).unsafe(text),
  transaction: (fn: () => Promise<unknown>) => als.getStore()
    ? fn()
    : sql.begin(async (tx: any) => als.run(tx, async () => { await tx.unsafe('SELECT pg_advisory_xact_lock(7731)'); return fn(); })),
};

// ---- Supabase Storage (private bucket) for uploaded files and the one-time import ----
const SUPA = env('SUPABASE_URL').replace(/\/+$/, '');
const KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const BUCKET = 'sao-data';
const auth = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${KEY}`, apikey: KEY, ...extra });
const objectUrl = (key: string) => `${SUPA}/storage/v1/object/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const r = await fetch(`${SUPA}/storage/v1/bucket`, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
  if (!r.ok) {
    const t = await r.text();
    if (r.status !== 409 && !/already exists|Duplicate/i.test(t)) throw new Error(`Storage bucket check failed (${r.status}): ${t.slice(0, 200)}`);
  }
  bucketReady = true;
}
const storage = {
  async get(key: string) {
    const r = await fetch(objectUrl(key), { headers: auth() });
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
    const t = await r.text();
    if (r.status === 404 || /not.?found/i.test(t)) return null;
    throw new Error(`Storage read failed (${r.status}): ${t.slice(0, 200)}`);
  },
  async put(key: string, bytes: Uint8Array, type = 'application/octet-stream') {
    await ensureBucket();
    const r = await fetch(objectUrl(key), { method: 'POST', headers: auth({ 'Content-Type': type, 'x-upsert': 'true' }), body: bytes });
    if (!r.ok) throw new Error(`Storage write failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  },
  async del(key: string) {
    await fetch(`${SUPA}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: [key] }) });
  },
};

const app = createApp({
  driver, storage,
  forms: (globalThis as any).SAO_FORMS,
  Anthropic,
  env: { ANTHROPIC_API_KEY: env('ANTHROPIC_API_KEY') },
  // the portal starts from the imported data; set SAO_ALLOW_SETUP=1 only to start a brand-new empty portal
  allowSetup: env('SAO_ALLOW_SETUP') === '1',
});

Deno.serve((req: Request) => app.handle(req, { ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() }));
