// Server-side chat discipline: an in-memory offence ledger and escalating auto-silence.
export type OffenceOutcome = { silencedMs: number };

const STRIKE_WINDOW_MS = 600_000;
const SILENCE_BASE_MS = 60_000;
const SILENCE_CAP_MS = 900_000;
const WARNING_STRIKES = 2;
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_LIMIT = 5;
const REPEAT_WINDOW_MS = 10_000;

// Escalation schedule: the first two strikes warn, the third silences for a minute and every later
// strike doubles, capped at fifteen minutes.
export const silenceForStrikes = (strikes: number) => strikes <= WARNING_STRIKES ? 0 : Math.min(SILENCE_CAP_MS, SILENCE_BASE_MS * 2 ** (strikes - WARNING_STRIKES - 1));

export class ChatDiscipline {
  private strikes = new Map<string, number[]>();
  private silencedUntil = new Map<string, number>();
  private floodAt = new Map<string, number[]>();
  private lastBody = new Map<string, { body: string; at: number }>();

  constructor(private readonly clock: () => number = Date.now) {}

  // A strike stops counting once the guest has gone ten quiet minutes without a new offence, so the
  // ledger is a run of offences rather than a sliding count. Offences separated by a served silence
  // still escalate; a genuinely quiet guest starts again at a warning.
  private activeStrikes(profileId: string, now: number): number[] {
    const strikes = this.strikes.get(profileId) ?? [];
    const last = strikes[strikes.length - 1];
    if (last !== undefined && now - last < STRIKE_WINDOW_MS) return strikes;
    this.strikes.delete(profileId);
    return [];
  }

  silenceRemaining(profileId: string): number {
    const remaining = (this.silencedUntil.get(profileId) ?? 0) - this.clock();
    if (remaining > 0) return remaining;
    this.silencedUntil.delete(profileId);
    return 0;
  }

  recordOffence(profileId: string): OffenceOutcome {
    const silencedMs = this.silenceRemaining(profileId);
    if (silencedMs > 0) return { silencedMs }; // An active silence is never extended by more offences.
    const now = this.clock();
    const strikes = this.activeStrikes(profileId, now);
    strikes.push(now);
    this.strikes.set(profileId, strikes);
    const duration = silenceForStrikes(strikes.length);
    if (duration) this.silencedUntil.set(profileId, now + duration);
    return { silencedMs: duration };
  }

  // Rolling window: at most FLOOD_LIMIT messages per FLOOD_WINDOW_MS for one session.
  flooding(sessionId: string): boolean {
    const now = this.clock();
    const recent = (this.floodAt.get(sessionId) ?? []).filter(at => now - at < FLOOD_WINDOW_MS);
    recent.push(now);
    this.floodAt.set(sessionId, recent);
    return recent.length > FLOOD_LIMIT;
  }

  isRepeat(sessionId: string, body: string): boolean {
    const now = this.clock(), previous = this.lastBody.get(sessionId);
    this.lastBody.set(sessionId, { body, at: now });
    return !!previous && now - previous.at < REPEAT_WINDOW_MS && previous.body === body;
  }

  // Session-keyed windows only. The profile ledger deliberately survives so strikes follow a reconnect.
  dispose(sessionId: string) {
    this.floodAt.delete(sessionId);
    this.lastBody.delete(sessionId);
  }
}
