import { BRIDGEMIND_TWITCH_CHANNEL } from '../../shared/community';

export interface TwitchPlayerHandle {
  addEventListener(event: string, callback: () => void): void;
  removeEventListener?(event: string, callback: () => void): void;
  play(): void;
  pause(): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  getMuted(): boolean;
  getVolume(): number;
  isPaused(): boolean;
  destroy?(): void;
}
export interface TwitchPlayerSDK {
  Player: {
    new (container: HTMLElement, options: { width: number; height: number; channel: string; parent: string[]; autoplay: boolean; muted: boolean }): TwitchPlayerHandle;
    READY: string; PLAYING: string; PAUSE: string; ENDED: string; OFFLINE: string; PLAYBACK_BLOCKED: string; ERROR?: string;
  };
}
const SCRIPT_URL = 'https://player.twitch.tv/js/embed/v1.js';
const loaders = new WeakMap<Document, Promise<TwitchPlayerSDK>>();

/** One SDK request per document; failures can be retried by a later mount. */
export function loadTwitchPlayerSDK(document: Document): Promise<TwitchPlayerSDK> {
  const getSDK = () => (document.defaultView as (Window & { Twitch?: TwitchPlayerSDK }) | null)?.Twitch;
  const available = getSDK();
  if (available?.Player) return Promise.resolve(available);
  const pending = loaders.get(document);
  if (pending) return pending;
  const promise = new Promise<TwitchPlayerSDK>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    const script = existing ?? document.createElement('script');
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
      const sdk = getSDK();
      if (error || !sdk?.Player) {
        if (!existing) script.remove();
        reject(error ?? new Error('Twitch player SDK is unavailable.'));
      } else resolve(sdk);
    };
    const loaded = () => finish();
    const failed = () => finish(new Error('Twitch player SDK could not load.'));
    const timeout = setTimeout(() => finish(new Error('Twitch player SDK timed out.')), 15_000);
    script.addEventListener('load', loaded);
    script.addEventListener('error', failed);
    if (!existing) {
      script.src = SCRIPT_URL;
      script.async = true;
      document.head.append(script);
    }
  });
  loaders.set(document, promise);
  void promise.catch(() => { if (loaders.get(document) === promise) loaders.delete(document); });
  return promise;
}

/** Horizontal distance in metres from the character to the cinema screen centre. */
export function cinemaProximityVolume(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  const t = Math.max(0, Math.min(1, (distance - 8) / 22));
  return 1 - t * t * (3 - 2 * t);
}

export interface TwitchCinemaPlayerStatus {
  ready: boolean;
  playing: boolean;
  blocked: boolean;
  muted: boolean;
  error: string | null;
  disposed: boolean;
}
export interface TwitchCinemaPlayerOptions {
  onStatusChange?: (status: Readonly<TwitchCinemaPlayerStatus>) => void;
  /** Pass the preceding player's native mute state to preserve it across remounts. */
  muted?: boolean;
}

/** Official, visible player only. The caller owns screen visibility and must dispose when hidden. */
export class TwitchCinemaPlayer {
  private player: TwitchPlayerHandle | null = null;
  private host: HTMLDivElement;
  private listeners: Array<[string, () => void]> = [];
  private poll: ReturnType<typeof setInterval> | null = null;
  private readyTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoplayTimeout: ReturnType<typeof setTimeout> | null = null;
  private volume = 1;
  private appliedVolume = -1;
  private disposed = false;
  private mutedFallbackAttempted = false;
  private hasPlayed = false;
  private state: TwitchCinemaPlayerStatus;
  /** Settles after SDK construction or failure; status.ready comes from the provider READY event. */
  readonly loaded: Promise<void>;
  get status(): Readonly<TwitchCinemaPlayerStatus> {
    // Read the latest SDK snapshot when a caller saves mute state before a remount.
    if (this.player && this.state.ready && !this.disposed) {
      try { return { ...this.state, muted: this.player.getMuted(), playing: this.state.playing && !this.player.isPaused() }; } catch { /* Keep the last observed state. */ }
    }
    return this.state;
  }

  constructor(container: HTMLElement, private readonly options: TwitchCinemaPlayerOptions = {}, loadSDK = () => loadTwitchPlayerSDK(container.ownerDocument)) {
    const view = container.ownerDocument.defaultView;
    const muted = options.muted ?? !view?.navigator.userActivation?.hasBeenActive;
    this.state = { ready: false, playing: false, blocked: false, muted, error: null, disposed: false };
    this.host = container.ownerDocument.createElement('div');
    this.host.className = 'world-cinema-twitch';
    Object.assign(this.host.style, { width: '960px', height: '540px', pointerEvents: 'auto' });
    container.append(this.host);
    this.loaded = this.mount(loadSDK, view?.location.hostname ?? 'localhost', muted);
  }

  private update(patch: Partial<TwitchCinemaPlayerStatus>) {
    const next = { ...this.state, ...patch };
    if (Object.keys(next).every(key => next[key as keyof typeof next] === this.state[key as keyof typeof next])) return;
    this.state = next;
    this.options.onStatusChange?.(this.state);
  }

