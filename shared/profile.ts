import type { Profile } from './world.ts';
export type GuestProfile = Profile & { id: string; revision: number };
export type PrivateGuestProfile = GuestProfile & { blocks: string[] };
