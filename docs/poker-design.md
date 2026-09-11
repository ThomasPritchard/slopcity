# Meridian Texas Hold’em

The right rear bay contains one six-seat, player-versus-player poker table at `(11.5, 51.4)`. Two to six funded players play no-limit Texas Hold’em using fictional credits. No bots, rake, real-money purchases or real-money cash-out.

## Table rules

- Blinds: 5 / 10 chips. Buy in between hands for 100–1,000 wallet credits, in steps of 100; default 100. One credit becomes one table chip. The cap applies to entry, not winnings. No mid-hand top-ups.
- A fresh cryptographically shuffled 52-card deck supplies two private hole cards each, burns and five community cards. Best five of seven wins; equal hands split each pot, with odd chips awarded clockwise after the button.
- The button advances to the next participating seat. Heads-up, the button posts the small blind and acts first preflop; the big blind acts first after the flop. Otherwise the usual clockwise blind/action order applies.
- Fold, check, call, raise to a total street bet, or all-in. A full raise is at least the previous full raise increment. A short all-in does not reopen an already-acted player's raise rights unless cumulative increases reach a full raise. Unmatched excess returns to its contributor; side pots preserve eligibility.
- Twenty seconds per turn. Expiry checks when free and folds when facing a bet. The first hand has an eight-second admission window once two funded players are present; subsequent hands have an eight-second result interval. Between hands, Ready can shorten these windows to a 1.5-second start countdown once every funded, connected player is ready, with the bounded table-opening grace described in the casino contract. At least two players are still required. All-in runout deals remaining streets at 1.2-second intervals.
- Closing the panel keeps the seat. **Leave seat** releases the character immediately, marks departure and folds on the next legal turn. All-in hands and hands whose betting is already complete stay eligible. Remaining chips return after settlement; leaving between hands returns the stack immediately.
- Disconnects reserve a seat through the hand and use ordinary turn timeouts. An authenticated reconnect returns to its chair and can explicitly rejoin the same escrow without another buy-in. Rejoining cannot undo a fold. Disconnected and busted seats cash out when the hand ends.

Rules references: [PokerStars Hold’em rules](https://www.pokerstars.com/poker/games/texas-holdem/) and [Poker TDA rules](https://www.pokertda.com/view-poker-tda-rules/), especially short all-in reopening and heads-up order. These inform the rules; this social game does not implement a full tournament procedure.

## Authority, privacy and storage

`shared/poker.ts` defines the public table, private hand, legal actions and commands. `PokerService` runs within the existing `CasinoService` queue. No second timer or independently authoritative client simulation is introduced. Commands bind to the authenticated profile/session, current hand and turn IDs. Seating and actions require table proximity; escrow cash-out remains available on explicit departure. Poker occupancy excludes simultaneous blackjack/slots seating.

Public snapshots contain seats, table stacks/contributions, button/blinds, current turn, board and settled awards. Hole cards remain null until eligible showdown. Folded cards and an uncontested winner's cards remain hidden. Each owner privately receives its hole cards, escrow and current legal actions; wallet balances and deck order never enter the public table. UI and 3D presentation consume these same projections.

Migration `005_poker.sql` adds `poker_seats`, durable buy-in `poker_requests`, `poker_hands` and the `poker_buyin` / `poker_cashout` ledger kinds. All repository migration guards accept version 5. Existing wager migrations are preserved.

`PokerRepository` uses the existing economy transactions and wallet locks. A poker advisory lock serializes its escrow transitions before other locks; other economy operations never acquire this lock. Buy-in replay precedes live eligibility, then wallet debit, escrow creation and receipt commit atomically. A request remains replayable after its escrow closes. Cash-out uses the escrow ID as its permanent ledger operation key.

Before dealing, `beginHand` persists the exact opening roster, stacks and revisions and marks the participating escrows active. During a hand their durable stacks retain those opening balances. `finishHand` validates the exact roster and chip conservation, then atomically replaces all stacks and marks the hand settled. Frozen hand IDs and allocations survive ambiguous commit retries. The table pauses until acknowledgement; showdown and final stacks follow the committed result. An active hand cannot cash out its stored opening stacks.

Startup and drained room disposal cancel unfinished hands and cash out their opening stacks. Completed allocations survive and are returned instead. Recovery is idempotent and room-scoped when called for disposal. Hands are cancelled after process loss rather than resumed. The existing PostgreSQL integer balance limit still applies to wallets and escrow stacks.

## Asset and presentation

`art-source/build_poker.py` generates `poker-table.blend`, `public/models/poker-table.glb` and `poker-assets.stats.json`. The table spans 4.8 × 2.7 metres, with felt 1.10 metres and rail 1.20 metres above the hall floor. The six chairs reuse `casino-chair.glb`. `shared/pokerLayout.ts` owns chair, card and standing-exit positions.

`PokerTableArt` preallocates 17 card meshes, six stacks, six current bets, pot chips, labels and a dealer marker. Community and private cards agree with the panel. The felt model includes matching card markers; runtime cards and chips remain separate from the export. Indoor lighting stays steady. The responsive panel keeps hole cards and available actions together in the mobile dock.

## Verification

- `tests/poker-rules.test.ts` and `tests/poker-engine.test.ts`: ranking/kickers, ties/odd chips, side pots, blinds/action order, short all-ins, departures, timeouts, private projections and frozen persistence retries.
- `node --env-file=.env --import tsx --test tests/poker-persistence.test.ts`: disposable local schemas, concurrency, conservation, stale/conflicting requests, lost commit replies, cash-out fencing and recovery.
- `npm run test:poker-network`: isolated local server on port 2572, three authenticated clients, actual movement/seating, legal turns, late spectators, reconnect, showdown and ledger reconciliation.
- `npm run test:poker-render`: actual imported table/card geometry and owner/spectator render projections, using synthetic table states.
- `npm run test:poker-browser`: actual full-app browser journey and responsive poker controls.

Dated executed evidence is recorded in [implementation status](implementation-status.md). Headless browser and emulated mobile results do not establish physical phone or public-network performance.
