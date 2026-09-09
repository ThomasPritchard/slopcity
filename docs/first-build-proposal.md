# Slop City — first-build proposal

Date: 9 September 2026 (BST).
Status: product direction confirmed. This document retains the wider product proposal; see implementation-status.md for the current build and evidence.

## Confirmed brief

Slop City is a modern 3D social life simulation inspired by Second Life, PlayStation Home and Identity's Town Square. The name refers to its AI-assisted creation; the intended result is cohesive and polished.

- Play in a browser on Windows, macOS and mobile.
- Refined stylised realism, with a third-person camera.
- Up to 64 concurrent people in one town instance, counting outdoor and indoor players together.
- A town square with an enterable casino and clothing shop.
- Proximity voice, text chat, emotes, sitting, and mute/block controls.
- Curated character face/body presets, skin tones, hairstyles and interchangeable clothing; save character and wardrobe between sessions.
- Shared roulette and blackjack tables with spectators; individual slot machines.
- Fictional credits only, with a starting balance and recurring base salary. No microtransactions or cash-out.
- Clothing purchases provide a use for credits outside gambling. Future development will broaden town activities.

## Proposed first playable experience

Create an account and character, choose a free starter outfit, then arrive at the square. The casino entrance, clothing shop and communal seating are visible from the arrival area. Walking across the square takes tens of seconds, keeping encounters frequent.

Use a contemporary pedestrian district: warm stone, brick, glass, trees, planted beds and restrained signage. Human characters have believable proportions and deliberately quirky, expressive faces; the user prefers the original fixed, wide-eyed stare and neutral expression. The casino has warmer evening lighting, felt, timber and brass. The shop is bright enough to judge outfit colours accurately. The implemented visual direction is shown in the browser screenshots linked from the implementation checkpoint.

Desktop movement uses keyboard and mouse with an orbiting third-person camera. Mobile uses a movement stick, drag-to-look and contextual action buttons. Essential menus and table controls support touch; the game must not depend on pointer lock, hover or a physical keyboard. Landscape is the proposed primary mobile play layout.

The HUD leaves the world visible: credits, salary countdown, chat, microphone state and contextual interactions. More detailed controls appear when customising a character, shopping or playing at a table. Voice requires an explicit join action and a persistent mute control; text play remains available when microphone access is declined.

## Proposed economy defaults

| Setting | Initial proposal |
| --- | --- |
| Starting balance | 1,000 credits, once per account |
| Base salary | 100 credits per accumulated 10 real minutes online |
| Game clock | 10 real minutes = 1 game hour; a full game day = 4 real hours |
| Eligible time | Connected play, including sitting and chatting; suspended/disconnected sessions pause accrual |
| Reconnection | Preserve partial salary progress; one accruing session per account |
| Starter clothing | Free complete outfit |
| First clothing catalogue | Approximately 12 purchasable items, provisionally 100–600 credits |
| Table stakes | Low limits with a proposed 10-credit minimum |

Salary eligibility was not answered explicitly and needs confirmation. Recommend online time rather than movement requirements, since socialising is core play. Display a countdown and retain progress across sessions. Persist accrual so reconnects cannot duplicate a payment. Keep salary accounting independent of cosmetic day/night rendering.

Balances, purchases, owned items, bets and payouts belong to the server. Use integer credits and durable transactions with duplicate-request protection. Reject unaffordable purchases or bets before accepting them. Losing the full balance must not prevent chatting, walking, changing owned outfits or receiving salary. Exact clothing prices, stake limits and payouts are tuning values.

## Proposed casino scope

- **Roulette:** one shared European single-zero wheel; all players at that table see the same betting window, locked bets, result and payouts. Include the conventional inside and outside bet types with readable touch controls.
- **Blackjack:** two tables of up to five players against a server-controlled dealer. Offer hit, stand, double and one split; specify dealer, shoe, timeout and payout rules before implementation. Spectators see public play, with unrevealed cards kept on the server.
- **Slots:** six interactable machines using one initial three-reel game and a visible paytable. Resolve outcomes on the server before presenting the corresponding animation.
- All games show rules, stake and potential payout clearly. No autoplay in the proposed slice.
- Before accepting real shared sessions, define disconnect handling and restart recovery: accepted wagers must resolve once or be refunded once. Test this along with ordinary play.

Table and machine counts are provisional, not a promise that all 64 players can gamble simultaneously. Busy seats should be visible and spectators should have room to gather. Tune counts after observing the space in multiplayer.

## Recommended technical approach

