-- Additive migration under the existing exclusive game-runtime startup contract.
-- 011/012 belong to the independent accounts work and are not prerequisites.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE economy_ledger DROP CONSTRAINT economy_ledger_kind_check;
ALTER TABLE economy_ledger ADD CONSTRAINT economy_ledger_kind_check CHECK(kind IN (
 'grant','salary','purchase','casino_bet','casino_return','casino_refund',
 'poker_buyin','poker_cashout','gift_sent','gift_received','gift_recovery','gift_reset'
)) NOT VALID;
ALTER TABLE economy_ledger VALIDATE CONSTRAINT economy_ledger_kind_check;

CREATE TABLE credit_incidents (
 id uuid PRIMARY KEY,
 incident_key text NOT NULL UNIQUE,
 profile_id uuid NOT NULL REFERENCES economy_wallets(profile_id) ON DELETE CASCADE,
 rule text NOT NULL,
 detected_at timestamptz NOT NULL,
 activity_started_at timestamptz NOT NULL,
 activity_ended_at timestamptz NOT NULL CHECK(activity_ended_at>=activity_started_at),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 acknowledged_at timestamptz,
 balance_reset_to integer CHECK(balance_reset_to>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,profile_id)
);
CREATE INDEX credit_incidents_unread ON credit_incidents(profile_id,created_at) WHERE acknowledged_at IS NULL;

CREATE TABLE credit_recoveries (
 sender_id uuid NOT NULL,
 request_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 profile_id uuid NOT NULL,
 amount integer NOT NULL CHECK(amount BETWEEN 1 AND 1000),
 PRIMARY KEY(sender_id,request_id),
 FOREIGN KEY(sender_id,request_id) REFERENCES player_gifts(sender_id,request_id) ON DELETE CASCADE,
 FOREIGN KEY(incident_id,profile_id) REFERENCES credit_incidents(id,profile_id) ON DELETE CASCADE
);
CREATE INDEX credit_recoveries_recipient ON credit_recoveries(profile_id);
CREATE INDEX credit_recoveries_incident ON credit_recoveries(incident_id);

CREATE TABLE gift_restrictions (
 profile_id uuid PRIMARY KEY,
 incident_id uuid NOT NULL REFERENCES credit_incidents(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- The restriction key deliberately has no guest FK: enforcement already proves each
-- source through player_gifts, and must not lock unrelated senders' guest rows.
CREATE INDEX player_gifts_recipient_time ON player_gifts(target_id,created_at);
