CREATE TABLE community_images (
 id uuid PRIMARY KEY, owner_id uuid REFERENCES guest_profiles(id) ON DELETE SET NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100), credit text NOT NULL CHECK(length(credit)<=80),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 image bytea NOT NULL CHECK(octet_length(image)<=1048576), width integer NOT NULL CHECK(width BETWEEN 1 AND 1920), height integer NOT NULL CHECK(height BETWEEN 1 AND 1080),
 featured boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), moderated_at timestamptz
);
CREATE INDEX community_images_owner ON community_images(owner_id,created_at);
CREATE TABLE community_submission_days (day date NOT NULL, owner_key text NOT NULL, count integer NOT NULL, PRIMARY KEY(day,owner_key));
CREATE TABLE community_programme (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision integer NOT NULL DEFAULT 1, epoch timestamptz NOT NULL DEFAULT now(),
 mode text NOT NULL DEFAULT 'intermission' CHECK(mode IN ('intermission','live')), platform text NOT NULL DEFAULT 'twitch' CHECK(platform IN ('twitch','youtube')),
 twitch_channel text NOT NULL DEFAULT 'bridgemindai', youtube_video_id text NOT NULL DEFAULT '', schedule jsonb NOT NULL DEFAULT '[]'
);
INSERT INTO community_programme(singleton) VALUES(true);
CREATE TABLE community_moderation (id bigserial PRIMARY KEY,image_id uuid NOT NULL, action text NOT NULL, decided_at timestamptz NOT NULL DEFAULT now());
