# Economy and clothing technical design

Updated 11 September 2026. Approved: 1,000 credits once per guest; 100 per 300,000 eligible milliseconds; three free starter items and nine paid tops/bottoms/shoes.

## Architecture and data

`React → authenticated API / Colyseus → economy repository → existing guests.pool`

PostgreSQL owns wallet, ledger, salary remainder, owned items and equipment. Colyseus owns live eligibility. Try-on remains client-private; buying does not automatically equip. Purchase eligibility uses server shop coordinates; owned clothing can be equipped anywhere.

Add migration 002; update the current runner's version-1-only guard. Tables: wallet (balance, revision, salary remainder/payment sequence, session epoch/cumulative checkpoint), immutable ledger (unique profile/operation key), owned items (unique profile/item), equipment (one owned item per slot). Lock the wallet for mutations; constrain nonnegative balance and remainder below 600,000 for compatibility with previously saved progress. The current salary interval is 300,000ms; a positive checkpoint converts any saved remainder using five-minute payments without discarding earned time. Initialise wallet, unique starting grant and starter wardrobe atomically for existing/new guests.

## Agreed contracts

Parent owns `shared/catalog.ts`:

- `Slot = 'top' | 'bottoms' | 'shoes'`
- `Outfit = { top: string; bottoms: string; shoes: string }`
- `WalletState = { balance: number; salaryProgressMs: number; owned: string[]; outfit: Outfit; revision: number }`

Coder-owned `EconomyRepository(existingPool)`:

- `initialise(): Promise<void>`
- `ensure(profileId: string): Promise<WalletState>`
- `openSession(profileId: string, epoch: string): Promise<WalletState>`
- `checkpoint(profileId: string, epoch: string, cumulativeEligibleMs: number): Promise<WalletState>`
- `purchase(profileId: string, itemId: string, requestId: string): Promise<WalletState>`
- `equip(profileId: string, itemId: string, expectedRevision: number): Promise<WalletState>`

Authenticated routes: `GET /api/economy`, `POST /api/economy/purchase` (item/request ID), `POST /api/economy/equip` (item/expected revision). Retain external `/game` prefix, cookies and origin checks. Inject shop/session validation and committed-equipment notification hooks.

Server catalogue controls price/slot. Purchase checks prior request first; matching replay returns current state without another debit, different-item reuse conflicts. Debit, ownership and receipt commit together. Already-owned items never charge; insufficient funds consumes no request ID. Equip requires ownership and expected revision. Every mutation advances revision; clients ignore older snapshots.

## Salary and recovery

Coder tracker exposes `start(profileId, sessionId, roomId)`, `heartbeat(sessionId, visible)`, `stop(sessionId)`, `dispose()`, with injected clock/snapshot callback. Start returns persisted state; first heartbeat begins accrual.

Visible heartbeats every 5 seconds expire after 10 seconds. Hidden pauses; blur alone does not. Sitting/chat/menus count. Frozen clients can accrue only the remaining lease. Visibility is cooperative, not human-presence proof. Use server monotonic time; discard scheduler gaps beyond the lease.

Checkpoint cumulative eligible time every 5 seconds and on threshold/pause/leave. Under wallet lock, fence by epoch, apply only cumulative time above its committed checkpoint, and atomically save remainder, payouts and uniquely sequenced salary ledger entries. An uncertain COMMIT retry cannot duplicate time or money.

Freeze before asynchronous leave flushing; retain SessionRegistry ownership until the bounded write settles. New admission replaces epoch, rejecting obsolete work. Healthy-write crash loss is at most the checkpoint interval; outages can lose more pending time. Show delayed saving; never promise uncommitted durability. Keep SQL outside movement ticks.

## Integration and checks

Parent owns catalogue, town/context/main and scene integration. Coder owns repository/migration, routes, tracker and tests. Private `economy` sends `WalletState` plus `accruing`; add explicit initial sync. Public Citizen exposes only flat equipment IDs. Apply changed appearance to existing local/remote models; current `scene.sync()` does not. Profile editing cannot grant paid clothing. Recheck session identity after awaits.

Test grant-once, purchase replay/concurrency, insufficient funds, ownership/revision rejection, checkpoint replay/stale epoch, threshold/reconnect remainder, hide/freeze/sleep, leave during write, restart persistence, private-state isolation and two-browser equipment replication. Reuse existing social checks.

## Reception credit leaderboard — 11 September 2026

The casino reception wall displays the ten richest saved guests, including offline players. This deliberately exposes only those guests' names, ranks and combined credit totals to authenticated guests; wallet revisions, profile IDs, inventory and ledger details remain private.

Rank by wallet balance plus open poker escrow. A buy-in or cash-out transfers credits without changing the total. During a hand, saved poker chips retain the opening stack until atomic settlement. Other outstanding casino wagers are already debited from the wallet; unsettled winnings and clothing value are not included. Equal totals share a competition rank (1, 1, 3); creation time then profile ID selects a stable order and cutoff at ten entries.

`GET /game/api/economy/leaderboard` reads one PostgreSQL snapshot. Requests share a 30-second server cache and one in-flight query. The client polls every 30 seconds while visible and playing, refreshes on visibility return, and preserves the last standings with an update-delay message if a request fails. No new tables or mutations are involved.

The display is mounted above the panelling behind the reception desk on the right foyer partition. Clicking it from reception, or selecting the nearby “View credit leaderboard” button, opens a scrollable reading panel. Changed characters use a staggered split-flap animation; initial loading and reduced motion settle immediately. The world display uses three meshes and one persistent texture, uploading only while values change. The reading panel presents the final accessible text immediately.

Checks: database standings and escrow/cash-out cases in `tests/credit-leaderboard.test.ts`; authentication and coalesced reads in `tests/economy-routes.test.ts`; actual reception mounting and split-flap rendering in `scripts/credit-leaderboard-render-check.ts`; guest walk, wall click, responsive reading panel and delayed-response recovery in `scripts/credit-leaderboard-browser-check.ts`. Browser captures use headless WebKit and emulated phone layouts, not physical-device performance measurements.
