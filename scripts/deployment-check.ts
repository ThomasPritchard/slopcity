// Destructive lifecycle checks are restricted to the generated, loopback-only
// slop-city-smoke Docker project. Never point this script at a deployed VPS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { request } from 'node:https';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { connect as connectTls } from 'node:tls';
import WebSocket from 'ws';
import { AccessToken } from 'livekit-server-sdk';
import type { Room } from '@colyseus/sdk';
import type { TownState } from '../shared/state.ts';
import type { PrivateGuestProfile } from '../shared/profile.ts';
import type { WalletState } from '../shared/catalog.ts';

const directory = resolve('.deploy-smoke');
const composeEnv = parseEnv(await readFile(`${directory}/compose.env`, 'utf8'));
const gameEnv = parseEnv(await readFile(`${directory}/game.env`, 'utf8'));
assert.equal(composeEnv.COMPOSE_PROJECT_NAME, 'slop-city-smoke', 'only the smoke Docker project may be mutated');
assert.ok(composeEnv.DEPLOY_DIR);
assert.equal(resolve(composeEnv.DEPLOY_DIR), directory);
assert.equal(composeEnv.BIND_IP, '127.0.0.1', 'smoke Docker ports must be loopback-only');
assert.ok(gameEnv.APP_ORIGIN && gameEnv.LIVEKIT_PUBLIC_URL && gameEnv.LIVEKIT_API_KEY && gameEnv.LIVEKIT_API_SECRET);
const origin = gameEnv.APP_ORIGIN;
const voiceOrigin = gameEnv.LIVEKIT_PUBLIC_URL.replace(/^wss:/, 'https:');
function localUrl(value: string | URL) {
  const url = new URL(value);
  assert.ok(['https:', 'wss:'].includes(url.protocol), 'smoke requests must use TLS');
  assert.ok(url.hostname.endsWith('.localhost'), 'refusing a non-local smoke endpoint');
  assert.equal(url.port, composeEnv.HTTPS_PORT);
  assert.ok(!url.username && !url.password);
  return url;
}
localUrl(origin); localUrl(voiceOrigin);
// Lookup is supplied on each test connection; neither DNS nor process-global TLS
// settings change. The deliberately local Caddy CA is bypassed only here.
const lookup: import('node:net').LookupFunction = (_hostname, options, callback) => {
  if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
  else callback(null, '127.0.0.1', 4);
};
async function localFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = localUrl(input instanceof Request ? input.url : input);
  const headers = Object.fromEntries(new Headers(init.headers));
  return new Promise((resolveResponse, reject) => {
    const req = request(url, { method: init.method ?? 'GET', headers, lookup, rejectUnauthorized: false, timeout: 10000 }, res => {
      const parts: Buffer[] = [];
      res.on('data', part => parts.push(Buffer.from(part)));
      res.on('error', reject);
      res.on('end', () => {
        const responseHeaders = new Headers();
        for (let index = 0; index < res.rawHeaders.length; index += 2) responseHeaders.append(res.rawHeaders[index], res.rawHeaders[index + 1]);
        const status = res.statusCode!;
        resolveResponse(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(parts), { status, headers: responseHeaders }));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Local smoke HTTP request timed out')));
    req.on('error', reject);
    if (init.body !== undefined && init.body !== null) {
      assert.equal(typeof init.body, 'string', 'smoke client expects JSON text bodies');
      req.write(init.body);
    }
    req.end();
  });
}
class LocalSocket extends WebSocket {
  constructor(url: string | URL, options: WebSocket.ClientOptions = {}) {
    localUrl(url);
    super(url, { ...options, lookup, rejectUnauthorized: false, handshakeTimeout: 10000 });
  }
}
globalThis.WebSocket = LocalSocket as unknown as typeof globalThis.WebSocket;
const { Client } = await import('@colyseus/sdk');
const composeArgs = ['compose', '--env-file', `${directory}/compose.env`, '--project-name', 'slop-city-smoke'];
async function docker(args: string[], input?: Buffer, captureStderr = false): Promise<Buffer> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn('docker', [...composeArgs, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const parts: Buffer[] = [];
    let bytes = 0;
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Docker smoke command timed out (${args[0]})`)); }, 60000);
    const collect = (data: Buffer) => {
      bytes += data.length;
      if (bytes > 64 * 1024 * 1024) { child.kill('SIGKILL'); reject(new Error('Smoke command output exceeded memory bound')); }
      else parts.push(Buffer.from(data));
    };
    child.stdout.on('data', collect);
    // Only the explicit diagnostics path collects stderr, then redacts it.
    if (captureStderr) child.stderr.on('data', collect); else child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Unable to execute Docker smoke command')); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolveOutput(Buffer.concat(parts));
      else reject(new Error(`Docker smoke command failed (${args[0]}, exit ${code})`));
    });
    child.stdin.end(input);
  });
}
if (process.argv.includes('--diagnostics')) {
  const credentials = [
    gameEnv.DATABASE_URL!, gameEnv.LIVEKIT_API_KEY!, gameEnv.LIVEKIT_API_SECRET!, gameEnv.ABUSE_PROXY_SECRET ?? '',
    await readFile(`${directory}/postgres-password`, 'utf8'),
    await readFile(`${directory}/app-password`, 'utf8'),
  ];
  const redact = (value: string) => {
    for (const credential of credentials) if (credential.trim()) value = value.replaceAll(credential.trim(), '[REDACTED]');
    return value
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED JWT]')
      .replace(/(slop_guest=)[A-Za-z0-9_-]+/g, '$1[REDACTED]')
      .replace(/(access_token=)[^&\s"\\]+/gi, '$1[REDACTED]');
  };
  console.log(redact((await docker(['ps', '--all', '--format', '{{.Service}} {{.State}} {{.Health}} {{.ExitCode}}'])).toString()));
  console.log(redact((await docker(['logs', '--no-color', '--tail', '60', 'game', 'livekit', 'edge', 'postgres'], undefined, true)).toString()));
  process.exit(0);
}
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`); await delay(50); }
}
async function healthy() {
  await until(async () => { try { return (await localFetch(`${origin}/game/health`)).status === 200; } catch { return false; } }, 'Docker game health', 45000);
}
async function checkTurn() {
  const target = localUrl(`https://turn.localhost:${composeEnv.HTTPS_PORT}`);
  const transaction = randomBytes(12);
  const allocation = Buffer.alloc(28);
  allocation.writeUInt16BE(0x0003, 0); // Allocate request.
  allocation.writeUInt16BE(8, 2);
  allocation.writeUInt32BE(0x2112a442, 4);
  transaction.copy(allocation, 8);
  allocation.writeUInt16BE(0x0019, 20); // REQUESTED-TRANSPORT.
  allocation.writeUInt16BE(4, 22); allocation[24] = 17; // UDP.
  await new Promise<void>((resolveProbe, reject) => {
    const socket = connectTls({ host: '127.0.0.1', port: Number(target.port), servername: target.hostname, rejectUnauthorized: false });
    let received = Buffer.alloc(0);
    const finish = (error?: Error) => { clearTimeout(timeout); socket.destroy(); error ? reject(error) : resolveProbe(); };
    const timeout = setTimeout(() => finish(new Error('Local TURN/TLS probe timed out')), 10000);
    socket.once('error', () => finish(new Error('Local TURN/TLS connection failed')));
    socket.once('secureConnect', () => socket.write(allocation));
    socket.on('data', chunk => {
      received = Buffer.concat([received, chunk]);
      if (received.length < 20 || received.length < 20 + received.readUInt16BE(2)) return;
      try {
        assert.equal(received.readUInt16BE(0), 0x0113, 'TURN Allocate error response');
        assert.equal(received.readUInt32BE(4), 0x2112a442);
        assert.deepEqual(received.subarray(8, 20), transaction);
        let errorCode = 0;
        for (let offset = 20; offset + 4 <= received.length;) {
          const type = received.readUInt16BE(offset), length = received.readUInt16BE(offset + 2);
          assert.ok(offset + 4 + length <= received.length, 'complete TURN attribute');
          if (type === 0x0009 && length >= 4) errorCode = (received[offset + 6] & 7) * 100 + received[offset + 7];
          offset += 4 + Math.ceil(length / 4) * 4;
        }
        assert.equal(errorCode, 401, 'TURN requires authenticated allocation');
        finish();
      } catch { finish(new Error('Local TURN/TLS probe did not receive the expected authenticated Allocate challenge')); }
    });
  });
  console.log('PASS: TURN/TLS SNI route returns an authenticated Allocate challenge (media not measured).');
}
if (process.argv.includes('--turn-only')) { await checkTurn(); process.exit(0); }
const rooms: Room<unknown, TownState>[] = [];
const chats = new Map<string, string[]>();
function watch(room: Room<unknown, TownState>) {
  rooms.push(room); chats.set(room.sessionId, []);
  room.onMessage<{ body: string }>('chat', message => chats.get(room.sessionId)!.push(message.body));
  for (const type of ['voice-neighbours', 'notice', 'economy', 'economy-error', 'casino-state', 'casino-private', 'casino-receipt']) room.onMessage(type, () => {});
  // A planned service restart must not produce reconnect retries.
  room.reconnection.enabled = false;
  return room;
}
async function guest(name: string) {
  const response = await localFetch(`${origin}/game/api/guest`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, shirt: 1, skin: 2 }) });
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /; Secure(?:;|$)/); assert.match(cookie, /; HttpOnly(?:;|$)/);
  assert.match(cookie, /; Path=\/game(?:;|$)/); assert.match(cookie, /; SameSite=Strict(?:;|$)/);
  return { cookie: cookie.split(';')[0], profile: await response.json() as PrivateGuestProfile };
}
async function api(path: string, cookie: string) {
  const response = await localFetch(`${origin}/game/api/${path}`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200); return response.json();
}
const client = (cookie: string) => new Client(`${origin}/game`, { fetchFn: localFetch, headers: { Cookie: cookie, Origin: origin } });
const restoreDatabase = `smoke_restore_${randomUUID().replaceAll('-', '')}`;
let restoreCreated = false;
try {
  await healthy();
  await docker(['exec', '-T', 'livekit', 'sh', '-c', 'test -r /etc/livekit.yaml']);
  const index = await localFetch(origin);
  assert.equal(index.status, 200);
  const html = await index.text();
  const asset = html.match(/src="([^\"]+\.js)"/)?.[1];
  assert.ok(asset, 'built HTML contains a JavaScript entry');
  const javascript = await localFetch(new URL(asset, origin));
  assert.equal(javascript.status, 200); assert.match(javascript.headers.get('content-type')!, /javascript/);
  for (const path of ['/.env', '/.git/config', '/.deploy/game.env']) assert.equal((await localFetch(`${origin}${path}`)).status, 404);
  assert.equal((await localFetch(`${origin}/game/api/guest`, { method: 'POST', headers: { Origin: 'https://untrusted.localhost:8443', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  console.log('PASS: built assets, private-file rejection and origin enforcement through HTTPS edge.');

  const guests = [];
  for (let index = 0; index < 10; index++) guests.push(await guest(`Smoke ${index + 1}`));
  const owner = watch(await client(guests[0].cookie).create<TownState>('town'));
  for (const entry of guests.slice(1)) watch(await client(entry.cookie).joinById<TownState>(owner.roomId));
  await until(() => rooms.every(room => room.state?.players?.size === 10), '10 replicated game clients');
  rooms[1].send('chat', 'Docker social smoke'); rooms[1].send('wave');
  await until(() => rooms.every(room => chats.get(room.sessionId)!.includes('Docker social smoke')), 'shared chat');
  await until(() => owner.state.players.get(rooms[1].sessionId)!.wave > 0, 'replicated wave');
  const wallet = await api('economy', guests[0].cookie) as WalletState;
  console.log('PASS: 10 guest clients, secure cookies, shared population, chat and wave over proxied WSS.');

  const initialAccount = await api('account', guests[0].cookie);
  assert.equal(initialAccount.kind, 'guest');
  assert.equal(initialAccount.emailEnabled, false, 'production email is disabled by default in the disposable smoke stack');
  const uploadBody = { requestId: randomUUID(), title: 'Container community check', credit: 'Disposable acceptance', imageBase64: (await readFile('public/community/first-memory.png')).toString('base64') };
  const deniedGuestUpload = await localFetch(`${origin}/game/api/community/submissions`, {
    method: 'POST', headers: { Cookie: guests[0].cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(uploadBody),
  });
  assert.equal(deniedGuestUpload.status, 403, 'guest profiles cannot submit images');
  // Fixture membership only: the guarded disposable Compose database never sends email.
  assert.match(guests[0].profile.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  await docker(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'slop_city', '-v', 'ON_ERROR_STOP=1', '-c',
    `INSERT INTO player_accounts(profile_id,email_normalized) VALUES('${guests[0].profile.id}','container-member@example.invalid')`]);
  const memberAccount = await api('account', guests[0].cookie);
  assert.equal(memberAccount.kind, 'member');
  assert.equal(memberAccount.emailEnabled, false);

  const submitted = await localFetch(`${origin}/game/api/community/submissions`, {
    method: 'POST', headers: { Cookie: guests[0].cookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(uploadBody),
  });
  assert.equal(submitted.status, 201, 'production image decoder accepts the supplied still image');
  const submission = await submitted.json() as { id: string; imageUrl: string; status: string };
  assert.equal(submission.status, 'pending');
  const imageResponse = await localFetch(`${origin}${submission.imageUrl}`, { headers: { Cookie: guests[0].cookie } });
  assert.equal(imageResponse.status, 200);
  const normalisedImage = Buffer.from(await imageResponse.arrayBuffer());
  assert.equal(normalisedImage.toString('ascii', 8, 12), 'WEBP');
  assert.equal((await localFetch(`${origin}/game/api/community/images/${submission.id}`)).status, 404);
  assert.equal((await localFetch(`${origin}${submission.imageUrl}`, { headers: { Cookie: guests[1].cookie } })).status, 404);
  console.log('PASS: guest upload denial, fixture member image decoding, private pending upload and denied public/other-guest reads through HTTPS.');

  const voice = await localFetch(`${origin}/game/api/voice/token`, { method: 'POST', headers: { Cookie: guests[0].cookie, Origin: origin } });
  assert.equal(voice.status, 200);
  const grant = await voice.json() as { token: string; url: string };
  assert.equal(grant.url, gameEnv.LIVEKIT_PUBLIC_URL); assert.ok(grant.token.length > 30);
  const listGrant = new AccessToken(gameEnv.LIVEKIT_API_KEY, gameEnv.LIVEKIT_API_SECRET, { ttl: '30s' });
  listGrant.addGrant({ roomList: true });
  const list = await localFetch(`${voiceOrigin}/twirp/livekit.RoomService/ListRooms`, { method: 'POST', headers: { Authorization: `Bearer ${await listGrant.toJwt()}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(list.status, 200);
  await list.json();
  console.log('PASS: authenticated voice token and LiveKit API reachable through separate TLS voice hostname (media not measured).');

  await checkTurn();

  await docker(['restart', 'game']);
  await healthy();
  const restored = await api('profile', guests[0].cookie) as PrivateGuestProfile;
  assert.equal(restored.id, guests[0].profile.id); assert.equal(restored.name, guests[0].profile.name);
  const restoredAccount = await api('account', guests[0].cookie);
  assert.equal(restoredAccount.kind, 'member');
  assert.equal(restoredAccount.email, memberAccount.email);
  assert.equal(restoredAccount.emailEnabled, false);
  const restoredWallet = await api('economy', guests[0].cookie) as WalletState;
  assert.equal(restoredWallet.balance, wallet.balance); assert.deepEqual(restoredWallet.owned, wallet.owned);
  const restoredImage = await localFetch(`${origin}${submission.imageUrl}`, { headers: { Cookie: guests[0].cookie } });
  assert.equal(restoredImage.status, 200);
  assert.deepEqual(Buffer.from(await restoredImage.arrayBuffer()), normalisedImage);
  const rejoined = watch(await client(guests[0].cookie).create<TownState>('town'));
  await until(() => rejoined.state?.players?.size === 1, 'post-restart admission');
  await rejoined.leave();
  console.log('PASS: game container restart preserves profile identity, fixture email membership, wallet and clothing; admission works again.');

  const countSql = "SELECT (SELECT count(*) FROM guest_profiles), (SELECT count(*) FROM economy_wallets), (SELECT count(*) FROM economy_owned), (SELECT count(*) FROM casino_wagers), (SELECT count(*) FROM community_images), (SELECT md5(string_agg(encode(image,'hex'),'' ORDER BY id)) FROM community_images), (SELECT revision FROM community_programme WHERE singleton)";
  const counts = await docker(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'slop_city', '-At', '-v', 'ON_ERROR_STOP=1', '-c', countSql]);
  const backup = await docker(['exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-d', 'slop_city', '--format=custom', '--no-owner']);
  assert.ok(backup.length > 100);
  await docker(['exec', '-T', 'postgres', 'createdb', '-U', 'postgres', restoreDatabase]); restoreCreated = true;
  await docker(['exec', '-T', 'postgres', 'pg_restore', '-U', 'postgres', '-d', restoreDatabase, '--no-owner', '--exit-on-error'], backup);
  const restoredCounts = await docker(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', restoreDatabase, '-At', '-v', 'ON_ERROR_STOP=1', '-c', countSql]);
  assert.equal(restoredCounts.toString(), counts.toString());
  console.log('PASS: PostgreSQL backup restored into a temporary database; player/game counts, community image bytes and programme revision match.');
} finally {
  await Promise.allSettled(rooms.filter(room => room.connection?.isOpen).map(room => room.leave(false)));
  if (restoreCreated) await docker(['exec', '-T', 'postgres', 'dropdb', '-U', 'postgres', '--if-exists', restoreDatabase]);
}