  private async mount(loadSDK: () => Promise<TwitchPlayerSDK>, hostname: string, muted: boolean) {
    try {
      const sdk = await loadSDK();
      if (this.disposed) return;
      this.player = new sdk.Player(this.host, { width: 960, height: 540, channel: BRIDGEMIND_TWITCH_CHANNEL, parent: [hostname], autoplay: true, muted });
      const frame = this.host.querySelector('iframe');
      if (frame) {
        frame.className = 'world-cinema-player-frame';
        frame.title = 'BridgeMind live on Twitch at The Bridge Picture House';
        frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
        frame.allowFullscreen = true;
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        Object.assign(frame.style, { display: 'block', border: '0', width: '960px', height: '540px', pointerEvents: 'auto' });
      }
      const listen = (event: string, callback: () => void) => {
        const guarded = () => {
          if (this.disposed) return;
          try { callback(); } catch { this.update({ error: 'Twitch playback failed.', playing: false }); }
        };
        this.listeners.push([event, guarded]);
        this.player!.addEventListener(event, guarded);
      };
      listen(sdk.Player.READY, () => {
        if (this.state.ready) return;
        if (this.readyTimeout) clearTimeout(this.readyTimeout);
        this.readyTimeout = null;
        this.update({ ready: true, error: null });
        if (this.disposed || !this.player) return;
        this.applyVolume();
        this.player.setMuted(muted);
        this.player.play();
        this.observeMute();
        this.poll = setInterval(() => this.observeMute(), 500);
        // SDK isPaused() is false in its unstarted Ready state too. Use the absence
        // of PLAYING, not that incomplete pause signal, for this single startup retry.
        this.autoplayTimeout = setTimeout(() => {
          this.autoplayTimeout = null;
          if (this.disposed || this.hasPlayed || !this.player || !this.state.ready) return;
          try { this.tryMutedAutoplay(); }
          catch { this.update({ error: 'Twitch playback could not start.', playing: false }); }
        }, 3_000);
      });
      listen(sdk.Player.PLAYING, () => {
        this.hasPlayed = true;
        this.clearAutoplayTimeout();
        this.observeMute();
        this.update({ playing: true, blocked: this.state.muted && this.state.blocked });
      });
      for (const event of [sdk.Player.PAUSE, sdk.Player.ENDED, sdk.Player.OFFLINE]) listen(event, () => this.update({ playing: false }));
      listen(sdk.Player.PLAYBACK_BLOCKED, () => {
        this.update({ blocked: true, playing: false });
        this.tryMutedAutoplay();
      });
      if (sdk.Player.ERROR) listen(sdk.Player.ERROR, () => this.update({ error: 'Twitch playback failed.', playing: false }));
      this.readyTimeout = setTimeout(() => { if (!this.disposed && !this.state.ready) this.update({ error: 'Twitch player did not become ready.' }); }, 20_000);
    } catch {
      if (!this.disposed) this.update({ error: 'Twitch player could not load.', playing: false });
    }
  }

  private clearAutoplayTimeout() {
    if (this.autoplayTimeout) clearTimeout(this.autoplayTimeout);
    this.autoplayTimeout = null;
  }

  private tryMutedAutoplay() {
    // A watchdog and BLOCKED event share one retry; neither can undo a later native pause.
    if (this.disposed || !this.player || !this.state.ready || this.hasPlayed || this.mutedFallbackAttempted) return;
    this.mutedFallbackAttempted = true;
    this.clearAutoplayTimeout();
    this.player.setMuted(true);
    this.update({ muted: true, blocked: true });
    this.player.play();
  }

  /** Latest provider-reported volume, rather than merely our requested attenuation. */
  getVolume(): number | null {
    if (this.disposed || !this.player || !this.state.ready) return null;
    try {
      const volume = this.player.getVolume();
      return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : null;
    } catch { return null; }
  }

  private observeMute() {
    if (!this.player || !this.state.ready || this.disposed) return;
    try { this.update({ muted: this.player.getMuted() }); }
    catch { this.update({ error: 'Twitch playback failed.', playing: false }); }
  }

  private applyVolume() {
    if (!this.player || !this.state.ready || this.disposed) return;
    if (this.volume === this.appliedVolume || (this.volume > 0 && this.volume < 1 && Math.abs(this.volume - this.appliedVolume) < .005)) return;
    try {
      this.player.setVolume(this.volume);
      this.appliedVolume = this.volume;
    } catch { this.update({ error: 'Twitch volume could not be updated.' }); }
  }

  /** Attenuation is independent of Twitch's native mute switch; never unmute here. */
  setVolume(volume: number) {
    if (this.disposed) return;
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    this.applyVolume();
  }

  /** Call synchronously inside a click/key activation; no queued replay after the gesture expires. */
  playWithSound(): boolean {
    if (this.disposed || !this.player || !this.state.ready) return false;
    try {
      this.player.setMuted(false);
      this.applyVolume();
      this.player.play();
      this.update({ muted: false, blocked: false, error: null });
      return true;
    } catch {
      this.update({ blocked: true, error: 'Twitch playback could not start.' });
      return false;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.observeMute();
    this.disposed = true;
    if (this.poll) clearInterval(this.poll);
    if (this.readyTimeout) clearTimeout(this.readyTimeout);
    this.clearAutoplayTimeout();
    if (this.player) {
      for (const [event, listener] of this.listeners) {
        try { this.player.removeEventListener?.(event, listener); } catch { /* Guarded callbacks also ignore disposed instances. */ }
      }
      try { this.player.pause(); } catch { /* Frame may already have been detached by its parent. */ }
      // Present in Twitch's current SDK; removing our host also covers SDK versions without it.
      try { this.player.destroy?.(); } catch { /* Removing the owned host below always removes the complete player. */ }
    }
    this.listeners = [];
    this.player = null;
    this.host.remove();
    this.update({ ready: false, playing: false, disposed: true });
  }
}
