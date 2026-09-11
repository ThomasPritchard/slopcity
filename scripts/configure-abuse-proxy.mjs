import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// Only the generated game route and its transport trust settings are changed.
export function configureAbuseProxy(caddy, secret, tunnel) {
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid abuse proxy secret.');
  const web = caddy.apps?.http?.servers?.web;
  const sites = web?.routes?.filter(route => route.handle?.some(handle => handle.handler === 'subroute' && handle.routes?.some(r => r.handle?.some(h => h.handler === 'reverse_proxy' && h.upstreams?.some(u => u.dial === 'game:2567')))));
  if (sites?.length !== 1) throw new Error('Expected exactly one generated game site.');
  const subroutes = sites[0].handle.filter(h => h.handler === 'subroute');
  if (subroutes.length !== 1) throw new Error('Ambiguous game subroutes.');
  const routes = subroutes[0].routes;
  const gameRoutes = routes.filter(r => r.handle?.some(h => h.handler === 'reverse_proxy' && h.upstreams?.some(u => u.dial === 'game:2567')));
  if (gameRoutes.length !== 1 || JSON.stringify(gameRoutes[0].match) !== JSON.stringify([{ path: ['/game', '/game/*'] }])) throw new Error('Expected the generated /game route.');
  const proxies = gameRoutes[0].handle.filter(h => h.handler === 'reverse_proxy');
  if (proxies.length !== 1 || proxies[0].upstreams.length !== 1) throw new Error('Ambiguous game upstream.');
  if (tunnel) {
    if (caddy.apps.layer4 || JSON.stringify(web.listen) !== JSON.stringify([':80'])) throw new Error('Tunnel mode does not match the gateway.');
  } else {
    if (JSON.stringify(web.listen) !== JSON.stringify(['127.0.0.1:8080'])) throw new Error('Direct HTTP listener must remain loopback-only.');
    const forwards = caddy.apps.layer4?.servers?.tls?.routes?.flatMap(r => r.handle ?? []).filter(h => h.handler === 'proxy' && h.upstreams?.some(u => u.dial?.includes('127.0.0.1:8080')));
    if (forwards?.length !== 1 || forwards[0].upstreams.length !== 1) throw new Error('Expected one direct TLS-to-HTTP proxy.');
    const wrapper = { wrapper: 'proxy_protocol', fallback_policy: 'REQUIRE' };
    if (web.listener_wrappers && JSON.stringify(web.listener_wrappers) !== JSON.stringify([wrapper])) throw new Error('Custom listener wrappers require manual review.');
    forwards[0].proxy_protocol = 'v2';
    web.listener_wrappers = [wrapper];
  }
  const request = (proxies[0].headers ??= {}).request ??= {};
  for (const operation of ['add', 'delete', 'replace']) {
    if (request[operation] && /x-slop-(?:proxy-key|client-ip)/i.test(JSON.stringify(request[operation]))) throw new Error('Conflicting proxy header operation.');
  }
  const set = request.set ??= {};
  for (const key of Object.keys(set)) if (/^x-slop-(proxy-key|client-ip)$/i.test(key)) delete set[key];
  set['X-Slop-Proxy-Key'] = [secret];
  set['X-Slop-Client-IP'] = [tunnel ? '{http.request.header.CF-Connecting-IP}' : '{http.request.remote.host}'];
  const adminRoutes = routes.filter(r => r.match?.some(m => m.path?.some(p => p === '/admin' || p === '/admin/')));
  const admin = { match: [{ path: ['/admin', '/admin/'] }], handle: [{ handler: 'rewrite', uri: '/index.html' }, { handler: 'file_server', root: '/srv' }], terminal: true };
  if (adminRoutes.length && (adminRoutes.length !== 1 || JSON.stringify(adminRoutes[0]) !== JSON.stringify(admin))) throw new Error('Existing admin route requires manual review.');
  if (!adminRoutes.length) routes.splice(routes.indexOf(gameRoutes[0]) + 1, 0, admin);
}

async function main() {
  const args = process.argv.slice(2);
  let directory = '.deploy';
  let tunnel = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tunnel') tunnel = true;
    else if (args[i] === '--directory' && args[i + 1]) directory = args[++i];
    else throw new Error('Usage: node scripts/configure-abuse-proxy.mjs [--directory PATH] [--tunnel]');
  }
  const envPath = resolve(directory, 'game.env'), caddyPath = resolve(directory, 'caddy.json');
  for (const path of [envPath, caddyPath]) if (!(await lstat(path)).isFile()) throw new Error('Configuration must be regular files, not symbolic links.');
  const envText = await readFile(envPath, 'utf8');
  if ((envText.match(/^\s*(?:export\s+)?ABUSE_PROXY_SECRET\s*=/gm) ?? []).length > 1) throw new Error('Duplicate abuse proxy secret entries.');
  const env = parseEnv(envText);
  const secret = env.ABUSE_PROXY_SECRET || randomBytes(32).toString('hex');
  const original = await readFile(caddyPath, 'utf8');
  let caddy;
  try { caddy = JSON.parse(original); } catch { throw new Error('Invalid gateway JSON.'); }
  configureAbuseProxy(caddy, secret, tunnel);
  const updatedEnv = env.ABUSE_PROXY_SECRET ? envText : envText.replace(/^\s*(?:export\s+)?ABUSE_PROXY_SECRET\s*=.*$/gm, '') + `${envText.endsWith('\n') ? '' : '\n'}ABUSE_PROXY_SECRET=${secret}\n`;
  const suffix = `.abuse-${randomBytes(8).toString('hex')}.tmp`;
  const envTemp = envPath + suffix, caddyTemp = caddyPath + suffix;
  try {
    await writeFile(envTemp, updatedEnv, { mode: 0o600, flag: 'wx' });
    await writeFile(caddyTemp, JSON.stringify(caddy, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    // Write the durable secret first: rerunning after interruption reuses it.
    await rename(envTemp, envPath);
    await rename(caddyTemp, caddyPath);
  } finally {
    await rm(envTemp, { force: true });
    await rm(caddyTemp, { force: true });
  }
  console.log(`Updated ${envPath} and ${caddyPath}.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof SyntaxError ? 'Invalid private configuration.' : error.message); process.exitCode = 1; });
}
