import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { loadEnvFile } from 'node:process';
const root = resolve(import.meta.dirname, '..');
if (existsSync(join(root, '.env'))) loadEnvFile(join(root, '.env'));
const local = join(root, '.local');
mkdirSync(local, { recursive: true, mode: 0o700 });
const pgBin = process.env.PG_BIN || '/opt/homebrew/opt/postgresql@18/bin';
const data = join(local, 'postgres');
const pidPath = join(local, 'livekit.pid');
const configPath = join(local, 'livekit.yaml');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command.split('/').pop()} failed: ${result.stderr || result.error || 'see local service logs'}`);
  return result.stdout;
}
function ownsLivekit(pid) {
  try { return run('ps', ['-p', String(pid), '-o', 'command=']).includes(configPath); } catch { return false; }
}
if (process.argv[2] === 'stop') {
  if (existsSync(join(data, 'PG_VERSION'))) spawnSync(join(pgBin, 'pg_ctl'), ['-D', data, 'stop', '-m', 'fast']);
  if (existsSync(pidPath)) { const pid = Number(readFileSync(pidPath, 'utf8')); if (ownsLivekit(pid)) process.kill(pid, 'SIGTERM'); unlinkSync(pidPath); }
  console.log('Stopped Slop City local services.');
  process.exit(0);
}
if (!existsSync(join(pgBin, 'initdb'))) throw new Error('PostgreSQL binaries missing. Install postgresql@18 or set PG_BIN.');
const secretsPath = join(local, 'service-secrets.json');
if (!existsSync(secretsPath)) writeFileSync(secretsPath, JSON.stringify({ admin: randomBytes(24).toString('hex'), database: randomBytes(24).toString('hex'), apiKey: `slop${randomBytes(8).toString('hex')}`, apiSecret: randomBytes(32).toString('hex') }), { mode: 0o600 });
const secrets = JSON.parse(readFileSync(secretsPath, 'utf8'));
if (!existsSync(join(data, 'PG_VERSION'))) {
  const passwordFile = join(local, 'init-password');
  writeFileSync(passwordFile, secrets.admin, { mode: 0o600 });
  try { run(join(pgBin, 'initdb'), ['-D', data, '-U', 'slop_admin', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C', `--pwfile=${passwordFile}`]); }
  finally { unlinkSync(passwordFile); }
}
if (spawnSync(join(pgBin, 'pg_ctl'), ['-D', data, 'status'], { stdio: 'ignore' }).status !== 0) run(join(pgBin, 'pg_ctl'), ['-D', data, '-l', join(local, 'postgres.log'), '-o', '-h 127.0.0.1 -p 55432 -k /tmp', 'start']);
const admin = new Pool({ host: '127.0.0.1', port: 55432, user: 'slop_admin', password: secrets.admin, database: 'postgres' });
try {
  if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='slop_city'")).rowCount) {
    // Generated hex only; PostgreSQL's CREATE ROLE grammar cannot bind its password as a value parameter.
    if (!/^[a-f0-9]{48}$/.test(secrets.database)) throw new Error('Invalid generated database credential');
    await admin.query(`CREATE ROLE slop_city LOGIN PASSWORD '${secrets.database}'`);
  }
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='slop_city'")).rowCount) await admin.query('CREATE DATABASE slop_city OWNER slop_city');
} finally { await admin.end(); }
const config = `port: 17880\nbind_addresses: ["127.0.0.1"]\ndevelopment: true\nrtc:\n  tcp_port: 0\n  udp_port: 17882\n  node_ip: 127.0.0.1\n  use_external_ip: false\n  enable_loopback_candidate: true\n  interfaces:\n    includes: ["lo0"]\nkeys:\n  ${secrets.apiKey}: ${secrets.apiSecret}\nlogging:\n  level: warn\n`;
const configChanged = existsSync(configPath) && readFileSync(configPath, 'utf8') !== config;
const oldPid = existsSync(pidPath) ? Number(readFileSync(pidPath, 'utf8')) : 0;
if (configChanged && oldPid && ownsLivekit(oldPid)) {
  process.kill(oldPid, 'SIGTERM');
  for (let attempt = 0; attempt < 40 && ownsLivekit(oldPid); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  if (ownsLivekit(oldPid)) throw new Error('Previous project voice server has not stopped.');
}
writeFileSync(configPath, config, { mode: 0o600 });
if (!oldPid || !ownsLivekit(oldPid)) {
  const log = openSync(join(local, 'livekit.log'), 'a', 0o600);
  const child = spawn(process.env.LIVEKIT_BINARY || 'livekit-server', ['--config', configPath], { detached: true, stdio: ['ignore', log, log] });
  child.on('error', error => { console.error(`LiveKit could not start: ${error.message}`); process.exitCode = 1; });
  if (child.pid) { writeFileSync(pidPath, String(child.pid)); child.unref(); }
  closeSync(log);
}
const envPath = join(root, '.env');
let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const settings = {
  DATABASE_URL: `postgresql://slop_city:${secrets.database}@127.0.0.1:55432/slop_city`,
  APP_ORIGIN: 'http://localhost:5173',
  APP_ORIGINS: 'http://127.0.0.1:5173',
  TURNSTILE_ENABLED: 'false',
  LIVEKIT_URL: 'ws://127.0.0.1:17880',
  LIVEKIT_API_KEY: secrets.apiKey,
  LIVEKIT_API_SECRET: secrets.apiSecret,
};
for (const [key, value] of Object.entries(settings)) if (!new RegExp(`^${key}=`, 'm').test(env)) env += `${env && !env.endsWith('\n') ? '\n' : ''}${key}=${value}\n`;
if (!existsSync(envPath) || readFileSync(envPath, 'utf8') !== env) writeFileSync(envPath, env, { mode: 0o600 });
for (let attempt = 0; attempt < 30; attempt++) {
  try { if ((await fetch('http://127.0.0.1:17880')).ok) { console.log('Slop City PostgreSQL :55432 and LiveKit :17880 ready. Credentials retained in ignored local files.'); process.exit(0); } } catch {}
  await new Promise(resolve => setTimeout(resolve, 250));
}
throw new Error('LiveKit did not become ready; inspect .local/livekit.log.');
