// Disposable, loopback-only database and server for community browser acceptance.
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { loadEnvFile } from 'node:process';
import { Pool } from 'pg';
import { hashCommunityPassword } from '../server/communityAuth.ts';

loadEnvFile('.env');
const directOrigin = 'http://localhost:5178';
const requestedOrigin = process.env.COMMUNITY_PREVIEW_ORIGIN?.trim();
let proxyOrigin = '';
if (requestedOrigin) {
 const preview = new URL(requestedOrigin);
 if (preview.protocol !== 'http:' || !(preview.hostname === 'localhost' || preview.hostname.endsWith('.localhost')) || preview.username || preview.password || preview.pathname !== '/' || preview.search || preview.hash) {
  throw Error('COMMUNITY_PREVIEW_ORIGIN must be an exact HTTP localhost preview URL without a path.');
 }
 proxyOrigin = preview.origin;
}
const url = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Community preview requires the local development database.');
for (const port of [5178, 2578]) {
 await new Promise<void>((resolve, reject) => {
  const server = createServer();
  server.once('error', () => reject(new Error(`Local port ${port} is already in use.`)));
  server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
 });
}
const directory = 'output/playwright/cinema-preview';
await mkdir(directory, { recursive: true });
const database = new Pool({ connectionString: url.toString() });
const schema = `cinema_preview_${randomUUID().replaceAll('-', '')}`;
const children: ChildProcess[] = [];
let stopping = false;
async function stop(code = 0) {
 if (stopping) return;
 stopping = true;
 for (const child of children) child.kill('SIGTERM');
 await Promise.all(children.map(child => !child.pid || child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(resolve => child.once('exit', () => resolve()))));
 try { await database.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
 finally { await database.end(); await rm(`${directory}/access.json`, { force: true }); }
 process.exit(code);
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
try {
 await database.query(`CREATE SCHEMA ${schema}`);
 url.searchParams.set('options', `-c search_path=${schema}`);
 const password = randomBytes(24).toString('base64url');
 const origin = directOrigin;
 await rm(`${directory}/access.json`, { force: true });
 await writeFile(`${directory}/access.json`, JSON.stringify({ password, origin, schema }), { mode: 0o600 });
 await writeFile(`${directory}/vite.config.ts`, `import {defineConfig} from 'vite';export default defineConfig({server:{host:'127.0.0.1',port:5178,strictPort:true,proxy:{'/game':{target:'http://127.0.0.1:2578',ws:true,rewrite:path=>path.replace(/^\\/game/,'')},'/voice':{target:'http://127.0.0.1:17880',ws:true,rewrite:path=>path.replace(/^\\/voice/,'')}}}});`);
 const env = { ...process.env, DATABASE_URL: url.toString(), APP_ORIGIN: origin, APP_ORIGINS: proxyOrigin, HOST: '127.0.0.1', PORT: '2578', COMMUNITY_ADMIN_PASSWORD_HASH: await hashCommunityPassword(password) };
 for (const [name, args] of [
  ['server', ['--import', 'tsx', 'server/index.ts']],
  ['vite', ['node_modules/vite/bin/vite.js', '--config', `${directory}/vite.config.ts`]],
 ] as const) {
  const child = spawn(process.execPath, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const log = createWriteStream(`${directory}/${name}.log`);
  child.stdout!.pipe(log); child.stderr!.pipe(log);
  child.once('error', () => void stop(1));
  child.once('exit', () => { if (!stopping) void stop(1); });
 }
 console.log(`Disposable community preview starting at ${proxyOrigin || origin}. Ctrl+C removes its test database.`);
 console.log(`Private browser-test credentials saved to ${directory}/access.json; no credentials printed.`);
} catch {
 console.error('Community preview failed to start; removing its disposable database.');
 await stop(1);
}
