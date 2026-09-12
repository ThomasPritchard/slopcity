# Email accounts and submission protection

Approved direction, 12 September 2026. Implemented locally; deployment and real provider acceptance remain separate.

## Agreed direction

- Keep guest play and offer an optional upgrade to an email account.
- Upgrade the existing player profile, retaining its ID, credits, wardrobe, friendships, moderation history and existing image ownership. Never create a second starting-credit grant during conversion.
- Only authenticated accounts with verified email addresses may make player submissions. A guest session alone is insufficient. This replaces the proposed approved-uploader list.
- Require a fresh server-validated verification challenge for each upload, including registered users. Existing image review remains mandatory before publication.
- Fix quota charging so requests rejected by guest/network limits do not consume the shared upload allowance.
- Provide manual submission pause plus automatic protection with explicit reasons and recovery behaviour.

## Account flow

Both guests and registered players use authenticated, opaque HttpOnly sessions. The server derives account status from persisted identity records linked to the profile; a client flag, display name or session's mere existence never establishes membership.

When a returning guest clicks **Join the square**, one panel offers an optional email account alongside the inline Cloudflare check. **Save and join** sends a verification link and proceeds into town; **Not yet** proceeds without sending email. Both choices use one server-validated `account_entry` challenge for the combined operation. There is no second entry-check dialog or email-sent confirmation step. Email verification can be completed later, and email delivery failures or sending limits do not block an otherwise valid entry. Closing the dialog or pressing Escape cancels joining.

The offer appears on every returning guest connection, including reconnects and connection retries, until the account is verified. A newly created guest skips it for their first connection and receives it on later reconnects. Verified accounts skip the offer. The guest welcome screen has no separate save-progress button. Players can also open their account from in-town Settings; sign-in remains available on the welcome screen when no profile is active.

The combined operation shares the existing email quotas and issues the existing credential-bound admission grant. A bounded five-minute, process-local request receipt coalesces concurrent/retried requests without sending another email or revalidating a consumed Cloudflare token. Reusing the request ID with different choices is rejected; replaying it cannot mint a second consumed or invalidated admission. Account status, bans and entry controls are checked again after verification and delivery. Standalone email requests and each image upload retain their separate action-specific checks.

From the existing guest profile, the player chooses to save their progress to an email account. The email must be verified before enabling member-only capabilities. Conversion requires proof of both the current guest credential and email ownership, is atomic and retry-safe, and rotates the session credential. Existing profile bans and other restrictions continue to apply after conversion and on later sign-ins.

One verified email belongs to one account/profile. If that email already belongs to another profile, offer sign-in to the existing account with an explicit profile-switch confirmation. Do not merge wallets or replace the current guest silently. Starting verification, opening a link in another browser and email-link scanners must not independently attach an email to an unrelated guest. Expired, reused or cancelled verification requests fail without changing profile ownership.

Email addresses and authentication tokens stay out of public player state, leaderboards, logs and game messages. Use generic registration/recovery responses and rate limits to avoid account enumeration and email flooding. Store only token digests; enforce expiry and single use transactionally. Preserve the existing one-active-town-session policy for an account used on multiple devices.

Sign-in uses passwordless email links delivered through Resend. Links expire after 15 minutes and carry their token in a URL fragment, removed before rendering. Opening the link only inspects it; confirmation is an explicit POST. Upgrades require the original guest browser. Signing in rotates credentials and disconnects existing town connections for that profile. A failed or lost confirmation response can be recovered by requesting a new sign-in link. Development uses a private local outbox and does not prove live email delivery.

## Upload eligibility and quotas

Authorise on the server before image processing: enforce bans, resolve the session, require a verified account, enforce pause/cooldown state and individual/network quotas, then verify the upload challenge. Use a distinct Turnstile action such as `community_upload`, validate its hostname/action server-side, and reject expired or reused tokens. The town-entry challenge is not an upload grant. Reject requests when verification is unavailable; distinguish that condition from detected spam.

Retain existing bounded image decoding, supported still-image formats, size limits, pending-per-player cap, site-wide pending cap and persisted daily quotas. Group IPv6 network quotas by /64 consistently with the existing safety layer. Distinguish limits on attempted work from counts of successfully retained submissions. Rejected per-player/network traffic must not spend the shared work allowance.

An upload request ID makes legitimate retries idempotent for 30 days. The server returns the original completed outcome without another upload; reusing that ID with different content is rejected. Temporary limit responses do not reserve the ID. Duplicate-content detection should use the normalised image digest; exact retry replays are not abuse signals. Admin uploads should also require the upload challenge. Authenticated administration and moderation stay available during pauses; the admin's direct upload path can remain available within the existing storage caps.

## Automatic protection criteria

These are centralised starting thresholds in `shared/submissionProtection.ts` for the current small audience, not measured production capacity or proof of malicious intent.

| Scope | Trigger | Action and recovery |
| --- | --- | --- |
| Individual account | Five distinct invalid or duplicate upload attempts in two minutes | Fifteen-minute upload cooldown for that account. Ordinary request retries do not count. |
| Network | Ten such attempts in two minutes | Fifteen-minute network upload cooldown, with IPv6 addresses grouped by /64. |
| Multiple-source abuse | Twenty qualifying attempts in two minutes, spanning at least five verified accounts and three networks | Pause player submissions for ten minutes. Then allow at most two admitted upload attempts per minute for five minutes before returning to normal. A fresh qualifying incident during this trial restarts the ten-minute pause. |
| Review backlog | Pending queue reaches 65 of its 75-image hard cap | Pause player submissions until moderation reduces pending images to 50 or fewer. Time alone cannot clear a full queue. |

