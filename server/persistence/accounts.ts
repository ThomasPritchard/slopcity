import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { validCredential } from './guests.ts';
import type { EconomyRepository } from './economy.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class AccountError extends Error {
 constructor(public code: string, message: string, public status = 409) { super(message); }
}
export function normalizeAccountEmail(value: string): string {
 const email = value.trim().toLowerCase();
 if (email.length > 254 || !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(email)) throw new AccountError('invalid_email', 'Enter a valid email address.', 400);
 return email;
}
const invalid = () => new AccountError('invalid_link', 'This link is expired or unavailable. Request a new link.', 400);
type Purpose = 'upgrade' | 'signin';
export class AccountRepository {
 constructor(readonly economy: EconomyRepository) {}
 async initialise() {
  await this.economy.transaction(async c => {
   await c.query("SET LOCAL lock_timeout='5s'");
   await c.query('SELECT pg_advisory_xact_lock(782641092)');
   const versions = (await c.query('SELECT version FROM guest_schema_migrations')).rows;
   if (!versions.some(r => r.version === 10) || versions.some(r => !Number.isInteger(r.version) || r.version < 1 || r.version > 13)) throw new Error('Unsupported accounts schema');
   if (!versions.some(r => r.version === 11)) {
    await c.query(await readFile(new URL('./migrations/011_accounts.sql', import.meta.url), 'utf8'));
    await c.query('INSERT INTO guest_schema_migrations(version) VALUES(11)');
   }
   await c.query('SELECT profile_id,email_normalized,verified_at FROM player_accounts LIMIT 0');
   await c.query('SELECT token_digest,initiating_credential_digest,consumed_at FROM account_challenges LIMIT 0');
  });
 }
 async status(profileId: string): Promise<{ kind: 'guest' | 'member'; email: string | null }> {
  const row = (await this.economy.pool.query('SELECT email_normalized FROM player_accounts WHERE profile_id=$1', [profileId])).rows[0];
  return row ? { kind: 'member', email: row.email_normalized } : { kind: 'guest', email: null };
 }
 private async credential(c: PoolClient, secret: string | null) {
  if (!validCredential(secret)) return null;
  return (await c.query('SELECT profile_id FROM guest_credentials WHERE credential_hash=$1 AND expires_at>now()', [digest(secret)])).rows[0]?.profile_id as string | undefined ?? null;
 }
 async issue(purpose: Purpose, inputEmail: string, guestSecret?: string) {
  const email = normalizeAccountEmail(inputEmail);
  return this.economy.transaction(async c => {
   let profileId = (await c.query('SELECT profile_id FROM player_accounts WHERE email_normalized=$1', [email])).rows[0]?.profile_id as string | undefined;
   if (profileId) purpose = 'signin';
   else if (purpose === 'signin') return null;
   else {
    profileId = await this.credential(c, guestSecret ?? null) ?? undefined;
    if (!profileId) throw new AccountError('session_required', 'Your guest session has ended.', 401);
    if ((await c.query('SELECT 1 FROM player_accounts WHERE profile_id=$1', [profileId])).rowCount) throw new AccountError('already_member', 'This profile already has an email account.');
   }
   const profileName = (await c.query('SELECT name FROM guest_profiles WHERE id=$1', [profileId])).rows[0]?.name as string | undefined;
   if (!profileName) throw invalid();
   const token = randomBytes(32).toString('base64url'), challengeId = randomUUID();
   await c.query("DELETE FROM account_challenges WHERE expires_at < now() - interval '1 day'");
   await c.query("INSERT INTO account_challenges(id,token_digest,purpose,profile_id,email_normalized,initiating_credential_digest,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '15 minutes')", [challengeId, digest(token), purpose, profileId, email, purpose === 'upgrade' ? digest(guestSecret!) : null]);
   return { token, challengeId, email, purpose, profileName };
  });
 }
 private async context(c: PoolClient, token: string, currentSecret: string | null, lock: boolean) {
  if (!validCredential(token)) throw invalid();
  const row = (await c.query(`SELECT a.*,p.name FROM account_challenges a JOIN guest_profiles p ON p.id=a.profile_id WHERE token_digest=$1 AND consumed_at IS NULL AND expires_at>now() ${lock ? 'FOR UPDATE OF a' : ''}`, [digest(token)])).rows[0];
  if (!row) throw invalid();
  const currentProfileId = await this.credential(c, currentSecret);
  if (row.purpose === 'upgrade' && (!currentSecret || row.initiating_credential_digest !== digest(currentSecret) || currentProfileId !== row.profile_id)) throw new AccountError('original_browser_required', 'Open this link in the browser where you started saving your profile.', 403);
  return { row, currentProfileId };
 }
 inspect(token: string, currentSecret: string | null) {
  return this.economy.transaction(async c => {
   const { row, currentProfileId } = await this.context(c, token, currentSecret, false);
   return { purpose: row.purpose as Purpose, profileId: row.profile_id as string, profileName: row.name as string, email: row.email_normalized as string, requiresProfileSwitch: !!currentProfileId && currentProfileId !== row.profile_id, currentProfileId };
  });
 }
 confirm(token: string, currentSecret: string | null, expectedCurrentProfileId: string | null, confirmProfileSwitch: boolean, checkTarget?: (id: string, name: string) => void) {
  return this.economy.transaction(async c => {
   const { row, currentProfileId } = await this.context(c, token, currentSecret, true);
   // Serialize credential rotation for a profile, including separate valid links.
   await c.query('SELECT id FROM guest_profiles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[row.profile_id, ...(currentProfileId ? [currentProfileId] : [])]]);
   if (await this.credential(c, currentSecret) !== currentProfileId || currentProfileId !== expectedCurrentProfileId) throw new AccountError('session_changed', 'Your session changed. Open the link again.');
   if (currentProfileId && currentProfileId !== row.profile_id && !confirmProfileSwitch) throw new AccountError('profile_switch_required', 'Confirm switching to this account.');
   checkTarget?.(row.profile_id, row.name);
   if (row.purpose === 'upgrade') {
    const inserted = await c.query('INSERT INTO player_accounts(profile_id,email_normalized) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING profile_id', [row.profile_id, row.email_normalized]);
    if (!inserted.rowCount) throw new AccountError('account_conflict', 'This profile or email already has an account. Request a sign-in link.');
   } else if (!(await c.query('SELECT 1 FROM player_accounts WHERE profile_id=$1 AND email_normalized=$2', [row.profile_id, row.email_normalized])).rowCount) throw invalid();
   await c.query('UPDATE account_challenges SET consumed_at=now() WHERE id=$1', [row.id]);
   await c.query('DELETE FROM guest_credentials WHERE profile_id=$1', [row.profile_id]);
   if (currentSecret && currentProfileId !== row.profile_id) await c.query('DELETE FROM guest_credentials WHERE credential_hash=$1', [digest(currentSecret)]);
   const secret = randomBytes(32).toString('base64url');
   await c.query("INSERT INTO guest_credentials(credential_hash,profile_id,expires_at) VALUES($1,$2,now()+interval '90 days')", [digest(secret), row.profile_id]);
   return { profileId: row.profile_id as string, secret, previousProfileIds: [...new Set<string>([row.profile_id, ...(currentProfileId ? [currentProfileId] : [])])] };
  });
 }
 async cancel(token: string) {
  if (validCredential(token)) await this.economy.pool.query('UPDATE account_challenges SET consumed_at=now() WHERE token_digest=$1 AND consumed_at IS NULL', [digest(token)]);
 }
 async logout(secret: string): Promise<string | null> {
  if (!validCredential(secret)) return null;
  return (await this.economy.pool.query('DELETE FROM guest_credentials WHERE credential_hash=$1 RETURNING profile_id', [digest(secret)])).rows[0]?.profile_id ?? null;
 }
}
