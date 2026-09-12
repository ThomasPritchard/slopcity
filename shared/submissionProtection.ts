export const SUBMISSION_PROTECTION = {
  pendingHardCap: 75, backlogPause: 65, backlogResume: 50,
  windowMs: 120_000, accountThreshold: 5, networkThreshold: 10,
  globalThreshold: 20, globalAccounts: 5, globalNetworks: 3,
  cooldownMs: 900_000, pauseMs: 600_000, trialMs: 300_000,
  trialWindowMs: 60_000, trialAdmissions: 2, maxEntries: 2048, historyLimit: 50,
} as const;
export type SubmissionPauseReason = 'manual' | 'backlog' | 'spam';
export interface SubmissionProtectionTransition { at: number; event: string; scope?: string }
export interface SubmissionCooldown { key: string; until: number }
export interface SubmissionProtectionSnapshot {
  reasons: SubmissionPauseReason[];
  manualPaused: boolean;
  backlogPaused: boolean;
  spamPauseUntil: number | null;
  trialUntil: number | null;
  pending: number;
  accountCooldowns: SubmissionCooldown[];
  networkCooldowns: SubmissionCooldown[];
  history: SubmissionProtectionTransition[];
}
export interface SubmissionAdmissionDecision {
  allowed: boolean;
  reason?: SubmissionPauseReason | 'account' | 'network' | 'trial' | 'capacity' | 'hard-cap';
  retryAt?: number;
  replay?: boolean;
}
