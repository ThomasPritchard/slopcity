ALTER TABLE economy_ledger DROP CONSTRAINT economy_ledger_kind_check;
ALTER TABLE economy_ledger ADD CONSTRAINT economy_ledger_kind_check CHECK(kind IN ('grant','salary','purchase','casino_bet','casino_return','casino_refund','poker_buyin','poker_cashout'));

CREATE TABLE poker_seats (
 id uuid PRIMARY KEY,
 profile_id uuid NOT NULL REFERENCES economy_wallets(profile_id) ON DELETE CASCADE,
 room_id text NOT NULL,
 table_id text NOT NULL CHECK(table_id='poker-1'),
 seat integer NOT NULL CHECK(seat BETWEEN 0 AND 5),
 stack integer NOT NULL CHECK(stack>=0),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 active_hand_id uuid,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz,
 CHECK((status='open' AND closed_at IS NULL) OR (status='closed' AND closed_at IS NOT NULL AND active_hand_id IS NULL))
);
CREATE UNIQUE INDEX poker_profile_open ON poker_seats(profile_id) WHERE status='open';
CREATE UNIQUE INDEX poker_seat_open ON poker_seats(room_id,table_id,seat) WHERE status='open';
CREATE TABLE poker_requests (
 profile_id uuid NOT NULL REFERENCES economy_wallets(profile_id) ON DELETE CASCADE,
 request_id text NOT NULL,
 fingerprint text NOT NULL,
 escrow_id uuid NOT NULL REFERENCES poker_seats(id),
 PRIMARY KEY(profile_id,request_id)
);
CREATE TABLE poker_hands (
 id uuid PRIMARY KEY,
 room_id text NOT NULL,
 table_id text NOT NULL CHECK(table_id='poker-1'),
 roster jsonb NOT NULL,
 start_fingerprint text NOT NULL,
 allocations jsonb,
 settlement_fingerprint text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 CHECK((status='pending' AND settled_at IS NULL AND allocations IS NULL) OR (status='cancelled' AND settled_at IS NOT NULL AND allocations IS NULL) OR (status='settled' AND settled_at IS NOT NULL AND allocations IS NOT NULL AND settlement_fingerprint IS NOT NULL))
);
ALTER TABLE poker_seats ADD CONSTRAINT poker_active_hand FOREIGN KEY(active_hand_id) REFERENCES poker_hands(id);
CREATE UNIQUE INDEX poker_hand_pending ON poker_hands(room_id,table_id) WHERE status='pending';
