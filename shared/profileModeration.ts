import { containsSevereProfanity } from './moderation.ts';
import { parseProfile } from './world.ts';

export const PROFILE_NAME_ERROR = 'Choose a different name. Slurs and extreme profanity are not allowed.';

export function isBlockedProfileName(name: unknown): boolean {
 if (typeof name !== 'string') return false;
 // Check both the submitted text and the exact name that would be displayed.
 // Removing markup/control characters or truncating a name can expose a blocked word.
 return containsSevereProfanity(name) || containsSevereProfanity(parseProfile({name}).name);
}

export class BlockedProfileNameError extends Error {
 constructor() { super(PROFILE_NAME_ERROR); }
}

export function assertAllowedProfileName(name: unknown): void {
 if (isBlockedProfileName(name)) throw new BlockedProfileNameError();
}
