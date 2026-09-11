import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SafetyBan, SafetyGuest } from '../../shared/safety.ts';
import type { EconomyRepository } from './economy.ts';

const ban = (row: any): SafetyBan => ({ id: row.id, kind: row.kind, target: row.target, reason: row.reason, createdAt: +row.created_at, expiresAt: row.expires_at ? +row.expires_at : null });
export class SafetyRepository {
 constructor(private readonly economy: EconomyRepository) {}
 async initialise() {
  await this.economy.transaction(async c => {
   await c.query('SELECT pg_advisory_xact_lock(782641092)');
   const versions = (await c.query('SELECT version FROM guest_schema_migrations')).rows.map(row => row.version);
   if (!versions.includes(8) || versions.some(v => ![1,2,3,4,5,6,7,8,9].includes(v))) throw new Error('Unsupported safety schema');
   if (!versions.includes(9)) { await c.query(await readFile(new URL('./migrations/009_safety.sql', import.meta.url), 'utf8')); await c.query('INSERT INTO guest_schema_migrations(version) VALUES(9)'); }
  });
 }
 async active(): Promise<SafetyBan[]> {
  return (await this.economy.pool.query('SELECT * FROM safety_bans WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) ORDER BY created_at DESC')).rows.map(ban);
 }
 async profileNames(after: string | null): Promise<{id:string;name:string}[]> {
  return (await this.economy.pool.query('SELECT id,name FROM guest_profiles WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT 500',[after])).rows;
 }
 async add(kind: SafetyBan['kind'], target: string, reason: string, durationMinutes: number | null): Promise<SafetyBan> {
  return this.economy.transaction(async c => {
   await c.query('SELECT pg_advisory_xact_lock(782641094)');
   if (kind === 'guest' && !(await c.query('SELECT id FROM guest_profiles WHERE id=$1', [target])).rowCount) throw new Error('Guest not found');
   const replaced=await c.query('UPDATE safety_bans SET revoked_at=now() WHERE kind=$1 AND target=$2 AND revoked_at IS NULL RETURNING id',[kind,target]);
   for(const row of replaced.rows)await c.query("INSERT INTO safety_audit(ban_id,action) VALUES($1,'unban')",[row.id]);
   const count = await c.query('SELECT count(*) FROM safety_bans WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())');
   if (Number(count.rows[0].count) >= 5000) throw new Error('Lift an existing ban before adding more');
   const row = (await c.query("INSERT INTO safety_bans(id,kind,target,reason,expires_at) VALUES($1,$2,$3,$4,CASE WHEN $5::integer IS NULL THEN NULL ELSE now()+$5*interval '1 minute' END) RETURNING *", [randomUUID(),kind,target,reason,durationMinutes])).rows[0];
   await c.query("INSERT INTO safety_audit(ban_id,action) VALUES($1,'ban')", [row.id]);
   return ban(row);
  });
 }
 async revoke(id: string): Promise<boolean> {
  return this.economy.transaction(async c => {
   const result = await c.query('UPDATE safety_bans SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id', [id]);
   if (result.rowCount) await c.query("INSERT INTO safety_audit(ban_id,action) VALUES($1,'unban')", [id]);
   return !!result.rowCount;
  });
 }
 async search(query: string): Promise<SafetyGuest[]> {
  return (await this.economy.pool.query("SELECT id,name,created_at FROM guest_profiles WHERE id::text=$1 OR name ILIKE $2 ESCAPE '\\' ORDER BY created_at DESC LIMIT 30", [query,`%${query.replace(/[\\%_]/g, '\\$&')}%`])).rows.map(row => ({profileId:row.id,name:row.name,createdAt:+row.created_at}));
 }
}
