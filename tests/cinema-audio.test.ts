import test from 'node:test';
import assert from 'node:assert/strict';
import { cinemaProximityVolume, loadTwitchPlayerSDK, TwitchCinemaPlayer, type TwitchPlayerSDK } from '../src/world/twitchPlayer.ts';

class Element extends EventTarget {
  style = {};
  className = '';
  src = '';
  async = false;
  title = '';
  children: Element[] = [];
  parent: Element | null = null;
  constructor(readonly ownerDocument: FakeDocument, readonly tag = 'div') { super(); }
  append(child: Element) { child.parent = this; this.children.push(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  querySelector(tag: string): Element | null { return this.children.find(child => child.tag === tag) ?? null; }
}
class FakeDocument {
  defaultView: { location: { hostname: string }; navigator: { userActivation: { hasBeenActive: boolean } }; Twitch?: TwitchPlayerSDK } = {
    location: { hostname: 'localhost' }, navigator: { userActivation: { hasBeenActive: true } },
  };
  head = new Element(this, 'head');
  createElement(tag: string) { return new Element(this, tag); }
  querySelector() { return this.head.children.find(child => child.tag === 'script') ?? null; }
}
function fixture() {
  const document = new FakeDocument(), container = new Element(document);
  const instances: Player[] = [];
  class Player {
    static READY = 'ready'; static PLAYING = 'playing'; static PAUSE = 'pause'; static ENDED = 'ended'; static OFFLINE = 'offline'; static PLAYBACK_BLOCKED = 'blocked'; static ERROR = 'error';
    listeners = new Map<string, Set<() => void>>();
    calls: Array<[string, number | boolean | undefined]> = [];
    muted: boolean;
    volume = 1;
    paused = true;
    acceptPlay = true;
    constructor(host: HTMLElement, readonly options: { muted: boolean; channel: string; parent: string[]; autoplay: boolean; width: number; height: number }) {
      this.muted = options.muted;
      (host as unknown as Element).append(new Element(document, 'iframe'));
      instances.push(this);
    }
    addEventListener(event: string, callback: () => void) { const set = this.listeners.get(event) ?? new Set(); set.add(callback); this.listeners.set(event, set); }
    removeEventListener(event: string, callback: () => void) { this.listeners.get(event)?.delete(callback); }
    emit(event: string) { if (event === 'playing') this.paused = false; if (event === 'pause') this.paused = true; for (const callback of this.listeners.get(event) ?? []) callback(); }
    play() { this.calls.push(['play', undefined]); if (this.acceptPlay) this.paused = false; }
    pause() { this.calls.push(['pause', undefined]); this.paused = true; }
    setVolume(volume: number) { this.calls.push(['volume', volume]); this.volume = volume; }
    setMuted(muted: boolean) { this.calls.push(['mute', muted]); this.muted = muted; }
    getMuted() { return this.muted; }
    getVolume() { return this.volume; }
    isPaused() { return this.paused; }
    destroy() { this.calls.push(['destroy', undefined]); }
  }
  const sdk: TwitchPlayerSDK = { Player };
  return { document, container, instances, sdk, element: container as unknown as HTMLElement };
}

test('cinema attenuation has smooth limits and falls monotonically across the listening area', () => {
  for (const d of [0, 2, 8]) assert.equal(cinemaProximityVolume(d), 1);
  assert.equal(cinemaProximityVolume(19), .5);
  for (const d of [30, 100, Infinity, -Infinity, NaN]) assert.equal(cinemaProximityVolume(d), 0);
  let previous = 1;
  for (let d = 8; d <= 30; d += .1) { const volume = cinemaProximityVolume(d); assert.ok(volume >= 0 && volume <= previous); previous = volume; }
  assert.ok(1 - cinemaProximityVolume(8.001) < 1e-8, 'No abrupt volume step at the full-volume boundary');
  assert.ok(cinemaProximityVolume(29.999) < 1e-8, 'No abrupt volume step at the silence boundary');
});

test('disposing while the SDK is loading prevents delayed iframe creation', async () => {
  const f = fixture();
  let resolve!: (sdk: TwitchPlayerSDK) => void;
  const loading = new Promise<TwitchPlayerSDK>(done => { resolve = done; });
  const adapter = new TwitchCinemaPlayer(f.element, {}, () => loading);
  assert.equal(adapter.playWithSound(), false);
  adapter.dispose();
  resolve(f.sdk);
  await adapter.loaded;
  assert.equal(f.instances.length, 0);
  assert.equal(f.container.children.length, 0);
  assert.equal(adapter.status.disposed, true);
});

test('READY applies queued attenuation and the initial mute choice before one explicit autoplay request', async t => {
  const f = fixture(), adapter = new TwitchCinemaPlayer(f.element, { muted: true }, async () => f.sdk);
  t.after(() => adapter.dispose());
  adapter.setVolume(.4);
  await adapter.loaded;
  const player = f.instances[0];
  assert.deepEqual(player.options, { width: 960, height: 540, channel: 'bridgemindai', parent: ['localhost'], autoplay: true, muted: true });
  assert.deepEqual(player.calls, []);
  assert.equal(adapter.getVolume(), null);
  player.emit('ready');
  player.emit('ready');
  assert.deepEqual(player.calls, [['volume', .4], ['mute', true], ['play', undefined]]);
  assert.equal(adapter.getVolume(), .4);
  player.emit('pause');
  adapter.setVolume(.4);
  adapter.setVolume(4);
  adapter.setVolume(-4);
  adapter.setVolume(NaN);
  assert.deepEqual(player.calls, [['volume', .4], ['mute', true], ['play', undefined], ['volume', 1], ['volume', 0]]);
  assert.equal(adapter.status.muted, true);
  assert.equal(player.paused, true);
  assert.equal(adapter.status.playing, false, 'READY is not evidence that video started');
});

test('blocked sound gets only one muted fallback; only an explicit click retries unmuting', async t => {
  const f = fixture(), adapter = new TwitchCinemaPlayer(f.element, {}, async () => f.sdk);
  t.after(() => adapter.dispose());
  await adapter.loaded;
  const player = f.instances[0];
  assert.equal(player.options.muted, false, 'A prior browser activation permits the initial audible autoplay attempt');
  assert.equal(adapter.playWithSound(), false);
  player.emit('ready');
  player.calls = [];
  player.emit('blocked'); player.emit('blocked'); player.emit('playing');
  assert.equal(adapter.status.playing, true);
  assert.equal(adapter.status.blocked, true, 'Muted fallback does not claim that sound was permitted');
  assert.deepEqual(player.calls.filter(([call]) => call === 'mute' || call === 'play'), [['mute', true], ['play', undefined]]);
  assert.equal(adapter.playWithSound(), true);
  player.emit('playing');
  assert.equal(adapter.status.muted, false);
  assert.equal(adapter.status.blocked, false);
  player.muted = true; // A subsequent native mute click must survive distance changes.
  player.emit('playing');
  adapter.setVolume(.2); adapter.setVolume(.7);
  assert.equal(adapter.status.muted, true);
  assert.equal(player.calls.filter(([call, value]) => call === 'mute' && value === false).length, 1);
  player.emit('pause'); adapter.setVolume(.3);
  assert.equal(adapter.status.playing, false);
});

test('silent autoplay failure gets one muted retry after three seconds even without a BLOCKED event', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(), adapter = new TwitchCinemaPlayer(f.element, {}, async () => f.sdk);
  t.after(() => adapter.dispose());
  await adapter.loaded;
  const player = f.instances[0];
  player.acceptPlay = false;
  player.emit('ready');
  t.mock.timers.tick(2_999);
  assert.equal(player.calls.filter(([call]) => call === 'play').length, 1);
  t.mock.timers.tick(1);
  assert.equal(adapter.status.blocked, true);
  assert.equal(adapter.status.muted, true);
  assert.equal(player.calls.filter(([call]) => call === 'play').length, 2);
  player.emit('blocked');
  t.mock.timers.tick(30_000);
  assert.equal(player.calls.filter(([call]) => call === 'play').length, 2, 'Timeout and event paths share one retry');
});

test('an unstarted SDK Ready state with isPaused false still gets the single no-PLAYING retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(), adapter = new TwitchCinemaPlayer(f.element, {}, async () => f.sdk);
  t.after(() => adapter.dispose());
  await adapter.loaded;
  const player = f.instances[0];
  player.emit('ready');
  assert.equal(player.isPaused(), false, 'Matches the SDK Ready state that was observed before any native video playback');
  t.mock.timers.tick(3_000);
  assert.equal(player.calls.filter(([call]) => call === 'play').length, 2);
  assert.equal(adapter.status.muted, true);
  assert.equal(adapter.status.playing, false, 'An accepted play command is not a PLAYING event');
  t.mock.timers.tick(30_000);
  assert.equal(player.calls.filter(([call]) => call === 'play').length, 2, 'No recurring retry loop');
});

