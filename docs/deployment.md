# Self-hosted alpha on Hetzner

The deployment target is one Linux VPS for approximately ten friends: the built browser game, one Node/Colyseus process, PostgreSQL 18 and LiveKit voice. Docker Compose manages the services. No GPU is required. This is a single-server alpha with maintenance interruptions, not a highly available or horizontally scaled service.

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

The local project already includes its Git ignore rules, binary attributes, lockfile, Docker build and GitHub Actions CI. Create a **private** remote when ready; no remote is assumed by this configuration. Clone the reviewed repository into `/opt/slop-city`. Do not copy the Mac's `.env`, `.local` database or development credentials. The VPS starts with a fresh guest database; migrating development profiles is a separate deliberate operation.

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

```sh
sh deploy/compose.sh ps
curl --fail https://play.your-domain.com/game/health
sh deploy/compose.sh logs --tail 80 game
```

Open the site from a computer and a physical phone on a different network. Create guests, join the same town, exchange chat, enable voice and test both directions. Place a fictional-credit wager, wait for settlement, reload, and confirm the balance persists. Check a planned restart with players connected. Verify voice on a network where UDP is blocked to exercise TURN/TLS, not just the happy path. A container build or voice-token response does not prove microphone media or public-network connectivity.

The production browser uses `/game` on its own origin, preserving the HttpOnly/Secure/SameSite guest cookie. LiveKit signalling uses the separate `voice` hostname. Caddy serves only the built `dist` files, rejects dotfiles, revalidates unversioned models and caches hashed JS/CSS assets. No Vite development server is shipped.

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

GitHub Actions runs unit tests, TypeScript/frontend/server builds and the disposable Compose integration check. It does not publish images or deploy the site. The first remote workflow run remains to be verified after a private remote exists.

## Scope remaining before opening access

Guest profiles are tied to browser cookies; accounts and cross-device recovery are future work. Keep the initial audience to known testers. Existing voice filtering relies on cooperating clients and does not guarantee server-enforced private conversations against modified clients. Moderation and public access controls are not completed by containerising the app. Ten-player hosting is a sizing assumption pending a live session; client rendering performance remains a separate measurement.

References: [LiveKit single-VM deployment](https://docs.livekit.io/transport/self-hosting/vm/), [LiveKit network ports](https://docs.livekit.io/transport/self-hosting/ports-firewall/), [Docker PostgreSQL storage](https://docs.docker.com/guides/postgresql/).