For the multiple-source trigger, count only authenticated, email-verified accounts whose upload challenge succeeded and whose request was admitted through individual/network limits. Count each request once. Anonymous requests, guests, failed/replayed challenges, requests from already-cooled sources, routine quota rejections, provider outages and requests received while paused do not trigger or extend a global pause. This prevents a single source from keeping submissions closed merely by hammering a rejected endpoint. The review-backlog rule also bounds campaigns using valid, distinct images that cannot be confidently classified as spam.

Persist pause reason, expiry and transition history so a restart does not reopen submissions prematurely. At expiry, recheck backlog before reopening; if there are multiple active reasons, all must clear. Keep detection windows bounded and transitions atomic. A manual pause has no automatic expiry. The review desk shows the reason, countdown or backlog condition, affected scope, recent transitions, and controls to pause, resume or clear an account cooldown. Do not automatically issue permanent bans from these signals.

## Verification required before release

- Conversion preserves every profile-owned record and never grants starting credits twice, including concurrent/replayed confirmations.
- Existing-email collisions, cross-browser confirmation, expired/reused tokens, logout, credential rotation, recovery and bans cannot switch or claim another profile.
- Guests and unverified accounts cannot submit through the API; verified accounts still require a valid upload challenge.
- Existing single-source regressions preserve other users' shared quota; the global cap still limits independently admitted traffic.
- Fake-clock tests cover threshold boundaries, independent source counting, excluded signals, cooldown expiry, manual pause precedence, backlog hysteresis and restart behaviour.
- Database tests prove atomic conversion, uniqueness, token use, idempotent upload writes and persisted pause state in an isolated local schema.
- Headless browser journeys cover guest upgrade, registration/sign-in, verified upload, challenge expiry/retry and review-desk pause states in portrait and short landscape.
- Verify actual email delivery and a real production challenge separately from local fixtures before claiming live readiness. Preserve the existing production gateway IP block during any later authorised release.

References: [Cloudflare server-side challenge validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [OWASP email verification](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html).

## Resend setup

1. Verify a sending domain in the Resend dashboard and apply the DNS records it supplies. Disable click/open tracking for authentication emails.
2. Create a sending API key and keep it server-side in the private production `.deploy/game.env`. Never put it in a `VITE_` variable or commit it. Configure:

   ```dotenv
   ACCOUNT_EMAIL_MODE=resend
   ACCOUNT_EMAIL_FROM=Slop City <accounts@your-verified-domain>
   RESEND_API_KEY=your-private-sending-key
   APP_ORIGIN=https://slopcity.fun
   ```

3. Use the existing real Turnstile key pair for `account_entry`, `account_email`, `community_upload` and `town_entry` actions. The server validates action and hostname separately on each request.
4. Deploy only when authorised, preserving the existing gateway IP block. Verify a real delivered link, upgrade, fresh-browser sign-in and fresh upload challenge before calling email accounts live-ready.

Without explicit configuration, production email delivery stays disabled and guest play remains available. Local development defaults to `ACCOUNT_EMAIL_MODE=outbox`; messages are stored under ignored `.local/account-mail` with directory mode 0700 and file mode 0600, retaining at most 100 messages. This mode is forbidden in production and with public origins. Use `ACCOUNT_EMAIL_MODE=disabled` to disable local account email too. No email content or tokens are logged.

The adapter uses Resend's HTTPS endpoint with a 10-second timeout and the challenge UUID as the idempotency key. Failed delivery invalidates its link; the player requests a new one. Email requests require a fresh challenge, are limited to three per address/profile and ten per network in 15 minutes, then 100 shared attempts per hour. Network attempts are charged before verification; recipient/profile and shared sending quotas are charged only after a successful challenge. Non-consuming prechecks reject already-exhausted recipient/profile quotas before provider work, and the quotas are checked again when charged so concurrent requests cannot exceed them. Failed checks and provider outages cannot spend another recipient's sending allowance. This ordering applies to both standalone email requests and the combined save-and-join flow. These counters are bounded process-local protection and reset on server restart; provider account sending limits remain relevant. Persisted upload daily quotas, cooldowns, pauses and completed request receipts survive restart.

Additive migrations 011 and 012 introduce accounts and upload protection. All repository version guards accept the new schema. The migration follows the existing one-process ownership/startup contract, with a five-second lock timeout. This is not a rolling mixed-version deployment.

Local verification command:

```sh
npm run build
node --env-file=.env --import tsx scripts/accounts-browser-check.ts
```

It creates and deletes an isolated loopback PostgreSQL schema and a private temporary outbox. It uses the real React UI and API, with fixture Turnstile responses and no external emails. Screenshots and the result are under ignored `output/playwright/accounts/`.

Provider references: [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Community browser fixture

The existing `scripts/community-ui-check.ts` upload journey now requires an email-verified fixture account. Its private `COMMUNITY_ACCESS_FILE` JSON must contain `origin`, `password` (the disposable town’s admin password), and `memberCookie` (the opaque value of that verified profile’s `slop_guest` cookie, without the cookie name). All credentials must belong to the same isolated `http://localhost` origin used by `GAME_URL`. Keep this file in ignored private state and do not print or commit it.

Before navigating, the script installs that cookie at `/game` and checks the real account endpoint reports `kind: member`. Missing or invalid fixture credentials stop setup. Verification must be disabled in this disposable local fixture; an enabled or missing verification configuration stops the script rather than bypassing a challenge. This journey proves the verified fixture’s upload and review flow, not account conversion or live email/challenge delivery. `scripts/accounts-browser-check.ts` separately covers conversion through the local outbox; real providers need their own acceptance check.
