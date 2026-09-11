# Town safety

Open `/admin` directly, or choose **Town safety** in the community review desk. Both use the same administrator password and eight-hour HttpOnly session. No guest profile or town admission is needed to administer the game. If the password hash is empty, login is disabled. Set a password of at least 12 characters privately with:

```sh
node scripts/community-admin-password.mjs --file .deploy/game.env
```

Run it from the production checkout in an interactive terminal; it stores a salted scrypt hash without printing the password. Recreate the game container to load a changed environment (`restart` alone does not reload the env file):

```sh
sh deploy/compose.sh up -d --no-deps --force-recreate --wait game
```

This disconnects players. Locally, omit `--file .deploy/game.env` and use the development server. See [deployment setup](deployment.md#trusted-visitor-addresses-and-abuse-controls) for the required trusted gateway configuration before releasing this version.

## Ban controls

The private page lists connected guests and addresses, searches saved guest names/IDs, and accepts one exact IPv4/IPv6 address or guest UUID. Choose a reason and one hour, one day, one week or permanent, then review and confirm. IP bans affect everyone sharing that address. A replacement ban updates the target's restriction; **Lift ban** removes it. Expiry is automatic.

Migration 009 stores bans and ban/unban audit records in PostgreSQL. Bans load before the server accepts traffic and survive restarts. Matching connections are stopped immediately, deferred casino/purchase/social eligibility rejects stopped sessions, and their voice participant is removed. A non-cooperating socket is terminated after one second. Completed transactions are preserved; banning is not a wallet rollback. Already issued self-hosted voice tokens have a short validity window, so a game ban does not establish instant revocation of all previously issued voice credentials.

Guest bans protect saved identities; clearing cookies permits trying to create another guest. IP bans can be evaded by changing networks. These controls reduce abuse without claiming one IP or one guest equals one person. There is no CAPTCHA, account requirement, device fingerprint or automatic behaviour-based permanent ban.

## Initial quotas

Quotas use bounded token buckets: the listed count is the burst capacity, refilled continuously over the listed period. Limits reject with HTTP 429 and `Retry-After`; routine saved-profile restoration does not spend creation quota. Address quotas group IPv6 privacy addresses by /64; bans match exact normalized addresses, including equivalent IPv4-mapped IPv6 forms.

| Surface | Per network | Global / per guest |
| --- | --- | --- |
| New guest creation | 10 / 15 minutes | 120 / 15 minutes globally |
| Matchmaking, including failed reconnects | 30 / minute | 120 / minute globally; 12 successful-auth attempts / minute per guest |
| WebSocket upgrade attempts | 40 / minute | 180 / minute globally |
| Concurrent town admission, including pending joins | 12 | 64 across all rooms |
| Game HTTP requests | 600 / minute | 6,000 / minute globally |
| Voice-token issuance requests | 60 / minute | 240 globally and 6 per guest / minute |
| Raw game messages | — | 120 / second per connection; excess disconnects |
| Other game controls | — | 20 burst / second per connection; excess ignored |

Existing chat moderation and casino action limits remain. Administrator login and authenticated admin requests have separate quotas, so a game/IP ban does not prevent administrator recovery. The trusted origin's health check remains reachable. Runtime defaults are in `server/safety.ts`; adjust them deliberately after observing real join failures and shared-network use.

## Monitoring and limits of evidence

The admin page shows current/pending connections, counts since process start, and the latest 200 detailed signals from at most the last 24 hours. Repeated identical signals are aggregated over ten seconds. These signals indicate requests to investigate; they do not establish that a player is a bot. Counters/details reset on restart; bans and their audit history persist.

Every minute, `town_safety_summary` emits structured aggregate counters and connection count to the existing rotating service logs. These summaries contain no IP addresses, guest IDs, cookies, passwords or chat bodies. Detailed IP/guest attribution is restricted to authenticated administration and process memory. No separate monitoring service is needed for this initial dashboard.

`npm run test:safety` uses only a loopback database and a disposable schema/server, plus the running loopback Vite client for headless admin UI checks. It exercises real ban removal, rejected restore/rejoin, malformed proxy identity, reconnect quotas, flood disconnection, restart persistence and browser ban/unban at desktop/portrait/landscape sizes. `test:network` models 64 distinct networks using a test-only gateway key rather than disabling quotas. Neither check measures real bot traffic or physical phone performance.
