import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, access, rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';

// This command writes secrets, never prints them, and refuses to overwrite a deployment.
const args = process.argv.slice(2);
const local = args.includes('--local');
const values = args.filter(arg => arg !== '--local');
if ((!local && values.length !== 4) || (local && values.length > 1)) {
  console.error('Usage: npm run deploy:configure -- GAME_DOMAIN VOICE_DOMAIN TURN_DOMAIN PUBLIC_IPV4\nLocal test: npm run deploy:configure -- --local [.deploy-smoke]');
  process.exit(1);
}
const [gameDomain, voiceDomain, turnDomain, publicIP] = local
  ? ['game.localhost', 'voice.localhost', 'turn.localhost', '127.0.0.1'] : values;
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
if (![gameDomain, voiceDomain, turnDomain].every(d => domainPattern.test(d) && (local || !d.endsWith('.localhost'))) || new Set([gameDomain, voiceDomain, turnDomain]).size !== 3 || isIP(publicIP) !== 4) {
  throw new Error('Use three distinct lowercase DNS hostnames (without URLs/paths) and a public IPv4 address.');
}
if (!local && /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(publicIP)) throw new Error('Production needs the VPS public IPv4 address.');
const directoryName = local ? (values[0] || '.deploy-smoke') : '.deploy';
if (!/^\.deploy(?:-[a-z0-9-]+)?$/.test(directoryName)) throw new Error('Deployment directory must be .deploy or .deploy-NAME in the repository root.');
const directory = resolve(directoryName);
try { await access(directory); throw new Error(`${directoryName} already exists; refusing to replace credentials. Keep its passwords when updating configuration.`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(directory, { mode: 0o700 });
const secret = () => randomBytes(32).toString('hex');
const adminPassword = secret(), appPassword = secret(), voiceKey = `SC${randomBytes(12).toString('hex')}`, voiceSecret = secret();
const portSuffix = local ? ':8443' : '';
const appOrigin = `https://${gameDomain}${portSuffix}`;
const response = (status, body = '') => ({ handler: 'static_response', status_code: status, body });
const proxy = dial => ({ handler: 'reverse_proxy', upstreams: [{ dial }] });
const header = set => ({ handler: 'headers', response: { set } });
const caddy = {
  admin: { disabled: true },
  logging: { logs: { default: { level: 'INFO' } } },
  apps: {
    tls: {
      certificates: { automate: [gameDomain, voiceDomain, turnDomain] },
      ...(local ? { automation: { policies: [{ issuers: [{ module: 'internal' }] }] } } : {}),
    },
    layer4: { servers: { tls: { listen: [':443'], routes: [
      { match: [{ tls: { sni: [turnDomain] } }], handle: [{ handler: 'tls' }, { handler: 'proxy', upstreams: [{ dial: ['livekit:5349'] }] }] },
      { match: [{ tls: { sni: [gameDomain, voiceDomain] } }], handle: [{ handler: 'tls', connection_policies: [{ alpn: ['http/1.1'] }] }, { handler: 'proxy', upstreams: [{ dial: ['127.0.0.1:8080'] }] }] },
    ] } } },
    http: { servers: {
      redirect: { listen: [':80'], automatic_https: { disable: true }, routes: [
        { match: [{ host: [gameDomain, voiceDomain, turnDomain] }], handle: [{ ...response(308), headers: { Location: ['https://{http.request.host}{http.request.uri}'] } }], terminal: true },
        { handle: [response(404)] },
      ] },
      web: { listen: ['127.0.0.1:8080'], automatic_https: { disable: true }, routes: [
        { match: [{ host: [gameDomain] }], handle: [{ handler: 'subroute', routes: [
          { handle: [header({ 'X-Content-Type-Options': ['nosniff'], 'X-Frame-Options': ['DENY'], 'Referrer-Policy': ['same-origin'], 'Permissions-Policy': ['camera=(), microphone=(self)'], 'Cache-Control': ['no-cache'] })] },
          { match: [{ path_regexp: { pattern: '(^|/)\\.' } }], handle: [response(404)], terminal: true },
          { match: [{ path: ['/game', '/game/*'] }], handle: [{ handler: 'rewrite', strip_path_prefix: '/game' }, proxy('game:2567')], terminal: true },
          { match: [{ path: ['/assets/*'] }], handle: [header({ 'Cache-Control': ['public, max-age=31536000, immutable'] }), { handler: 'file_server', root: '/srv' }], terminal: true },
          { handle: [{ handler: 'file_server', root: '/srv' }] },
        ] }], terminal: true },
        { match: [{ host: [voiceDomain] }], handle: [proxy('livekit:7880')], terminal: true },
        { handle: [response(404)] },
      ] },
    } },
  },
};
const livekit = {
  port: 7880,
  bind_addresses: ['0.0.0.0'],
  rtc: { tcp_port: 7881, udp_port: 7882, use_external_ip: false, node_ip: publicIP, ...(local ? { enable_loopback_candidate: true } : {}) },
  keys: { [voiceKey]: voiceSecret },
  room: { max_participants: 64, empty_timeout: 300, departure_timeout: 20 },
  turn: { enabled: true, domain: turnDomain, tls_port: 5349, udp_port: 3478, external_tls: true, ...(local ? { allow_restricted_peer_cidrs: ['127.0.0.1/32'] } : {}) },
  logging: { level: 'info', json: true },
};
try {
  for (const [name, contents] of Object.entries({
    'postgres-password': adminPassword,
    'app-password': appPassword,
    'game.env': `NODE_ENV=production\nHOST=0.0.0.0\nPORT=2567\nDATABASE_URL=postgresql://slop_city:${appPassword}@postgres:5432/slop_city\nAPP_ORIGIN=${appOrigin}\nAPP_ORIGINS=\nLIVEKIT_URL=http://livekit:7880\nLIVEKIT_PUBLIC_URL=wss://${voiceDomain}${portSuffix}\nLIVEKIT_API_KEY=${voiceKey}\nLIVEKIT_API_SECRET=${voiceSecret}\n`,
    'livekit.yaml': JSON.stringify(livekit, null, 2) + '\n',
    'caddy.json': JSON.stringify(caddy, null, 2) + '\n',
    'compose.env': `DEPLOY_DIR=./${directoryName}\nRELEASE_TAG=local\n${local ? 'COMPOSE_PROJECT_NAME=slop-city-smoke\nBIND_IP=127.0.0.1\nHTTP_PORT=8088\nHTTPS_PORT=8443\nRTC_TCP_PORT=17891\nRTC_UDP_PORT=17892\nTURN_UDP_PORT=13478\n' : 'BIND_IP=0.0.0.0\n'}`,
  })) await writeFile(resolve(directory, name), contents, { mode: 0o600, flag: 'wx' });
} catch (error) {
  await rm(directory, { recursive: true, force: true });
  throw error;
}
console.log(`Created private configuration in ${directoryName}/ (no credentials printed).`);
console.log(`Run: docker compose --env-file ${directoryName}/compose.env config --quiet`);
if (local) console.log('Local test configuration binds only to loopback. Its translated media ports are for container/API tests, not public voice deployment.');
