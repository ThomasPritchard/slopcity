import assert from 'node:assert/strict';
import test from 'node:test';
import { SUBMISSION_PROTECTION as P } from '../shared/submissionProtection.ts';
import { createSubmissionProtectionState, admitSubmission, recordInvalidSubmission, inspectSubmissionProtection, setSubmissionManualPause, clearSubmissionAccountCooldown, type SubmissionProtectionState } from '../server/submissionProtection.ts';
function invalid(state: SubmissionProtectionState, n: number, profileId = 'a', network = 'n', now = n) {
  const input = { profileId, network, requestId: String(n), now, pending: 0 };
  const admission = admitSubmission(state, input);
  assert.equal(admission.decision.allowed, true);
  return recordInvalidSubmission(admission.state, input).state;
}
function globalPause() {
  let state = createSubmissionProtectionState();
  for (let n = 0; n < 20; n++) state = invalid(state, n, `a${n % 5}`, `n${n % 3}`);
  return state;
}
test('account unique attempts, retry exclusion, cooldown expiry and immutable input', () => {
  const initial = createSubmissionProtectionState();
  let state = initial;
  for (let n = 0; n < 5; n++) state = invalid(state, n);
  assert.equal(initial.admissions.length, 0);
  assert.equal(state.accountCooldowns[0]?.until, 4 + P.cooldownMs);
  const retry = { profileId: 'a', network: 'n', requestId: '4', pending: 0, now: 5 };
  assert.equal(admitSubmission(state, retry).decision.replay, true);
  assert.equal(recordInvalidSubmission(state, retry).recorded, false);
  assert.equal(admitSubmission(state, { ...retry, requestId: 'new' }).decision.reason, 'account');
  assert.equal(admitSubmission(state, { ...retry, profileId: 'other', requestId: 'new' }).decision.allowed, true);
  assert.equal(inspectSubmissionProtection(state, 0, 4 + P.cooldownMs).state.accountCooldowns.length, 0);
  assert.equal(clearSubmissionAccountCooldown(state, 'a', 0, 6).state.accountCooldowns.length, 0);
});
test('window excludes exact two-minute boundary and networks aggregate independent actors', () => {
  let state = invalid(createSubmissionProtectionState(), 0);
  for (let n = 1; n < 5; n++) state = invalid(state, n, 'a', 'n', P.windowMs + n - 1);
  assert.equal(state.accountCooldowns.length, 0);
  state = createSubmissionProtectionState();
  for (let n = 0; n < 10; n++) state = invalid(state, n, `a${n}`, 'shared');
  assert.equal(state.networkCooldowns.length, 1);
  assert.equal(state.accountCooldowns.length, 0);
  assert.equal(admitSubmission(state, { profileId: 'new', network: 'shared', requestId: 'new', pending: 0, now: 11 }).decision.reason, 'network');
});
test('global distinct sources, paused traffic exclusion, restart and trial boundaries', () => {
  let state = globalPause();
  assert.equal(state.spamPauseUntil, 19 + P.pauseMs);
  const input = { profileId: 'fresh', network: 'fresh', requestId: 'fresh', pending: 0, now: 20 };
  assert.equal(admitSubmission(state, input).decision.reason, 'spam');
  assert.equal(recordInvalidSubmission(state, input).recorded, false);
  state = JSON.parse(JSON.stringify(state));
  assert.equal(inspectSubmissionProtection(state, 0, 18 + P.pauseMs).snapshot.reasons[0], 'spam');
  const now = 19 + P.pauseMs;
  state = inspectSubmissionProtection(state, 0, now).state;
  assert.equal(state.trialUntil, now + P.trialMs);
  for (let n = 0; n < 2; n++) state = admitSubmission(state, { ...input, requestId: `trial${n}`, now }).state;
  assert.equal(admitSubmission(state, { ...input, now, requestId: 'trial3' }).decision.reason, 'trial');
  assert.equal(admitSubmission(state, { ...input, now: now + P.trialWindowMs, requestId: 'trial3' }).decision.allowed, true);
  assert.equal(inspectSubmissionProtection(state, 0, now + P.trialMs).state.trialUntil, null);
  state = recordInvalidSubmission(state, { ...input, now: now + 1, requestId: 'trial0' }).state;
  assert.equal(state.spamPauseUntil, now + 1 + P.pauseMs);
});
test('manual pause and backlog hysteresis overlap; admin bypass retains hard cap', () => {
  let state = inspectSubmissionProtection(createSubmissionProtectionState(), 65, 0).state;
  state = setSubmissionManualPause(state, true, 65, 1).state;
  assert.deepEqual(inspectSubmissionProtection(state, 51, 999999).snapshot.reasons, ['manual', 'backlog']);
  state = inspectSubmissionProtection(state, 50, 999999).state;
  assert.deepEqual(inspectSubmissionProtection(state, 50, 999999).snapshot.reasons, ['manual']);
  const input = { profileId: 'admin', network: 'n', requestId: 'admin1', pending: 65, now: 999999, admin: true };
  const admitted = admitSubmission(state, input);
  assert.equal(admitted.decision.allowed, true);
  assert.equal(recordInvalidSubmission(admitted.state, input).recorded, false);
  assert.equal(admitSubmission(state, { ...input, pending: 75 }).decision.reason, 'hard-cap');
  assert.deepEqual(setSubmissionManualPause(state, false, 50, 1000000).snapshot.reasons, []);
});
test('unadmitted signals excluded, capacity fails closed and history bounded', () => {
  let state = createSubmissionProtectionState();
  const input = { profileId: 'a', network: 'n', requestId: 'x', pending: 0, now: 0 };
  assert.equal(recordInvalidSubmission(state, input).recorded, false);
  for (let n = 0; n < P.maxEntries; n++) state = admitSubmission(state, { ...input, requestId: String(n) }).state;
  assert.equal(admitSubmission(state, input).decision.reason, 'capacity');
  assert.equal(admitSubmission(state, { ...input, now: P.cooldownMs }).decision.allowed, true);
  for (let n = 0; n < 100; n++) state = setSubmissionManualPause(state, n % 2 === 0, 0, n).state;
  assert.equal(state.history.length, P.historyLimit);
});
test('twenty incidents without three networks do not pause everyone; preadmitted cooled traffic is excluded', () => {
  let state = createSubmissionProtectionState();
  const queued = { profileId: 'a0', network: 'n0', requestId: 'queued', pending: 0, now: 0 };
  state = admitSubmission(state, queued).state;
  for (let n = 0; n < 20; n++) state = invalid(state, n, `a${n % 5}`, `n${n % 2}`);
  assert.equal(state.spamPauseUntil, null);
  const before = state.incidents.length;
  const recorded = recordInvalidSubmission(state, { ...queued, now: 21 });
  assert.equal(recorded.recorded, false);
  assert.equal(recorded.state.incidents.length, before);
});
