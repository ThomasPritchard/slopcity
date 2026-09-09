import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { GuestRepository } from './persistence/guests.ts';
import { SessionRegistry } from './guest.ts';
import { VoiceService } from './voice.ts';
import { EconomyRepository } from './persistence/economy.ts';
import { SalaryTracker } from './salary.ts';
import { CasinoRepository } from './persistence/casino.ts';
import type { WalletState } from '../shared/catalog.ts';
if (existsSync('.env')) loadEnvFile('.env');
export const guests = new GuestRepository();
export const sessions = new SessionRegistry();
export const voice = new VoiceService();
export const economy = new EconomyRepository(guests.pool);
export const casinoRepository = new CasinoRepository(economy);
export const towns = new Map<string, { hasSession(id: string): boolean; refreshBlocks(id: string): Promise<void>; canPurchase(profileId:string):boolean; publishEconomy(profileId:string,sessionId:string,state:WalletState,accruing?:boolean):void; economyError(sessionId:string):void }>();
export const salary = new SalaryTracker(economy, {
  onSnapshot: (profileId, sessionId, state, accruing) => { const active=sessions.get(profileId); if(active?.sessionId===sessionId) towns.get(active.roomId)?.publishEconomy(profileId,sessionId,state,accruing); },
  onError: (profileId, sessionId) => { const active=sessions.get(profileId); if(active?.sessionId===sessionId) towns.get(active.roomId)?.economyError(sessionId); },
});
sessions.onBlocksChanged(async id => { await Promise.all([...towns.values()].map(town => town.refreshBlocks(id))); });
