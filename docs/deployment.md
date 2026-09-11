# Self-hosted alpha

The deployment target is one Linux VPS for approximately ten friends: the built browser game, one Node/Colyseus process, PostgreSQL 18 and LiveKit voice. Docker Compose manages the services. No GPU is required. This is a single-server alpha with maintenance interruptions, not a highly available or horizontally scaled service.

The current deployment is an Ubuntu VM behind a router, reached through Cloudflare Tunnel at `https://slopcity.fun`. It uses the tunnel/nginx variant below. The direct Hetzner setup remains an alternative for a machine with its own public IP.

## Provision the VPS

Choose CPX32 (4 shared vCPUs, 8 GB RAM), Nuremberg, Ubuntu 24.04 LTS, public IPv4 and provider backups. Add an SSH public key when creating it. Keep the private key on your Mac. Availability and the final checkout price come from the Hetzner console.

Create three DNS A records pointing at its public IPv4, for example:

| Hostname | Purpose |
| --- | --- |
| `play.your-domain.com` | Website, guest API and game WebSockets |
| `voice.your-domain.com` | LiveKit signalling |
| `turn.your-domain.com` | TURN/TLS fallback for voice |

Use DNS-only records, without an HTTP proxy. Do not add AAAA records until IPv6 is configured and tested. Caddy obtains and renews certificates after DNS resolves to this server. All three names share one IPv4 and port 443 using TLS SNI.

Create a Hetzner Cloud firewall with these inbound rules:

| Protocol/port | Source | Purpose |
| --- | --- | --- |
| TCP 22 | Your administration IP(s) | SSH |
| TCP 80, 443 | Any IPv4 | Certificate issuance, HTTPS, game sockets and TURN/TLS |
| TCP 7881 | Any IPv4 | WebRTC TCP fallback |
| UDP 7882 | Any IPv4 | WebRTC audio |
| UDP 3478 | Any IPv4 | TURN/UDP |

Keep the default outbound allowance. PostgreSQL 5432, game 2567, LiveKit API 7880, internal TURN 5349 and Caddy's internal HTTP port are not published. The Compose database network is private. Use the provider firewall: Docker's published ports can bypass ordinary UFW rules. No SIP, video recording or ingress services are needed.

## Prepare the machine and repository

