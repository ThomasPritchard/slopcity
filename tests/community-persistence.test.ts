import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { GuestRepository } from '../server/persistence/guests.ts';
import { EconomyRepository } from '../server/persistence/economy.ts';
import { CasinoRepository } from '../server/persistence/casino.ts';
import { SocialRepository } from '../server/persistence/social.ts';
import { CommunityRepository } from '../server/persistence/community.ts';
test('community isolated migration, concurrent caps, private bytes, moderation, revision and restart',{skip:!process.env.DATABASE_URL},async()=>{
 const admin=new Pool({connectionString:process.env.DATABASE_URL});const schema=`community_test_${randomUUID().replaceAll('-','')}`;await admin.query(`CREATE SCHEMA ${schema}`);const url=new URL(process.env.DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema}`);const guests=new GuestRepository(url.toString()),economy=new EconomyRepository(guests.pool),casino=new CasinoRepository(economy),social=new SocialRepository(economy),repo=new CommunityRepository(economy);
 try{await guests.initialise();await economy.initialise();await casino.initialise();await social.initialise();await repo.initialise();assert.equal((await guests.pool.query('SELECT version FROM guest_schema_migrations WHERE version=8')).rowCount,1);const owner=randomUUID(),other=randomUUID();await guests.pool.query("INSERT INTO guest_profiles(id,name,shirt,skin) VALUES($1,'Tester',0,0),($2,'Other',0,0)",[owner,other]);const results=await Promise.allSettled(Array.from({length:8},()=>repo.submit(owner,'Picture','Tester',Buffer.from('normalised'),1,1)));assert.equal(results.filter(r=>r.status==='fulfilled').length,5);const image=(await repo.list(owner))[0];assert.equal(await repo.image(image.id,{public:true}),undefined);assert.equal(await repo.image(image.id,{owner:other}),undefined);assert.ok(await repo.image(image.id,{owner}));assert.equal((await repo.programme()).images.length,1);await repo.moderate(image.id,{status:'approved'});assert.equal((await repo.programme()).images.length,2);assert.ok(await repo.image(image.id,{public:true}));const p=await repo.programme();await repo.update(p,p.revision);await assert.rejects(repo.update(p,p.revision),/Programme changed/);await guests.initialise();await economy.initialise();await casino.initialise();await social.initialise();await repo.initialise();assert.equal((await new CommunityRepository(economy).programme()).images.length,2);await repo.remove(image.id);assert.equal(await repo.image(image.id,{public:true}),undefined);assert.equal((await repo.programme()).images.length,1);
 }finally{await guests.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
