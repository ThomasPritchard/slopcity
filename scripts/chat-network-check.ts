import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import WebSocket from 'ws';
import type { Room } from '@colyseus/sdk';
import type { TownState } from '../shared/state.ts';
import type { ChatMessage } from '../shared/chat.ts';

loadEnvFile('.env');
const database = new URL(process.env.DATABASE_URL!);
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname), 'Only the local test database');
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
const { Client } = await import('@colyseus/sdk');
const endpoint = 'http://127.0.0.1:2581', origin = 'http://localhost:5181';
const schema = `chat_channels_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: database.toString() });
database.searchParams.set('options', `-c search_path=${schema}`);
await admin.query(`CREATE SCHEMA ${schema}`);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '2581', APP_ORIGIN: origin, APP_ORIGINS: '', TURNSTILE_ENABLED: 'false', DATABASE_URL: database.toString(), TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '' }, stdio: 'ignore' });
type Peer = { room: Room<unknown, TownState>; id: string; cookie: string; messages: ChatMessage[]; errors: string[]; notices: string[]; sequence: number };
const peers: Peer[] = [];
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 15000) { const start = Date.now(); while (!await check()) { if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`); await delay(40); } }
async function connect(name: string, existing?: Peer) {
  const response = existing ? null : await fetch(`${endpoint}/api/guest`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, shirt: 1, skin: 2 }) });
  if (response) assert.equal(response.status, 201);
  const cookie = existing?.cookie || response!.headers.get('set-cookie')!.split(';')[0], id = existing?.id || (await response!.json()).id;
  const room = await new Client(endpoint, { headers: { Cookie: cookie, Origin: origin } }).joinOrCreate<TownState>('town');
  const peer: Peer = { room, id, cookie, messages: [], errors: [], notices: [], sequence: 0 }; peers.push(peer);
  room.onMessage<ChatMessage>('chat', message => peer.messages.push(message)); room.onMessage<string>('chat-error', error => peer.errors.push(error)); room.onMessage<string>('notice', notice => peer.notices.push(notice));
  for (const type of ['voice-neighbours', 'economy', 'casino-state', 'casino-private', 'casino-receipt', 'emote-inbox']) room.onMessage(type, () => {});
  await until(() => !!room.state?.players?.get(room.sessionId), 'player state'); return peer;
}
async function send(peer: Peer, command: unknown) { await delay(2100); peer.room.send('chat', command); await delay(160); }
const received = (peer: Peer, body: string) => peer.messages.some(message => message.body === body);
async function walk(peer: Peer, x: number, z: number) { await until(async () => { const player = peer.room.state.players.get(peer.room.sessionId)!; const dx = x - player.x, dz = z - player.z; if (Math.hypot(dx, dz) < .18) { peer.room.send('input', { x: 0, z: 0, seq: ++peer.sequence }); return true; } peer.room.send('input', { x: dx, z: dz, seq: ++peer.sequence, sprint: true }); await delay(50); return false; }, `walk ${x},${z}`, 18000); }
async function block(a: Peer, b: Peer, enabled: boolean) { const response = await fetch(`${endpoint}/api/blocks/${b.id}`, { method: enabled ? 'PUT' : 'DELETE', headers: { Origin: origin, Cookie: a.cookie } }); assert.equal(response.status, 200); }
try {
  await until(async () => { try { return (await fetch(`${endpoint}/health`)).ok; } catch { return false; } }, 'server');
  const a = await connect('Chat Alice'), b = await connect('Chat Bea'), c = await connect('Chat Charlie');
  await send(a, { channel: 'whisper', toProfileId: b.id, body: 'Only you and me', name: 'Forged', sentAt: 1 });
  assert.ok(received(a, 'Only you and me') && received(b, 'Only you and me')); assert.ok(!received(c, 'Only you and me'));
  const delivered = b.messages.at(-1)!; assert.equal(delivered.name, 'Chat Alice'); assert.equal(delivered.profileId, a.id); assert.equal(delivered.toName, 'Chat Bea'); assert.ok(Math.abs(Date.now() - delivered.sentAt) < 5000); assert.equal(a.messages.at(-1)!.id, delivered.id);
  await send(b, { channel: 'whisper', toProfileId: a.id, body: 'Reply just to you' }); assert.ok(received(a, 'Reply just to you')); assert.ok(!received(c, 'Reply just to you'));
  await block(b, a, true);
  await send(a, { channel: 'whisper', toProfileId: b.id, body: 'Blocked outbound' }); assert.ok(!received(a, 'Blocked outbound') && !received(b, 'Blocked outbound'));
  await send(b, { channel: 'whisper', toProfileId: a.id, body: 'Blocked reverse' }); assert.ok(!received(a, 'Blocked reverse'));
  await block(b, a, false);
  await send(a, { channel: 'whisper', body: 'Missing recipient' }); assert.ok(peers.every(peer => !received(peer, 'Missing recipient')));
  await send(a, { channel: 'table', tableId: 'roulette-1', body: 'Forged remote table' }); assert.ok(peers.every(peer => !received(peer, 'Forged remote table')));
  a.room.send('chat-table', 'roulette-1');
  await send(a, { channel: 'table', tableId: 'roulette-1', body: 'Remote subscription denied' }); assert.ok(peers.every(peer => !received(peer, 'Remote subscription denied')));
  await send(a, { channel: 'whisper', toProfileId: b.id, body: 'visit example.com' }); assert.ok(!received(b, 'visit example.com')); assert.ok(a.notices.some(message => message.includes('Links')));
  console.log('PASS: private whisper delivery/echo, authoritative names/timestamps, symmetric blocks, invalid targets, remote-table denial and moderation.');
  for (const [x, z] of [[-5, -17], [-5, 10], [0, 11], [0, 21], [0, 26.5], [0, 29.8]]) await Promise.all([walk(a, x, z), walk(b, x, z)]);
  a.room.send('chat-table', 'roulette-1'); b.room.send('chat-table', 'roulette-1');
  await send(a, { channel: 'table', tableId: 'roulette-1', body: 'At the roulette table' }); assert.ok(received(a, 'At the roulette table') && received(b, 'At the roulette table')); assert.ok(!received(c, 'At the roulette table'));
  await block(b, a, true); await send(a, { channel: 'table', tableId: 'roulette-1', body: 'Table block' }); assert.ok(!received(b, 'Table block')); await block(b, a, false);
  b.room.send('chat-table', null); await send(a, { channel: 'table', tableId: 'roulette-1', body: 'Closed table' }); assert.ok(!received(b, 'Closed table'));
  b.room.send('chat-table', 'roulette-1'); await walk(b, 0, 26.5); await send(a, { channel: 'table', tableId: 'roulette-1', body: 'Walked away' }); assert.ok(!received(b, 'Walked away'));
  await send(a, 'Legacy town message'); assert.ok(received(c, 'Legacy town message')); assert.equal(c.messages.at(-1)?.channel, 'town');
  await b.room.leave(); peers.splice(peers.indexOf(b), 1); await until(() => !a.room.state.players.has(b.room.sessionId), 'departure');
  await send(a, { channel: 'whisper', toProfileId: b.id, body: 'Offline whisper' }); assert.ok(!received(a, 'Offline whisper'));
  const rejoined = await connect('Chat Bea', b); assert.equal(rejoined.messages.length, 0, 'no private history replay to new connections');
  await send(a, { channel: 'table', tableId: 'roulette-1', body: 'Old membership expired' }); assert.ok(!received(rejoined, 'Old membership expired'));
  await send(a, { channel: 'whisper', toProfileId: rejoined.id, body: 'Welcome back privately' }); assert.ok(received(rejoined, 'Welcome back privately')); assert.ok(!received(c, 'Welcome back privately'));
  console.log('PASS: table isolation, table blocking, close/proximity revocation, town compatibility, offline rejection, reconnect and no history replay.');
} finally {
  await Promise.allSettled(peers.map(peer => peer.room.leave())); server.kill('SIGTERM'); await until(() => server.exitCode !== null || server.signalCode !== null, 'server exit');
  await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
}
