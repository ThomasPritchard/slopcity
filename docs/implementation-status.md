# Slop City implementation checkpoint

9 September 2026. Working on main; no commits or publication. Local-only operation requested: Vite and Colyseus bind 127.0.0.1, PostgreSQL binds 127.0.0.1, LiveKit signalling binds 127.0.0.1 and media uses loopback UDP with no TCP media listener. Current entry point: http://localhost:5173.

## Accepted direction

Browser on desktop/mobile, Babylon.js/TypeScript, Colyseus, PostgreSQL and LiveKit. 64 players per town. Social square, casino, clothing shop. Fictional credits; no microtransactions. The economy, clothing, shared casino and Phase 5 polish slices are implemented.

The entry menu collects a name only. Enter opens character customisation in a 3D changing room. Keep the user's preferred neutral, wide-eyed stare and latest hair, collar and shoes. Browser verification is headless and must not take screen focus. Share real screenshots during visual work. Author Blender changes in separate background factory-startup processes; preserve the unrelated active document.

## Social identity phase

The user chose guest profiles first, accounts later. One opaque HttpOnly browser cookie restores a PostgreSQL guest with saved name, skin/jacket colours and private blocks. The server owns cosmetics on admission, rejects stale profile revisions and duplicate active guest sessions, and clears expired cookies so entry can recover. No cross-device or cleared-cookie recovery is promised.

Eight shared seats use the same bench anchors for server validation and rendered geometry. Synchronous claims have one winner. Seated movement is ignored, Wave is disabled while seated, and stand/disconnect releases occupancy. Blender's Sit clip is included in citizen.glb and the editable source.

Social UI provides opt-in listening with the microphone initially off, explicit microphone enable/mute, local neighbour mute, persisted block/unblock, voice error/playback states, and a responsive focus-contained dialog. Town chat filters blocked pairs in both directions. Block acknowledgements await the active room's ordered routing refresh.

LiveKit tokens are tied to authenticated active town sessions, expire after 60 seconds, and permit microphone publication only. Authoritative positions determine full gain within 2m, fading to 0 by 12m; subscription release has 14m hysteresis. Venue boundaries prevent cross-area eligibility. Voice signalling is proxied through /voice and audio transport stays local. No public STUN servers are configured by the client.

## Economy and clothing phase

Approved values: a one-time 1,000-credit grant and 100 credits per 10 accumulated real minutes in the visible town tab. Hidden tabs, departure and long server sleep pause accrual; sitting, chatting and shopping count. The server uses short presence leases and monotonic time. PostgreSQL saves salary remainders through idempotent cumulative checkpoints and fences obsolete sessions. Wallet/ownership/equipment writes are atomic and private; only equipped item IDs replicate publicly. See [economy-design.md](economy-design.md).

Form & Thread has a Blender-authored interior and fitting alcove. The catalogue has three free starter pieces and nine paid choices across three slots, with distinct knitwear, bomber, denim, cargo, boot and loafer meshes. Private try-on, separate buy/equip, owned-only wardrobe access, balance/countdown, insufficient funds and retry feedback are implemented. Equipped clothes and purchases restore with the guest cookie. The original face and animation direction are retained. Location names now appear centrally on district entry and fade away within four seconds, with no permanent corner label. The browser journey verifies real entry, centring and removal.

## Shared casino phase

The Meridian has one European single-zero roulette table, two five-seat blackjack tables and six individually occupied slot machines. Shared transport/limits/anchors are in `shared/casino.ts`; rules and persistence follow [casino-design.md](casino-design.md). Fictional 10–100-credit base stakes use the same wallet as salary and clothing. Roulette accepts all 15 bet kinds; blackjack supports hit/stand/double and one identical-rank split, including split-ace rules; slots use the visible fixed paytable. There is no autoplay or wager cancellation.

The server alone accepts actions, chooses outcomes and settles returns. One serial casino queue keeps database waits outside the movement simulation. Every financial action has a durable request ID, fingerprint and debit/return ledger entries. Ambiguous confirmations retain the original action for retry. Acceptance rechecks session, range, round/deadline, seat/turn and funds under the wallet lock. Startup refunds each unfinished wager once before listening; completed outcomes remain settled. Seats persist through accepted hands but departure stands unfinished actions. The private wallet and roulette selections are not broadcast, and dealer hole cards/future results stay out of public projections.

