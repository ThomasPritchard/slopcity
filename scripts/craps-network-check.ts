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
import { sampleCrapsMotion } from '../shared/crapsMotion.ts';
import { resolveCraps, crapsReturn, type CrapsView } from '../shared/craps.ts';

loadEnvFile('.env');
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
const { Client } = await import('@colyseus/sdk');
const port = 2571, endpoint = `http://127.0.0.1:${port}`;
const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
const schema = `craps_network_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const isolated = new URL(process.env.DATABASE_URL!);
isolated.searchParams.set('options', `-c search_path=${schema}`);
const database = new Pool({ connectionString: isolated.toString() });
type Connected = { room: Room<unknown, TownState>; casino?: CasinoState; privateState?: CasinoPrivateState; receipts: CasinoReceipt[]; results: Map<string, CrapsView>; motions: Map<string, CrapsView>; privateMessages: CasinoPrivateState[]; sequence: number };
const connections: Connected[] = [];
await mkdir('output/playwright', { recursive: true });
const log = async (line: string) => { console.log(line); await appendFile('output/playwright/craps-network.log', `${new Date().toISOString()} ${line}\n`); };
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
    const view = state.tables.find(t => t.game === 'craps') as CrapsView;
    if (view.phase === 'result') connected.results.set(view.rollId, view);
    if (view.phase === 'rolling') connected.motions.set(view.rollId, view);

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
const craps = (connection: Connected) => connection.casino?.tables.find(table => table.game === 'craps') as CrapsView;
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
}try {
 await until(async () => { try { return (await fetch(`${endpoint}/health`)).ok; } catch { return false; } }, 'isolated server health');
 const ownerGuest = await guest('Craps owner'), spectatorGuest = await guest('Craps spectator');
 let owner = watch(await client(ownerGuest.cookie).create<TownState>('town'));
 const spectator = watch(await client(spectatorGuest.cookie).joinById<TownState>(owner.room.roomId));
 await until(() => connections.every(c => c.room.state?.players?.size === 2), 'two authenticated clients');
 await command(owner, { action: 'sync' }); await command(spectator, { action: 'sync' });
 assert.equal((await command(owner, { action: 'craps-bet', tableId: 'craps-1', roundId: craps(owner).roundId, bet: { kind: 'pass', stake: 10 } })).code, 'too_far');
 assert.equal((await wallet(ownerGuest.cookie)).balance, 1000);
 assert.equal((await database.query('SELECT count(*)::integer AS count FROM casino_wagers')).rows[0].count, 0);
 await log('PASS: authenticated outside wager rejected without wallet or ledger debit.');
 const path = [[-5, -17], [-5, 10], [0, 11], [0, 26.7], [-12, 26.7], [-12, 48], [-11.5, 49.5]];
 await Promise.all([owner, spectator].map(async c => { for (const [x, z] of path) await walk(c, x, z); }));
 await log('PASS: two real clients walked through entrance and rear aisle to craps.');
 let late: Connected | undefined, lateGuest: Awaited<ReturnType<typeof guest>> | undefined;
 let throws = 0, cycles = 0, sawPoint = false, reconnected = false;
 while (!sawPoint || cycles === 0) {
  assert.ok(throws < 60, 'Bounded live random coverage did not reach point and terminal cycle within 60 throws');
  await until(() => craps(spectator).phase === 'betting' && craps(spectator).deadline - Date.now() > 4000, 'fresh come-out window', 30_000);
  const roundId = craps(spectator).roundId, requestId = randomUUID();
  const beforeOwner = (await wallet(ownerGuest.cookie)).balance, beforeSpectator = (await wallet(spectatorGuest.cookie)).balance;
  const ownerBet: Action = { action: 'craps-bet', tableId: 'craps-1', roundId, bet: { kind: 'pass', stake: 10 } };
  const accepted = await command(owner, ownerBet, requestId);
  assert.equal(accepted.ok, true); assert.equal(accepted.wallet?.balance, beforeOwner - 10);
  assert.equal((await command(owner, ownerBet, requestId)).wagerId, accepted.wagerId);
  assert.equal((await command(owner, { ...ownerBet, bet: { kind: 'dont-pass', stake: 10 } }, requestId)).code, 'request_conflict');
  assert.equal((await command(owner, ownerBet)).code, 'already_bet');
  const second = await command(spectator, { action: 'craps-bet', tableId: 'craps-1', roundId, bet: { kind: 'dont-pass', stake: 10 } });
  assert.equal(second.ok, true);
  await until(() => owner.privateState?.crapsBets?.length === 1 && spectator.privateState?.crapsBets?.length === 1, 'individual private wagers');
  assert.equal(owner.privateState!.crapsBets![0].wagerId, accepted.wagerId);
  assert.equal(spectator.privateState!.crapsBets![0].wagerId, second.wagerId);
  assert.ok(!JSON.stringify(craps(spectator)).includes('stake'));
  if (!cycles) assert.equal(craps(owner).shooter?.profileId, ownerGuest.profile.id);
  await until(() => craps(spectator).phase === 'awaiting-roll', 'come-out awaiting shooter', 25_000);
  let terminal = false;
  while (!terminal) {
   assert.ok(throws++ < 60, 'Live throw bound exceeded');
   const before = craps(spectator), rollId = before.rollId;
   const shooter = before.shooter?.profileId === ownerGuest.profile.id ? owner : spectator;
   const nonshooter = shooter === owner ? spectator : owner;
   const action: Action = { action: 'craps-roll', tableId: 'craps-1', roundId, rollId };
   const rejectedRoll = await command(nonshooter, action);
   assert.ok(rejectedRoll.code === 'not_shooter' || (reconnected && rejectedRoll.code === 'too_far'));
   const rollRequest = randomUUID();
   assert.equal((await command(shooter, action, rollRequest)).ok, true);
   await until(() => !!spectator.motions.get(rollId) && !!owner.motions.get(rollId), 'shared rolling descriptor');
   const motion = spectator.motions.get(rollId)!.motion!;
   assert.deepEqual(owner.motions.get(rollId)!.motion, motion);
   assert.equal((await command(shooter, action, rollRequest)).ok, true);
   assert.deepEqual(craps(spectator).motion, motion);
   assert.equal((await command(shooter, action)).code, 'invalid_roll');
   assert.equal(craps(spectator).result, null);
   assert.equal(craps(spectator).point, before.point);
   const expected = resolveCraps(motion.dice, before.point);
   if (!late) {
    lateGuest = await guest('Late craps spectator');
    late = watch(await client(lateGuest.cookie).joinById<TownState>(owner.room.roomId));
    await command(late, { action: 'sync' });
    await until(() => craps(late!).motion?.rollId === rollId, 'late-join motion');
    assert.equal(craps(late).phase, 'rolling'); assert.equal(craps(late).result, null);
    assert.deepEqual(craps(late).motion, motion); assert.deepEqual(late.privateState!.crapsBets, []);
    for (const time of [motion.startedAt + 900, motion.startedAt + 2400, motion.startedAt + 4200]) {
     const pose = sampleCrapsMotion(motion, time);
     assert.deepEqual(sampleCrapsMotion(owner.motions.get(rollId)!.motion, time), pose);
     assert.deepEqual(sampleCrapsMotion(craps(late).motion, time), pose);
    }
    await log('PASS: late third client received identical rolling descriptor and sampled dice poses.');
   }
   // Reconnect once while the first dice are moving; private wager survives, old shooter session does not.
   if (!reconnected) {
    const roomId = owner.room.roomId; await owner.room.leave();
    owner = watch(await client(ownerGuest.cookie).joinById<TownState>(roomId));
    await command(owner, { action: 'sync' });
    await until(() => owner.privateState?.crapsBets?.[0]?.wagerId === accepted.wagerId, 'reconnected private wager');
    await until(() => craps(spectator).shooter?.profileId === spectatorGuest.profile.id, 'departure assigns next shooter');
    assert.equal(craps(owner).shooter?.profileId, spectatorGuest.profile.id);
    reconnected = true;
    await log('PASS: real reconnect restored private wager and preserved replacement shooter.');
   }
   // Every received rolling snapshot hides result/point changes before the server landing deadline.
   for (const c of [owner, spectator, late]) {
    const snapshot = c.motions.get(rollId);
    if (snapshot) { assert.equal(snapshot.result, null); assert.equal(snapshot.point, before.point); }
   }
   await until(() => spectator.results.has(rollId) && owner.results.has(rollId) && late!.results.has(rollId), 'all clients receive landed result', 9000);
   for (const c of [owner, spectator, late]) assert.deepEqual(c.results.get(rollId)!.result, expected);
   const rows = (await database.query('SELECT id,status,returned FROM casino_wagers WHERE id=ANY($1::uuid[])', [[accepted.wagerId, second.wagerId]])).rows;
   terminal = expected.pointAfter === null;
   if (!terminal) {
    sawPoint = true;
    assert.ok(rows.every(r => r.status === 'pending' && r.returned === null));
    assert.equal((await wallet(ownerGuest.cookie)).balance, beforeOwner - 10);
    assert.equal((await wallet(spectatorGuest.cookie)).balance, beforeSpectator - 10);
    assert.equal((await command(spectator, { action: 'craps-bet', tableId: 'craps-1', roundId, bet: { kind: 'pass', stake: 10 } })).code, 'betting_closed');
    await until(() => craps(spectator).phase === 'awaiting-roll', 'next point throw', 9000);
   } else {
    const passReturn = crapsReturn({ kind: 'pass', stake: 10 }, expected), dontReturn = crapsReturn({ kind: 'dont-pass', stake: 10 }, expected);
    assert.equal(rows.find(r => r.id === accepted.wagerId).returned, passReturn);
    assert.equal(rows.find(r => r.id === second.wagerId).returned, dontReturn);
    assert.ok(rows.every(r => r.status === 'settled'));
    assert.equal((await wallet(ownerGuest.cookie)).balance, beforeOwner - 10 + passReturn);
    assert.equal((await wallet(spectatorGuest.cookie)).balance, beforeSpectator - 10 + dontReturn);
    assert.equal((await command(owner, ownerBet, requestId)).wagerId, accepted.wagerId);
    assert.equal((await wallet(ownerGuest.cookie)).balance, beforeOwner - 10 + passReturn);
    const ledger = await database.query('SELECT w.balance,COALESCE(sum(l.amount),0)::integer AS ledger FROM economy_wallets w LEFT JOIN economy_ledger l ON l.profile_id=w.profile_id GROUP BY w.profile_id,w.balance');
    assert.ok(ledger.rows.every(r => r.balance === r.ledger));
    cycles++;
    await log(`PASS: live cycle ${cycles}, throw ${throws}, dice ${expected.dice.join('+')}, ${expected.resolution}; both API wallets and PostgreSQL ledger reconcile exactly once.`);
   }
  }
  // A reconnect may respawn outside: restore owner proximity only if another real cycle is needed.
  if (!sawPoint) for (const [x, z] of path) await walk(owner, x, z);
 }
 assert.ok(late && lateGuest && reconnected);
 assert.ok(late.privateMessages.every(m => m.crapsBets?.length === 0));
 assert.equal((await wallet(lateGuest.cookie)).balance, 1000);
 await log(`PASS: craps network complete; ${throws} real crypto-RNG throws, ${cycles} terminal cycles, point-held wagers observed, three clients, late join and reconnect. No browser or physical-device claim.`);
} catch (error) {
 await log(`FAIL: ${error instanceof assert.AssertionError ? error.message : error instanceof Error && error.message.startsWith('Timed out:') ? error.message : 'Network check failed (details suppressed to protect connection configuration)'}`);
 process.exitCode = 1;
} finally {
 await Promise.allSettled(connections.filter(c => c.room.connection?.isOpen).map(c => c.room.leave()));
 server.kill('SIGTERM');
 await until(() => server.exitCode !== null || server.signalCode !== null, 'isolated server exit');
 await database.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
}
