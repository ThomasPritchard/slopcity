import type { CasinoReceipt, CasinoState, CasinoTableId, CasinoTableView } from '../../shared/casino';

type Snapshot = { round: string; phase: string; cards: number; game: CasinoTableView['game'] };

/** Local synthesis only. Call unlock directly from a trusted input handler. */
export class TownAudio {
  private context: AudioContext | null = null;
  private effects: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private water: AudioBufferSourceNode | null = null;
  private waterFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Map<AudioScheduledSourceNode, AudioNode[]>();
  private volumes = { effects: .45, ambience: .35 };
  private active = false;
  private disposed = false;
  private foreground = document.hasFocus() && !document.hidden;
  private distance = 100;
  private lastStep = 0;
  private focused: CasinoTableId | null = null;
  private previous: Snapshot | null = null;
  private serverTime = -Infinity;
  private receipts = new Set<string>();
  private visibility = () => {
    this.foreground = document.hasFocus() && !document.hidden;
    this.silence();
    this.updateWater();
  };

  constructor() {
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('blur', this.visibility);
    window.addEventListener('focus', this.visibility);
  }

  unlock(): void {
    if (this.disposed || document.hidden || !document.hasFocus()) return;
    this.foreground = true;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.effects = this.context.createGain();
        this.effects.gain.value = this.volumes.effects * .22;
        this.effects.connect(this.context.destination);
        this.waterGain = this.context.createGain();
        this.waterGain.gain.value = 0;
        this.waterGain.connect(this.context.destination);
        this.noise = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      // No other method resumes the context: browsers retain their autoplay boundary.
      void this.context.resume().then(() => this.updateWater()).catch(() => {});
    } catch { /* Audio is optional when the browser cannot create a context. */ }
  }

  configure(volumes: { effects: number; ambience: number }): void {
    const clamp = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    this.volumes = { effects: clamp(volumes.effects), ambience: clamp(volumes.ambience) };
    if (this.context && this.effects) this.effects.gain.setTargetAtTime(this.volumes.effects * .22, this.context.currentTime, .025);
    this.updateWater();
  }

  setActive(active: boolean): void {
    if (this.active !== active) {
      this.previous = null;
      this.focused = null;
      this.serverTime = -Infinity;
      this.lastStep = 0;
    }
    this.active = active;
    if (!active) this.silence();
    this.updateWater();
  }

  motion(x: number, z: number, moving: boolean): void {
    this.distance = Number.isFinite(x) && Number.isFinite(z) ? Math.hypot(x, z - 1) : 100;
    this.updateWater();
    const now = performance.now();
    if (!moving) { this.lastStep = 0; return; }
    if (this.audible() && now - this.lastStep >= 370) {
      this.lastStep = now;
      this.burst(180, .075, .22, true);
    }
  }

  casino(state: CasinoState, focusedTable: CasinoTableId | null): void {
    const table = state.tables.find(item => item.id === focusedTable);
    if (!table) { this.previous = null; this.focused = focusedTable; this.serverTime = -Infinity; return; }
    const next: Snapshot = {
      round: table.roundId, phase: table.phase, game: table.game,
      cards: table.game === 'blackjack' ? table.dealer.filter(Boolean).length + table.seats.reduce((sum, seat) => sum + seat.hands.reduce((count, hand) => count + hand.cards.length, 0), 0) : 0,
    };
    if (this.focused === focusedTable && state.serverTime < this.serverTime) return;
    const before = this.focused === focusedTable ? this.previous : null;
    this.focused = focusedTable;
    this.previous = next;
    this.serverTime = state.serverTime;
    if (!before || !this.audible()) return;
    if (next.game === 'blackjack' && next.cards > before.cards && next.phase !== 'betting') this.burst(1900, .095, .2, true);
    if (next.game === 'slots') {
      if (next.phase === 'spinning' && (before.phase !== 'spinning' || next.round !== before.round)) this.burst(260, .15, .16);
      if (next.phase === 'result' && before.phase === 'spinning' && next.round === before.round) {
        // Identical neutral result cue regardless of payout; no celebratory loss masking.
        this.burst(520, .17, .15);
      }
    }
  }

  receipt(receipt: CasinoReceipt): void {
    if (this.receipts.has(receipt.requestId)) return;
    this.receipts.add(receipt.requestId);
    if (this.receipts.size > 512) this.receipts.delete(this.receipts.values().next().value!);
    if (receipt.ok && receipt.wagerId && this.focused && this.audible()) this.burst(1400, .065, .16);
  }

  private audible(): boolean {
    return !this.disposed && this.active && this.foreground && !document.hidden && this.context?.state === 'running';
  }

  private updateWater(): void {
    const context = this.context;
    if (!context || !this.waterGain) return;
    const level = this.audible() ? this.volumes.ambience * .035 * Math.max(0, 1 - this.distance / 22) : 0;
    if (level === 0) { this.stopWater(); return; }
    if (!this.water && this.noise) {
      this.water = context.createBufferSource();
      this.water.buffer = this.noise;
      this.water.loop = true;
      this.waterFilter = context.createBiquadFilter();
      this.waterFilter.type = 'lowpass';
      this.waterFilter.frequency.value = 2400;
      this.water.connect(this.waterFilter).connect(this.waterGain);
      this.water.start();
    }
    this.waterGain.gain.setTargetAtTime(level, context.currentTime, .15);
  }

  private stopWater(): void {
    if (this.context && this.waterGain) {
      this.waterGain.gain.cancelScheduledValues(this.context.currentTime);
      this.waterGain.gain.value = 0;
    }
    if (this.water) { this.water.stop(); this.water.disconnect(); this.water = null; }
    this.waterFilter?.disconnect();
    this.waterFilter = null;
  }

  private burst(frequency: number, duration: number, level: number, noisy = false): void {
    const context = this.context;
    if (!context || !this.effects || !this.audible() || !this.volumes.effects || this.voices.size >= 6) return;
    const source = noisy ? context.createBufferSource() : context.createOscillator();
    if (source instanceof AudioBufferSourceNode) source.buffer = this.noise;
    else { source.type = 'sine'; source.frequency.value = frequency; }
    const filter = context.createBiquadFilter();
    filter.type = noisy ? 'bandpass' : 'lowpass';
    filter.frequency.value = frequency;
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + .006);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.effects);
    this.voices.set(source, [filter, gain]);
    source.onended = () => {
      source.disconnect(); filter.disconnect(); gain.disconnect();
      this.voices.delete(source);
    };
    source.start();
    source.stop(now + duration + .01);
  }

  private silence(): void {
    this.stopWater();
    for (const [source, nodes] of this.voices) {
      source.onended = null;
      source.stop(); source.disconnect();
      nodes.forEach(node => node.disconnect());
    }
    this.voices.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('blur', this.visibility);
    window.removeEventListener('focus', this.visibility);
    this.silence();
    this.effects?.disconnect(); this.waterGain?.disconnect();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.noise = null;
    this.receipts.clear();
  }
}
