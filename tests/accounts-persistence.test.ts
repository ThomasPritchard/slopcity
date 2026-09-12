import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { GuestRepository } from '../server/persistence/guests.ts';
import { EconomyRepository } from '../server/persistence/economy.ts';
import { AccountRepository, normalizeAccountEmail } from '../server/persistence/accounts.ts';

test('account emails normalize without accepting header injection', () => {
 assert.equal(normalizeAccountEmail(' Test@Example.com '), 'test@example.com');
 for (const email of ['a', 'a@b', 'a\r\n@b.com', 'a b@example.com']) assert.throws(() => normalizeAccountEmail(email));
});
test('account conversion preserves progress and binds single-use links to credentials', { skip: !process.env.DATABASE_URL }, async () => {
 const url = new URL(process.env.DATABASE_URL!);
 assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Account tests require a loopback database');
 const admin = new Pool({ connectionString: url.toString() });
 const schema = `accounts_test_${randomUUID().replaceAll('-', '')}`;
 await admin.query(`CREATE SCHEMA ${schema}`);
 url.searchParams.set('options', `-c search_path=${schema}`);
 const guests = new GuestRepository(url.toString());
 const economy = new EconomyRepository(guests.pool);
 const accounts = new AccountRepository(economy);
 try {
  await guests.initialise(); await economy.initialise();
  // Account tables depend only on profile/credential tables; mark the preceding app migration.
  await guests.pool.query('INSERT INTO guest_schema_migrations(version) VALUES(10)');
  await accounts.initialise();
  const a = await guests.create({ name: 'Account Test', shirt: 0, skin: 0 });
  const before = await economy.ensure(a.profile.id);
  const link = (await accounts.issue('upgrade', 'Owner@Example.com', a.secret))!;
  assert.deepEqual(await accounts.status(a.profile.id), { kind: 'guest', email: null });
  await assert.rejects(accounts.inspect(link.token, null), { code: 'original_browser_required' });
  await assert.rejects(accounts.confirm(link.token, a.secret, a.profile.id, false, () => { throw new Error('banned'); }), /banned/);
  const claims = await Promise.allSettled([accounts.confirm(link.token, a.secret, a.profile.id, false), accounts.confirm(link.token, a.secret, a.profile.id, false)]);
  assert.equal(claims.filter(r => r.status === 'fulfilled').length, 1);
  const converted = claims.find(r => r.status === 'fulfilled')!;
  assert.equal(converted.status, 'fulfilled');
  if (converted.status !== 'fulfilled') throw new Error('No conversion');
  assert.equal(converted.value.profileId, a.profile.id);
  assert.equal(await guests.resolve(a.secret), null);
  assert.deepEqual(await economy.ensure(a.profile.id), before);
  assert.equal((await guests.pool.query("SELECT count(*)::int AS n FROM economy_ledger WHERE profile_id=$1 AND kind='grant'", [a.profile.id])).rows[0].n, 1);
  assert.deepEqual(await new AccountRepository(economy).status(a.profile.id), { kind: 'member', email: 'owner@example.com' });
  assert.equal(await accounts.issue('signin', 'unknown@example.com'), null);
  const b = await guests.create({ name: 'Other Test', shirt: 0, skin: 0 });
  const collision = (await accounts.issue('upgrade', 'owner@example.com', b.secret))!;
  assert.equal(collision.purpose, 'signin');
  assert.equal((await accounts.inspect(collision.token, b.secret)).requiresProfileSwitch, true);
  await assert.rejects(accounts.confirm(collision.token, b.secret, b.profile.id, false), { code: 'profile_switch_required' });
  const signed = await accounts.confirm(collision.token, b.secret, b.profile.id, true);
  assert.equal(await guests.resolve(b.secret), null);
  assert.equal(await guests.resolve(converted.value.secret), null);
  assert.ok(await guests.resolve(signed.secret));
  assert.equal(await accounts.logout(signed.secret), a.profile.id);
  assert.equal(await guests.resolve(signed.secret), null);
  const c = await guests.create({ name: 'Third Test', shirt: 0, skin: 0 });
  const d = await guests.create({ name: 'Fourth Test', shirt: 0, skin: 0 });
  const cLink = (await accounts.issue('upgrade', 'race@example.com', c.secret))!;
  const dLink = (await accounts.issue('upgrade', 'race@example.com', d.secret))!;
  const raced = await Promise.allSettled([accounts.confirm(cLink.token, c.secret, c.profile.id, false), accounts.confirm(dLink.token, d.secret, d.profile.id, false)]);
  assert.equal(raced.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(raced.filter(r => r.status === 'rejected' && r.reason.code === 'account_conflict').length, 1);
  const changed = (await accounts.issue('signin', 'owner@example.com'))!;
  await assert.rejects(accounts.confirm(changed.token, null, c.profile.id, true), { code: 'session_changed' });
  // A sign-in link remains usable following a stale UI/cookie mismatch.
  const restored = await accounts.confirm(changed.token, null, null, false);
  assert.ok(await guests.resolve(restored.secret));
  const expired = (await accounts.issue('signin', 'owner@example.com'))!;
  await guests.pool.query("UPDATE account_challenges SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.challengeId]);
  await assert.rejects(accounts.confirm(expired.token, null, null, false), { code: 'invalid_link' });
  const cancelled = (await accounts.issue('signin', 'owner@example.com'))!;
  await accounts.cancel(cancelled.token);
  await assert.rejects(accounts.inspect(cancelled.token, null), { code: 'invalid_link' });
 } finally { await guests.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
