CREATE TABLE town_admission (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 mode text NOT NULL DEFAULT 'open' CHECK (mode IN ('open','paused','approved'))
);
INSERT INTO town_admission(singleton) VALUES(true);
CREATE TABLE town_approved_guests (
 profile_id uuid PRIMARY KEY REFERENCES guest_profiles(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE town_admission_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 action text NOT NULL CHECK (action IN ('mode','approve','revoke','reverify')),
 target text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
