import { readFile } from 'node:fs/promises';
import type { CreditProtectionRepository,ConfirmedGiftIncident } from './persistence/creditProtection.ts';

export function parseCreditIncidents(source: string): ConfirmedGiftIncident[] {
 if(source.length>256_000)throw new Error('Incident manifest is too large');
 const incidents=JSON.parse(source) as ConfirmedGiftIncident[];
 if(!Array.isArray(incidents)||!incidents.length||incidents.length>20)throw new Error('Provide one to twenty confirmed incidents');
 return incidents;
}
export async function applyConfiguredCreditIncidents(protection: CreditProtectionRepository, file=process.env.CREDIT_INCIDENTS_FILE) {
 if(!file)return;
 const incidents=parseCreditIncidents(await readFile(file,'utf8'));
 // Validate the complete file before any adjustment. Startup applies before listening;
 // leaving the file mounted is safe because original gift IDs make recovery idempotent.
 for(const incident of incidents)await protection.confirmed(incident,false);
 for(const incident of incidents)await protection.confirmed(incident,true);
}
