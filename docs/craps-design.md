# Meridian craps

10 September 2026. Approved first game for the left rear bay; poker remains future work in the other bay. Uses existing guest identities and entirely fictional credits.

## Play

One standing table, `craps-1`, is centred at town `(-11.5, 51.4)`. Players approach and open its panel; spectators share its point, shooter and dice. One accepted Pass Line or Don't Pass wager per player per cycle, 10–100 credits in steps of 10. No extra odds, cancellation, point-phase additions or automatic rebet in this version.

The rules follow [MGM's craps guide](https://www.mgmresorts.com/en/gamesense/guide-to-craps.html): on the come-out roll, 7/11 wins Pass, 2/3 wins Don't Pass, and 12 loses Pass but pushes Don't Pass. A 4, 5, 6, 8, 9 or 10 establishes the point. Subsequent rolls retain the wager until the point wins Pass or a seven wins Don't Pass. Gross return is twice the stake on a win, the original stake on a push, and zero on a loss.

Betting lasts 20 seconds. The first eligible bettor becomes shooter and has 15 seconds to press **Roll dice** after betting closes; the table rolls automatically at the deadline. The shooter retains the dice until seven-out or departure. A replacement is selected from eligible bettors in acceptance order, wrapping for solo play. Departure never extends the roll deadline or cancels an accepted wager. Closing the panel alone keeps play active. Reconnecting restores private wagers, but does not reclaim a turn already passed to another player. With no eligible shooter, automatic rolls continue to resolve held wagers. Empty betting windows do not throw dice.

## Authority and persistence

The existing `CasinoService` queue owns admission, deadlines, shooter selection and resolution. `roundId` identifies the multi-roll wager cycle; `rollId` identifies each throw. A roll command must match both IDs, the current shooter, current session, proximity and phase. The server samples two independent random integers once per throw; retries preserve them.

Line wagers reuse the existing atomic acceptance and terminal settlement paths. Point rolls leave wagers pending; terminal rolls settle all line wagers atomically before publishing their motion. Wallet snapshots follow the existing commit-first contract. Failed or ambiguous settlement pauses the table and retries the frozen throw. No target enters public state before successful terminal settlement. Startup/disposal refunds unfinished line wagers once through existing recovery. Migration `004_craps.sql` extends the wager game constraint; all three repository initializers accept schema version 4. Applied migrations remain unchanged.

`casino-private.crapsBets` carries only the owner's wager. Public state carries the shooter, aggregate count, point, result/history and a motion descriptor. Result, history and point changes become visible after the dice finish moving. Private bets remain available through the result interval, then clear when a new cycle starts.

## Presentation and assets

`shared/crapsMotion.ts` samples a descriptor containing throw ID, scheduled start, previous faces and target faces. A 500 ms lead precedes a 4.2-second pickup/throw with tumbling, a far-cushion rebound and diminishing bounces. Every client samples the existing server-aligned monotonic clock; frame rate and late joins do not change the trajectory. Motion presents the server outcome; client physics never selects it. Network latency and clock alignment still limit wall-clock synchrony. Reduced motion holds the previous faces until the scheduled completion.

`art-source/build_craps.py` owns the editable table source, GLB and stats. It uses the established Meridian walnut, bronze and evergreen materials. Table footprint is 5.6 × 2.7 m, felt height 1.04 m above the 0.9 m hall floor, rail top 1.30 m. The runtime owns 0.14 m chamfered dice, private line chips, aggregate dealer chips and the ON/OFF puck. Actual pip normals define the six faces; opposite faces sum to seven. The UI exposes only the two bet fields drawn on the felt. Shared collision blocks the table while retaining standing access on both long sides. The other rear bay now contains [Texas Hold’em](poker-design.md).

## Checks

- Unit/service tests: all 36 dice pairs, every point, pushes, held wagers, stale/duplicate/unauthorized throws, failed settlement retries, shooter departure/reconnect and seven-out rotation.
- `npm run test:casino`: disposable PostgreSQL schema including deployed version 3 to version 4 upgrade, idempotent initialization, payout replay and unfinished-wager refunds.
- `npm run test:craps-render`: actual imported table contact, all 36 rendered top-face pairs, well clearance during motion, independent viewers, reduced motion and emulated mobile renders.
- `npm run test:craps-network`: isolated local server and real authenticated clients, private bets, shared motion/late join and durable point-cycle settlement.
- `npm run test:craps-browser`: real entry/walking, touch controls, portrait/landscape, physical line chips, displayed results matching actual 3D dice and wallet settlement.

Screenshots, measurements and video are ignored local artifacts under `output/playwright/craps/`; logs use `output/playwright/craps-*.log`. Dated completed evidence belongs in [implementation status](implementation-status.md). Native-device and public-network performance require separate evidence. This implementation does not authorize publication or a live restart.
