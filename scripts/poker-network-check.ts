import assert from 'node:assert/strict';
import { appendFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import WebSocket from 'ws';
import type { Room } from '@colyseus/sdk';
import type { TownState } from '../shared/state.ts';
import type { PrivateGuestProfile } from '../shared/profile.ts';
import type { WalletState } from '../shared/catalog.ts';
import { type CasinoCommand, type CasinoPrivateState, type CasinoReceipt, type CasinoState } from '../shared/casino.ts';
import type { PokerView } from '../shared/poker.ts';
import { pokerPots } from '../server/casino/pokerRules.ts';

loadEnvFile('.env');
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
const { Client } = await import('@colyseus/sdk');
const port = 2572, endpoint = `http://127.0.0.1:${port}`;
const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
const schema = `poker_network_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const isolated = new URL(process.env.DATABASE_URL!);
isolated.searchParams.set('options', `-c search_path=${schema}`);
const database = new Pool({ connectionString: isolated.toString() });
type Connected = { room: Room<unknown, TownState>; casino?: CasinoState; privateState?: CasinoPrivateState; receipts: CasinoReceipt[]; results: Map<string, PokerView>; motions: Map<string, PokerView>; privateMessages: CasinoPrivateState[]; sequence: number };
const connections: Connected[] = [];
await mkdir('output/playwright', { recursive: true });
const log = async (line: string) => { console.log(line); await appendFile('output/playwright/poker-network.log', `${new Date().toISOString()} ${line}\n`); };
await admin.query(`CREATE SCHEMA ${schema}`);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, PORT: String(port), DATABASE_URL: isolated.toString() }, stdio: ['ignore', 'pipe', 'pipe'],
});
// Third-party error output may include connection strings; keep child output private.
server.stdout.resume(); server.stderr.resume();
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 8000) {
  const start = performance.now();
  while (!(await check())) {
    if (performance.now() - start > timeout) throw new Error(`Timed out: ${label}`);
    await delay(30);
  }
}
async function guest(name: string) {
  const response = await fetch(`${endpoint}/api/guest`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, shirt: 1, skin: 2 }) });
  assert.equal(response.status, 201);
  return { cookie: response.headers.get('set-cookie')!.split(';')[0], profile: await response.json() as PrivateGuestProfile };
}
function watch(room: Room<unknown, TownState>): Connected {
  const connected: Connected = { room, receipts: [], results: new Map(), motions: new Map(), privateMessages: [], sequence: 0 };
  connections.push(connected);
  room.onMessage<CasinoState>('casino-state', state => {
    connected.casino = state;
    const view = state.tables.find(t => t.game === 'poker') as PokerView;
    if (view.phase === 'result') connected.results.set(view.roundId, view);
    if (view.phase === 'preflop') connected.motions.set(view.roundId, view);

  });
  room.onMessage<CasinoReceipt>('casino-receipt', receipt => connected.receipts.push(receipt));
  room.onMessage<CasinoPrivateState>('casino-private', state => { connected.privateState = state; connected.privateMessages.push(state); });
  for (const message of ['chat', 'voice-neighbours', 'notice', 'economy', 'economy-error']) room.onMessage(message, () => {});
  return connected;
}
const client = (cookie: string) => new Client(endpoint, { headers: { Cookie: cookie, Origin: origin } });
type Action = CasinoCommand extends infer Command ? Command extends CasinoCommand ? Omit<Command, 'requestId'> : never : never;
async function command(connection: Connected, action: Action, requestId = randomUUID()) {
  await delay(160);
  const previous = connection.receipts.length;
  connection.room.send('casino-command', { ...action, requestId });
  await until(() => connection.receipts.slice(previous).some(receipt => receipt.requestId === requestId), `receipt for ${action.action}`);
  return connection.receipts.slice(previous).find(receipt => receipt.requestId === requestId)!;
}
const poker = (connection: Connected) => connection.casino?.tables.find(table => table.game === 'poker') as PokerView;
const player = (connection: Connected) => connection.room.state.players.get(connection.room.sessionId)!;
async function walk(connection: Connected, x: number, z: number) {
  await until(async () => {
    const current = player(connection), dx = x - current.x, dz = z - current.z;
    if (Math.hypot(dx, dz) < .18) { connection.room.send('input', { x: 0, z: 0, seq: ++connection.sequence }); return true; }
    connection.room.send('input', { x: dx, z: dz, seq: ++connection.sequence });
    await delay(50); return false;
  }, `walk to ${x},${z}`, 16000);
}
async function wallet(cookie: string) {
  const response = await fetch(`${endpoint}/api/economy`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200); return await response.json() as WalletState;
}
try {
 await until(async () => { try { return (await fetch(`${endpoint}/health`)).ok; } catch { return false; } }, 'isolated server health');
 const guests = [await guest('Poker Alice'), await guest('Poker Blake'), await guest('Poker spectator')];
 const a = watch(await client(guests[0].cookie).create<TownState>('town'));
 let b = watch(await client(guests[1].cookie).joinById<TownState>(a.room.roomId));
 await until(() => a.room.state.players.size === 2, 'two real clients');
 await command(a, { action: 'sync' }); await command(b, { action: 'sync' });
 assert.equal((await command(a, { action: 'poker-join', tableId: 'poker-1', seat: 0, buyIn: 500 })).code, 'too_far');
 assert.equal((await wallet(guests[0].cookie)).balance, 1000);
 const path = [[-5, -17], [-5, 10], [0, 11], [0, 26.7], [12, 26.7], [12, 48], [11.5, 49.4]];
 await Promise.all([a, b].map(async c => { for (const [x, z] of path) await walk(c, x, z); }));
 await log('PASS: two authenticated clients walked through the foyer to the rear poker bay.');
 const joinA: Action = { action: 'poker-join', tableId: 'poker-1', seat: 0, buyIn: 500 }, joinId = randomUUID();
 assert.equal((await command(a, joinA, joinId)).ok, true);
 assert.equal((await command(a, joinA, joinId)).ok, true);
 assert.equal((await command(a, { ...joinA, buyIn: 600 }, joinId)).code, 'request_conflict');
 assert.equal((await command(b, { action: 'poker-join', tableId: 'poker-1', seat: 3, buyIn: 500 })).ok, true);
 await until(() => a.privateState?.poker?.holeCards.length === 2 && b.privateState?.poker?.holeCards.length === 2, 'private deal', 12000);
 assert.equal((await wallet(guests[0].cookie)).balance, 500); assert.equal((await wallet(guests[1].cookie)).balance, 500);
 assert.equal(player(a).seatId, 'casino:poker-1:0'); assert.equal(player(b).seatId, 'casino:poker-1:3');
 const hand = poker(a).handId!;
 const holes = new Map([[0, a.privateState!.poker!.holeCards], [3, b.privateState!.poker!.holeCards]]);
 assert.equal(new Set([...holes.values()].flat().map(c => `${c.rank}:${c.suit}`)).size, 4);
 assert.ok(poker(a).seats.every(s => s.cards.every(c => c === null)));
 let raised = false, reconnected = false, spectator: Connected | undefined;
 for (let turns = 0; poker(a).phase !== 'result'; turns++) {
  assert.ok(turns < 20, 'Bounded check-to-showdown hand');
  await until(() => poker(a).phase === 'result' || [a, b].some(c => !!c.privateState?.poker?.actions), 'next turn');
  if (poker(a).phase === 'result') break;
  if (poker(a).phase === 'flop' && !reconnected) {
   spectator = watch(await client(guests[2].cookie).joinById<TownState>(a.room.roomId));
   await command(spectator, { action: 'sync' });
   assert.deepEqual(poker(spectator).board, poker(a).board); assert.equal(spectator.privateState?.poker, null);
   assert.ok(poker(spectator).seats.every(s => s.cards.every(c => c === null)));
   const saved = b.privateState!.poker!.escrowId; await b.room.leave();
   b = watch(await client(guests[1].cookie).joinById<TownState>(a.room.roomId));
   await command(b, { action: 'sync' });
   await until(() => b.privateState?.poker?.canRejoin === true && player(b)?.seatId === 'casino:poker-1:3', 'reserved seat re-admission');
   assert.equal(b.privateState!.poker!.escrowId, saved);
   assert.equal((await command(b, { action: 'poker-rejoin', tableId: 'poker-1', escrowId: saved })).ok, true);
   assert.deepEqual(b.privateState!.poker!.holeCards, holes.get(3));
   assert.equal((await wallet(guests[1].cookie)).balance, 500);
   reconnected = true; await log('PASS: late spectator received the shared board and backs; reconnect restored the same private cards, escrow and physical chair.');
  }
  await until(() => [a, b].some(c => !!c.privateState?.poker?.actions), 'private action after rejoin');
  const active = [a, b].find(c => !!c.privateState?.poker?.actions)!, other = active === a ? b : a;
  const state = active.privateState!.poker!, legal = state.actions!;
  const move: Action = { action: 'poker-action', tableId: 'poker-1', handId: hand, turnId: legal.turnId, move: !raised ? 'raise' : legal.canCheck ? 'check' : 'call', ...(!raised ? { raiseTo: 40 } : {}) };
  if (!raised) assert.equal((await command(other, move)).code, 'not_your_turn');
  const id = randomUUID(); assert.equal((await command(active, move, id)).ok, true);
  assert.equal((await command(active, move, id)).ok, true);
  assert.equal((await command(active, move)).code, 'not_your_turn');
  raised = true;
 }
 assert.ok(spectator && reconnected);
 await until(() => poker(b).phase === 'result' && poker(spectator!).phase === 'result', 'all clients see showdown');
 const result = poker(a); assert.equal(result.board.length, 5); assert.equal(result.pot, 80);
 assert.deepEqual(poker(b), result); assert.deepEqual(poker(spectator), result);
 for (const seat of result.seats) assert.deepEqual(seat.cards, holes.get(seat.seat));
 const expected = pokerPots(result.seats.map(s => ({ seat: s.seat, committed: s.committed, folded: false, cards: holes.get(s.seat)! })), result.board, result.button!);
 assert.deepEqual(result.winners, expected.winners);
 assert.equal(result.seats.reduce((sum, s) => sum + s.stack, 0), 1000);
 assert.ok(spectator.privateMessages.every(m => m.poker === null));
 const rows = (await database.query('SELECT status,allocations FROM poker_hands WHERE id=$1', [hand])).rows;
 assert.equal(rows[0].status, 'settled');
 for (const [c, g] of [[a, guests[0]], [b, guests[1]]] as const) {
  const own = c.privateState!.poker!, stack = result.seats.find(s => s.player.profileId === g.profile.id)!.stack;
  const leave: Action = { action: 'poker-leave', tableId: 'poker-1', escrowId: own.escrowId }, id = randomUUID();
  assert.equal((await command(c, leave, id)).ok, true); assert.equal((await command(c, leave, id)).ok, true);
  await until(() => c.privateState?.poker === null && player(c).seatId === '', 'cashout releases chair and private hand');
  assert.equal((await wallet(g.cookie)).balance, 500 + stack);
 }
 assert.equal((await command(a, joinA, joinId)).ok, true);
 assert.equal((await database.query("SELECT count(*)::integer AS n FROM poker_seats WHERE status='open'")).rows[0].n, 0);
 const ledger = (await database.query('SELECT w.balance,sum(l.amount)::integer AS ledger FROM economy_wallets w JOIN economy_ledger l ON l.profile_id=w.profile_id GROUP BY w.profile_id,w.balance')).rows;
 assert.ok(ledger.every(r => r.balance === r.ledger));
 await log('PASS: legal raise/call/check through showdown, wrong-turn and duplicate protection, identical results on three clients, conserved escrow settlement and one cashout per player.');
} catch (error) {
 await log(`FAIL: ${error instanceof assert.AssertionError ? error.message : error instanceof Error && error.message.startsWith('Timed out:') ? error.message : 'Network check failed (details suppressed to protect connection configuration)'}`);
 process.exitCode = 1;
} finally {
 await Promise.allSettled(connections.filter(c => c.room.connection?.isOpen).map(c => c.room.leave()));
 server.kill('SIGTERM');
 await until(() => server.exitCode !== null || server.signalCode !== null, 'isolated server exit');
 await database.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
}
