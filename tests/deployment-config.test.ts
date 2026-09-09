import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const configure = fileURLToPath(new URL('../scripts/configure-deploy.mjs', import.meta.url));
test('deployment generation protects credentials, refuses rotation and keeps smoke ports private', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'slop-config-test-'));
  try {
    const run = () => spawnSync(process.execPath, [configure, '--local'], { cwd, encoding: 'utf8' });
    const first = run(); assert.equal(first.status, 0);
    const directory = join(cwd, '.deploy-smoke');
    const env = parseEnv(await readFile(join(directory, 'game.env'), 'utf8'));
    const compose = parseEnv(await readFile(join(directory, 'compose.env'), 'utf8'));
    const secret = await readFile(join(directory, 'app-password'), 'utf8');
    assert.match(secret, /^[a-f0-9]{64}$/);
    assert.equal(new URL(env.DATABASE_URL!).password, secret);
    assert.equal(compose.BIND_IP, '127.0.0.1');
    assert.equal(compose.COMPOSE_PROJECT_NAME, 'slop-city-smoke');
    assert.equal(env.NODE_ENV, 'production');
    assert.ok(!first.stdout.includes(secret) && !first.stdout.includes(env.LIVEKIT_API_SECRET!));
    if (process.platform !== 'win32') {
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal((await stat(join(directory, 'game.env'))).mode & 0o777, 0o600);
    }
    assert.notEqual(run().status, 0, 'rerunning setup must not silently rotate a live database password');
    assert.equal(await readFile(join(directory, 'app-password'), 'utf8'), secret);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('production generation rejects URL-shaped hostnames and private addresses before writing secrets', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'slop-config-reject-'));
  try {
    for (const args of [
      ['https://play.example.com', 'voice.example.com', 'turn.example.com', '203.0.113.10'],
      ['play.example.com', 'voice.example.com', 'turn.example.com', '127.0.0.1'],
      ['play.example.com', 'play.example.com', 'turn.example.com', '203.0.113.10'],
    ]) assert.notEqual(spawnSync(process.execPath, [configure, ...args], { cwd, encoding: 'utf8' }).status, 0);
    await assert.rejects(stat(join(cwd, '.deploy')), { code: 'ENOENT' });
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
