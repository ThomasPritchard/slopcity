import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { acquireRuntimeLock, runtimeConfig } from '../server/runtime.ts';

const production = {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://game:secret@postgres/game',
  APP_ORIGIN: 'https://game.example.com', LIVEKIT_URL: 'http://livekit:7880',
  LIVEKIT_PUBLIC_URL: 'wss://voice.example.com', LIVEKIT_API_KEY: 'game-key', LIVEKIT_API_SECRET: 'secret-value',
};
test('runtime defaults remain local and production accepts internal voice with secure public endpoints', () => {
  assert.deepEqual(runtimeConfig({}), { host: '127.0.0.1', port: 2567 });
  assert.deepEqual(runtimeConfig({ ...production, HOST: '0.0.0.0', PORT: '3000' }), { host: '0.0.0.0', port: 3000 });
  assert.doesNotThrow(() => runtimeConfig({ ...production, APP_ORIGINS: 'https://other.example.com' }));
});
test('production rejects incomplete configuration and unsafe origins without reflecting secret values', () => {
  for (const name of ['DATABASE_URL', 'APP_ORIGIN', 'LIVEKIT_URL', 'LIVEKIT_PUBLIC_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) {
    assert.throws(() => runtimeConfig({ ...production, [name]: '' }), new RegExp(name));
  }
  for (const patch of [
    { APP_ORIGIN: 'http://game.example.com' }, { APP_ORIGIN: 'https://game.example.com/' },
    { APP_ORIGINS: '*' }, { LIVEKIT_PUBLIC_URL: 'ws://voice.example.com' },
    { LIVEKIT_API_SECRET: 'REPLACE_ME' }, { DATABASE_URL: 'not-a-url-secret' },
    { LIVEKIT_URL: 'http://user:private-password@voice.example.com' },
  ]) {
    assert.throws(() => runtimeConfig({ ...production, ...patch }), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes('private-password'));
      assert.ok(!error.message.includes('not-a-url-secret'));
      return true;
    });
  }
  for (const PORT of ['NaN', '0', '65536', '3.5']) assert.throws(() => runtimeConfig({ PORT }), /PORT/);
});

test('runtime lock excludes duplicate owners, isolates schemas, releases and reports connection loss', { skip: !process.env.DATABASE_URL }, async () => {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const schemas = [0, 1].map(() => `runtime_test_${randomUUID().replaceAll('-', '')}`);
  const locks: Awaited<ReturnType<typeof acquireRuntimeLock>>[] = [];
  const url = (schema: string) => {
    const value = new URL(process.env.DATABASE_URL!);
    value.searchParams.set('options', `-c search_path=${schema}`);
    value.searchParams.set('application_name', schema);
    return value.toString();
  };
  let lost = 0;
  try {
    for (const schema of schemas) await admin.query(`CREATE SCHEMA ${schema}`);
    locks.push(await acquireRuntimeLock(url(schemas[0]), () => { lost++; }));
    await assert.rejects(acquireRuntimeLock(url(schemas[0]), () => {}), /Another Slop City server/);
    locks.push(await acquireRuntimeLock(url(schemas[1]), () => {}));
    await locks.shift()!.close();
    assert.equal(lost, 0, 'intentional release is not ownership loss');
    locks.push(await acquireRuntimeLock(url(schemas[0]), () => { lost++; }));
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1', [schemas[0]]);
    const deadline = Date.now() + 3000;
    while (!lost && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(lost, 1, 'lost ownership reported exactly once');
  } finally {
    for (const lock of locks) await lock.close();
    for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

test('server starts, rejects a duplicate database owner and releases ownership on SIGTERM', { skip: !process.env.DATABASE_URL, timeout: 20000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { createServer } = await import('node:net');
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const schema = `runtime_process_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const isolated = new URL(process.env.DATABASE_URL!);
  isolated.searchParams.set('options', `-c search_path=${schema}`);
  const children: ReturnType<typeof spawn>[] = [];
  function launch() {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: { ...process.env, DATABASE_URL: isolated.toString(), NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    child.stdout!.on('data', data => { output += data.toString(); });
    child.stderr!.on('data', data => { output += data.toString(); });
    const done = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    return { child, done, output: () => output };
  }
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const first = launch();
    const deadline = Date.now() + 10000;
    while (!first.output().includes('multiplayer listening') && Date.now() < deadline && first.child.exitCode === null) {
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(first.output().includes('multiplayer listening'), 'isolated game server started');
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    const duplicate = launch();
    assert.equal(await duplicate.done, 1);
    assert.match(duplicate.output(), /Another Slop City server/);
    first.child.kill('SIGTERM');
    assert.equal(await first.done, 0, 'graceful shutdown completed');
    const lock = await acquireRuntimeLock(isolated.toString(), () => {});
    await lock.close();
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await new Promise(resolve => child.once('exit', resolve));
      }
    }
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
