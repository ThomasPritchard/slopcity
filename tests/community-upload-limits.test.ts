import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import sharp from 'sharp';
import { mountCommunityRoutes } from '../server/community.ts';
import type { CommunityRepository } from '../server/persistence/community.ts';
import type { AccountRepository } from '../server/persistence/accounts.ts';
import type { AdmissionService } from '../server/admission.ts';
import type { GuestRepository } from '../server/persistence/guests.ts';

async function uploadFixture() {
 const app = express(), profiles = new Map<string, { id: string }>();
 let writes = 0;
 const guests = { resolve: async (secret: string) => profiles.get(secret) ?? null } as unknown as GuestRepository;
 const repository = {
  replay:async()=>null,
  protectionStatus:async()=>({pending:0,reasons:[],accountCooldowns:[],networkCooldowns:[],spamPauseUntil:null,trialUntil:null}),
  submitProtected: async () => { writes++; return {status:201,body:{ id: randomUUID(), status: 'pending' }}; },
 } as unknown as CommunityRepository;
 mountCommunityRoutes(app, guests, repository,{accounts:{status:async()=>({kind:'member'})} as unknown as AccountRepository,admission:{enabled:true,config:{siteKey:'fixture'},verify:async()=>0} as unknown as AdmissionService});
 const server = app.listen(0, '127.0.0.1');
 await once(server, 'listening');
 const address = server.address();
 assert.ok(address && typeof address === 'object');
 const imageBase64 = (await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer()).toString('base64');
 return {
  guest() {
   const secret = randomBytes(32).toString('base64url');
   profiles.set(secret, { id: randomUUID() });
   return `slop_guest=${secret}`;
  },
  async upload(cookie: string, ip: string) {
   const response = await fetch(`http://127.0.0.1:${address.port}/api/community/submissions`, {
    method: 'POST',
    headers: { cookie, origin: process.env.APP_ORIGIN ?? 'http://localhost:5173', 'content-type': 'application/json', 'x-slop-client-ip': ip },
    body: JSON.stringify({ requestId:randomUUID(),turnstileToken:'fixture',title: 'Quota regression', credit: '', imageBase64 }),
   });
   await response.arrayBuffer();
   return response.status;
  },
  writes: () => writes,
  close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
 };
}

test('guest-limited uploads cannot exhaust the shared allowance by changing networks', async () => {
 const fixture = await uploadFixture();
 try {
  const guest = fixture.guest();
  for (let i = 0; i < 110; i++) {
   assert.equal(await fixture.upload(guest, `198.51.100.${i + 1}`), i < 10 ? 201 : 429);
  }
  assert.equal(await fixture.upload(fixture.guest(), '203.0.113.1'), 201);
  assert.equal(fixture.writes(), 11);
 } finally { await fixture.close(); }
});

test('network-limited uploads cannot exhaust the shared allowance by changing guests', async () => {
 const fixture = await uploadFixture();
 try {
  for (let i = 0; i < 110; i++) {
   assert.equal(await fixture.upload(fixture.guest(), '198.51.100.1'), i < 30 ? 201 : 429);
  }
  assert.equal(await fixture.upload(fixture.guest(), '203.0.113.1'), 201);
  assert.equal(fixture.writes(), 31);
 } finally { await fixture.close(); }
});

test('the shared upload allowance still limits traffic across guests and networks', async () => {
 const fixture = await uploadFixture();
 try {
  for (let i = 0; i < 100; i++) {
   assert.equal(await fixture.upload(fixture.guest(), `198.51.100.${i + 1}`), 201);
  }
  assert.equal(await fixture.upload(fixture.guest(), '203.0.113.1'), 429);
  assert.equal(fixture.writes(), 100);
 } finally { await fixture.close(); }
});


test('IPv6 addresses in one /64 share the network upload quota', async () => {
 const fixture=await uploadFixture();
 try {
  for(let i=0;i<31;i++)assert.equal(await fixture.upload(fixture.guest(),`2001:db8:1:2::${(i+1).toString(16)}`),i<30?201:429);
  assert.equal(await fixture.upload(fixture.guest(),'2001:db8:1:3::1'),201);
  assert.equal(fixture.writes(),31);
 } finally {await fixture.close();}
});
