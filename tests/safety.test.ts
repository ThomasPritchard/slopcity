import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AddressedHttpServer, captureClientAddress, clientAddress, networkKey, normalizeIP, proxySecret } from '../server/clientAddress.ts';
import { SafetyService, TokenBucket } from '../server/safety.ts';
import type { SafetyRepository } from '../server/persistence/safety.ts';
import type { SafetyBan } from '../shared/safety.ts';

test('visitor address trusts only socket or verified gateway; mapped IPv6 shares quotas and bans',()=>{
 const req=(headers:IncomingMessage['headers'])=>({headers,socket:{remoteAddress:'::ffff:192.0.2.1'}} as IncomingMessage);
 const spoof=req({'x-slop-client-ip':'192.0.2.99','x-real-ip':'192.0.2.98','x-forwarded-for':'192.0.2.97','cf-connecting-ip':'192.0.2.96'});
 captureClientAddress(spoof);assert.equal(clientAddress(spoof.headers),'192.0.2.1');assert.equal(spoof.headers['x-forwarded-for'],undefined);
 const key='a'.repeat(64),trusted=req({'x-slop-client-ip':'2001:DB8:0:0:0:0:0:1','x-slop-proxy-key':key});captureClientAddress(trusted,key);
 assert.equal(clientAddress(trusted.headers),'2001:db8::1');assert.equal(trusted.headers['x-slop-proxy-key'],undefined);
 const wrong=req({'x-slop-client-ip':'192.0.2.99','x-slop-proxy-key':'b'.repeat(64)});captureClientAddress(wrong,key);assert.equal(clientAddress(wrong.headers),null);
 const unicode=req({'x-slop-client-ip':'192.0.2.99','x-slop-proxy-key':'é'.repeat(64)});assert.doesNotThrow(()=>captureClientAddress(unicode,key));assert.equal(clientAddress(unicode.headers),null);
 for(const ip of ['192.0.2.1,192.0.2.2','127.1','1.2.3.4/24','fe80::1%lo0','[::1]',''])assert.equal(normalizeIP(ip),null);
 assert.equal(normalizeIP('::ffff:c000:201'),'192.0.2.1');
 assert.equal(networkKey('2001:db8::1'),networkKey('2001:db8::abcd'));
 assert.throws(()=>proxySecret({NODE_ENV:'production'}),/Configure/);
});

test('address validation and common guard precede even prepended framework listeners',()=>{
 const server=new AddressedHttpServer(undefined,req=>{assert.equal(clientAddress(req.headers),'192.0.2.1');return false;});let dispatched=false;
 server.prependListener('request',()=>{dispatched=true;});
 server.emit('request',{headers:{'x-slop-client-ip':'198.51.100.1'},socket:{remoteAddress:'192.0.2.1'}},{});
 assert.equal(dispatched,false);
});

test('quota refill cannot be reset by rejected requests; storage stays bounded',()=>{
 const b=new TokenBucket(2,1000,2);assert.ok(b.take('a',0));assert.ok(b.take('a',0));assert.equal(b.take('a',0),false);
 assert.equal(b.take('a',250),false);assert.ok(b.take('a',500));assert.ok(b.take('b',500));assert.equal(b.take('c',500),false);
 assert.ok(b.take('c',2000));
});

