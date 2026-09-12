import { readFile } from 'node:fs/promises';
import type { AdmissionMode } from '../../shared/admission.ts';
import type { EconomyRepository } from './economy.ts';
export class AdmissionRepository {
 constructor(private readonly economy: EconomyRepository) {}
 async initialise() {
  await this.economy.transaction(async c => {
   await c.query('SELECT pg_advisory_xact_lock(782641092)');
   const versions = (await c.query('SELECT version FROM guest_schema_migrations')).rows.map(r => r.version);
   if (!versions.includes(9) || versions.some(v => ![1,2,3,4,5,6,7,8,9,10,11,12,13].includes(v))) throw new Error('Unsupported admission schema');
   if (!versions.includes(10)) {
    await c.query(await readFile(new URL('./migrations/010_admission.sql', import.meta.url), 'utf8'));
    await c.query('INSERT INTO guest_schema_migrations(version) VALUES(10)');
   }
  });
 }
 async load(): Promise<{mode: AdmissionMode; approved: string[]}> {
  const mode = (await this.economy.pool.query('SELECT mode FROM town_admission WHERE singleton')).rows[0].mode;
  const approved = (await this.economy.pool.query('SELECT profile_id FROM town_approved_guests')).rows.map(r => r.profile_id);
  return { mode, approved };
 }
 async approved() { return (await this.economy.pool.query('SELECT g.id,g.name FROM town_approved_guests a JOIN guest_profiles g ON g.id=a.profile_id ORDER BY a.created_at DESC')).rows as {id:string;name:string}[]; }
 async edit(action: 'mode'|'approve'|'revoke'|'reverify', target: string) {
  await this.economy.transaction(async c => {
   await c.query('SELECT pg_advisory_xact_lock(782641095)');
   if (action === 'mode') await c.query('UPDATE town_admission SET mode=$1 WHERE singleton', [target]);
   if (action === 'approve') {
    if (Number((await c.query('SELECT count(*) FROM town_approved_guests')).rows[0].count) >= 5000) throw new Error('Approval list is full');
    await c.query('INSERT INTO town_approved_guests(profile_id) VALUES($1) ON CONFLICT DO NOTHING', [target]);
   }
   if (action === 'revoke') await c.query('DELETE FROM town_approved_guests WHERE profile_id=$1', [target]);
   await c.query('INSERT INTO town_admission_audit(action,target) VALUES($1,$2)', [action,target]);
  });
 }
}
