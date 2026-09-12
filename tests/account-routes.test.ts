import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { mountAccountRoutes } from '../server/accounts.ts';
import { AccountError, type AccountRepository } from '../server/persistence/accounts.ts';
import type { GuestRepository } from '../server/persistence/guests.ts';
import type { AccountMailer } from '../server/accountMail.ts';
import type { AdmissionService } from '../server/admission.ts';
import { SafetyError, type SafetyService } from '../server/safety.ts';
const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const secret = 'a'.repeat(43), rotated = 'b'.repeat(43), token = 'c'.repeat(43);
async function fixture() {
 let member = false, failMail = false, banned = false;
 const issued: unknown[][] = [], sent: unknown[] = [], cancelled: string[] = [], checks: unknown[][] = [], invalidated: string[][] = [], confirmations: unknown[][] = [];
 const guests = { resolve: async (value: string) => value === secret ? { id, name: 'Player' } : null } as unknown as GuestRepository;
 const accounts = {
  status: async () => member ? { kind: 'member', email: 'known@example.com' } : { kind: 'guest', email: null },
  issue: async (purpose: string, email: string) => { issued.push([purpose, email]); return email.startsWith('unknown') ? null : { purpose, email, token, challengeId: id, profileName: 'Player' }; },
  cancel: async (value: string) => { cancelled.push(value); },
  inspect: async (value: string) => { if (value !== token) throw new AccountError('invalid_link', 'Unavailable', 400); return { profileName: 'Player', requiresProfileSwitch: true }; },
  confirm: async (...args: unknown[]) => { confirmations.push(args.slice(0, 4)); (args[4] as (id: string, name: string) => void)(other, 'Target'); return { profileId: other, secret: rotated, previousProfileIds: [id, other] }; },
  logout: async (value: string) => value === secret ? id : null,
 } as unknown as AccountRepository;
 const mailer = { enabled: true, send: async (message: unknown) => { if (failMail) throw new Error('private provider error'); sent.push(message); } } as unknown as AccountMailer;
 const admission = { enabled: true, config: { siteKey: 'public-site-key' }, verify: async (...args: unknown[]) => { checks.push(args); if (args[0] === 'outage') throw new SafetyError(503, 'verification_unavailable', 'Unavailable'); if (args[0] !== 'fresh') throw new SafetyError(403, 'verification_required', 'Verify'); }, invalidateProfiles: (ids: string[]) => invalidated.push(ids) } as unknown as AdmissionService;
 const safety = { checkBan: () => {}, checkProfile: (_ip: string, profile: { id: string }) => { if (banned && profile.id === other) throw new SafetyError(403, 'banned', 'Unavailable'); } } as unknown as SafetyService;
 const app = express(); mountAccountRoutes(app, guests, accounts, mailer, admission, safety);
 const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
 const address = server.address(); assert.ok(address && typeof address === 'object');
 const url = `http://127.0.0.1:${address.port}/api/account`;
 const headers = { origin: process.env.APP_ORIGIN ?? 'http://localhost:5173', 'content-type': 'application/json', 'x-slop-client-ip': '192.0.2.1' };
 return {
  issued, sent, cancelled, checks, invalidated, confirmations,
  member: () => { member = true; }, guest: () => { member = false; }, failMail: () => { failMail = true; }, ban: () => { banned = true; },
  get: (cookie = '') => fetch(url, { headers: { ...headers, cookie } }),
  post: (path: string, body: unknown, extra: Record<string, string> = {}) => fetch(url + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) }),
  close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
 };
}
test('account HTTP status is private and upgrade requires origin, guest and fresh challenge', async () => {
 const f = await fixture();
 try {
  const none = await f.get(); assert.equal(none.headers.get('cache-control'), 'no-store'); assert.equal(none.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await none.json()).kind, 'none');
  assert.equal((await (await f.get(`slop_guest=${secret}`)).json()).kind, 'guest');
  f.member(); const member = await (await f.get(`slop_guest=${secret}`)).json(); assert.equal(member.kind, 'member'); assert.equal(member.email, 'known@example.com');
  f.guest();
  assert.equal((await f.post('/upgrade', { email: 'known@example.com' }, { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await f.post('/upgrade', { email: 'known@example.com' })).status, 401);
  assert.equal((await f.post('/upgrade', { email: 'known@example.com', turnstileToken: 'stale' }, { cookie: `slop_guest=${secret}` })).status, 403);
  assert.equal(f.sent.length, 0);
  assert.equal((await f.post('/upgrade', { email: 'known@example.com', turnstileToken: 'fresh' }, { cookie: `slop_guest=${secret}` })).status, 202);
  assert.deepEqual(f.checks.at(-1), ['fresh', '192.0.2.1', 'account_email']);
 } finally { await f.close(); }
});
test('email lookup replies do not enumerate accounts and failed mail cancels the link', async () => {
 const f = await fixture();
 try {
  const known = await f.post('/signin', { email: 'known@example.com', turnstileToken: 'fresh' });
  const unknown = await f.post('/signin', { email: 'unknown@example.com', turnstileToken: 'fresh' });
  assert.equal(known.status, 202); assert.equal(unknown.status, 202); assert.deepEqual(await known.json(), await unknown.json()); assert.equal(f.sent.length, 1);
  f.failMail(); const failed = await f.post('/signin', { email: 'failure@example.com', turnstileToken: 'fresh' });
  assert.equal(failed.status, 503); assert.deepEqual(f.cancelled, [token]); assert.ok(!(await failed.text()).includes('private provider'));
 } finally { await f.close(); }
});
test('confirmation validates UI state, checks target ban, rotates opaque cookies and invalidates sessions', async () => {
 const f = await fixture();
 try {
  assert.equal((await f.post('/confirm', { token })).status, 400);
  assert.equal((await f.post('/confirm', { token, expectedCurrentProfileId: id, confirmProfileSwitch: 'yes' })).status, 400);
  assert.equal(f.confirmations.length, 0);
  assert.equal((await f.post('/inspect', { token: 'bad' })).status, 400);
  const response = await f.post('/confirm', { token, expectedCurrentProfileId: id, confirmProfileSwitch: true }, { cookie: `slop_guest=${secret}` });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { profileId: other });
  const cookie = response.headers.get('set-cookie')!; assert.ok(cookie.startsWith(`slop_guest=${rotated};`)); assert.ok(cookie.includes('HttpOnly')); assert.ok(cookie.includes('SameSite=Strict')); assert.ok(cookie.includes('Path=/game')); if ((process.env.APP_ORIGIN ?? '').startsWith('https:')) assert.ok(cookie.includes('Secure'));
  assert.deepEqual(f.confirmations[0], [token, secret, id, true]); assert.deepEqual(f.invalidated, [[id, other]]);
  f.ban(); assert.equal((await f.post('/confirm', { token, expectedCurrentProfileId: null, confirmProfileSwitch: false })).status, 403); assert.equal(f.invalidated.length, 1);
  const logout = await f.post('/logout', {}, { cookie: `slop_guest=${secret}` }); assert.equal(logout.status, 204); assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0')); assert.deepEqual(f.invalidated.at(-1), [id]);
 } finally { await f.close(); }
});
test('limited addresses and networks cannot exhaust the shared email budget', async () => {
 const f = await fixture();
 try {
  // Three admitted attempts for one email, then reject it across fresh networks.
  for (let i = 0; i < 3; i++) assert.equal((await f.post('/signin', { email: 'limited@example.com', turnstileToken: 'fresh' })).status, 202);
  for (let i = 0; i < 105; i++) assert.equal((await f.post('/signin', { email: 'limited@example.com', turnstileToken: 'fresh' }, { 'x-slop-client-ip': `198.51.100.${i + 1}` })).status, 429);
  assert.equal(f.checks.length, 3);
  // Seven more distinct emails fill the original network's ten-attempt allowance.
  for (let i = 0; i < 7; i++) assert.equal((await f.post('/signin', { email: `network${i}@example.com`, turnstileToken: 'fresh' })).status, 202);
  assert.equal((await f.post('/signin', { email: 'network-over@example.com', turnstileToken: 'fresh' })).status, 429);
  // Ninety fresh sources still have the rest of the global allowance.
  for (let i = 0; i < 90; i++) assert.equal((await f.post('/signin', { email: `fresh${i}@example.com`, turnstileToken: 'fresh' }, { 'x-slop-client-ip': `203.0.113.${i + 1}` })).status, 202);
  assert.equal((await f.post('/signin', { email: 'global-over@example.com', turnstileToken: 'fresh' }, { 'x-slop-client-ip': '203.0.113.200' })).status, 429);
 } finally { await f.close(); }
});
test('profile email quota applies across emails and networks before verification', async () => {
 const f = await fixture();
 try {
  for (let i = 0; i < 3; i++) assert.equal((await f.post('/upgrade', { email: `profile${i}@example.com`, turnstileToken: 'fresh' }, { cookie: `slop_guest=${secret}`, 'x-slop-client-ip': `203.0.113.${i + 1}` })).status, 202);
  assert.equal((await f.post('/upgrade', { email: 'profile-over@example.com', turnstileToken: 'fresh' }, { cookie: `slop_guest=${secret}`, 'x-slop-client-ip': '203.0.113.99' })).status, 429);
  assert.equal(f.checks.length, 3);
 } finally { await f.close(); }
});

