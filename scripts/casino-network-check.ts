import assert from 'node:assert/strict';
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
import type { CasinoCommand, CasinoPrivateState, CasinoReceipt, CasinoState, RouletteView, SlotsView } from '../shared/casino.ts';

loadEnvFile('.env');
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
const { Client } = await import('@colyseus/sdk');
const port = Number(process.env.TEST_CASINO_PORT || 2569), endpoint = `http://127.0.0.1:${port}`;
const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
const schema = `casino_network_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const isolated = new URL(process.env.DATABASE_URL!);
isolated.searchParams.set('options', `-c search_path=${schema}`);
const database = new Pool({ connectionString: isolated.toString() });
type Connected = { room: Room<unknown, TownState>; casino?: CasinoState; privateState?: CasinoPrivateState; receipts: CasinoReceipt[]; results: Map<string, RouletteView>; privateMessages: CasinoPrivateState[]; sequence: number };
const connections: Connected[] = [];
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
  const connected: Connected = { room, receipts: [], results: new Map(), privateMessages: [], sequence: 0 };
  connections.push(connected);
  room.onMessage<CasinoState>('casino-state', state => {
    connected.casino = state;
    const roulette = state.tables.find(t => t.game === 'roulette') as RouletteView;
    if (roulette.phase === 'result') connected.results.set(roulette.roundId, roulette);
  });
  room.onMessage<CasinoReceipt>('casino-receipt', receipt => connected.receipts.push(receipt));
  room.onMessage<CasinoPrivateState>('casino-private', state => { connected.privateState = state; connected.privateMessages.push(state); });
  for (const message of ['chat', 'voice-neighbours', 'notice', 'economy', 'economy-error']) room.onMessage(message, () => {});
  return connected;
}
const client = (cookie: string) => new Client(endpoint, { headers: { Cookie: cookie, Origin: origin } });
type Action = CasinoCommand extends infer Command ? Command extends CasinoCommand ? Omit<Command, 'requestId'> : never : never;
async function command(connection: Connected, action: Action, requestId = randomUUID()) {
  const previous = connection.receipts.length;
  connection.room.send('casino-command', { ...action, requestId });
  await until(() => connection.receipts.slice(previous).some(receipt => receipt.requestId === requestId), `receipt for ${action.action}`);
  return connection.receipts.slice(previous).find(receipt => receipt.requestId === requestId)!;
}
const roulette = (connection: Connected) => connection.casino?.tables.find(table => table.game === 'roulette') as RouletteView | undefined;
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
  const ownerGuest = await guest('Casino owner'), spectatorGuest = await guest('Casino spectator');
  const owner = watch(await client(ownerGuest.cookie).create<TownState>('town'));
  const spectator = watch(await client(spectatorGuest.cookie).joinById<TownState>(owner.room.roomId));
  await until(() => connections.every(c => c.room.state?.players?.size === 2), 'two authenticated town clients');
  await command(owner, { action: 'sync' }); await command(spectator, { action: 'sync' });
  await until(() => !!owner.casino && !!spectator.casino && !!owner.privateState && !!spectator.privateState, 'initial casino projections');
  assert.equal(roulette(owner)!.roundId, roulette(spectator)!.roundId);
  const outside = await command(owner, { action: 'roulette-bet', tableId: 'roulette-1', roundId: roulette(owner)!.roundId, bet: { kind: 'straight', numbers: [0], stake: 10 } });
  assert.equal(outside.code, 'too_far'); assert.equal((await wallet(ownerGuest.cookie)).balance, 1000);
  assert.equal((await database.query('SELECT count(*)::integer AS count FROM casino_wagers')).rows[0].count, 0);
  console.log('PASS: two authenticated clients receive shared casino state; outside wagers are rejected without debit.');

  // Travel around the fountain, through the actual four-metre entrance, then approach the table front.
  for (const [x, z] of [[-5, -17], [-5, 10], [0, 11], [0, 16], [-8, 17.8]]) await walk(owner, x, z);
  assert.ok(player(owner).z > 14);
  await until(() => roulette(owner)?.phase === 'betting' && roulette(owner)!.deadline - Date.now() > 11000, 'fresh roulette betting window', 35000);
  const roundId = roulette(owner)!.roundId, requestId = randomUUID();
  const bet: Action = { action: 'roulette-bet', tableId: 'roulette-1', roundId, bet: { kind: 'straight', numbers: [0], stake: 10 } };
  const accepted = await command(owner, bet, requestId);
  assert.equal(accepted.ok, true); assert.equal(accepted.wallet?.balance, 990);
  await until(() => owner.privateState?.rouletteBets.length === 1 && roulette(spectator)?.betCount === 1, 'private owner wager and shared public count');
  await command(spectator, { action: 'sync' });
  assert.deepEqual(spectator.privateState!.rouletteBets, []);
  assert.equal(owner.privateState!.rouletteBets[0].wagerId, accepted.wagerId);
  assert.equal('bets' in roulette(spectator)!, false);
  assert.equal(roulette(spectator)!.result, null);
  assert.equal(roulette(owner)!.roundId, roulette(spectator)!.roundId);
  assert.equal(roulette(owner)!.deadline, roulette(spectator)!.deadline);
  await walk(owner, 0, 16);
  const replay = await command(owner, bet, requestId);
  assert.equal(replay.ok, true); assert.equal(replay.wagerId, accepted.wagerId);
  const durableBet = (await database.query('SELECT id,stake FROM casino_wagers WHERE profile_id=$1 AND request_id=$2', [ownerGuest.profile.id, requestId])).rows;
  assert.equal(durableBet.length, 1); assert.equal(durableBet[0].stake, 10);
  assert.equal((await database.query("SELECT count(*)::integer AS count FROM economy_ledger WHERE profile_id=$1 AND kind='casino_bet'", [ownerGuest.profile.id])).rows[0].count, 1);
  console.log('PASS: real entrance movement, shared roulette window, owner-only bet details and exactly one debit after an away-from-table retry.');

  await walk(owner, 3, 16.7);
  assert.equal((await command(owner, { action: 'blackjack-join', tableId: 'blackjack-1', seat: 2 })).ok, true);
  await until(() => connections.every(c => c.room.state.players.get(owner.room.sessionId)?.seatId === 'casino:blackjack-1:2'), 'blackjack physical seating replicated');
  assert.ok(Math.abs(player(owner).x - 3) < .1); assert.ok(Math.abs(player(owner).z - 17.1) < .1);
  owner.room.send('stand');
  await until(() => connections.every(c => c.room.state.players.get(owner.room.sessionId)?.seatId === ''), 'stand releases physical casino seat');
  await until(() => {
    const table = owner.casino!.tables.find(table => table.id === 'blackjack-1');
    return table?.game === 'blackjack' && table.seats.length === 0;
  }, 'stand releases logical casino seat');
  await walk(owner, 0, 16);
  console.log('PASS: blackjack seat ownership changes actual Citizen position/seatId for both clients; Stand up releases logical and physical seating.');

  await until(() => owner.results.has(roundId) && spectator.results.has(roundId), 'shared roulette result', 35000);
  const ownerResult = owner.results.get(roundId)!, spectatorResult = spectator.results.get(roundId)!;
  assert.deepEqual(ownerResult, spectatorResult);
  assert.ok(Number.isInteger(ownerResult.result) && ownerResult.result! >= 0 && ownerResult.result! <= 36);
  const expectedReturn = ownerResult.result === 0 ? 360 : 0;
  assert.equal((await wallet(ownerGuest.cookie)).balance, 990 + expectedReturn);
  assert.equal((await wallet(spectatorGuest.cookie)).balance, 1000);
  assert.ok(spectator.privateMessages.every(message => message.rouletteBets.length === 0));
  const settled = (await database.query('SELECT status,returned FROM casino_wagers WHERE id=$1', [accepted.wagerId])).rows[0];
  assert.deepEqual(settled, { status: 'settled', returned: expectedReturn });
  console.log('PASS: both clients observe the same real-time roulette outcome and the owner receives its durable payout exactly once.');

  for (const [x, z] of [[0, 21], [3, 21.8]]) await walk(owner, x, z);
  const beforeSpin = await wallet(ownerGuest.cookie);
  const spin = await command(owner, { action: 'slots-spin', tableId: 'slots-4', stake: 10 });
  assert.equal(spin.ok, true); assert.ok(spin.wallet && spin.wagerId);
  const saved = (await database.query('SELECT balance,revision FROM economy_wallets WHERE profile_id=$1', [ownerGuest.profile.id])).rows[0];
  assert.equal(saved.balance, spin.wallet.balance); assert.equal(saved.revision, spin.wallet.revision);
  assert.deepEqual(await wallet(ownerGuest.cookie), spin.wallet);
  const savedSpin = (await database.query('SELECT status,stake,returned FROM casino_wagers WHERE id=$1', [spin.wagerId])).rows[0];
  assert.equal(savedSpin.status, 'settled'); assert.equal(spin.wallet.balance, beforeSpin.balance - 10 + savedSpin.returned);
  const currentSlot = () => owner.casino?.tables.find(table => table.id === 'slots-4') as SlotsView | undefined;
  await until(() => currentSlot()?.phase === 'spinning', 'committed spin animation');
  assert.deepEqual(currentSlot()!.reels, []); assert.equal(currentSlot()!.returned, null);
  await until(() => currentSlot()?.phase === 'result', 'slot result reveal');
  assert.equal(currentSlot()!.returned, savedSpin.returned); assert.equal(currentSlot()!.reels.length, 3);
  console.log('PASS: a real slot spin settles before animation; private receipt wallet matches PostgreSQL and economy API, with reels revealed only on completion.');
} finally {
  await Promise.allSettled(connections.map(c => c.room.leave()));
  server.kill('SIGTERM');
  await until(() => server.exitCode !== null || server.signalCode !== null, 'isolated server exit');
  await database.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
}
