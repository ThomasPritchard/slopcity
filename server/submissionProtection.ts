import { SUBMISSION_PROTECTION as P, type SubmissionProtectionSnapshot, type SubmissionProtectionTransition, type SubmissionCooldown, type SubmissionAdmissionDecision } from '../shared/submissionProtection.ts';

interface Attempt { profileId: string; network: string; requestId: string; at: number; invalid: boolean; admin: boolean }
export interface SubmissionProtectionState {
  version: 1;
  manualPaused: boolean;
  backlogPaused: boolean;
  spamPauseUntil: number | null;
  trialUntil: number | null;
  admissions: Attempt[];
  incidents: Attempt[];
  trialAdmissions: number[];
  accountCooldowns: SubmissionCooldown[];
  networkCooldowns: SubmissionCooldown[];
  history: SubmissionProtectionTransition[];
}
export interface SubmissionAttemptInput { profileId: string; network: string; requestId: string; pending: number; admin?: boolean; now: number }
export function createSubmissionProtectionState(): SubmissionProtectionState {
  return { version: 1, manualPaused: false, backlogPaused: false, spamPauseUntil: null, trialUntil: null, admissions: [], incidents: [], trialAdmissions: [], accountCooldowns: [], networkCooldowns: [], history: [] };
}
function event(state: SubmissionProtectionState, now: number, name: string, scope?: string) {
  state.history.push({ at: now, event: name, ...(scope === undefined ? {} : { scope }) });
  state.history = state.history.slice(-P.historyLimit);
}
function snapshot(state: SubmissionProtectionState, pending: number): SubmissionProtectionSnapshot {
  return { reasons: [...(state.manualPaused ? ['manual' as const] : []), ...(state.backlogPaused ? ['backlog' as const] : []), ...(state.spamPauseUntil !== null ? ['spam' as const] : [])], manualPaused: state.manualPaused, backlogPaused: state.backlogPaused, spamPauseUntil: state.spamPauseUntil, trialUntil: state.trialUntil, pending, accountCooldowns: state.accountCooldowns, networkCooldowns: state.networkCooldowns, history: state.history };
}
function result(state: SubmissionProtectionState, pending: number) { return { state, snapshot: snapshot(state, pending) }; }
export function inspectSubmissionProtection(previous: SubmissionProtectionState, pending: number, now: number) {
  const state = structuredClone(previous);
  state.admissions = state.admissions.filter(a => a.at > now - P.cooldownMs);
  state.incidents = state.incidents.filter(a => a.at > now - P.windowMs);
  state.trialAdmissions = state.trialAdmissions.filter(at => at > now - P.trialWindowMs);
  for (const field of ['accountCooldowns', 'networkCooldowns'] as const) {
    for (const cooldown of state[field]) if (cooldown.until <= now) event(state, now, `${field}-expired`, cooldown.key);
    state[field] = state[field].filter(c => c.until > now);
  }
  if (!state.backlogPaused && pending >= P.backlogPause) { state.backlogPaused = true; event(state, now, 'backlog-paused'); }
  else if (state.backlogPaused && pending <= P.backlogResume) { state.backlogPaused = false; event(state, now, 'backlog-resumed'); }
  if (state.spamPauseUntil !== null && state.spamPauseUntil <= now) {
    state.spamPauseUntil = null;
    // Start a full observation period on the first refresh after expiry, including after restart.
    state.trialUntil = now + P.trialMs;
    state.trialAdmissions = [];
    event(state, now, 'trial-started');
  }
  if (state.trialUntil !== null && state.trialUntil <= now) { state.trialUntil = null; state.trialAdmissions = []; event(state, now, 'trial-completed'); }
  return result(state, pending);
}
export function admitSubmission(previous: SubmissionProtectionState, input: SubmissionAttemptInput) {
  const { state } = inspectSubmissionProtection(previous, input.pending, input.now);
  const finish = (decision: SubmissionAdmissionDecision) => ({ ...result(state, input.pending), decision });
  const existing = state.admissions.find(a => a.profileId === input.profileId && a.requestId === input.requestId);
  // Replay is only an accounting signal. The caller must return its persisted original result, never process another upload.
  if (existing) return finish({ allowed: true, replay: true });
  if (input.pending >= P.pendingHardCap) return finish({ allowed: false, reason: 'hard-cap' });
  if (!input.admin) {
    const reason = snapshot(state, input.pending).reasons[0];
    if (reason) return finish({ allowed: false, reason, ...(reason === 'spam' ? { retryAt: state.spamPauseUntil! } : {}) });
    for (const [field, key, reason] of [['accountCooldowns', input.profileId, 'account'], ['networkCooldowns', input.network, 'network']] as const) {
      const cooldown = state[field].find(c => c.key === key);
      if (cooldown) return finish({ allowed: false, reason, retryAt: cooldown.until });
    }
    if (state.trialUntil !== null && state.trialAdmissions.length >= P.trialAdmissions) return finish({ allowed: false, reason: 'trial', retryAt: state.trialAdmissions[0]! + P.trialWindowMs });
  }
  // Fail closed instead of evicting live deduplication or detection entries under sustained load.
  if (state.admissions.length >= P.maxEntries) return finish({ allowed: false, reason: 'capacity', retryAt: state.admissions[0]!.at + P.cooldownMs });
  state.admissions.push({ profileId: input.profileId, network: input.network, requestId: input.requestId, at: input.now, invalid: false, admin: !!input.admin });
  if (!input.admin && state.trialUntil !== null) state.trialAdmissions.push(input.now);
  return finish({ allowed: true });
}
export function recordInvalidSubmission(previous: SubmissionProtectionState, input: SubmissionAttemptInput) {
  const { state } = inspectSubmissionProtection(previous, input.pending, input.now);
  const attempt = state.admissions.find(a => a.profileId === input.profileId && a.network === input.network && a.requestId === input.requestId);
  if (!attempt || attempt.invalid || attempt.admin) return { ...result(state, input.pending), recorded: false };
  attempt.invalid = true;
  if (snapshot(state, input.pending).reasons.length || state.accountCooldowns.some(c => c.key === input.profileId) || state.networkCooldowns.some(c => c.key === input.network)) return { ...result(state, input.pending), recorded: false };
  state.incidents.push({ ...attempt, at: input.now });
  for (const [field, key, threshold, actor] of [['accountCooldowns', input.profileId, P.accountThreshold, 'profileId'], ['networkCooldowns', input.network, P.networkThreshold, 'network']] as const) {
    if (state.incidents.filter(a => a[actor] === key).length >= threshold) {
      state[field].push({ key, until: input.now + P.cooldownMs }); event(state, input.now, `${field}-started`, key);
    }
  }
  if (state.trialUntil !== null || (state.incidents.length >= P.globalThreshold && new Set(state.incidents.map(a => a.profileId)).size >= P.globalAccounts && new Set(state.incidents.map(a => a.network)).size >= P.globalNetworks)) {
    state.spamPauseUntil = input.now + P.pauseMs; state.trialUntil = null; state.trialAdmissions = []; event(state, input.now, 'spam-paused');
  }
  return { ...result(state, input.pending), recorded: true };
}
export function setSubmissionManualPause(previous: SubmissionProtectionState, paused: boolean, pending: number, now: number) {
  const { state } = inspectSubmissionProtection(previous, pending, now);
  if (state.manualPaused !== paused) { state.manualPaused = paused; event(state, now, paused ? 'manual-paused' : 'manual-resumed'); }
  return result(state, pending);
}
export function clearSubmissionAccountCooldown(previous: SubmissionProtectionState, profileId: string, pending: number, now: number) {
  const { state } = inspectSubmissionProtection(previous, pending, now);
  state.accountCooldowns = state.accountCooldowns.filter(c => c.key !== profileId);
  state.incidents = state.incidents.filter(a => a.profileId !== profileId);
  event(state, now, 'account-cooldown-cleared', profileId);
  return result(state, pending);
}
