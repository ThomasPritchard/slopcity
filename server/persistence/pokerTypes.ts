import type { WalletState } from '../../shared/catalog.ts';

export type PokerEscrow = {
 id: string; profileId: string; roomId: string; tableId: 'poker-1'; seat: number;
 stack: number; revision: number; status: 'open' | 'closed'; activeHandId: string | null;
};
export type PokerTransfer = { escrow: PokerEscrow; wallet: WalletState; replayed: boolean };
export type PokerBuyIn = {
 profileId: string; requestId: string; fingerprint: string; roomId: string; tableId: 'poker-1'; seat: number; amount: number;
};
export type PokerHandStart = { handId: string; roomId: string; tableId: 'poker-1'; roster: PokerEscrow[] };
export type PokerAllocation = { escrowId: string; stack: number };
export interface PokerRepositoryLike {
 replay(profileId: string, requestId: string, fingerprint: string): Promise<PokerTransfer | null>;
 buyIn(input: PokerBuyIn, validate: () => void): Promise<PokerTransfer>;
 beginHand(input: PokerHandStart, validate?: () => void): Promise<void>;
 finishHand(handId: string, allocations: PokerAllocation[]): Promise<PokerEscrow[]>;
 cashOut(escrowId: string): Promise<PokerTransfer>;
}
