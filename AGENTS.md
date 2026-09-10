# Slop City — agent instructions

## Product and working style

Slop City is a browser-based 3D social game for desktop and mobile. Preserve the approved direction: a town square, clothing shop and shared roulette, blackjack and slots; guest profiles first, accounts later; entirely fictional credits with no microtransactions. The town has a 64-player admission cap, while the initial hosting audience is approximately ten people. Neither number establishes measured rendering or voice capacity.

Keep the refined stylised world and the character's deliberately neutral, wide-eyed, slightly derpy stare. Onboarding collects a name, then opens a visible character preview in the 3D changing room. Location names appear centrally on entry and fade away. Casino actions in the interface must remain consistent with the visible 3D table. Treat phone portrait/landscape usability as part of visual changes.

Act on clear requests and preserve existing authorization. Resolve routine reversible details without repeated confirmation; clarify consequential changes to product scope. Check the working tree before editing, preserve unrelated work and keep changes focused. Creating or editing code does not automatically authorize publishing, a production restart or a database restore.

Use concise progress updates and report what changed, the relevant checks and their limits. Show actual screenshots during meaningful visual work. Do not present a successful build as proof of browser behavior, multiplayer performance or live voice media.

Delegate only useful independent work. When delegation is available and permitted, use native `gpt-6-astra` agents: UI/design workers at `xhigh`, bounded coding workers starting at `low`. Give each worker exact ownership and tell them to preserve others' edits. The parent owns integration and verification. Do not substitute Claude, OpenCode or another model provider; work locally if the requested native role is unavailable.

## Find the relevant code

| Location | Responsibility |
| --- | --- |
| `src/` | React interface, Babylon.js world, presentation, audio and browser settings |
| `shared/` | Replicated state, world geometry, catalogues and shared contracts |
| `server/` | Colyseus town, guest/voice APIs, authoritative gameplay and runtime lifecycle |
| `server/persistence/` | PostgreSQL repositories and SQL migrations |
| `tests/` | Node test-runner unit and boundary checks |
| `scripts/` | Local services, protocol/browser checks and deployment configuration |
| `art-source/` | Editable Blender assets and generation scripts |
| `public/models/`, `public/textures/` | Runtime asset exports |
| `deploy/`, `compose*.yaml`, `Dockerfile` | Production containers, gateway, backups and releases |

Use `package.json` and `.nvmrc` for the actual dependencies and runtime; Node 24 is the supported deployment target. Read only the documentation relevant to the task:

- `README.md`: local startup, controls and test entry points.
- `docs/implementation-status.md`: dated implementation evidence and remaining limits. Historical local-only/no-publication statements describe earlier phases; they are not current task instructions.
- `docs/economy-design.md`, `docs/casino-design.md`: gameplay and persistence contracts.
- `server/persistence/README.md`: database behavior and checks.
- `art-source/README.md`: asset sources and regeneration.
- `docs/deployment.md`: current deployment and recovery procedures.

## Development and verification

Local development remains loopback-only at `http://localhost:5173`. Do not enable LAN access as a convenience. Use the same hostname consistently because `localhost` and `127.0.0.1` have separate cookies. Inspect existing processes before starting duplicate services.

```sh
npm ci
npm run services:start
npm run dev
```

The service helper requires local PostgreSQL/LiveKit prerequisites described in the README and generates private development state under `.local/` and `.env`. Avoid reinstalling or restarting these when they are already running. `npm ci` also applies the pinned Colyseus SDK compatibility patch in `scripts/patch-sdk.mjs`; preserve or deliberately reassess it when changing the SDK.

Run checks proportional to the behavior changed. Documentation-only edits need link/command accuracy and whitespace checks, not a complete game build. For code changes, select meaningful regressions and relevant builds:

