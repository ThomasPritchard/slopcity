import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountMailer, accountMailConfig } from '../server/accountMail.ts';
const message = { token: 'a'.repeat(43), challengeId: randomUUID(), email: 'owner@example.com', purpose: 'upgrade' as const, profileName: '<script>alert("name")</script>' };
test('mail configuration fails closed outside loopback development', () => {
 assert.equal(accountMailConfig({}).mode, 'outbox');
 assert.equal(accountMailConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://slopcity.fun' }).mode, 'disabled');
 assert.equal(accountMailConfig({ APP_ORIGIN: 'https://slopcity.fun' }).mode, 'disabled');
 assert.throws(() => accountMailConfig({ NODE_ENV: 'production', ACCOUNT_EMAIL_MODE: 'outbox' }));
 assert.throws(() => accountMailConfig({ ACCOUNT_EMAIL_MODE: 'resend' }));
 assert.throws(() => accountMailConfig({ APP_ORIGIN: 'https://user:password@example.com' }));
});
test('Resend uses escaped messages, a fragment token, timeout and challenge idempotency', async () => {
 let called = false;
 const mailer = new AccountMailer({ mode: 'resend', origin: 'https://slopcity.fun', apiKey: 'test-secret', from: 'Slop City <accounts@example.com>' }, (async (url, init) => {
  called = true;
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init?.method, 'POST');
  const headers = init!.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer test-secret');
  assert.equal(headers['Idempotency-Key'], message.challengeId);
  assert.ok(init!.signal);
  const body = JSON.parse(init!.body as string);
  assert.deepEqual(body.to, [message.email]);
  assert.ok(body.text.includes(`https://slopcity.fun/#account=${message.token}`));
  assert.ok(body.text.includes('15 minutes'));
  assert.ok(body.html.includes('&lt;script&gt;'));
  assert.ok(!body.html.includes('<script>'));
  return new Response('{}', { status: 200 });
 }) as typeof fetch);
 await mailer.send(message); assert.ok(called);
});
test('delivery failures never expose provider content or recipient', async () => {
 for (const request of [async () => new Response(message.email + message.token, { status: 429 }), async () => { throw new Error(message.email + message.token); }]) {
  const mailer = new AccountMailer({ mode: 'resend', origin: 'https://slopcity.fun', apiKey: 'test-secret', from: 'accounts@example.com' }, request as typeof fetch);
  await assert.rejects(mailer.send(message), error => error instanceof Error && !error.message.includes(message.email) && !error.message.includes(message.token));
 }
});
test('development outbox is private and retains at most 100 messages', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'account-mail-'));
 try {
  const mailer = new AccountMailer({ mode: 'outbox', origin: 'http://localhost:5173', outboxDir: dir });
  await mailer.send(message);
  const file = join(dir, `${message.challengeId}.json`);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).to[0], message.email);
  await Promise.all(Array.from({ length: 101 }, () => mailer.send({ ...message, challengeId: randomUUID() })));
  assert.equal((await readdir(dir)).length, 100);
 } finally { await rm(dir, { recursive: true, force: true }); }
});