test('first PLAYING cancels the watchdog and later native pauses are never restarted automatically', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(), adapter = new TwitchCinemaPlayer(f.element, {}, async () => f.sdk);
  t.after(() => adapter.dispose());
  await adapter.loaded;
  const player = f.instances[0];
  player.emit('ready');
  player.emit('playing');
  assert.equal(adapter.status.playing, true);
  player.emit('pause');
  player.emit('blocked');
  t.mock.timers.tick(30_000);
  assert.equal(adapter.status.playing, false);
  assert.equal(player.calls.filter(([call]) => call === 'play').length, 1, 'No automatic restart after playback began');
});

test('disposing a ready player cancels the pending autoplay watchdog', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(), adapter = new TwitchCinemaPlayer(f.element, {}, async () => f.sdk);
  await adapter.loaded;
  const player = f.instances[0];
  player.acceptPlay = false;
  player.emit('ready');
  adapter.dispose();
  t.mock.timers.tick(30_000);
  assert.equal(player.calls.filter(([call]) => call === 'play').length, 1);
  assert.equal(adapter.getVolume(), null);
});

test('dispose is idempotent, clears listeners and ignores already queued provider events', async () => {
  const f = fixture(), adapter = new TwitchCinemaPlayer(f.element, {}, async () => f.sdk);
  await adapter.loaded;
  const player = f.instances[0];
  player.emit('ready'); player.emit('playing');
  const lateCallback = [...player.listeners.get('playing')!][0];
  adapter.dispose(); adapter.dispose(); lateCallback(); adapter.setVolume(.2);
  assert.equal(adapter.status.ready, false);
  assert.equal(adapter.status.playing, false);
  assert.equal(adapter.playWithSound(), false);
  assert.equal(f.container.children.length, 0);
  assert.equal([...player.listeners.values()].every(set => set.size === 0), true);
  assert.equal(player.calls.filter(([call]) => call === 'pause').length, 1);
  assert.equal(player.calls.filter(([call]) => call === 'destroy').length, 1);
});