test('failed email challenges preserve recipient and profile allowance for legitimate requests', async () => {
 for (const purpose of ['signin', 'upgrade']) {
  const f = await fixture();
  try {
   const headers: Record<string, string> = purpose === 'upgrade' ? { cookie: `slop_guest=${secret}` } : {};
   for (const [turnstileToken, status] of [[undefined, 403], ['stale', 403], ['outage', 503]] as const) {
    assert.equal((await f.post(`/${purpose}`, { email: 'known@example.com', turnstileToken }, headers)).status, status);
   }
   assert.equal(f.sent.length, 0);
   for (let n = 0; n < 3; n++) assert.equal((await f.post(`/${purpose}`, { email: 'known@example.com', turnstileToken: 'fresh' }, headers)).status, 202);
   assert.equal((await f.post(`/${purpose}`, { email: 'known@example.com', turnstileToken: 'fresh' }, headers)).status, 429);
   assert.equal(f.sent.length, 3);
   assert.equal(f.checks.length, 6, 'Exhausted sending quota still stops provider work');
  } finally { await f.close(); }
 }
});

test('failed challenges still exhaust network attempts before further provider calls', async () => {
 const f = await fixture();
 try {
  for (let n = 0; n < 10; n++) assert.equal((await f.post('/signin', { email: 'known@example.com' })).status, 403);
  assert.equal((await f.post('/signin', { email: 'known@example.com', turnstileToken: 'fresh' })).status, 429);
  assert.equal(f.checks.length, 10); assert.equal(f.sent.length, 0);
  assert.equal((await f.post('/signin', { email: 'known@example.com', turnstileToken: 'fresh' }, { 'x-slop-client-ip': '203.0.113.10' })).status, 202);
 } finally { await f.close(); }
});

test('member upgrade rejects known and unknown addresses identically without issuing email', async () => {
 const f = await fixture();
 try {
  f.member();
  const known = await f.post('/upgrade', { email: 'known@example.com', turnstileToken: 'fresh' }, { cookie: `slop_guest=${secret}` });
  const unknown = await f.post('/upgrade', { email: 'unknown@example.com', turnstileToken: 'fresh' }, { cookie: `slop_guest=${secret}` });
  assert.equal(known.status, 409); assert.equal(unknown.status, 409);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.equal(f.issued.length, 0); assert.equal(f.sent.length, 0); assert.equal(f.checks.length, 0);
 } finally { await f.close(); }
});
