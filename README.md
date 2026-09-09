# Slop City

A browser 3D social town built with Babylon.js, React, TypeScript and Colyseus, with PostgreSQL guest persistence and LiveKit proximity voice. The current build includes the social foundation, fictional-credit economy, clothing shop and shared casino games.

## Run on this Mac

```sh
npm ci
# One-time local prerequisites:
brew install postgresql@18 livekit
npm run services:start
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The game and its database/voice services bind to loopback only. LAN access is disabled at the user's request. Use the same address consistently: localhost and 127.0.0.1 have separate browser cookies.

`services:start` creates project-specific PostgreSQL storage under ignored `.local/`, generates private credentials in `.env`, and runs PostgreSQL/LiveKit as local processes. It does not install login services. Use `npm run services:stop` to stop those services; Ctrl+C stops the development command. Prerequisites may also be supplied through `PG_BIN` and `LIVEKIT_BINARY`. The local voice configuration uses macOS's `lo0` interface. `.nvmrc` recommends Node 24; current local checks used Node 26.8.1.

Enter a name, customise your character in the 3D changing room, then join the square. Walk with WASD/arrows, drag to orbit and scroll to zoom. Touch controls are present; tap Chat to expand it on a phone. Settings saves Performance mode, motion preferences and separate city-effects/fountain volumes in this browser. Approach a bench and choose **Sit down**; **Stand up** releases the seat. Open **Social** to join voice, then explicitly enable your microphone if desired. A separate private browser window gives you a second guest for local testing.

Walk into **Form & Thread** and choose **Browse Form & Thread** to try on clothes. Buying adds a piece to your collection; **Wear this** equips it for everyone to see. Click the wallet to open your saved wardrobe anywhere. Each guest receives **1,000 credits once**, then **100 credits per 10 accumulated real minutes in the visible town tab**. Sitting, chat and browsing count. Leaving or hiding the tab pauses salary and preserves progress.

Walk into **The Meridian Casino**, approach a table or machine, then choose **Open**. Roulette accepts a separate confirmed bet on each press; blackjack requires a seat before betting; slots play one spin at a time. Stakes are 10–100 fictional credits. Rules and returns are available in each panel. Closing a panel keeps accepted bets in play. Blackjack’s **Leave seat** releases your character and stands unfinished hands; slots release after their result interval. Unfinished wagers are refunded once after a server restart.

## Implemented

- Server-owned movement/collisions and a 64-client room cap.
- PostgreSQL guest identity, saved name/skin/jacket, revision checks and one active town session per guest.
- An opaque HttpOnly guest cookie; clearing site data or expiry loses browser access to that character. Accounts and cross-device recovery are not implemented.
- Shared appearance, town text chat, wave and departure.
- Centred location titles on arrival, fading away within four seconds; the town map retains your current location.
- Eight server-owned seats on four benches, with an authored seated pose.
- Opt-in LiveKit voice, microphone off on join, distance fade and separate acoustic areas for the square and venue interiors.
- Local voice mute plus persistent guest blocking that filters chat and voice in both directions. Blocked avatars remain visible.
- Name-first onboarding and a live 3D changing room with skin/jacket colours.
- Original Blender character and idle/walk/wave/sit clips; fountain, benches, lamps, planters, olive trees and changing-room assets.
- Fountain ripples, reflection/refraction and water jets, with local ambience and reduced-motion support.
- Recoverable camera zoom, blended character transitions, sharper phone rendering, 44px touch controls and saved comfort settings.
- Rigged remote-character LOD, bounded nearby shadows and restricted fountain reflections; [polish measurements and limits](docs/polish-review.md).
- Blender-furnished Meridian Casino: shared European roulette, two five-seat blackjack tables and six individual slot machines.
- Server-owned casino rules, hidden outcomes, explicit stakes, shared seats/spectating, durable debit/return receipts and restart refunds for unfinished wagers.
- Matching 3D roulette chips/coverage, animated cards and split hands, spinning wheel/ball and illustrated slot reels.
- Phone portrait/landscape casino layouts with a visible 3D table and fixed bet/spin/hand controls.
- Furnished Blender clothing shop with rails, folded garments, checkout and a 3D fitting alcove.
- Twelve wardrobe items across tops, trousers and shoes, including three free starters; distinct knit, bomber, denim, cargo, boot and loafer meshes.
- Server-owned credits, salary checkpoints, atomic purchases, retry-safe receipts, owned-only equipment and saved wardrobes. Only equipped clothes replicate to other players; try-ons and wallet data stay private.
- A recoverable startup screen and pinned Colyseus SDK WebKit compatibility patch, reapplied by `postinstall`.

Accounts and wider moderation remain future work. Proximity filtering uses server-computed eligibility, publisher allowlists and cooperating clients; it is not a claim of server-enforced private conversations against modified publishers. The session registry requires one game process per database schema.

## Self-hosted deployment

The [Hetzner deployment guide](docs/deployment.md) covers a single VPS with Docker Compose, HTTPS, PostgreSQL, LiveKit/TURN voice, private configuration generation, backups and controlled updates. It includes the VPS/DNS/firewall settings and an isolated local container check. Development stays loopback-only; production configuration is separate under ignored `.deploy/`. CI verifies builds and the disposable deployment without publishing or deploying anything.

## Checks

```sh
npm test
npm run build
npm run test:guests
npm run test:economy
npm run test:casino
npm run test:casino-network
npm run test:network
npx playwright install chromium-headless-shell webkit
npm run test:shop
npm run test:casino-browser
npm run test:social
npm run test:voice
npm run test:startup
npm run test:browser
npm run test:character
npm run test:wave
npm run test:polish
npm run test:crowd
```

Browser checks need the development server and always launch headlessly. Voice testing uses Chromium's synthetic microphone, never the user's real microphone. Set `PLAYWRIGHT_BROWSERS_PATH` for a custom browser directory. Screenshots/results go to ignored `output/playwright/`. The shop check defaults to WebKit; use `SHOP_BROWSER=chromium npm run test:shop` for Chromium (compact viewport and performance mode). The economy check uses an isolated PostgreSQL schema and simulated cumulative time to verify salary thresholds without a ten-minute wait.

The casino browser journey defaults to WebKit; `CASINO_BROWSER=chromium npm run test:casino-browser` runs a compact Chromium roulette compatibility check. `test:casino` uses an isolated PostgreSQL schema for wagering, concurrent wallet use and recovery. `test:casino-network` starts an isolated localhost server on port 2569 for shared casino protocol checks.

The network check starts its own localhost server on port 2568 and an isolated database schema, then removes that schema. It checks 64 protocol clients, admission, movement, chat/blocking and seat contention. It does not establish smooth 64-avatar rendering or voice capacity. Separate synthetic renderer measurements are documented in [the polish implementation](docs/polish-review.md); dense crowds still need native-device profiling. Synthetic voice reception and mobile emulation are separate from native microphone, physical phone or Windows runtime evidence.

## Art sources

See [art-source/README.md](art-source/README.md) for editable Blender sources and regeneration commands, [the implementation checkpoint](docs/implementation-status.md) for evidence and limits, and [the first-build proposal](docs/first-build-proposal.md) for the broader product scope.