test('SDK loader shares a request and retries after network failure without leaving duplicate scripts', async () => {
  const f = fixture(), document = f.document as unknown as Document;
  const first = loadTwitchPlayerSDK(document), second = loadTwitchPlayerSDK(document);
  assert.equal(first, second);
  assert.equal(f.document.head.children.length, 1);
  f.document.head.children[0].dispatchEvent(new Event('error'));
  await assert.rejects(first, /could not load/);
  assert.equal(f.document.head.children.length, 0);
  const retry = loadTwitchPlayerSDK(document);
  assert.notEqual(retry, first);
  f.document.defaultView.Twitch = f.sdk;
  f.document.head.children[0].dispatchEvent(new Event('load'));
  assert.equal(await retry, f.sdk);
  assert.equal(await loadTwitchPlayerSDK(document), f.sdk);
  assert.equal(f.document.head.children.length, 1);
});

test('SDK failure becomes visible status and never constructs a provider', async () => {
  const f = fixture(), adapter = new TwitchCinemaPlayer(f.element, {}, async () => { throw new Error('network'); });
  await adapter.loaded;
  assert.match(adapter.status.error!, /could not load/);
  assert.equal(f.instances.length, 0);
  adapter.dispose();
});

test('remount snapshots read a recent native mute immediately and cleanup survives provider teardown errors', async () => {
  const f = fixture(), adapter = new TwitchCinemaPlayer(f.element, {}, async () => f.sdk);
  await adapter.loaded;
  const player = f.instances[0];
  player.emit('ready');
  player.muted = true;
  assert.equal(adapter.status.muted, true, 'A mute immediately before walking away is retained before the poll runs');
  player.destroy = () => { throw new Error('provider already detached'); };
  adapter.dispose();
  assert.equal(f.container.children.length, 0);
  assert.equal(adapter.status.disposed, true);
  assert.equal(adapter.status.muted, true);
});
