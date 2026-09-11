import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { GuestRepository } from '../server/persistence/guests.ts';
import { EconomyRepository } from '../server/persistence/economy.ts';
import { CasinoRepository } from '../server/persistence/casino.ts';
import { SocialRepository } from '../server/persistence/social.ts';

test('One-time casino reimbursement preserves balances, reconciles the ledger and survives concurrent retries', { skip: !process.env.DATABASE_URL }, async () => {
 const source = new URL(process.env.DATABASE_URL!);
 assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Disposable local database only');
 const admin = new Pool({ connectionString: source.toString() }), schema = `reimbursement_${randomUUID().replaceAll('-', '')}`;
 await admin.query(`CREATE SCHEMA ${schema}`);
 source.searchParams.set('options', `-c search_path=${schema}`);
 const guests = new GuestRepository(source.toString()), economy = new EconomyRepository(guests.pool), casino = new CasinoRepository(economy), social = new SocialRepository(economy);
 try {
  await guests.initialise(); await economy.initialise(); await casino.initialise(); await social.initialise();
  const a = (await guests.create({ name: 'A', shirt: 0, skin: 0 })).profile.id;
  const b = (await guests.create({ name: 'B', shirt: 0, skin: 0 })).profile.id;
  await economy.ensure(a); await economy.ensure(b);
  await guests.pool.query("INSERT INTO economy_ledger(profile_id,operation_key,kind,amount) VALUES($1,'spent','purchase',-975)", [a]);
  await guests.pool.query('UPDATE economy_wallets SET balance=25,revision=2 WHERE profile_id=$1', [a]);
  const sql = await readFile(new URL('../deploy/casino-hotfix-reimbursement.sql', import.meta.url), 'utf8');
  await Promise.all([guests.pool.query(sql), guests.pool.query(sql)]);
  assert.equal((await economy.ensure(a)).balance, 1025);
  assert.equal((await economy.ensure(a)).revision, 3);
  assert.equal((await economy.ensure(b)).balance, 2000);
  const ledger = await guests.pool.query('SELECT w.balance, sum(l.amount)::integer AS total FROM economy_wallets w JOIN economy_ledger l ON l.profile_id=w.profile_id GROUP BY w.profile_id');
  assert.ok(ledger.rows.every(row => row.balance === row.total));
  const awarded = await guests.pool.query("SELECT count(*)::integer AS n, sum(amount)::integer AS amount FROM economy_ledger WHERE operation_key='casino-hotfix:2026-09-11'");
  assert.deepEqual(awarded.rows, [{ n: 2, amount: 2000 }]);
  assert.ok((await guests.pool.query('SELECT gifting_allowance FROM economy_wallets')).rows.every(row => row.gifting_allowance === 0), 'A reimbursement does not unlock salary gifting');
  const newcomer = (await guests.create({ name: 'New', shirt: 0, skin: 0 })).profile.id;
  assert.equal((await economy.ensure(newcomer)).balance, 1000, 'New players still receive only the normal starting grant');
 } finally { await guests.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