| Change | Relevant checks |
| --- | --- |
| Shared rules, APIs or TypeScript | `npm test`, `npm run build`; add `npm run build:server` for server/shared/runtime changes |
| Database ownership/runtime | `node --env-file=.env --import tsx --test tests/runtime.test.ts` against the local test database |
| Guest/economy/casino persistence | `npm run test:guests`, `npm run test:economy`, `npm run test:casino`, as affected |
| Multiplayer contracts | `npm run test:network` or `npm run test:casino-network` |
| Onboarding, world or character | Relevant `test:startup`, `test:browser`, `test:character`, `test:wave` scripts |
| Shop, casino or social UI | Relevant `test:shop`, `test:casino-browser`, `test:social`, `test:polish` scripts |
| Voice | `npm run test:voice`; synthetic reception is distinct from human/cross-network audio |
| Deployment | The isolated Compose workflow in `docs/deployment.md` and `.github/workflows/ci.yml` |

Plain `npm test` does not load `.env`; database runtime tests skip without `DATABASE_URL`. When claiming database-inclusive unit coverage, use `node --env-file=.env --import tsx --test tests/*.test.ts` with the local development database available and report any skips. Read a script's setup and side effects before running it; never point test cleanup, temporary schema or lifecycle scripts at production.

All browser automation must stay **headless/background**, without stealing screen focus. Existing browser checks use synthetic microphone input, not Tom's real microphone. Keep screenshots and results in ignored `output/playwright/`; show local images with absolute paths. Inspect `PLAYWRIGHT_BROWSERS_PATH` before assuming browser binaries are missing. Emulated mobile layouts and headless frame rates do not establish physical phone/Windows performance.

## Gameplay and asset invariants

- The server owns movement validation, appearance admission, seat occupancy, credits, purchase ownership, wagers and settlement. Client presentation must not become authoritative.
- Preserve atomic, retry-safe wallet/purchase/wager writes, private wallet and hidden casino state, and restart recovery. Add migrations for deployed schema changes instead of rewriting applied migrations.
- Keep guest credentials opaque and HttpOnly, preserve origin checks and one active town session per guest. Guest profiles are browser-bound; do not promise cleared-cookie or cross-device recovery.
- Proximity and blocking currently rely partly on cooperating clients. Do not describe them as secure private conversations or complete moderation against modified clients.
- Author Blender changes in a separate `--background --factory-startup` process. Preserve unrelated open Blender documents. Update the owned source/export together and verify the resulting rig, clips and runtime appearance as relevant. Keep the character identity while improving asset quality.

## Production boundaries

The live site is `https://slopcity.fun`. It runs on an Ubuntu VM behind a router using Cloudflare Tunnel, host nginx and a loopback Docker gateway. The original direct-IP Hetzner proposal is an alternative, not the current routing setup. Development and production databases/configuration are separate.

For SSH/navigation, use the project-local `slop-city-vps` skill at `.agents/skills/slop-city-vps/SKILL.md` when available. It records the nonstandard SSH port, correct production checkout and password boundaries. This local skill is ignored by Git and is not included in a fresh clone. If unavailable, use `docs/deployment.md` and request missing connection details only when needed. Verify live state instead of treating recorded health or revisions as current.

Use `sh deploy/compose.sh` from the production checkout; it selects the configured tunnel override. Do not replace it with a bare/default Compose invocation. Keep one game process per database schema: startup's ownership lock protects migrations and unfinished-wager recovery. An authorized `deploy/update.sh` release is a stop/start operation that interrupts players.

Never commit or print `.env`, `.deploy/`, `.local/`, backups, database URLs, generated LiveKit secrets, Cloudflare tokens or SSH private keys. Use `config --quiet` for Compose validation; expanded configuration contains credentials. Preserve the existing ignore rules and keep local infrastructure details in the project-local VPS skill rather than duplicating them here.

Never run `docker compose down --volumes` against production. The destructive deployment test belongs only to its disposable smoke project. A restore replaces saved player state and requires a deliberately selected dump and the documented maintenance procedure. Preserve unrelated nginx sites and host services; do not bypass an interactive sudo password through Docker's root-equivalent capabilities.

Verify public HTTPS, game WebSockets and voice audio separately. Tunnel mode serves voice signalling under `/voice`, but audio needs a direct router route; TURN is disabled in that mode. Healthy containers and a voice token do not prove microphone media. Local backup timers do not establish off-server recovery.
