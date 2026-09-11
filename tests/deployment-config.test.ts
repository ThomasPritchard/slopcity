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

test('tunnel mode keeps the public HTTPS origin and sends signalling through the existing hostname', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'slop-tunnel-config-'));
  try {
    const result = spawnSync(process.execPath, [configure, '--tunnel', 'slopcity.example.com', 'voice.example.com', 'turn.example.com', '203.0.113.10'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0);
    const directory = join(cwd, '.deploy');
    const env = parseEnv(await readFile(join(directory, 'game.env'), 'utf8'));
    const compose = parseEnv(await readFile(join(directory, 'compose.env'), 'utf8'));
    const gateway = JSON.parse(await readFile(join(directory, 'caddy.json'), 'utf8'));
    const voice = JSON.parse(await readFile(join(directory, 'livekit.yaml'), 'utf8'));
    assert.equal(env.APP_ORIGIN, 'https://slopcity.example.com');
    assert.equal(env.LIVEKIT_PUBLIC_URL, 'wss://slopcity.example.com/voice');
    assert.equal(compose.COMPOSE_FILE, 'compose.yaml:compose.tunnel.yaml');
    assert.deepEqual(gateway.apps.http.servers.web.listen, [':80']);
    assert.equal(gateway.apps.tls, undefined, 'public TLS belongs to the existing tunnel');
    assert.equal(voice.turn.enabled, false, 'do not advertise an unreachable TURN/TLS endpoint');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

const upgrade = fileURLToPath(new URL('../scripts/configure-abuse-proxy.mjs', import.meta.url));
for (const tunnel of [false, true]) test(`trusted game proxy generation and private upgrade (${tunnel ? 'tunnel' : 'direct'})`, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'slop-abuse-config-'));
  try {
    const args = ['--local', ...(tunnel ? ['--tunnel'] : [])];
    const generated = spawnSync(process.execPath, [configure, ...args], { cwd, encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const directory = join(cwd, '.deploy-smoke');
    const envPath = join(directory, 'game.env'), gatewayPath = join(directory, 'caddy.json');
    const originalEnv = await readFile(envPath, 'utf8');
    const env = parseEnv(originalEnv);
    assert.match(env.ABUSE_PROXY_SECRET!, /^[a-f0-9]{64}$/);
    assert.ok(!`${generated.stdout}${generated.stderr}`.includes(env.ABUSE_PROXY_SECRET!));
    const gateway = JSON.parse(await readFile(gatewayPath, 'utf8'));
    const web = gateway.apps.http.servers.web;
    const routes = web.routes[0].handle[0].routes;
    const proxy = routes.find((r: any) => r.match?.[0]?.path?.includes('/game')).handle[1];
    assert.deepEqual(proxy.headers.request.set, {
      'X-Slop-Proxy-Key': [env.ABUSE_PROXY_SECRET],
      'X-Slop-Client-IP': [tunnel ? '{http.request.header.CF-Connecting-IP}' : '{http.request.remote.host}'],
    }, 'set replaces caller headers for HTTP and WebSocket requests on the same route');
    const admin = routes.find((r: any) => r.match?.[0]?.path?.includes('/admin'));
    assert.deepEqual(admin.match[0].path, ['/admin', '/admin/']);
    assert.equal(admin.handle[0].uri, '/index.html');
    if (!tunnel) {
      assert.deepEqual(web.listener_wrappers, [{ wrapper: 'proxy_protocol', fallback_policy: 'REQUIRE' }]);
      assert.equal(gateway.apps.layer4.servers.tls.routes[1].handle[1].proxy_protocol, 'v2');
    }
    // Model an old deployment, including unrelated settings that must survive.
    delete proxy.headers;
    routes.splice(routes.indexOf(admin), 1);
    gateway.logging.logs.default.level = 'WARN';
    if (!tunnel) {
      delete web.listener_wrappers;
      delete gateway.apps.layer4.servers.tls.routes[1].handle[1].proxy_protocol;
    }
    const { writeFile } = await import('node:fs/promises');
    await writeFile(gatewayPath, JSON.stringify(gateway));
    const oldEnv = originalEnv.replace(/^ABUSE_PROXY_SECRET=.*\n/m, '') + 'UNRELATED_SETTING=preserve-me\n';
    await writeFile(envPath, oldEnv);
    const otherFiles = await Promise.all(['postgres-password', 'app-password', 'compose.env', 'livekit.yaml'].map(async name => [name, await readFile(join(directory, name), 'utf8')]));
    const run = () => spawnSync(process.execPath, [upgrade, '--directory', directory, ...(tunnel ? ['--tunnel'] : [])], { cwd, encoding: 'utf8' });
    const upgraded = run();
    assert.equal(upgraded.status, 0, upgraded.stderr);
    const newEnvText = await readFile(envPath, 'utf8');
    const newEnv = parseEnv(newEnvText);
    assert.equal(newEnvText.replace(/^ABUSE_PROXY_SECRET=.*\n/m, ''), oldEnv);
    assert.ok(!`${upgraded.stdout}${upgraded.stderr}`.includes(newEnv.ABUSE_PROXY_SECRET!));
    const updated = JSON.parse(await readFile(gatewayPath, 'utf8'));
    assert.equal(updated.logging.logs.default.level, 'WARN');
    const preserved = structuredClone(updated);
    const preservedWeb = preserved.apps.http.servers.web;
    const preservedRoutes = preservedWeb.routes[0].handle[0].routes;
    delete preservedRoutes.find((r: any) => r.match?.[0]?.path?.includes('/game')).handle[1].headers;
    preservedRoutes.splice(preservedRoutes.findIndex((r: any) => r.match?.[0]?.path?.includes('/admin')), 1);
    if (!tunnel) {
      delete preservedWeb.listener_wrappers;
      delete preserved.apps.layer4.servers.tls.routes[1].handle[1].proxy_protocol;
    }
    assert.deepEqual(preserved, gateway, 'all unrelated gateway configuration survives exactly');
    assert.equal(run().status, 0);
    assert.equal(await readFile(envPath, 'utf8'), newEnvText, 'reruns do not rotate the shared key');
    for (const [name, contents] of otherFiles) assert.equal(await readFile(join(directory, name!), 'utf8'), contents);
    // Invalid/custom layouts fail before either private file changes.
    updated.apps.http.servers.web.routes.push(structuredClone(updated.apps.http.servers.web.routes[0]));
    const ambiguous = JSON.stringify(updated);
    await writeFile(gatewayPath, ambiguous);
    assert.notEqual(run().status, 0);
    assert.equal(await readFile(envPath, 'utf8'), newEnvText);
    assert.equal(await readFile(gatewayPath, 'utf8'), ambiguous);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('host nginx sanitizes visitor identity in both proxy locations and trusts only loopback', async () => {
  const nginx = await readFile(new URL('../deploy/nginx-tunnel.conf', import.meta.url), 'utf8');
  assert.deepEqual([...nginx.matchAll(/set_real_ip_from ([^;]+);/g)].map(m => m[1]), ['127.0.0.1', '::1']);
  assert.match(nginx, /real_ip_header CF-Connecting-IP;/);
  assert.equal([...nginx.matchAll(/proxy_set_header CF-Connecting-IP \$remote_addr;/g)].length, 2);
});
