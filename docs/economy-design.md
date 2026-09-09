# Economy and clothing technical design

9 September 2026. Local only. Approved: 1,000 credits once per guest; 100 per 600,000 eligible milliseconds; three free starter items and nine paid tops/bottoms/shoes.

## Architecture and data

`React → authenticated API / Colyseus → economy repository → existing guests.pool`

PostgreSQL owns wallet, ledger, salary remainder, owned items and equipment. Colyseus owns live eligibility. Try-on remains client-private; buying does not automatically equip. Purchase eligibility uses server shop coordinates; owned clothing can be equipped anywhere.

Add migration 002; update the current runner's version-1-only guard. Tables: wallet (balance, revision, salary remainder/payment sequence, session epoch/cumulative checkpoint), immutable ledger (unique profile/operation key), owned items (unique profile/item), equipment (one owned item per slot). Lock the wallet for mutations; constrain nonnegative balance and remainder below 600,000. Initialise wallet, unique starting grant and starter wardrobe atomically for existing/new guests.

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
