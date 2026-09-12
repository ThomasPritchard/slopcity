CREATE TABLE player_accounts (
 profile_id uuid PRIMARY KEY REFERENCES guest_profiles(id) ON DELETE CASCADE,
 email_normalized text NOT NULL UNIQUE,
 verified_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_challenges (
 id uuid PRIMARY KEY,
 token_digest text NOT NULL UNIQUE,
 purpose text NOT NULL CHECK (purpose IN ('upgrade','signin')),
 profile_id uuid NOT NULL REFERENCES guest_profiles(id) ON DELETE CASCADE,
 email_normalized text NOT NULL,
 initiating_credential_digest text,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((purpose='upgrade') = (initiating_credential_digest IS NOT NULL))
);
CREATE INDEX account_challenges_expiry ON account_challenges(expires_at);
