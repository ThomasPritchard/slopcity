import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { parseProfile, type Profile } from '../../shared/world.ts';
import type { GuestProfile, PrivateGuestProfile } from '../../shared/profile.ts';
import { assertAllowedProfileName } from '../../shared/profileModeration.ts';
export const CREDENTIAL_SECONDS = 90 * 24 * 60 * 60;
export const validCredential = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const validProfileId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
const columns = 'id, name, shirt, skin, revision';
export class GuestRepository {
 readonly pool: Pool;
 constructor(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  this.pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000, query_timeout: 5000 });
  this.pool.on('error', () => { /* Requests report a generic service unavailable response. */ });
 }
 private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await this.pool.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { try { await client.query('ROLLBACK'); } catch { /* Preserve original failure. */ } throw error; }
  finally { client.release(); }
 }
 async initialise() {
  await this.transaction(async client => {
   await client.query('SELECT pg_advisory_xact_lock(782641092)');
   await client.query('CREATE TABLE IF NOT EXISTS guest_schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
   const versions = await client.query('SELECT version FROM guest_schema_migrations ORDER BY version');
   if (versions.rows.some(row => row.version !== 1 && row.version !== 2 && row.version !== 3 && row.version !== 4 && row.version !== 5 && row.version !== 6 && row.version !== 7 && row.version !== 8 && row.version !== 9 && row.version !== 10 && row.version !== 11 && row.version !== 12)) throw new Error('Unsupported guest schema version');
   if (!versions.rowCount) {
    await client.query(await readFile(new URL('./migrations/001_guests.sql', import.meta.url), 'utf8'));
    await client.query('INSERT INTO guest_schema_migrations(version) VALUES (1)');
   }
   await client.query(`SELECT ${columns} FROM guest_profiles LIMIT 0`);
   await client.query('SELECT credential_hash, profile_id, expires_at FROM guest_credentials LIMIT 0');
   await client.query('SELECT owner_id, target_id FROM guest_blocks LIMIT 0');
  });
 }
 close() { return this.pool.end(); }
 async create(input: Profile): Promise<{ profile: PrivateGuestProfile; secret: string }> {
  assertAllowedProfileName(input.name);
  const profile = { ...parseProfile(input), id: randomUUID(), revision: 1, blocks: [] };
  const secret = randomBytes(32).toString('base64url');
  await this.transaction(async client => {
   await client.query('INSERT INTO guest_profiles(id,name,shirt,skin) VALUES ($1,$2,$3,$4)', [profile.id, profile.name, profile.shirt, profile.skin]);
   await client.query("INSERT INTO guest_credentials(credential_hash,profile_id,expires_at) VALUES ($1,$2,now() + interval '90 days')", [hash(secret), profile.id]);
  });
  return { profile, secret };
 }
 async resolve(secret: string): Promise<PrivateGuestProfile | null> {
  if (!validCredential(secret)) return null;
  const result = await this.pool.query<GuestProfile>(`SELECT p.id,p.name,p.shirt,p.skin,p.revision FROM guest_profiles p JOIN guest_credentials c ON c.profile_id=p.id WHERE c.credential_hash=$1 AND c.expires_at>now()`, [hash(secret)]);
  return result.rows[0] ? { ...result.rows[0], blocks: await this.blocks(result.rows[0].id) } : null;
 }
 async update(id: string, input: Profile, revision: number): Promise<GuestProfile | null> {
  assertAllowedProfileName(input.name);
  const profile = parseProfile(input);
  const result = await this.pool.query<GuestProfile>(`UPDATE guest_profiles SET name=$2,shirt=$3,skin=$4,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$5 RETURNING ${columns}`, [id, profile.name, profile.shirt, profile.skin, revision]);
  return result.rows[0] ?? null;
 }
 async blocks(id: string): Promise<string[]> { return (await this.pool.query('SELECT target_id FROM guest_blocks WHERE owner_id=$1 ORDER BY target_id', [id])).rows.map(row => row.target_id); }
 async setBlock(owner: string, target: string, blocked: boolean): Promise<boolean> {
  if (owner === target || !validProfileId(target)) return false;
  return this.transaction(async client => {
   await client.query('SELECT id FROM guest_profiles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[owner,target]]);
   if (blocked) return !!(await client.query('INSERT INTO guest_blocks(owner_id,target_id) SELECT $1,id FROM guest_profiles WHERE id=$2 ON CONFLICT DO NOTHING RETURNING target_id', [owner,target])).rowCount || !!(await client.query('SELECT 1 FROM guest_blocks WHERE owner_id=$1 AND target_id=$2',[owner,target])).rowCount;
   await client.query('DELETE FROM guest_blocks WHERE owner_id=$1 AND target_id=$2', [owner,target]); return true;
  });
 }
}
