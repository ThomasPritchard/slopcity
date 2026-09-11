-- Authorized one-time casino hotfix grant, 11 September 2026.
-- Run manually against the selected deployment with psql ON_ERROR_STOP enabled.
-- Credits every existing wallet; the operation key prevents duplicate grants.
-- This is not part of startup or the deployment helper.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE economy_wallets IN SHARE ROW EXCLUSIVE MODE;
WITH grants AS (
 INSERT INTO economy_ledger (profile_id, operation_key, kind, amount)
 SELECT profile_id, 'casino-hotfix:2026-09-11', 'grant', 1000
 FROM economy_wallets
 ON CONFLICT (profile_id, operation_key) DO NOTHING
 RETURNING profile_id, amount
), credited AS (
 UPDATE economy_wallets AS wallet
 SET balance = wallet.balance + grants.amount, revision = wallet.revision + 1
 FROM grants WHERE wallet.profile_id = grants.profile_id
 RETURNING grants.amount
)
SELECT count(*) AS reimbursed_players, coalesce(sum(amount), 0) AS credits_added FROM credited;
COMMIT;