function fixture() {
 let now=1000;const saved:SafetyBan[]=[];
 const repository={initialise:async()=>{},active:async()=>saved,add:async(kind:SafetyBan['kind'],target:string,reason:string,duration:number|null)=>{const value={id:randomUUID(),kind,target,reason,createdAt:now,expiresAt:duration===null?null:now+duration*60_000};saved.push(value);return value;},revoke:async()=>true} as unknown as SafetyRepository;
 const safety=new SafetyService(repository,()=>now);return {safety,advance:(ms:number)=>{now+=ms;}};
}
test('creation quotas cover rotating guests/networks; expired quotas recover',()=>{
 const {safety,advance}=fixture();
 for(let i=0;i<10;i++)safety.limit('guest','192.0.2.1');
 assert.throws(()=>safety.limit('guest','192.0.2.1'),/Too many/);
 for(let i=0;i<110;i++)safety.limit('guest',`198.51.100.${i+1}`);
 assert.throws(()=>safety.limit('guest','203.0.113.1'),/Too many/);
 advance(900_000);assert.doesNotThrow(()=>safety.limit('guest','192.0.2.1'));
});
test('admission counts pending connections globally and shared networks, release permits reconnect',()=>{
 const {safety}=fixture();
 const player=(i:number,ip='2001:db8::1')=>({sessionId:String(i),profileId:randomUUID(),name:'Guest',ip});
 for(let i=0;i<12;i++)safety.connect(player(i),()=>{});
 assert.throws(()=>safety.connect(player(13,'2001:db8::2'),()=>{}),/limit/);
 safety.disconnect('0');assert.doesNotThrow(()=>safety.connect(player(13),()=>{}));
 for(let i=14;i<66;i++)safety.connect(player(i,`192.0.2.${i}`),()=>{});
 assert.throws(()=>safety.connect(player(70,'203.0.113.1'),()=>{}),/limit/);
});
test('ban commit immediately disconnects matching sessions; unban, expiry and replacement work',async()=>{
 const {safety,advance}=fixture();const id=randomUUID();let kicked=0;
 safety.connect({sessionId:'one',profileId:id,name:'Guest',ip:'192.0.2.1'},()=>kicked++);
 const guestBan=await safety.addBan({kind:'guest',target:id,reason:'Spam',durationMinutes:null});assert.equal(kicked,1);assert.ok(safety.isBanned('203.0.113.1',id));
 await safety.revokeBan(guestBan.id);assert.equal(safety.isBanned('192.0.2.1',id),false);
 await safety.addBan({kind:'ip',target:'::ffff:192.0.2.1',reason:'Flood',durationMinutes:1});assert.ok(safety.isBanned('192.0.2.1',randomUUID()));
 await safety.addBan({kind:'ip',target:'192.0.2.1',reason:'Updated',durationMinutes:2});assert.equal(safety.snapshot().bans.length,1);
 advance(120_001);assert.equal(safety.isBanned('192.0.2.1',id),false);
 assert.throws(()=>safety.addBan({kind:'ip',target:'192.0.2.1/24',reason:'No ranges',durationMinutes:null}),/one IPv4/);
});
test('monitoring aggregates repeats and bounds detailed event retention',()=>{
 const {safety,advance}=fixture();for(let i=0;i<100;i++)safety.record('api_rate_limited','192.0.2.1');
 assert.equal(safety.snapshot().recentEvents[0].count,100);
 for(let i=0;i<250;i++)safety.record('ban_rejected',`198.51.100.${i}`);
 assert.equal(safety.snapshot().recentEvents.length,200);advance(86400_001);assert.equal(safety.snapshot().recentEvents.length,0);
 assert.equal(safety.snapshot().metrics.find(m=>m.name==='api_rate_limited')?.count,100);
});

test('saved-name sweep visits every page, persists only matching guest bans and is idempotent',async()=>{
 const {safety}=fixture();
 const bad=randomUUID(),existing=randomUUID(),good=randomUUID();let kicked=0;
 const pages=[{id:bad,name:'nigger10'},{id:good,name:'Nigel'},{id:existing,name:'n1gg3r'}];
 safety.repository.profileNames=async after=>after===null?pages.slice(0,2):after===good?pages.slice(2):[];
 await safety.addBan({kind:'guest',target:existing,reason:'Existing moderation',durationMinutes:null});
 safety.connect({sessionId:'offender',profileId:bad,name:'nigger10',ip:'192.0.2.1'},()=>kicked++);
 safety.connect({sessionId:'innocent',profileId:good,name:'Nigel',ip:'192.0.2.1'},()=>{throw Error('Innocent neighbour disconnected');});
 assert.equal(await safety.banProhibitedNames(),1);assert.equal(kicked,1);
 assert.equal(await safety.banProhibitedNames(),0);
 const bans=safety.snapshot().bans;assert.equal(bans.length,2);assert.ok(bans.every(b=>b.kind==='guest'&&b.expiresAt===null));
 assert.ok(safety.isBanned('203.0.113.1',bad));assert.equal(safety.isBanned('192.0.2.1',good),false);
});

test('admission also rejects unsafe legacy names even without a cached ban',()=>{
 const {safety}=fixture(),id=randomUUID();
 assert.throws(()=>safety.checkProfile('192.0.2.1',{id,name:'nigger'}),error=>error instanceof Error&&error.message.includes('Choose a different name'));
 assert.doesNotThrow(()=>safety.checkProfile('192.0.2.1',{id,name:'Nigel'}));
});
