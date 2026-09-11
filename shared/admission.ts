export type AdmissionMode = 'open' | 'paused' | 'approved';
export type AdmissionStatus = { enabled: boolean; siteKey: string; verified: boolean; mode: AdmissionMode };
export type AdmissionAdmin = { enabled: boolean; mode: AdmissionMode; approved: { id: string; name: string }[]; pending: number };
