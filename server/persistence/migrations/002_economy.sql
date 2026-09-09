CREATE TABLE economy_wallets (
 profile_id uuid PRIMARY KEY REFERENCES guest_profiles(id) ON DELETE CASCADE,
 balance integer NOT NULL CHECK(balance >= 0), revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 salary_remainder integer NOT NULL DEFAULT 0 CHECK(salary_remainder >= 0 AND salary_remainder < 600000),
 salary_sequence integer NOT NULL DEFAULT 0 CHECK(salary_sequence >= 0),
 session_epoch uuid, session_checkpoint bigint NOT NULL DEFAULT 0 CHECK(session_checkpoint >= 0)
);
CREATE TABLE economy_ledger (
 profile_id uuid NOT NULL REFERENCES economy_wallets(profile_id) ON DELETE CASCADE,
 operation_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('grant','salary','purchase')),
 amount integer NOT NULL, item_id text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(profile_id,operation_key)
);
CREATE TABLE economy_owned (
 profile_id uuid NOT NULL REFERENCES economy_wallets(profile_id) ON DELETE CASCADE,
 item_id text NOT NULL, slot text NOT NULL CHECK(slot IN ('top','bottoms','shoes')),
 PRIMARY KEY(profile_id,item_id), UNIQUE(profile_id,item_id,slot)
);
CREATE TABLE economy_equipment (
 profile_id uuid NOT NULL, slot text NOT NULL CHECK(slot IN ('top','bottoms','shoes')), item_id text NOT NULL,
 PRIMARY KEY(profile_id,slot),
 FOREIGN KEY(profile_id,item_id,slot) REFERENCES economy_owned(profile_id,item_id,slot)
);
