import { ROULETTE_PROFIT_MULTIPLIER, ROULETTE_RED_NUMBERS, type CasinoPrivateState, type CasinoTableView } from '../../shared/casino.ts';
import { crapsReturn } from '../../shared/craps.ts';

export type CasinoResult = {
  id: string; tableId: CasinoTableView['id']; game: CasinoTableView['game'];
  stake: number; returned: number; net: number; unit: 'credits' | 'table chips'; detail: string;
};

/** Only revealed, settled personal results; wallet deposits and spectators are never wins. */
export function summariseCasinoResult(table: CasinoTableView, privateState: CasinoPrivateState, profileId: string): CasinoResult | null {
  if (!profileId || table.phase !== 'result') return null;
  let stake = 0, returned = 0, detail = '';
  switch (table.game) {
    case 'roulette': {
      if (table.result === null) return null;
      const bets = privateState.rouletteBets.filter(bet => bet.tableId === table.id && bet.roundId === table.roundId);
      if (!bets.length) return null;
      stake = bets.reduce((sum, { bet }) => sum + bet.stake, 0);
      returned = bets.reduce((sum, { bet }) => sum + (bet.numbers.includes(table.result!) ? bet.stake * (ROULETTE_PROFIT_MULTIPLIER[bet.kind] + 1) : 0), 0);
      detail = `${table.result} · ${table.result === 0 ? 'Zero' : (ROULETTE_RED_NUMBERS as readonly number[]).includes(table.result) ? 'Red' : 'Black'}`;
      break;
    }
    case 'blackjack': {
      const seat = table.seats.find(seat => seat.player.profileId === profileId);
      if (!seat?.hands.length || seat.hands.some(hand => hand.returned === undefined)) return null;
      stake = seat.hands.reduce((sum, hand) => sum + hand.stake, 0);
      returned = seat.hands.reduce((sum, hand) => sum + hand.returned!, 0);
      detail = seat.hands.some(hand => hand.outcome === 'blackjack') ? 'Blackjack' : seat.hands.length > 1 ? 'Both hands settled' : 'Hand settled';
      break;
    }
    case 'slots':
      if (table.player?.profileId !== profileId || table.returned === null) return null;
      stake = table.stake; returned = table.returned;
      detail = returned === 0 ? 'No winning line' : table.reels.join(' · ');
      break;
    case 'craps': {
      if (!table.result || table.result.pointAfter !== null) return null;
      const own = privateState.crapsBets?.find(bet => bet.tableId === table.id && bet.roundId === table.roundId);
      if (!own) return null;
      stake = own.bet.stake; returned = crapsReturn(own.bet, table.result);
      detail = `${table.result.total} rolled · ${own.bet.kind === 'pass' ? 'Pass' : 'Don’t Pass'}`;
      break;
    }
    case 'poker': {
      const seat = table.seats.find(seat => seat.player.profileId === profileId);
      if (!seat || seat.state === 'waiting' || !table.handId) return null;
      // Committed excludes uncalled chips returned by settlement. Awards stay at the table.
      stake = seat.committed;
      const awards = table.winners.filter(winner => winner.seat === seat.seat);
      returned = awards.reduce((sum, winner) => sum + winner.amount, 0);
      detail = awards.find(winner => winner.hand)?.hand || (seat.state === 'folded' ? 'You folded' : 'Hand settled');
      break;
    }
  }
  return { id: `${table.id}:${table.roundId}`, tableId: table.id, game: table.game, stake, returned, net: returned - stake, unit: table.game === 'poker' ? 'table chips' : 'credits', detail };
}

/** Bounded deduplication survives repeated public/private snapshots and panel reopening. */
export class CasinoResultFeed {
  private seen = new Set<string>();
  collect(tables: CasinoTableView[], privateState: CasinoPrivateState, profileId: string) {
    const results: CasinoResult[] = [];
    for (const table of tables) {
      const result = summariseCasinoResult(table, privateState, profileId);
      if (result && !this.seen.has(result.id)) { this.seen.add(result.id); results.push(result); }
    }
    while (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    return results;
  }
}
