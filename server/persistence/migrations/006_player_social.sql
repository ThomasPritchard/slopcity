ALTER TABLE economy_wallets ADD COLUMN gifting_allowance integer NOT NULL DEFAULT 0 CHECK(gifting_allowance>=0);
ALTER TABLE economy_ledger DROP CONSTRAINT economy_ledger_kind_check;
ALTER TABLE economy_ledger ADD CONSTRAINT economy_ledger_kind_check CHECK(kind IN ('grant','salary','purchase','casino_bet','casino_return','casino_refund','poker_buyin','poker_cashout','gift_sent','gift_received'));
CREATE TABLE player_friendships (
 low_id uuid NOT NULL REFERENCES guest_profiles(id) ON DELETE CASCADE,
 high_id uuid NOT NULL REFERENCES guest_profiles(id) ON DELETE CASCADE,
 requester_id uuid NOT NULL REFERENCES guest_profiles(id) ON DELETE CASCADE,
 accepted boolean NOT NULL DEFAULT false,
 PRIMARY KEY(low_id,high_id), CHECK(low_id<high_id), CHECK(requester_id IN(low_id,high_id))
);
CREATE TABLE player_gifts (
 sender_id uuid NOT NULL REFERENCES guest_profiles(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, target_id uuid NOT NULL REFERENCES guest_profiles(id),
 amount integer NOT NULL CHECK(amount BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(sender_id,request_id), CHECK(sender_id<>target_id)
);
CREATE FUNCTION grant_salary_gifting_allowance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='salary' THEN
  UPDATE economy_wallets SET gifting_allowance=gifting_allowance+NEW.amount WHERE profile_id=NEW.profile_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER salary_gifting_allowance AFTER INSERT ON economy_ledger FOR EACH ROW EXECUTE FUNCTION grant_salary_gifting_allowance();
