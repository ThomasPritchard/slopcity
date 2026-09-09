CREATE TABLE guest_profiles (
 id uuid PRIMARY KEY, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
 shirt integer NOT NULL CHECK (shirt BETWEEN 0 AND 5), skin integer NOT NULL CHECK (skin BETWEEN 0 AND 4),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE guest_credentials (
 credential_hash text PRIMARY KEY CHECK (credential_hash ~ '^[a-f0-9]{64}$'),
 profile_id uuid NOT NULL REFERENCES guest_profiles(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days')
);
CREATE TABLE guest_blocks (
 owner_id uuid NOT NULL REFERENCES guest_profiles(id) ON DELETE CASCADE,
 target_id uuid NOT NULL REFERENCES guest_profiles(id) ON DELETE CASCADE,
 PRIMARY KEY (owner_id,target_id), CHECK (owner_id <> target_id)
);