Blender-authored walnut/brass/felt tables, numbered rotor, chairs, slot cabinets and interior decoration replace the casino shell. The approved right-hand panel frames a table camera. Phone portrait keeps the 3D view above a 55%-height panel; phone landscape uses a compact side panel. A single set of controls moves into a fixed bottom action area on phones, while the hand/bet details scroll. Roulette’s number board can collapse; canonical selection controls remain available. All action targets are at least 44 pixels. The physical roulette wheel/ball and cabinet reels follow public state; own roulette bets place chips and mark covered cells. Blackjack cards slide onto the felt, expand into split hands and reveal the dealer card only when public state permits. Chip stacks reflect accepted stakes. The 3D renderer reuses card meshes and a bounded card-material catalogue.

A focused review identified four recovery/session/privacy defects; fixes and targeted regressions cover leaving an ambiguous blackjack acceptance, pending slot occupancy, commands crossing session replacement, and dealer draws during failed settlement. Active-round hit/stand receipts also survive cache pressure. The development database's early migration 003 was repaired additively for its final game/outcome columns, preserving existing balances and wagers.

## Visual and startup work retained

- Blender character with idle/walk/wave/sit, neutral stare, fitted hair, closed jacket collar and shaped sneakers.
- Changing-room Face/Outfit/Shoes framing, live colour controls and rotation.
- Blender changing room/mirror, benches, lamps, trees, planters and fountain.
- Fountain reflection/refraction, normal-map ripples, continuous jets and droplets.
- Bent-elbow greeting, wrist-driven wave, animation blending and clip-driven completion; walking interrupts the greeting.
- Static recovery UI for a failed startup module and Retry; pinned SDK 0.18.2 browser WebSocket constructor patch, reapplied at npm install and Vite cache rebuild.

The reported white page was not reproduced in fresh browsers; its original cause remains unknown. Recovery and the independently observed WebKit SDK error were addressed without claiming they identify that original incident.

## Verification

- 36 unit/rule/state/HTTP boundary checks pass, including salary visibility/freeze/sleep, checkpoint failures, leave during an in-flight write, and economy authentication/origin/conflict boundaries. Existing coverage includes: movement, palette validation, guest cookies/origins, admission/edit ownership, stale revision, expired credential recovery, block acknowledgement ordering, seat contention/exits, and acoustic gain/area boundaries.
- Isolated PostgreSQL checks cover migrations, restore, revision conflicts, private blocks, expiry and transaction rollback.
- Isolated 64-client protocol check passes authenticated admission, forged cosmetics rejection, duplicate guest rejection, the 65th-player cap, movement limits/stale/replayed inputs, shared wave/chat, symmetric block/unblock and seat contention/stand/departure. A rejected duplicate tab preserves the active guest's block filters.
- Headless WebKit social journey passes two guests, saved appearance/reload, mute control, block/chat filtering, unblock, mobile dialog/focus restoration, real walking to a bench, seated movement suppression and standing, with no page errors. Screenshots 20–22 and social-results.json.
- Headless Chromium synthetic voice checks pass two participants, microphone-only scoped tokens, muted entry, real inbound RTP audio (14,347 bytes / 35,040 samples in the final run), neighbour mute, block/unblock, own mic toggle, leave/rejoin and town departure cleanup. Synthetic permission denial preserves listening; an injected voice-service outage leaves text chat usable. No page errors. Screenshot 23 and voice-results.json. Web Audio mixing applies gain on mobile browsers; physical mobile audio remains unverified.
- Focused character check passes the latest exported model, preview presets/colours/rotation, mobile layouts, join and wave with no page errors. Screenshots 10–16.
- Earlier wave verification measured the bent elbow and raised wrist, completion into idle and walking interruption. Screenshot/video evidence is in wave-results.json and wave-preview.mp4.
- Isolated PostgreSQL economy checks pass one-time grant, concurrent purchase/replay, ownership/revision, insufficient-funds retry, salary checkpoint replay, epoch fencing, reconnect and repository restart. Thresholds use deterministic cumulative time.
- Headless WebKit shop journey passes real walking, private try-on, lost-response retry without duplicate debit, separate purchase/equip, remote outfit replication, three slots, insufficient funds, owned-only wardrobe, mobile layout, reload persistence, actual presence accrual and salary pause outside town. Screenshots 24–30 and economy-webkit-results.json. No page errors.
- Headless Chromium also passes the final shop/wallet/remote-outfit/reload journey with no page errors, using a compact desktop viewport and the game's performance mode (economy-chromium-results.json). Its slow headless rendering is not a native performance result. The brief location animation is verified in WebKit; slow Chromium can finish its walking actions after the title has faded. The lost-response check accepts automatic ownership recovery from the next server wallet snapshot and explicitly replays the original purchase receipt to verify no second debit.
- The 64-client protocol check and approved wave regression pass after economy/model integration.
- Production build includes strict type checking. Main JavaScript remains large (about 649 kB gzip); further bundle and dense-crowd tuning remain future work. Phase 5 measurements below supersede the earlier absence of a crowd-render benchmark.

