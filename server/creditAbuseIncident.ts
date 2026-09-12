// Maintenance entry point inside the game image; stdin carries the private manifest.
// It does not initialise schemas, grant wallets, recover casino hands or start a server.
import { Pool } from 'pg';
import { EconomyRepository } from './persistence/economy.ts';
import { CreditProtectionRepository } from './persistence/creditProtection.ts';
import { parseCreditIncidents } from './creditIncidents.ts';

const apply=process.argv.includes('--apply');
if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw new Error('Usage: node server/creditAbuseIncident.js [--apply] < private-incident.json');
let source='';
process.stdin.setEncoding('utf8');
for await(const chunk of process.stdin){source+=chunk;if(source.length>256_000)throw new Error('Incident manifest is too large');}
const incidents=parseCreditIncidents(source);
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000,query_timeout:15_000});
try {
 const protection=new CreditProtectionRepository(new EconomyRepository(pool));
 // Validate every incident before applying any. An interrupted run is safe to repeat.
 for(const incident of incidents)console.log(JSON.stringify(await protection.confirmed(incident,false)));
 if(apply)for(const incident of incidents)console.log(JSON.stringify(await protection.confirmed(incident,true)));
} finally {await pool.end();}
