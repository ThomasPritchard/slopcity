import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { authenticateGuest, guestCookie, isAllowedOrigin, mountGuestRoutes, parseGuestCookie, SessionRegistry } from '../server/guest.ts';
import { GuestRepository } from '../server/persistence/guests.ts';
test('credential cookies are strict, scoped and never accept ambiguous values', () => {
 const secret = randomBytes(32).toString('base64url');
 const cookie = guestCookie(secret, true);
 assert.ok(cookie.includes('; Path=/game; HttpOnly; SameSite=Strict; Max-Age=7776000; Secure'));
 assert.equal(parseGuestCookie(`other=ok; slop_guest=${secret}`), secret);
 assert.equal(parseGuestCookie(`slop_guest=${secret}; slop_guest=${secret}`), null);
 assert.equal(parseGuestCookie('slop_guest=invalid'), null);
 assert.equal(parseGuestCookie(undefined), null);
 assert.throws(() => guestCookie('bad'));
 assert.ok(!guestCookie(secret, false).includes('Secure'));
});
test('invalid authentication never reaches persistence and origins are exact', async () => {
 const repository = { resolve() { throw new Error('must not query'); } } as unknown as GuestRepository;
 assert.equal(await authenticateGuest('slop_guest=invalid', repository), null);
 const expected = process.env.APP_ORIGIN ?? 'http://localhost:5173';
 assert.ok(isAllowedOrigin(expected));
 assert.equal(isAllowedOrigin(undefined), false);
 assert.equal(isAllowedOrigin(`${expected}.evil.test`), false);
});
test('admission cannot displace another tab and release checks ownership', () => {
 const registry = new SessionRegistry();
 assert.ok(registry.claim('a','first','town'));
 assert.equal(registry.claim('a','second','town'), false);
 assert.equal(registry.release('a','second','town'), false);
 assert.equal(registry.release('a','first','other'), false);
 assert.deepEqual(registry.get('a'), { sessionId:'first',roomId:'town' });
 assert.equal(registry.beginEdit('a'), false);
 assert.ok(registry.release('a','first','town'));
 assert.ok(registry.beginEdit('a'));
 assert.equal(registry.claim('a','second','town'), false);
 registry.endEdit('a');
 assert.ok(registry.claim('a','second','town'));
 const seen: string[] = []; const unsubscribe = registry.onBlocksChanged(id => { seen.push(id); });
 registry.notifyBlocksChanged('a'); unsubscribe(); registry.notifyBlocksChanged('b'); assert.deepEqual(seen,['a']);
});
test('HTTP boundary rejects foreign origins, malformed JSON, unauthenticated and unavailable requests', async () => {
 const repository = { async resolve() { throw new Error('private database detail'); } } as unknown as GuestRepository;
 const app = express(); mountGuestRoutes(app, repository, new SessionRegistry());
 const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
 const address = server.address() as {port:number}; const base = `http://127.0.0.1:${address.port}/api`;
 try {
  assert.equal((await fetch(`${base}/guest`,{method:'POST'})).status,403);
  assert.equal((await fetch(`${base}/profile`)).status,401);
  const malformed = await fetch(`${base}/guest`,{method:'POST',headers:{Origin:process.env.APP_ORIGIN ?? 'http://localhost:5173','Content-Type':'application/json'},body:'{'});
  assert.equal(malformed.status,400);
  const unavailable = await fetch(`${base}/profile`,{headers:{Cookie:`slop_guest=${randomBytes(32).toString('base64url')}`}});
  assert.equal(unavailable.status,503); assert.deepEqual(await unavailable.json(),{error:'Guest service temporarily unavailable'});
 } finally { server.close(); await once(server,'close'); }
});
test('HTTP profile saves reject active admission and stale revision', async () => {
 const profile = {id:'guest-id',name:'Neighbour',shirt:0,skin:0,revision:2,blocks:[]};
 let updates = 0;
 const repository = { async resolve() { return profile; }, async update() { updates++; return null; } } as unknown as GuestRepository;
 const registry = new SessionRegistry(); const app = express(); mountGuestRoutes(app, repository, registry);
 const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
 const address = server.address() as {port:number};
 const save = () => fetch(`http://127.0.0.1:${address.port}/api/profile`,{method:'PATCH',headers:{Origin:process.env.APP_ORIGIN ?? 'http://localhost:5173','Content-Type':'application/json',Cookie:`slop_guest=${randomBytes(32).toString('base64url')}`},body:JSON.stringify({name:'New',shirt:1,skin:1,revision:1})});
 try {
  registry.claim(profile.id,'first','town'); assert.equal((await save()).status,409); assert.equal(updates,0);
  registry.release(profile.id,'first','town'); assert.equal((await save()).status,409); assert.equal(updates,1);
  assert.ok(registry.claim(profile.id,'second','town'));
 } finally { server.close(); await once(server,'close'); }
});
test('block acknowledgements wait for active town routing refresh', async () => {
 const registry = new SessionRegistry(); let release!: () => void;
 registry.onBlocksChanged(() => new Promise<void>(resolve => { release = resolve; }));
 let acknowledged = false;
 const pending = registry.notifyBlocksChanged('guest').then(() => { acknowledged = true; });
 await Promise.resolve(); assert.equal(acknowledged, false);
 release(); await pending; assert.equal(acknowledged, true);
});
test('expired credentials are removed so the browser can establish a new guest', async () => {
 const repository = { async resolve() { return null; } } as unknown as GuestRepository;
 const app = express(); mountGuestRoutes(app, repository, new SessionRegistry());
 const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
 try {
  const {port} = server.address() as {port:number};
  const response = await fetch(`http://127.0.0.1:${port}/api/profile`, {headers:{Cookie:`slop_guest=${randomBytes(32).toString('base64url')}`}});
  assert.equal(response.status,401); assert.ok(response.headers.get('set-cookie')?.includes('Max-Age=0'));
 } finally { server.close(); await once(server,'close'); }
});
