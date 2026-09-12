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

Enter a name, customise your character in the 3D changing room, then join the square. Walk with WASD/arrows, hold **Shift** to sprint, press **Space** for a short jump, drag to orbit and scroll to zoom. Phones have a movement stick, **Sprint** toggle and **Jump** button; tap Chat to expand it. Jumping keeps obstacle and ledge restrictions active. Settings saves [Low, Medium, High or Ultra graphics](docs/graphics-settings.md), motion preferences and separate city-effects/fountain volumes in this browser. High preserves the full appearance and is the default on all devices; Medium carries forward the former Performance mode. Approach a bench and choose **Sit down**; **Stand up** releases the seat. Open **Social** to join voice, then explicitly enable your microphone if desired. A separate private browser window gives you a second guest for local testing.

Click or tap a visible neighbour, or select their name in **Social**, to open their player card. Invite them to a handshake or hug, send a mutual friend request, give credits, mute voice or block them. Shared emotes need consent and clear space within two metres; moving or choosing **Stop emote** ends the pose. Friends and requests are saved with your browser-bound guest profile. Gifts need both players within three metres and a confirmation. Each future salary payment adds the same amount to your outgoing gifting allowance; starting credits, received gifts and casino returns add none. You can give up to your allowance and wallet balance, with a 1,000-credit limit per gift. A pending gift can be checked after reloading without sending it twice.

Walk into **Form & Thread** and choose **Browse Form & Thread** to try on clothes. Buying adds a piece to your collection; **Wear this** equips it for everyone to see. Click the wallet to open your saved wardrobe anywhere. Each guest receives **1,000 credits once**, then **100 credits per 5 accumulated real minutes in the visible town tab**. Sitting, chat and browsing count. Leaving or hiding the tab pauses salary and preserves progress.