- Casino-specific rule/state tests cover canonical roulette geometry, natural/peek/split/double returns, every slot combination, malformed commands, occupancy, expiration, hidden outcomes and ambiguous commits. Isolated PostgreSQL tests cover concurrent wallet use, debit/replay/conflict, lock-delayed cutoff, terminal settlement/refund races and restart recovery.
- Two real Colyseus clients on an isolated loopback server pass shared roulette phases/results, owner-only wager details, outside-proximity rejection, actual movement through the entrance, one debit on an accepted retry after walking away, physical blackjack seating/standing replication, and slot receipts matching PostgreSQL plus the economy endpoint.
- Headless WebKit completed actual walking, all three casino games, seat departure and balances matching each visible result with no page errors. Final screenshots 34–37 include the mirrored 3D presentation. The updated journey also checks physical roulette chips, dealt blackjack cards and a hit when available, and uses touch presses to place roulette/blackjack bets and start a slot spin. All three games have verified visible action controls at 390×844 and 844×390 without horizontal overflow; phone screenshots are `casino-*-mobile-*.png`. Physical phones remain untested.
- Headless WebKit renderer fixture verifies two split hands, a newly dealt hit arriving on the felt, dealer card conceal/reveal and layout clearing. This uses synthetic public state to cover rare visual transitions deterministically, not a wagering/network test.
- The existing 64-client regression and isolated clothing/salary PostgreSQL check pass with the casino backend integrated.

- Final headless Chromium compatibility check passes startup, actual walking into the casino, roulette acceptance/3D chip placement and visible-result wallet settlement with no page errors. The first attempt was interrupted by a development-server reload during preview-file cleanup; a repeat against frozen files passed. Full all-game touch/mobile coverage is from WebKit, not this bounded Chromium run.

## Phase 5 polish

The approved polish backlog is implemented; see [the implementation and measurements](polish-review.md). Phone chat and creation controls now have separate movement space and 44px touch targets. Canvas sizing follows layout, with sharp capped-DPR normal rendering and CSS-resolution Performance mode. Saved settings cover quality, decorative motion and local effects/fountain volumes. Audio starts with a gesture and silences in the background; proximity voice remains separate.

Camera obstruction recovers the requested zoom, and non-default orbit/framing survives casino/wardrobe views. Actual displacement drives gait; turns and Idle/Walk/Wave/Sit transitions blend. New neighbours spawn at their first snapshot. Remote LOD preserves outfit/rig/clip state with hysteresis; cloned materials are disposed and labels are excluded from character shadow casters. A repeated distant-wave regression is covered. Casino prompts identify a focused station with an in-world marker and clear phone movement controls. Casino fill lighting leaves clothing previews neutral.

Water reflects nearby props rather than every citizen. Reflection refresh, nearest-citizen shadow budgets and distant animation pauses reduce cost. The 64-avatar stationary headless WebKit sample improved from 9.6 to 27.3 fps normally; Performance mode measured 28.2 fps. A separate moving crowd measured 24.0/27.2 fps. These are synthetic renderer measurements on this Mac, not native-phone or 64-user end-to-end sign-off. The Blender LOD reduces the full set of character variants from 84,588 to 23,128 triangles, retaining all four clips and material names.

