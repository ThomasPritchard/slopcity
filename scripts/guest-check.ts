// Isolated schema: never changes application profile records. Requires DATABASE_URL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { GuestRepository } from '../server/persistence/guests.ts';
import { BlockedProfileNameError } from '../shared/profileModeration.ts';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const schema = `guest_test_${randomUUID().replaceAll('-','')}`;
const admin = new Pool({connectionString:url});
const isolated = new URL(url); isolated.searchParams.set('options',`-c search_path=${schema}`);
const repository = new GuestRepository(isolated.toString());
try {
 await admin.query(`CREATE SCHEMA ${schema}`);
 await repository.initialise(); await repository.initialise();
 const one = await repository.create({name:'First',shirt:1,skin:2});
 const two = await repository.create({name:'Second',shirt:2,skin:3});
 await assert.rejects(repository.create({name:'nigger',shirt:0,skin:0}),BlockedProfileNameError);
 await assert.rejects(repository.update(one.profile.id,{name:'ni<>gger',shirt:0,skin:0},1),BlockedProfileNameError);
 assert.equal((await repository.pool.query('SELECT count(*)::int AS count FROM guest_profiles')).rows[0].count,2);
 assert.deepEqual(await repository.resolve(one.secret),one.profile);
 assert.equal(await repository.resolve('invalid'),null);
 assert.ok(await repository.update(one.profile.id,{name:'Changed',shirt:3,skin:1},1));
 assert.equal(await repository.update(one.profile.id,{name:'Stale',shirt:0,skin:0},1),null);
 assert.ok(await repository.setBlock(one.profile.id,two.profile.id,true));
 assert.deepEqual((await repository.resolve(one.secret))?.blocks,[two.profile.id]);
 assert.deepEqual((await repository.resolve(two.secret))?.blocks,[]);
 assert.equal(await repository.setBlock(one.profile.id,one.profile.id,true),false);
 await repository.setBlock(one.profile.id,two.profile.id,false);
 assert.deepEqual(await repository.blocks(one.profile.id),[]);
 // A failed transactional profile creation must not leave its profile row behind.
 await repository.pool.query("ALTER TABLE guest_credentials ADD CONSTRAINT reject_test CHECK (false) NOT VALID");
 await assert.rejects(repository.create({name:'Rolled back',shirt:0,skin:0}));
 assert.equal((await repository.pool.query('SELECT count(*)::int AS count FROM guest_profiles')).rows[0].count,2);
 await repository.pool.query('ALTER TABLE guest_credentials DROP CONSTRAINT reject_test');
 await repository.pool.query("UPDATE guest_credentials SET created_at=now()-interval '91 days', expires_at=now()-interval '1 day'");
 assert.equal(await repository.resolve(one.secret),null);
 console.log('Guest PostgreSQL checks passed: name moderation, migrations, restore, revision conflicts, private blocks, rollback, expiry.');
} finally { await repository.close(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