Install Docker Engine and the Compose plugin using [Docker's Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/). Use a normal SSH user with sudo; Docker access itself grants root-equivalent privileges. Install Git and Node 24 LTS for the one-time configuration command (the game runs in its container).

For a fresh Ubuntu 24.04 host, `sudo sh deploy/bootstrap-ubuntu.sh YOUR_USERNAME` performs the Docker installation from its official apt repository, grants that user Docker access and prepares `/opt/slop-city`. It leaves nginx and firewall configuration unchanged and refuses to remove conflicting packages automatically. Reconnect SSH after it finishes. If Node is not installed on the host, use `sh deploy/configure.sh GAME_DOMAIN VOICE_DOMAIN TURN_DOMAIN PUBLIC_IPV4` instead of `npm run deploy:configure`; the wrapper runs the generator in a Node 24 container as your user.

The project includes its Git ignore rules, binary attributes, lockfile, Docker build and GitHub Actions CI. The user-approved public repository is [ThomasPritchard/slopcity](https://github.com/ThomasPritchard/slopcity). Clone the reviewed repository into `/opt/slop-city`. Do not copy the Mac's `.env`, `.local` database or development credentials. The server starts with a fresh guest database; migrating development profiles is a separate deliberate operation.

```sh
cd /opt/slop-city
npm run deploy:configure -- play.your-domain.com voice.your-domain.com turn.your-domain.com YOUR_PUBLIC_IPV4
sh deploy/compose.sh config --quiet
sh deploy/update.sh
```

The configuration command needs Node, but no `npm install`. It generates strong, separate database and voice secrets under ignored `.deploy/`, with directory permissions 0700 and files 0600. It refuses to overwrite that directory. Keep an encrypted copy of these credentials separately from the server. Do not run plain `docker compose config` in shared logs: its expanded output contains credentials. The `--quiet` form only validates.

`deploy/update.sh` builds before interrupting the running service, backs up an existing database, then stops and replaces the game and edge. Never scale `game` above one replica or deploy a second checkout against the same schema. The game takes a PostgreSQL ownership lock before migrations or wager recovery; a duplicate process fails closed. Graceful shutdown allows 25 seconds to dispose rooms, with Docker allowing 35 seconds before forced termination.

The application runs as an unprivileged container user with a read-only filesystem. SQL migrations run automatically during startup. PostgreSQL uses a named volume mounted at `/var/lib/postgresql`, as required by its version 18 image layout. The app uses its own database role rather than the PostgreSQL administrator. Images target `linux/amd64` for CPX32 by default; an Apple Silicon Mac runs them through Docker's emulation. `SLOP_PLATFORM` can override this for a deliberately different host architecture.

## First live checks

### Existing Cloudflare Tunnel / nginx host

For a host behind a router with an existing Cloudflare public hostname, generate configuration with `sh deploy/configure.sh --tunnel GAME_DOMAIN VOICE_DOMAIN TURN_DOMAIN PUBLIC_IPV4`. This chooses `compose.tunnel.yaml` automatically through `deploy/compose.sh`. The gateway listens only at `http://127.0.0.1:9080`, with the public HTTPS origin preserved. Cloudflare/nginx must preserve the original Host header and support WebSocket upgrades. The existing tunnel can point directly at that local URL, or nginx can proxy the selected hostname to it. The supplied `deploy/nginx-tunnel.conf` is specifically for `slopcity.fun`; `sudo sh deploy/enable-nginx-tunnel.sh` installs it only if the private gateway is healthy and no Slop City site already exists. It validates/reloads nginx and enables the daily backup timer, preserving other sites.

Voice signalling uses `wss://GAME_DOMAIN/voice` in this mode, so it needs no additional tunnel hostname. Audio still needs a direct route: forward UDP 7882 and optionally TCP 7881 from the router to the game host, keeping the same external and internal port numbers. Verify actual media from another network. TURN is explicitly disabled in tunnel mode because a normal HTTP tunnel cannot carry TURN/TLS; reliable fallback on restricted networks requires a separately reachable TURN setup. The ordinary direct-VPS configuration retains its full TURN/TLS gateway. Do not claim voice works based on signalling alone.

```sh
sh deploy/compose.sh ps
curl --fail https://play.your-domain.com/game/health
sh deploy/compose.sh logs --tail 80 game
```

Open the site from a computer and a physical phone on a different network. Create guests, join the same town, exchange chat, enable voice and test both directions. Place a fictional-credit wager, wait for settlement, reload, and confirm the balance persists. Check a planned restart with players connected. Verify voice on a network where UDP is blocked to exercise TURN/TLS, not just the happy path. A container build or voice-token response does not prove microphone media or public-network connectivity.

The production browser uses `/game` on its own origin, preserving the HttpOnly/Secure/SameSite guest cookie. LiveKit signalling uses `/voice` in tunnel mode or the separate `voice` hostname in direct mode. Caddy serves only the built `dist` files, rejects dotfiles, revalidates unversioned models and caches hashed JS/CSS assets. No Vite development server is shipped.

## Back up and restore

```sh
sh deploy/backup.sh
```

This creates a PostgreSQL custom-format dump in ignored `backups/` with private permissions. It does not stop the game. Configure the included daily timer after cloning to `/opt/slop-city`:

```sh
sudo install -m 644 deploy/slop-city-backup.service deploy/slop-city-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now slop-city-backup.timer
```

These dumps are local. Copy them off the VPS regularly (for example to a separate Hetzner Storage Box or your Mac over SSH), retain multiple versions, monitor disk use and test restoration. The supplied script deliberately does not delete old backups. Provider disk backups supplement database dumps; they do not replace tested database recovery. Certificate volumes and `.deploy/` credentials also need recovery planning.

To restore a chosen dump **over the live database**, announce maintenance, take a fresh backup first, stop `edge` and `game`, and restore using the following commands. The restore replaces saved players and balances with the dump's state, so only use a deliberately selected and verified backup:

```sh
sh deploy/backup.sh
sh deploy/compose.sh stop edge game
sh deploy/compose.sh exec -T postgres pg_restore -U postgres -d slop_city --clean --if-exists --no-owner --role=slop_city --exit-on-error < backups/CHOSEN_BACKUP.dump
sh deploy/compose.sh up -d --wait
```

Do not use `docker compose down --volumes` on the VPS: that removes the database and certificate volumes. Ordinary `stop`, `up` and container rebuilds preserve them. Startup refunds unfinished wagers from the restored state once.

## Releases and rollback

Tag or record the reviewed Git commit before deployment. To update, check out the intended commit and run `sh deploy/update.sh`. Keep the previous commit available. For application rollback, check it out and rebuild; **first check migration compatibility**. A database schema change may require restoring the matching pre-release dump during maintenance. There is no automatic schema downgrade or automatic rollback.

Node and PostgreSQL images track their supported major versions (24 and 18); Caddy and LiveKit use explicit release versions. Refresh them deliberately and run the deployment checks when updating. Docker logs rotate at three 10 MB files per service. Health checks report database availability; Docker restarts crashed containers, but an `unhealthy` status alone does not automatically restart them. Add external uptime notifications before relying on unattended availability.

## Local container verification

The existing `npm run dev` remains loopback-only and keeps its own database/voice processes. A separate disposable Docker project can run alongside it:

```sh
npm run deploy:configure -- --local
docker compose --env-file .deploy-smoke/compose.env up -d --build --wait --wait-timeout 120
npm run test:deployment
# Optional visual check (headless Chromium; install its Playwright browser first):
node --import tsx scripts/deployment-browser-check.ts
docker compose --env-file .deploy-smoke/compose.env down --volumes
```

The final command is safe only for this disposable `slop-city-smoke` project. Local HTTPS uses Caddy's test CA and loopback port 8443. The test client explicitly handles that CA boundary; never disable certificate verification in the production application. Local media port translation differs from the VPS and is not a public voice test.

GitHub Actions runs unit tests, TypeScript/frontend/server builds and the disposable Compose integration check. It does not publish images or deploy the site. [Run 34400476576](https://github.com/ThomasPritchard/slopcity/actions/runs/34400476576) passed for the deployed application revision `b88a5fd`.

## Scope remaining before opening access

Guest profiles are tied to browser cookies; accounts and cross-device recovery are future work. Keep the initial audience to known testers. Existing voice filtering relies on cooperating clients and does not guarantee server-enforced private conversations against modified clients. Moderation and public access controls are not completed by containerising the app. Ten-player hosting is a sizing assumption pending a live session; client rendering performance remains a separate measurement.

References: [LiveKit single-VM deployment](https://docs.livekit.io/transport/self-hosting/vm/), [LiveKit network ports](https://docs.livekit.io/transport/self-hosting/ports-firewall/), [Docker PostgreSQL storage](https://docs.docker.com/guides/postgresql/).


## Cinema and community uploads

The cinema’s approved images and private submission queue live in PostgreSQL, so existing database dumps include them. Migration 008 is applied during the normal single-owner startup. Twitch live status is detected server-side every 30 seconds when `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are set in the private production game environment. Confirmed Twitch live status overrides the saved reel or curated YouTube fallback; a schedule time alone does not switch on a stream. See [Twitch setup](cinema-stream-setup.md). Twitch is restricted to BridgeMind’s channel. YouTube video selection is trusted manual administrator curation; ownership of an entered video ID is not automatically verified.

Before a separately authorised deployment, configure the administrator password on the production checkout with a local Node runtime:

```sh
node scripts/community-admin-password.mjs --file .deploy/game.env
```

The command uses hidden input, preserves other environment settings and writes a salted hash with permissions 600. It does not print the password or hash. Use the configured deployment directory if it differs from `.deploy`. The new value takes effect when the game container is recreated by the authorised release. An unset hash disables administrator login; ordinary approved-gallery viewing still works. Administrator sessions expire after eight hours and are invalidated by a game restart.

For the existing tunnel host, apply the `/game/api/community/submissions` location from `deploy/nginx-tunnel.conf` to the `slopcity.fun` site during the authorised release, validate nginx, and reload it. That location permits the bounded 6 MiB JSON upload; other paths retain their 16 KiB limit. Merely rebuilding containers does not update the host nginx file. Preserve unrelated sites.

Provider players require a visible supported embed. The client supplies Twitch’s embedding hostname and preserves YouTube’s required cross-origin referrer. Narrow phones offer a rotate/provider-link fallback when the minimum player size cannot fit. A local UI test with a stubbed provider frame establishes layout and player lifecycle only; public HTTPS and actual live audio/video still require a real broadcast check.

### Trusted visitor addresses and abuse controls

New configuration includes a private `ABUSE_PROXY_SECRET` shared by `game.env` and the game reverse proxy in `caddy.json`. Before deploying this version over an existing configuration, run `node scripts/configure-abuse-proxy.mjs --directory .deploy --tunnel` on the selected deployment checkout (omit `--tunnel` for direct TLS). This only updates those two private files, preserves other credentials and routes, and reuses an existing key. Unexpected/custom gateway layouts are rejected for manual review. Do not rerun initial deployment generation or print expanded configuration. Run this helper while preparing an authorised release, before replacing the game and edge containers together; it does not restart services. If interrupted between file replacements, rerun the helper before releasing.

If the deployment host has no Node installation, run the same helper in the existing Node image:

```sh
docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$(pwd),dst=/workspace" --workdir /workspace \
  node:24-bookworm-slim node scripts/configure-abuse-proxy.mjs --directory .deploy --tunnel
```

The gateway overwrites `X-Slop-Proxy-Key` and `X-Slop-Client-IP` on every `/game` HTTP/WebSocket request. Direct TLS uses PROXY protocol v2 from the layer4 proxy into a loopback-only HTTP listener requiring PROXY protocol; visitor identity comes from that connection, never a caller's forwarding header. This uses the pinned [caddy-l4 proxy support](https://github.com/mholt/caddy-l4/blob/v0.1.2/modules/l4proxy/proxy.go) and [Caddy listener wrapper](https://github.com/caddyserver/caddy/blob/v2.11.4/modules/caddyhttp/proxyprotocol/listenerwrapper.go).

Tunnel mode trusts `CF-Connecting-IP` only because the Docker HTTP origin is published on loopback and is reachable exclusively through trusted local cloudflared/nginx processes. Cloudflare must supply its normal visitor header; do not configure a transform that removes it. If nginx sits between cloudflared and Caddy, apply the `set_real_ip_from`, `real_ip_header`, and both `proxy_set_header CF-Connecting-IP $remote_addr` entries from `deploy/nginx-tunnel.conf`. The [nginx real-IP module](https://nginx.org/en/docs/http/ngx_http_realip_module.html) accepts replacement identity only from loopback cloudflared; other clients receive their actual socket address. Both the upload and general/WebSocket locations sanitize the header. Validate with `sudo nginx -t` before an authorised reload, preserving unrelated sites. Rebuilding containers does not update host nginx, and the installer refuses to overwrite an existing site. Local host processes and containers with access to private configuration remain trusted; never expose the origin or game port publicly.

The standalone moderation page is available at `/admin` and `/admin/`; only these entry paths rewrite to the built application index. Game API authorization remains enforced by the server.
