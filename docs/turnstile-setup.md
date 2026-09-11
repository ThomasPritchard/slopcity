# Turnstile and town entry

Slop City verifies a Cloudflare Turnstile token on the server before creating a guest. A successful check creates a guest-credential-bound entry pass, valid for 15 minutes. Returning guests complete a check before each new town connection. Matchmaking reserves the pass for 30 seconds; WebSocket admission consumes it once. Passes expire on a server restart or admin entry-control change. A browser refresh or failed connection can therefore require another check.

Existing IP, connection, profile-ban and message limits still apply. Verification does not mean a player is trusted forever, and paid human solvers can pass challenges. Sitting quietly or watching the cinema does not trigger automatic checks or bans.

## Cloudflare setup

1. Open **Turnstile** in the [Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/turnstile) and add a widget named `Slop City production`.
2. Add `slopcity.fun` as its hostname, without a protocol, port or path. Select **Managed** mode. Leave pre-clearance off; the game verifies tokens through its own API.
3. Copy the site key and secret key. Keep the secret out of Git, browser code and chat.
4. Create a separate development widget for `localhost` and `127.0.0.1`. Use that pair in the ignored local `.env`:

   ```dotenv
   TURNSTILE_SITE_KEY=YOUR_DEVELOPMENT_SITE_KEY
   TURNSTILE_SECRET_KEY=YOUR_DEVELOPMENT_SECRET_KEY
   ```

5. On the production server, add the **production pair** to `/opt/slop-city/.deploy/game.env`, preserving every other setting:

   ```dotenv
   TURNSTILE_SITE_KEY=YOUR_PRODUCTION_SITE_KEY
   TURNSTILE_SECRET_KEY=YOUR_PRODUCTION_SECRET_KEY
   ```

   Both belong in the game runtime environment. The public site key is delivered by `/game/api/admission`; there is no `VITE_` key or secret-bearing frontend build argument. Protect the file with mode `0600`.

6. Apply the configuration through the [authorized deployment procedure](deployment.md). Changing the file alone does not change a running container. The release briefly interrupts players.
7. Visit the public site in a normal browser, enter a name and complete the check. Join the square, then refresh and confirm returning-guest verification works. Test a second device/browser too. Cloudflare's dashboard shows widget activity and token validation results.

Production startup rejects missing, partial and Cloudflare dummy key pairs on public hostnames. Local development and the disposable HTTPS `.localhost` smoke stack can run with both values empty. A configured check always fails closed on verification errors. The application validates Siteverify's success, expected action `town_entry` and hostname against `APP_ORIGIN` / `APP_ORIGINS`.

Do not place blanket Cloudflare HTML challenges on `/game/*` or `/voice/*`: these routes include JSON and WebSocket traffic. Load the Turnstile script directly from `challenges.cloudflare.com`; allow that domain in a content blocker or a future CSP.

## During a raid

Sign in at `/admin`, then open **Town safety → Entry & raid controls**. Admin sign-in remains reachable even when guest entry is paused or the administrator's guest/network is banned.

- **Paused** stops new town admissions and new guest creation. Existing players remain connected.
- **Request fresh checks** asks every connected player to verify again within two minutes. Unverified connections are removed through the normal departure path; they can return after a new entry check. This is not a permanent ban. Players can finish a requested check while entry is paused.
- **Approved guests only** requires a saved guest ID on the approval list as well as a valid check. Find the guest by name in the search below, copy their ID, then approve it. New guests can create a verified profile and ask the host for approval. There are no reusable public invite codes.
- **Open** restores entry for everyone who passes verification and the existing safety checks. Removing an approval affects the guest's next admission; use a guest ban for immediate removal.

Entry mode, approvals and admin actions are persisted in migration `010_admission.sql`. Outstanding passes are in memory because this deployment runs one game process. A rollback must support migration 10; older binaries that accept only schema versions through 9 will refuse startup. Do not remove deployed migrations or restore player data merely to roll back application code.

## Verification and troubleshooting

`npm run test:admission` uses a disposable loopback PostgreSQL schema, real HTTP/game WebSockets and headless browser journeys. Only the challenge script and Siteverify provider are simulated, including duplicate rejection. It does not measure Cloudflare's ability to identify attackers. The fixture entry point is excluded from the production server build and refuses non-test/non-loopback databases. Unit tests exercise malformed tokens, hostname/action mismatch, outages, identity binding, reservation expiry, replay, admin persistence and recheck deadlines.

If the check fails, retry it; tokens are single-use and expire after five minutes. Check that the widget contains the hostname actually being visited and that the site/secret keys belong to the same widget. An unavailable script shows a retry action. A provider error refuses entry with a retry message. Never disable production verification to make an automated browser test pass.

References: [Cloudflare client rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/), [server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), and [testing guidance](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
