CREATE TABLE safety_bans (
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('ip','guest')),
 target text NOT NULL,
 reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 240),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz,
 revoked_at timestamptz
);
CREATE INDEX safety_bans_active ON safety_bans(kind,target) WHERE revoked_at IS NULL;
CREATE TABLE safety_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 ban_id uuid NOT NULL REFERENCES safety_bans(id),
 action text NOT NULL CHECK (action IN ('ban','unban')),
 created_at timestamptz NOT NULL DEFAULT now()
);
