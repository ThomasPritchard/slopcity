import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mountAccountRoutes } from '../server/accounts.ts';
import { AdmissionService } from '../server/admission.ts';
import { SafetyError, type SafetyService } from '../server/safety.ts';
import type { AdmissionRepository } from '../server/persistence/admission.ts';
import type { AccountRepository } from '../server/persistence/accounts.ts';
import type { GuestRepository } from '../server/persistence/guests.ts';
import type { AccountMailer } from '../server/accountMail.ts';
const id = randomUUID(), secret = 'a'.repeat(43), cookie = `slop_guest=${secret}`;
function gate() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }
async function fixture() {
 const state = { valid: true, member: false, banned: false, enabled: true, failMail: false, providerWait: null as ReturnType<typeof gate> | null, mailWait: null as ReturnType<typeof gate> | null };
 const providerEntered = gate(), mailEntered = gate();
 const verifies: string[] = [], issued: string[] = [], sent: string[] = [], cancelled: string[] = [], used = new Set<string>();
 const admission = new AdmissionService({ siteKey: 'site', secret: 'secret', hostnames: ['localhost'] }, { edit: async () => {} } as unknown as AdmissionRepository, async (_url, init) => {
  const token = JSON.parse(String(init?.body)).response as string;
  verifies.push(token); providerEntered.release(); await state.providerWait?.promise;
  if (token === 'outage') throw new Error('Provider unavailable');
  if (used.has(token)) return Response.json({ success: false }); used.add(token);
  return Response.json({ success: token !== 'bad', hostname: 'localhost', action: token.split(':')[0] });
 });
 const guests = { resolve: async (value: string) => state.valid && value === secret ? { id, name: 'Entry Guest' } : null } as unknown as GuestRepository;
 const accounts = {
  status: async () => ({ kind: state.member ? 'member' : 'guest', email: null }),
  issue: async (_purpose: string, email: string) => { issued.push(email); return { token: 'b'.repeat(43), challengeId: randomUUID(), email, purpose: 'upgrade', profileName: 'Entry Guest' }; },
  cancel: async (token: string) => { cancelled.push(token); },
 } as unknown as AccountRepository;
 const mailer = { get enabled() { return state.enabled; }, send: async (link: { email: string }) => { sent.push(link.email); mailEntered.release(); await state.mailWait?.promise; if (state.failMail) throw new Error('Provider failed'); } } as unknown as AccountMailer;
 const safety = { checkBan: () => { if (state.banned) throw new SafetyError(403, 'banned', 'Unavailable'); }, checkProfile: () => {} } as unknown as SafetyService;
 const app = express(); mountAccountRoutes(app, guests, accounts, mailer, admission, safety);
 const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address === 'object');
 const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
 const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${address.port}/api/account${path}`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', 'x-slop-client-ip': '192.0.2.1', ...headers }, body: JSON.stringify(body) });
 const body = (choice: 'guest' | 'save' = 'guest') => ({ requestId: randomUUID(), expectedProfileId: id, choice, email: 'player@example.com', turnstileToken: `account_entry:${randomUUID()}` });
 return { state, providerEntered, mailEntered, admission, verifies, issued, sent, cancelled, post, body, close: () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) };
}
test('returning guest entry and optional save each use one account_entry check and one grant', async () => {
 for (const choice of ['guest', 'save'] as const) {
  const f = await fixture();
  try {
   const response = await f.post('/entry', f.body(choice)); assert.equal(response.status, 200);
   const result = await response.json(); assert.equal(result.profileId, id); assert.equal(result.emailStatus, choice === 'save' ? 'sent' : 'not_requested');
   assert.equal('email' in result, false); assert.equal('token' in result, false);
   assert.equal(f.verifies.length, 1); assert.equal(f.sent.length, choice === 'save' ? 1 : 0);
   assert.equal(f.admission.status(id, cookie).verified, true);
   const reservation = f.admission.reserve(id, cookie); f.admission.consume(id, cookie, reservation); assert.throws(() => f.admission.reserve(id, cookie));
  } finally { await f.close(); }
 }
});
test('entry rejects origin, missing guest, member, changed profile and wrong challenge before mail or grant', async () => {
 const f = await fixture();
 try {
  assert.equal((await f.post('/entry', f.body('save'), { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await f.post('/entry', f.body('save'), { cookie: '' })).status, 401);
  f.state.member = true; assert.equal((await f.post('/entry', f.body('save'))).status, 409); f.state.member = false;
  assert.equal((await f.post('/entry', { ...f.body('save'), expectedProfileId: randomUUID() })).status, 409);
  assert.equal(f.verifies.length, 0);
  for (const token of ['town_entry:wrong', 'account_email:wrong', 'bad']) assert.equal((await f.post('/entry', { ...f.body('save'), turnstileToken: token })).status, 403);
  assert.equal(f.sent.length, 0); assert.equal(f.issued.length, 0); assert.equal(f.admission.status(id, cookie).verified, false);
 } finally { await f.close(); }
});
test('identical simultaneous requests coalesce, payload conflicts fail and consumed or invalidated retries cannot mint grants', async () => {
 const f = await fixture();
 try {
  f.state.providerWait = gate(); const body = f.body('save');
  const first = f.post('/entry', body); await f.providerEntered.promise;
  const duplicate = f.post('/entry', body);
  assert.equal((await f.post('/entry', { ...body, email: 'changed@example.com' })).status, 409);
  f.state.providerWait.release(); const [a, b] = await Promise.all([first, duplicate]); assert.equal(a.status, 200); assert.equal(b.status, 200); assert.deepEqual(await a.json(), await b.json());
  assert.equal(f.verifies.length, 1); assert.equal(f.sent.length, 1);
  assert.equal((await f.post('/entry', body)).status, 200); assert.equal(f.verifies.length, 1);
  const reservation = f.admission.reserve(id, cookie); f.admission.consume(id, cookie, reservation);
  assert.equal((await f.post('/entry', body)).status, 403); assert.equal(f.sent.length, 1);
  const fresh = f.body(); assert.equal((await f.post('/entry', fresh)).status, 200); f.admission.invalidateProfiles([id]);
  assert.equal((await f.post('/entry', fresh)).status, 403);
 } finally { f.state.providerWait?.release(); await f.close(); }
});
test('entry rechecks bans, credentials and mode after provider and email awaits', async () => {
 for (const phase of ['provider', 'mail'] as const) for (const change of ['ban', 'revoke', 'pause'] as const) {
  const f = await fixture();
  try {
   const wait = gate(); if (phase === 'provider') f.state.providerWait = wait; else f.state.mailWait = wait;
   const pending = f.post('/entry', f.body('save')); await (phase === 'provider' ? f.providerEntered.promise : f.mailEntered.promise);
   if (change === 'ban') f.state.banned = true; else if (change === 'revoke') f.state.valid = false; else await f.admission.edit('mode', 'paused');
   wait.release(); assert.ok([401, 403].includes((await pending).status)); assert.equal(f.admission.status(id, cookie).verified, false);
   if (phase === 'provider') assert.equal(f.sent.length, 0);
  } finally { f.state.providerWait?.release(); f.state.mailWait?.release(); await f.close(); }
 }
});
test('email unavailable or failed still admits checked entry and cancels failed delivery', async () => {
 for (const failure of ['disabled', 'failed'] as const) {
  const f = await fixture();
  try {
   if (failure === 'disabled') f.state.enabled = false; else f.state.failMail = true;
   const response = await f.post('/entry', f.body('save')); assert.equal(response.status, 200); assert.equal((await response.json()).emailStatus, 'unavailable');
   assert.equal(f.admission.status(id, cookie).verified, true); assert.equal(f.verifies.length, 1); assert.equal(f.cancelled.length, failure === 'failed' ? 1 : 0);
  } finally { await f.close(); }
 }
});
test('combined entry shares standalone email quotas but email exhaustion does not block checked entry', async () => {
 const f = await fixture();
 try {
  for (let i = 0; i < 2; i++) assert.equal((await f.post('/upgrade', { email: 'player@example.com', turnstileToken: `account_email:${i}` })).status, 202);
  assert.equal((await f.post('/entry', f.body('save'))).status, 200); assert.equal(f.sent.length, 3);
  assert.equal((await f.post('/upgrade', { email: 'player@example.com', turnstileToken: 'account_email:exhausted' })).status, 429);
  const checked = await f.post('/entry', f.body('save')); assert.equal(checked.status, 200); assert.equal((await checked.json()).emailStatus, 'limited');
  assert.equal(f.sent.length, 3); assert.equal(f.verifies.length, 4); assert.equal(f.admission.status(id, cookie).verified, true);
 } finally { await f.close(); }
});
test('five fresh entry attempts per profile are allowed per minute and further attempts stop before verification', async () => {
 const f = await fixture();
 try {
  for (let i = 0; i < 5; i++) assert.equal((await f.post('/entry', f.body(), { 'x-slop-client-ip': `192.0.2.${i + 1}` })).status, 200);
  assert.equal((await f.post('/entry', f.body(), { 'x-slop-client-ip': '192.0.2.99' })).status, 429);
  assert.equal(f.verifies.length, 5); assert.equal(f.sent.length, 0);
 } finally { await f.close(); }
});

test('failed combined entry checks leave the shared recipient and profile email quota untouched', async () => {
 const f = await fixture();
 try {
  for (const [turnstileToken, status] of [[undefined, 403], ['bad', 403], ['outage', 503]] as const) {
   assert.equal((await f.post('/entry', { ...f.body('save'), turnstileToken })).status, status);
  }
  assert.equal(f.sent.length, 0); assert.equal(f.admission.status(id, cookie).verified, false);
  const saved = await f.post('/entry', f.body('save'));
  assert.equal(saved.status, 200); assert.equal((await saved.json()).emailStatus, 'sent');
  for (let n = 0; n < 2; n++) assert.equal((await f.post('/upgrade', { email: 'player@example.com', turnstileToken: `account_email:${n}` })).status, 202);
  assert.equal((await f.post('/upgrade', { email: 'player@example.com', turnstileToken: 'account_email:over' })).status, 429);
  assert.equal(f.sent.length, 3);
 } finally { await f.close(); }
});

test('concurrent verified email requests across entry and standalone flows cannot overspend the shared quota', async () => {
 const f = await fixture();
 try {
  const responses = await Promise.all([
   f.post('/entry', f.body('save')),
   f.post('/upgrade', { email: 'player@example.com', turnstileToken: 'account_email:upgrade' }),
   f.post('/signin', { email: 'player@example.com', turnstileToken: 'account_email:signin' }),
   f.post('/entry', f.body('save')),
  ]);
  const results = await Promise.all(responses.map(async response => ({ status: response.status, body: await response.json() })));
  assert.equal(results.filter(result => result.status === 202 || result.body.emailStatus === 'sent').length, 3);
  assert.equal(results.filter(result => result.status === 429 || result.body.emailStatus === 'limited').length, 1);
  assert.equal(f.sent.length, 3);
 } finally { await f.close(); }
});
