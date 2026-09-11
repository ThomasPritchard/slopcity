import assert from 'node:assert/strict';
import test from 'node:test';
import { TwitchLiveService } from '../server/twitchLive.ts';

const live = { data: [{ id: 'stream-1', user_login: 'bridgemindai', type: 'live' }] };
const offline = { data: [] };
const token = { access_token: 'fixture-token', expires_in: 7200 };
const valid = { client_id: 'fixture-client', expires_in: 7200 };
function fixture(replies: Array<object | Response | Error>, options: { pollMs?: number; timeoutMs?: number } = {}) {
 let time = 1_000_000;
 const calls: Array<{ url: string; init?: RequestInit }> = [];
 const fetcher: typeof fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  const reply = replies.shift();
  assert.ok(reply, 'Unexpected network call');
  if (reply instanceof Error) throw reply;
  return reply instanceof Response ? reply : Response.json(reply);
 };
 const service = new TwitchLiveService({ clientId: 'fixture-client', clientSecret: 'fixture-secret', fetch: fetcher, now: () => time, ...options });
 return { service, calls, advance: (ms: number) => { time += ms; } };
}
test('Twitch starts checking, confirms public live state, and needs two empty checks for offline', async () => {
 const { service, calls } = fixture([token, valid, live, offline, offline]);
 assert.equal(service.snapshot().status, 'checking');
 await service.refresh();
 assert.deepEqual(service.snapshot(), { status: 'live', isLive: true, streamId: 'stream-1', checkedAt: 1_000_000 });
 assert.equal(calls[0].url, 'https://id.twitch.tv/oauth2/token');
 assert.equal(new URLSearchParams(calls[0].init!.body as URLSearchParams).get('grant_type'), 'client_credentials');
 assert.equal(calls[1].url, 'https://id.twitch.tv/oauth2/validate');
 assert.equal(calls[2].url, 'https://api.twitch.tv/helix/streams?user_login=bridgemindai');
 assert.ok(calls.every(call => call.init?.redirect === 'error'));
 await service.refresh(); assert.equal(service.snapshot().status, 'live');
 await service.refresh(); assert.equal(service.snapshot().status, 'offline'); assert.equal(service.snapshot().isLive, false);
});
test('Twitch errors preserve confirmed state and reset offline debounce', async () => {
 const { service } = fixture([token, valid, live, offline, new Error('network'), offline, offline]);
 await service.refresh(); await service.refresh(); await service.refresh();
 assert.equal(service.snapshot().status, 'unknown'); assert.equal(service.snapshot().isLive, true);
 await service.refresh(); assert.equal(service.snapshot().isLive, true);
 await service.refresh(); assert.equal(service.snapshot().isLive, false);
});
test('Twitch renews expiring tokens, validates hourly, and retries Helix 401 once', async () => {
 const { service, calls, advance } = fixture([token, valid, live, valid, live, token, valid, live, new Response(null, { status: 401 }), token, valid, live]);
 await service.refresh();
 advance(3_600_000); await service.refresh();
 assert.equal(calls.filter(call => call.url.endsWith('/validate')).length, 2);
 advance(7_200_000); await service.refresh();
 assert.equal(calls.filter(call => call.url.endsWith('/token')).length, 2);
 await service.refresh(); assert.equal(service.snapshot().status, 'live');
 assert.equal(calls.filter(call => call.url.endsWith('/token')).length, 3);
 const denied = fixture([token, valid, new Response(null, { status: 401 }), token, valid, new Response(null, { status: 401 })]);
 await denied.service.refresh(); assert.equal(denied.calls.length, 6); assert.equal(denied.service.snapshot().status, 'unknown');
});
test('Twitch validates newly acquired tokens and replaces a revoked validation token', async () => {
 const { service, calls, advance } = fixture([token, valid, live, new Response(null, { status: 401 }), token, valid, live]);
 await service.refresh(); advance(3_600_000); await service.refresh();
 assert.equal(service.snapshot().status, 'live'); assert.equal(calls.filter(call => call.url.endsWith('/token')).length, 2);
});
test('Twitch respects rate reset without treating rate limits as offline', async () => {
 const { service, calls, advance } = fixture([token, valid, live, new Response(null, { status: 429, headers: { 'Ratelimit-Reset': '1120' } }), offline, offline]);
 await service.refresh(); await service.refresh();
 assert.equal(service.snapshot().status, 'unknown'); assert.equal(service.snapshot().isLive, true);
 await service.refresh(); assert.equal(calls.length, 4);
 advance(119_999); await service.refresh(); assert.equal(calls.length, 4);
 advance(1); await service.refresh(); assert.equal(calls.length, 5); assert.equal(service.snapshot().isLive, true);
 await service.refresh(); assert.equal(service.snapshot().isLive, false);
});
test('Twitch missing credentials performs no network calls', async () => {
 for (const credentials of [{ clientId: '', clientSecret: 'secret' }, { clientId: 'id', clientSecret: '' }]) {
  const service = new TwitchLiveService({ ...credentials, fetch: async () => { throw new Error('Must not fetch'); } });
  service.start(); await service.refresh(); assert.equal(service.snapshot().status, 'unconfigured'); service.stop();
 }
});
test('Twitch refresh is single-flight, stop aborts work and prevents later polling', async () => {
 let calls = 0;
 let signal: AbortSignal | undefined;
 const service = new TwitchLiveService({ clientId: 'id', clientSecret: 'secret', pollMs: 5, fetch: async (_url, init) => {
  calls++; signal = init!.signal!;
  return new Promise<Response>((_resolve, reject) => { signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
 } });
 service.start(); const pending = service.refresh(); assert.equal(service.refresh(), pending);
 assert.equal(calls, 1); service.stop(); assert.equal(signal!.aborted, true); await pending;
 await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, 1);
 await service.refresh(); assert.equal(calls, 1);
});
test('Twitch timeout reports unknown and self polling stops cleanly', async () => {
 let calls = 0;
 const service = new TwitchLiveService({ clientId: 'id', clientSecret: 'secret', timeoutMs: 5, pollMs: 5, fetch: async (_url, init) => {
  calls++; return new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true }); });
 } });
 service.start(); await service.refresh(); assert.equal(service.snapshot().status, 'unknown'); assert.equal(service.snapshot().isLive, null);
 service.stop(); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, 1);
});