This pass completed 39 unit/boundary tests, the strict build, headless WebKit comfort/world/casino/clothing/social/wave journeys, and a bounded Chromium roulette check. Actual Web Audio nodes and mute/step behaviour were checked; human listening remains untested. All browser checks stayed in the background. No commits, LAN exposure or publication.

## Self-hosting foundations

The single-VPS deployment is prepared for approximately ten known testers; see [the deployment guide](deployment.md). Docker builds the compiled Node server, static browser/HTTPS gateway and PostgreSQL initialization image, alongside pinned LiveKit. Default target is Linux AMD64 for Hetzner CPX32. Caddy shares HTTPS and TURN/TLS on port 443, keeps `/game` on the browser origin, and serves only build output. PostgreSQL is private with persistent storage and a separate application role. Production configuration is generated into ignored, permission-restricted `.deploy/`; it does not reuse local credentials.

Startup validates production configuration and takes a schema-scoped database ownership lock before migrations or unfinished-wager recovery. A second process fails closed. Shutdown disposes rooms before releasing database ownership, with a bounded deadline. The deployment includes backup/update helpers, a daily backup timer, a restore procedure and GitHub Actions checks without automatic publishing or deployment.

Verified on 2026-09-09: all 45 tests passed with the isolated PostgreSQL tests enabled; frontend and compiled-server builds passed. Linux AMD64 containers ran under Docker on this Mac, with the game reporting x64/UID1000/Node24.20.0. The integration check passed HTTPS assets/private-file rejection, secure cookies, ten WSS protocol clients with shared chat/wave, voice token and API routing, a TURN/TLS authentication challenge, game restart persistence and a custom-format database dump restored into a separate temporary database. The backup shell helper also produced a dump. The existing casino protocol journey passed after the server lifecycle changes. Headless Chromium loaded the Docker-served 3D changing room, joined town, sent chat and restored the guest after reload; screenshots are under ignored `output/playwright/deployment/`.

The Git candidate tree passed a redacted secret scan. The later live deployment is recorded below; the local checks alone do not establish public-network results.

## Live deployment — 2026-09-09

Application revision `b88a5fd` is deployed from the approved public GitHub repository to `/opt/slop-city` on the Ubuntu VM. Cloudflare Tunnel serves `https://slopcity.fun` through host nginx and the loopback Docker gateway on port 9080. The database and game containers report healthy; the public health endpoint returns `{"status":"ok"}`. GitHub Actions run 34400476576 passed, including the container integration checks. The updated local suite passed all 46 tests and both production builds.

Headless Chromium verified the actual public site with normal TLS certificate validation: production assets and the 3D changing room, guest creation, town admission, chat through HTTPS/WSS, secure HttpOnly guest cookies and profile recovery after reload, with no page errors. Live screenshots are `output/playwright/deployment/live-changing-room.png` and `live-town.png` (ignored local artifacts). This check used Performance mode and does not establish physical-device performance.

The first private database backup was created and the daily local backup timer is active. LiveKit signalling responds through `/voice`; actual public audio remains unverified and requires router forwarding for UDP 7882, with TCP 7881 as an optional fallback. TURN is disabled in this tunnel deployment. Cross-network microphone testing, physical-device performance, a ten-person playtest, off-server backup storage and uptime notifications remain outstanding. Cloudflare provides public HTTPS; direct Caddy ACME issuance was not tested on this host.

## Limits

Guest identity is browser-bound, the session registry assumes one server process, and blocks can be evaded with another guest identity. Proximity uses server-computed eligibility plus cooperating publishers' allowlists and receiver subscriptions. It is not a claim of private conversations or blocking enforced against modified publishers. A stronger server-side enforcement mechanism remains a public-release requirement.

No native Windows, physical phone, human microphone/listening or 64-person voice-capacity sign-off. The 64-avatar synthetic renderer measurements above do not constitute end-to-end capacity sign-off. Headless rendering and mobile emulation do not establish native GPU/device performance. Accounts and wider moderation remain future work. Salary visibility is cooperative, not human-presence proof. Healthy checkpointing can lose up to roughly five seconds on an abrupt server crash; a database outage can lose more uncommitted time. This build has not had a real ten-minute salary wait; deterministic threshold tests and actual browser presence accrual cover those separate behaviours.
