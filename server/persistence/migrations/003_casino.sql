ALTER TABLE economy_ledger DROP CONSTRAINT economy_ledger_kind_check;
ALTER TABLE economy_ledger ADD CONSTRAINT economy_ledger_kind_check CHECK(kind IN ('grant','salary','purchase','casino_bet','casino_return','casino_refund'));
CREATE TABLE casino_wagers (
 id uuid PRIMARY KEY,
 profile_id uuid NOT NULL REFERENCES economy_wallets(profile_id) ON DELETE CASCADE,
 request_id text NOT NULL,
 fingerprint text NOT NULL,
 room_id text NOT NULL,
 table_id text NOT NULL,
 game text NOT NULL CHECK(game IN ('roulette','blackjack','slots')),
 round_id text NOT NULL,
 stake integer NOT NULL CHECK(stake > 0 AND stake <= 100),
 details jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled','refunded')),
 returned integer CHECK(returned >= 0),
 outcome jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 UNIQUE(profile_id,request_id),
 CHECK((status='pending' AND returned IS NULL AND settled_at IS NULL) OR (status<>'pending' AND returned IS NOT NULL AND settled_at IS NOT NULL))
);
CREATE INDEX casino_wagers_pending ON casino_wagers(room_id) WHERE status='pending';