| Area | Recommendation | Reason |
| --- | --- | --- |
| Browser world | Babylon.js, TypeScript, glTF assets | A browser 3D engine with scene, animation and material support |
| Rendering baseline | WebGL2; optional WebGPU later | Keep the initial compatibility path consistent across target devices |
| Menus and HUD | React and TypeScript | Accessible HTML forms and responsive touch interfaces around the 3D scene |
| Multiplayer | Colyseus on Node.js | Server-owned room state and state synchronisation |
| Persistence | PostgreSQL | Durable accounts, wardrobes and transactional credit accounting |
| Voice | LiveKit WebRTC | Selective audio subscriptions and a separate media service |
| Deployment shape | Static client, game/API service, database and voice service | Separate assets, simulation, persistence and audio operations |

Babylon.js, TypeScript, React and Colyseus are now installed with a local working foundation. PostgreSQL and LiveKit remain planned. A directly managed Three.js scene is an alternative, but Babylon.js is the proposed starting point because this is an interactive game with characters and collisions.

The game server validates movement and interactions and owns salary, casino randomness, settlement and shop purchases. The client handles input, immediate visual feedback, interpolation and rendering. Separate private player data from public town state. Authoritative networking is designed into the first playable milestone.

Use one game room capped at 64 players. The plaza, casino and shop remain part of the same town session, while location determines relevant updates and audible participants. Stream or simplify assets by area without moving friends into unrelated town instances.

Voice uses a media server rather than a 64-person peer-to-peer mesh. Subscribe to relevant nearby speakers and attenuate volume by distance; interior boundaries stop unrelated conversations travelling between spaces. Apply mute/block state and voice eligibility at the appropriate server/media boundary, rather than relying solely on a client volume setting. Crowded voice behaviour needs a real browser and device test.

Use a single verified account identity for cross-device persistence. Select the authentication implementation before the account milestone; display names must never act as account credentials. Include basic report and administrator mute/kick/ban tools before opening the town to a public audience.

## Build sequence and acceptance

1. **Networked town foundation.** A walkable square, casino/shop entrances, third-person camera and touch controls. Two independent browsers see each other's movement and clothing. Check crowd rendering and 64-client server load early. Use representative character assets to avoid misleading results from cheap placeholders.
2. **Social identity.** Accounts, character customisation, persisted wardrobe, seating, emotes, text and proximity voice. Test microphone denial, mute/block, indoor boundaries and reconnects using independent sessions and real audio devices.
3. **Economy and clothing.** Starting grant, salary, durable wallet and shop try-on/purchase/equip flow. Verify duplicate requests, reconnects, concurrent spending, persistence across restart and insufficient funds.
4. **Shared casino.** Implement each game's specified rules and state machine. Verify betting cutoffs, spectators, accepted wagers, timeout behaviour and exactly-once settlement/recovery.
5. **Integrated quality pass.** Assess movement, character animation, lighting, asset consistency and UI in the actual browser. Test the complete create → meet → play → earn → buy → reconnect journey on the platform matrix.

Provisional performance targets: 60 fps on a representative desktop and 30 fps on a representative supported phone, with adaptive quality. Choose and record specific reference hardware during the first milestone. Test Safari on macOS/iOS and Chromium on Windows/Android, and check desktop Firefox. Report native device evidence separately from browser emulation.

Capacity evidence must distinguish automated 64-client protocol load, a browser rendering a 64-avatar gathering, and a human voice playtest. None of these alone proves all aspects of 64-player support. Hosting and voice bandwidth have operating costs despite the absence of microtransactions; choose hosting after measuring resource use and before public deployment.

## Scope boundaries

Housing, jobs, vehicles, trading, user uploads and player-built worlds are future candidates. V1 establishes persistent characters, a shared social place and a small credit economy that later activities can reuse. No extension framework is needed before those activities have concrete requirements.

Before detailed implementation, settle the online salary proposal and review the proposed setting/layout. Fine tuning values and internal source layouts remain revisable. Visual quality remains unverified until representative characters and environments are inspected in the running browser.

## Reference evidence

Checked 9 September 2026; these sources establish framework capabilities, not Slop City's performance or completion.

- [Identity official site](https://identityrpg.com/): inspiration for social self-expression. The supplied Town Square module URL could not be retrieved; no claim of a complete visual analysis of that page.
- [Babylon.js WebGPU documentation source](https://github.com/BabylonJS/Documentation/blob/master/content/setup/support/webGPU.md): WebGPU support alongside the WebGL implementation.
- [Colyseus state synchronisation](https://docs.colyseus.io/state): the server mutates room state and clients request changes.
- [LiveKit track subscriptions](https://docs.livekit.io/transport/media/subscribe/): selective media subscription capabilities.
- [LiveKit deployment](https://docs.livekit.io/transport/self-hosting/deployment/): secure deployment and TURN requirements.
