import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { acquireRuntimeLock, runtimeConfig } from './runtime.ts';
import { mountGuestRoutes } from './guest.ts';
import { mountVoiceRoutes } from './voice.ts';
import { mountEconomyRoutes } from './economy.ts';
if (existsSync('.env')) loadEnvFile('.env');
const config = runtimeConfig();
const { guests, sessions, voice, towns, economy, casinoRepository } = await import('./context.ts');
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
  await casinoRepository.recoverPending();
} catch {
  await guests.close();
  await lock.close();
  throw new Error('Database initialisation or wager recovery failed');
}

const httpServer = createServer();
const server = new Server({
  transport: new WebSocketTransport({ server: httpServer, maxPayload: 4096 }),
  greet: false,
  gracefullyShutdown: false,
  express: app => {
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
    mountVoiceRoutes(app, guests, sessions, voice, (roomId, sessionId) => towns.get(roomId)?.hasSession(sessionId) ?? false);
    mountGuestRoutes(app, guests, sessions);
  },
});
server.define('town', TownRoom);
let settled = false;
server.onShutdown(async () => {
  // Colyseus invokes this only after room disposal (including casino settlement).
  await guests.close();
  await lock.close();
  settled = true;
});
async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
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
  console.log(`Slop City multiplayer listening on ${config.host}:${config.port}`);
} catch {
  console.error('Multiplayer listener failed to start');
  await shutdown(1);
}