Walk into **The Meridian Casino**, approach a table or machine, then choose **Open**. Roulette accepts a separate confirmed bet on each press; blackjack requires a seat before betting; slots play one spin at a time; craps accepts one Pass or Don’t Pass line bet before the opening roll, followed by shared dice rolls until the wager resolves. Roulette stakes use 10-credit steps, up to your available balance and the 1,000-credit round limit; other house-game stakes are 10–100 fictional credits. Texas Hold’em seats two to six players with 5/10 blinds and a 100–1,000-credit buy-in from the wallet into table chips. Poker’s **Leave table** schedules a fold on your next turn and returns the remaining stack after the hand; all-in hands and completed betting remain live. Each panel has Play, How to play and Results views with fixed actions and paged details. Ready starts a round early once everyone playing is ready; opening the table gives a new player a brief joining grace. Personal win, loss and stake-return announcements appear after the reveal. Chat stays available beside each game. **Table** reaches neighbours viewing or seated at that same table; **Town** reaches the current town. Use a player card’s **Whisper** action, the recipient list, or `/w "Name" message` for an online neighbour; `/r message` replies to your latest incoming whisper. **All** shows every channel and sends to Town. Messages show timestamps, and unread badges plus **Jump to latest** let you read scrollback without interruption. Press **Enter** or **/** to focus chat, **Enter** to send, or **Escape** to return to the game. Desktop chat has height and text-size controls; chat history is retained only for this visit. Rules and returns are available in each panel. Closing a panel keeps accepted bets in play. Blackjack’s **Leave seat** releases your character and stands unfinished hands; slots release after their result interval. After a server restart, unfinished house wagers are refunded once and unfinished poker hands return their opening stacks; completed poker winnings are preserved.

Walk west to **The Bridge Picture House** for the shared community reel and BridgeMind on the physical cinema screen. **Memories** opens the Polaroid board: zoom in, select a photo, then return to the board. **Share a memory** uploads a still image to Tom’s private approval queue. The review desk controls publication, promos, schedule cards and a curated YouTube fallback. [Configure a Twitch developer app](docs/cinema-stream-setup.md) for automatic public live/offline checks. Set up the separate administrator password with `npm run community:admin-password`, then restart the local game server. See [cinema and community design](docs/cinema-community-design.md) for limits and provider behaviour. The stream follows the screen as you roam, with Twitch sound fading by character distance. Twitch currently needs one click on its native play button in the world view; playback then continues while roaming and switching tabs.

## Implemented

- Server-owned movement/collisions, sprinting and short hops with clearance checks, and a 64-client room cap.
- PostgreSQL guest identity, saved name/skin/jacket, revision checks and one active town session per guest.
- An opaque HttpOnly guest cookie; clearing site data or expiry loses browser access to that character. Accounts and cross-device recovery are not implemented.
- Shared appearance, town text chat, wave and departure.
- Click/tap player cards, consent-based shared handshakes/hugs, saved mutual friends and atomic, retry-safe credit gifts with salary-earned allowance.
- Centred location titles on arrival, fading away within four seconds; the town map retains your current location.
- Twenty-six server-owned seats on thirteen benches, including eighteen seats at the garden cinema, with an authored seated pose.
- Opt-in LiveKit voice, microphone off on join, distance fade and separate acoustic areas for the square and venue interiors.
- Local voice mute plus persistent guest blocking that filters chat and voice in both directions. Blocked avatars remain visible.
- Name-first onboarding and a live 3D changing room with skin/jacket colours.
- Original Blender character with idle/walk/run/jump/wave/sit and paired handshake/hug clips; fountain, benches, lamps, planters, olive trees and changing-room assets.
- Fountain ripples, reflection/refraction and water jets, with local ambience and reduced-motion support.
- Recoverable camera zoom, blended character transitions, sharper phone rendering, 44px touch controls and saved comfort settings.
- Rigged remote-character LOD, bounded nearby shadows and restricted fountain reflections; [polish measurements and limits](docs/polish-review.md).
- Blender-furnished Meridian Casino: two independent European roulette islands, six five-seat blackjack tables, 24 individual slot machines and a shared craps table in the left rear bay and six-seat Texas Hold’em in the right rear bay, reached through a reception foyer and steps or a side ramp.
- Server-owned casino rules, hidden outcomes, explicit stakes, shared seats/spectating, durable debit/return receipts and restart refunds for unfinished wagers.
- Matching 3D roulette chips/coverage, animated cards and split hands, spinning wheel/ball, illustrated slot reels and shared tumbling dice with a physical point marker.
- Phone portrait/landscape casino layouts with a visible 3D table and fixed bet/spin/hand controls.
- Form & Thread boutique with connected departments, display-window outfits, parquet, six rails, checkout, warm interior lighting and two mirrored fitting bays; [shop direction and scope](docs/clothing-shop-overhaul-design.md).
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
npm run test:shop-render
npm run test:shop-signage
npm run test:casino-browser
npm run test:casino-ux
npm run test:casino-qol
npm run test:roulette-placement
npm run test:casino-expansion
npm run test:roulette-motion
npm run test:craps-render
npm run test:craps-browser
npm run test:craps-network
npm run test:poker-network
npm run test:poker-render
npm run test:poker-browser
npm run test:social
npm run test:social-persistence
npm run test:interactions-network
npm run test:interactions-browser
npm run test:voice
npm run test:startup
npm run test:welcome
npm run test:cinema-render
npm run test:community-browser
npm run test:browser
npm run test:character
npm run test:wave
npm run test:polish
npm run test:graphics-render
npm run test:graphics-browser
npm run test:cinema-pointer
npm run test:crowd
```

Most browser checks need the development server and all launch headlessly. Voice testing uses Chromium's synthetic microphone, never the user's real microphone. Set `PLAYWRIGHT_BROWSERS_PATH` for a custom browser directory. Screenshots/results go to ignored `output/playwright/`. The shop check defaults to WebKit; use `SHOP_BROWSER=chromium npm run test:shop` for Chromium (compact viewport and Medium graphics). The economy check uses an isolated PostgreSQL schema and simulated cumulative time to verify salary thresholds without a five-minute wait. The graphics browser check uses a disposable local schema and its own loopback server with simulated admission verification; it needs the local database in `.env` and leaves the running game's bot controls unchanged.

The casino UI fixture check covers five games at desktop and phone sizes; run it separately from full-app browser journeys because fixture changes can reload Vite pages. The roulette placement check renders controlled outside bets on both actual table assets. The casino browser journey defaults to WebKit; `CASINO_BROWSER=chromium npm run test:casino-browser` runs a compact Chromium roulette compatibility check. `test:casino` uses an isolated PostgreSQL schema for wagering, concurrent wallet use and recovery. `test:casino-network` starts an isolated localhost server on port 2569 for shared casino protocol checks.

The craps checks cover the imported table/dice renderer, a real browser journey and an isolated three-client protocol journey on port 2571. Poker checks cover escrow/rules, an isolated three-client journey on port 2572, the imported table renderer and full-app controls; see [the poker contract](docs/poker-design.md). See [the craps contract](docs/craps-design.md) for rules, motion and persistence details.

The [player interaction contract](docs/player-interactions-design.md) records movement, consent, friends and gifting rules. `test:social-persistence` checks transactions and migrations in a disposable local schema. `test:interactions-network` starts an isolated server on port 2574 for three-client protocol and private HTTP checks. `test:interactions-browser` starts its own isolated backend on 2576 and a source-snapshot preview on 5184, so it needs no running development server; it defaults to WebKit, with `BROWSER=chromium` selecting Chromium. On macOS that check uses Metal because headless Chromium otherwise uses CPU-based SwiftShader; both browser paths test normal game quality unless `INTERACTION_PERFORMANCE=1` is set. These checks use the local `.env` database, remove their temporary schemas, and simulate salary payments only in those schemas. Browser evidence covers real UI and renderer behavior; emulated touch/layout checks do not establish physical-phone performance.

The network check starts its own localhost server on port 2568 and an isolated database schema, then removes that schema. It checks 64 protocol clients, admission, movement, chat/blocking and seat contention. It does not establish smooth 64-avatar rendering or voice capacity. Separate synthetic renderer measurements are documented in [the polish implementation](docs/polish-review.md); dense crowds still need native-device profiling. Synthetic voice reception and mobile emulation are separate from native microphone, physical phone or Windows runtime evidence.

## Art sources

See [art-source/README.md](art-source/README.md) for editable Blender sources and regeneration commands, [the implementation checkpoint](docs/implementation-status.md) for evidence and limits, and [the first-build proposal](docs/first-build-proposal.md) for the broader product scope.

### Isolated community acceptance

Run `npm run community:preview` with the local PostgreSQL service available. This creates a disposable schema and loopback-only servers at `http://localhost:5178` and port 2578. Ctrl+C stops both and removes the schema; the usual development town is unaffected. When opening through Orca, set `COMMUNITY_PREVIEW_ORIGIN` to the exact Orca preview URL before launching; that one additional loopback origin is allowed.

In another terminal, run:

```sh
GAME_URL=http://localhost:5178 COMMUNITY_ACCESS_FILE=output/playwright/cinema-preview/access.json npm run test:community-ui
GAME_URL=http://localhost:5178 npm run test:community-browser
GAME_URL=http://localhost:5178 npm run test:cinema-render
```

The private access file belongs only to this disposable preview. Provider documents are mocked in the UI acceptance check; these checks do not prove live broadcast playback or audio.

## Town safety administration

Open `/admin` to view activity and manage temporary/permanent guest or IP bans. Login is disabled until the server admin password is set. See [town safety](docs/abuse-controls.md) for password setup, quotas and monitoring, and [deployment](docs/deployment.md#trusted-visitor-addresses-and-abuse-controls) for the required gateway upgrade. Run `npm run test:safety` for the isolated enforcement and browser checks.

### HUD and chat acceptance

`npm run test:chat-network` checks three authenticated clients in a disposable local schema, including whisper isolation, table membership, blocking and reconnects. After `npm run build`, `npm run test:hud-chat` runs the built release headlessly in installed Brave against its own local backend/schema; `HUD_BROWSER=chromium` or `HUD_BROWSER=webkit` selects another browser. It covers native dialogs, real whispers, unread/scrollback controls, a walk to the leaderboard and roulette table, and desktop/touch layouts. These scripts use only the loopback development database, with admission challenges disabled in their isolated server. They never target production. See [the chat contract](docs/chat-design.md).
