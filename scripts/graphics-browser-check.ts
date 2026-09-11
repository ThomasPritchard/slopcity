// Run the settings journey without changing the running local server's bot controls.
// Reuse the admission fixture: only the challenge provider is simulated.
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

const database = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(database.hostname)) throw new Error('Graphics browser checks require a loopback development database');
const schema = `admission_test_graphics_${randomUUID().replaceAll('-', '')}`;
const pool = new Pool({ connectionString: database.toString() });
const isolated = new URL(database);isolated.searchParams.set('options', `-c search_path=${schema}`);
async function freePort() {
  const server = createServer();server.listen(0, '127.0.0.1');await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));return port;
}
const port = await freePort(), webPort = await freePort();
const endpoint = `http://127.0.0.1:${port}`, origin = `http://localhost:${webPort}`;
let server: ChildProcess | undefined, web: ViteDevServer | undefined;
try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  server = spawn(process.execPath, ['--import', 'tsx', 'scripts/fixtures/admission-server.ts'], {
    env: { ...process.env, DATABASE_URL: isolated.toString(), NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), APP_ORIGIN: origin, APP_ORIGINS: '', TURNSTILE_SITE_KEY: 'admission-test-site', TURNSTILE_SECRET_KEY: 'admission-test-secret', ABUSE_PROXY_SECRET: '', TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '' },
    stdio: 'ignore',
  });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error('Isolated graphics server exited before becoming ready');
    try { ready = (await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* startup */ }
    if (ready) break;await delay(100);
  }
  if (!ready) throw new Error('Isolated graphics server did not become ready');
  web = await createViteServer({ configFile: false, server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/game': { target: endpoint, ws: true, rewrite: path => path.replace(/^\/game/, '') } } } });
  await web.listen();
  const check = spawn(process.execPath, ['--import', 'tsx', 'scripts/comfort-browser-check.ts'], { env: { ...process.env, GAME_URL: origin, COMFORT_FIXTURE_ADMISSION: '1' }, stdio: 'inherit' });
  const [code] = await once(check, 'exit');
  if (code !== 0) throw new Error('Graphics settings browser journey failed');
} finally {
  await web?.close();
  if (server?.exitCode === null) {
    const ended = once(server, 'exit');server.kill('SIGTERM');
    const timeout = setTimeout(() => server?.kill('SIGKILL'), 30000);
    await ended;clearTimeout(timeout);
  }
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();
}
