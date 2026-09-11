import { TwitchLiveService } from './twitchLive.ts';
import { mountCommunityRoutes } from './community.ts';
import { AddressedHttpServer, clientAddress, proxySecret } from './clientAddress.ts';
import { guardHttpRequest, mountSafetyGuards } from './safetyRoutes.ts';
import { SafetyError } from './safety.ts';
import { authenticateGuest, isAllowedOrigin } from './guest.ts';
import { Server } from '@colyseus/core';
import { GameTransport } from './gameTransport.ts';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { acquireRuntimeLock, runtimeConfig } from './runtime.ts';
import { mountGuestRoutes } from './guest.ts';
import { mountVoiceRoutes } from './voice.ts';
import { mountPlayerSocialRoutes } from './playerSocial.ts';
import { mountEconomyRoutes } from './economy.ts';
if (existsSync('.env')) loadEnvFile('.env');
const config = runtimeConfig();
const addressSecret = proxySecret();
const { guests, sessions, voice, towns, economy, casinoRepository, socialRepository, communityRepository, safety } = await import('./context.ts');
const { TownRoom } = await import('./town.ts');
let stopping = false;
const lock = await acquireRuntimeLock(process.env.DATABASE_URL!, () => {
  console.error('Database ownership connection lost; exiting to protect game state');
  process.exit(1);
});
try {
  await guests.initialise();
  await economy.initialise();
  await casinoRepository.initialise();
  await socialRepository.initialise();
  await communityRepository.initialise();
  await safety.initialise();
  await casinoRepository.recoverPending();
} catch {
  await guests.close();
  await lock.close();
  throw new Error('Database initialisation or wager recovery failed');
}

const twitchLive = new TwitchLiveService();
const httpServer = new AddressedHttpServer(addressSecret,guardHttpRequest(safety));
const transport = new GameTransport({ server: httpServer, maxPayload: 4096, beforeUpgrade: async (_request, context) => {
  try {
    const ip = clientAddress(context.headers);
    if (!ip) throw new SafetyError(503,'untrusted_proxy','Game gateway unavailable.');
    if (!isAllowedOrigin(context.headers.get('origin') ?? undefined)) throw new SafetyError(403,'origin','Origin not allowed.');
    safety.checkBan(ip); safety.limit('upgrade',ip);
    const profile = await authenticateGuest(context.headers.get('cookie') ?? undefined,guests);
    if (!profile) throw new SafetyError(401,'unauthenticated','Restore your guest profile first.');
    safety.checkBan(ip,profile.id);
  } catch(error) {
    const known=error instanceof SafetyError;
    return new Response(known?error.message:'Game unavailable.',{status:known?error.status:503,headers:{'Cache-Control':'no-store',...(known&&error.status===429?{'Retry-After':String(error.retryAfter)}:{})}});
  }
} });
const server = new Server({
  transport,
  greet: false,
  gracefullyShutdown: false,
  express: app => {
    mountSafetyGuards(app,safety,guests);
    app.use((_request, response, next) => {
      if (stopping) { response.status(503).json({ status: 'unavailable' }); return; }
      next();
    });
    app.get('/health', async (_request, response) => {
      try { await guests.pool.query('SELECT 1'); response.json({ status: 'ok' }); }
      catch { response.status(503).json({ status: 'unavailable' }); }
    });
    mountEconomyRoutes(app, guests, economy, {
      canPurchase: id => { const active=sessions.get(id); return !!active && !!towns.get(active.roomId)?.canPurchase(id); },
      onEquipped: (id,state) => { const active=sessions.get(id); if(active) towns.get(active.roomId)?.publishEconomy(id,active.sessionId,state); },
    });
    mountVoiceRoutes(app, guests, sessions, voice, (roomId, sessionId) => towns.get(roomId)?.hasSession(sessionId) ?? false, safety);
    mountPlayerSocialRoutes(app, guests, socialRepository, {
      presence: id => { const active=sessions.get(id); if(!active)return; const presence=towns.get(active.roomId)?.socialPresence(id); return presence?.sessionId===active.sessionId?{...presence,roomId:active.roomId}:undefined; },
      changed: ids => { for(const town of towns.values())town.socialChanged(ids); },
      gifted: async ids => { for(const id of ids){const active=sessions.get(id);if(active){const wallet=await economy.ensure(id);towns.get(active.roomId)?.publishEconomy(id,active.sessionId,wallet);}} },
    });
    mountCommunityRoutes(app, guests, communityRepository, { safety, twitchLive });
    mountGuestRoutes(app, guests, sessions, safety);
  },
});
server.define('town', TownRoom);
let settled = false;
server.onShutdown(async () => {
  twitchLive.stop();
  safety.stopLogging();
  // Colyseus invokes this only after room disposal (including casino settlement).
  await guests.close();
  await lock.close();
  settled = true;
});
async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  twitchLive.stop();
  const deadline = setTimeout(() => {
    console.error('Graceful shutdown timed out; pending wagers recover on next startup');
    process.exit(1);
  }, 25000);
  deadline.unref();
  await server.gracefullyShutdown(false);
  clearTimeout(deadline);
  process.exit(settled ? exitCode : 1);
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
try {
  await server.listen(config.port, config.host);
  twitchLive.start();
  safety.startLogging();
  console.log(`Slop City multiplayer listening on ${config.host}:${config.port}`);
} catch {
  console.error('Multiplayer listener failed to start');
  await shutdown(1);
}
