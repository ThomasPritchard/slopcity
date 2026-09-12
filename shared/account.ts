export type VerificationConfig = { enabled: boolean; siteKey: string };
export type AccountEntryResult = {
 profileId: string;
 emailStatus: 'not_requested' | 'sent' | 'unavailable' | 'limited';
 message: string | null;
};
export type AccountEntryDecision = { continueToTown: boolean; notice?: string };
export type AccountStatus = {
 profileId: string | null;
 kind: 'none' | 'guest' | 'member';
 email: string | null;
 emailEnabled: boolean;
 challenge: VerificationConfig;
};
export type AccountLink = {
 purpose: 'upgrade' | 'signin';
 profileId: string;
 profileName: string;
 email: string;
 requiresProfileSwitch: boolean;
 currentProfileId: string | null;
};
