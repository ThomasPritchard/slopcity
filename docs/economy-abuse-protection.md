# Automatic gift-farming protection

12 September 2026. Approved policy integrated with the accounts and branding release (`9a18e2e`). The release includes the automatic rule, durable private notices and the configured historical correction importer.

## Automatic detection

All five conditions must hold for at least five distinct donor profiles and one recipient:

1. The donors were created within the same two-minute window.
2. Each qualifying gift was sent within 30 minutes of its donor's creation.
3. At that gift, the donor's recorded economic activity consisted only of grants, salary and outgoing gifts.
4. By that gift, the donor had sent at least 80% of its earned salary to that recipient.
5. The qualifying gifts occurred within the same two-minute window.

Sending 80–100% of salary or sending repeated gifts alone does not trigger enforcement. Names, IP addresses, balances and casino wins are not triggers. The rule uses authenticated profile IDs, persisted server timestamps and ledger records. Rejected requests and exact retries do not count as new gifts.

The production-history dry-run matched two coordinated groups, while excluding the legitimate friend gifts confirmed by the host. An isolated additional transfer is covered by the explicitly confirmed correction.

This policy detects tightly timed salary-farming groups. It can miss slower, older or more varied groups and does not establish common ownership. A recipient is not banned merely for receiving a gift.

## Deductions and resets

Detection runs inside the valid gift transaction. It reverses previously credited gifts from the matched donors to that recipient, including the triggering gift, and blocks those donor profile IDs from sending more gifts. Earlier gift responses remain historical receipts; replaying a reversed gift returns `reversed: true` without transferring it again. The triggering response also includes that flag.

Deduct the newly identified gift total from the recipient's current wallet:

- If the result is zero or greater, retain that result.
- If the result would be negative, reset the wallet to `STARTING_CREDITS` (currently 1,000). There is no outstanding debt and future income is credited normally.

The negative-result reset is Tom's approved replacement for deferred recovery. It affects the wallet at enforcement time; it does not revoke purchases or alter active poker stacks. The reset may increase a wallet already below 1,000. It does not grant salary gifting allowance.

Every reversed gift has one immutable `gift_recovery` ledger entry linked to its original sender/request IDs. A reset adds a separate `gift_reset` ledger adjustment, so the ledger still reconciles to the wallet. Wallet, evidence, restriction and notice writes commit together. Concurrency, retries and restarts cannot reverse a gift or reset a balance twice. Replaying the incident after acknowledgement leaves it acknowledged. New gifts can update the incident and require a new acknowledgement.

A short global gift transaction lock serializes gift enforcement before wallet locks. This fits the current single-runtime deployment contract; it is not a demonstrated large-scale throughput design.

## Shared recipient modal

Historical corrections and automatic triggers create the same private durable notice. It appears on the recipient's next world connection, after the changing room. The current world session is not interrupted by a new detection. Movement and other world interaction are paused while the native modal is open.

The title is **Suspicious gift activity**. It shows the actual gift activity date or date range in Europe/London, not the detection date. Ordinary deductions show the affected amount as credits removed. A reset prominently says:

> Your credits have been reset to the starting amount of 1,000 credits.

The reset explanation says that the deduction would have taken the balance below zero and that nothing remains to repay. The activity date, reset outcome and acknowledgement remain visible on short landscape layouts. The body can scroll.

`I understand` saves acknowledgement; it does not perform the deduction. Failed saves keep the dialog open. Lost responses safely retry. Revision checks prevent acknowledging new evidence using an older notice. Another player cannot read or acknowledge these notices. Escape cannot dismiss the warning.

## Confirmed historical corrections

The initial release includes two privately recorded cases: 98 gifts totalling 9,800 credits and 50 gifts totalling 5,000 credits. The 700 credits from friends explicitly confirmed as legitimate are excluded. Corrections use stable profile IDs; changes to display names cannot bypass them.

The private exact-gift manifest stays outside Git and public migrations. It records the recipient IDs and all 148 original gift IDs, with expected totals validated before any correction. Activity dates come from those gifts. Balances at deployment are authoritative; investigation balances are historical snapshots.

## Release integration

Migration 013 is additive and runs under the existing exclusive game-runtime startup lock, with a 3-second lock timeout and a 15-second statement timeout. It depends on the deployed social migration 006. Its local predecessor containing deferred recovery was never deployed and has been replaced before release.

All existing repository guards, including accounts and submission protection, accept migration 013 alongside 011 and 012. The account entry flow and pause state are preserved.

For a stop/start release with confirmed historical cases:

1. Verify the selected source revision and its CI checks.
2. Copy the private exact-gift manifest into the deployment's private configuration directory, readable by the game container user. Bind-mount it read-only at `/run/slop-city/credit-incidents.json` and set `CREDIT_INCIDENTS_FILE` to that container path.
3. Append the private incident Compose override to the existing configured Compose file list, retaining the tunnel and gateway overrides. Validate using `sh deploy/compose.sh config --quiet`; do not print expanded secrets.
4. Follow the existing deployment/backup procedure. Startup validates the complete incident file, then applies the corrections before opening the game listener. An invalid or missing configured file stops startup. Keeping a valid file mounted across restarts is safe.
5. Verify ledger reconciliation, exact correction totals, protected gifts, restrictions and private next-connection notices. Public HTTPS, WebSocket and voice checks retain their existing distinct scopes.

A maintenance entry point is also built into the game image: `node server/creditAbuseIncident.js` reads a manifest from stdin and defaults to read-only validation; `--apply` explicitly applies it. It does not initialize schemas, grant wallets or start another game runtime. The configured startup file is preferred for this release so both historical notices exist before the first post-deployment connection.

## Verification

- `node --env-file=<local development .env> --import tsx --test tests/*.test.ts`: 271 passed, no failures or skips, including concurrent enforcement, protected legitimate generosity, ledger reconciliation, rollback, replay, restart, notice ownership/revisions, negative-result reset, exact zero and later salary/poker cash-outs.
- `npm run build` and `npm run build:server`: passed. The client retains its existing bundle-size warning.
- Guest, economy and casino persistence regression scripts: passed against disposable local schemas.
- `scripts/credit-protection-browser-check.ts`: seven journeys passed using the real built React UI, game WebSocket and gift API against disposable loopback database schemas. Historical records and salary-eligible time are fixtures. Screenshots/results live under ignored `output/playwright/credit-protection/`.
- Headless desktop and emulated phone layouts do not establish physical-device performance. Deployment evidence is recorded separately for the selected release; local tests do not establish live production behaviour.
