ALTER TABLE community_programme ADD COLUMN submission_protection jsonb;
ALTER TABLE community_images ADD COLUMN image_digest text;
UPDATE community_images SET image_digest=encode(sha256(image),'hex');
CREATE INDEX community_images_owner_digest ON community_images ((COALESCE(owner_id::text,'admin')), image_digest) WHERE image_digest IS NOT NULL;
CREATE TABLE community_upload_receipts (
 owner_key text NOT NULL,
 request_id text NOT NULL,
 payload_hash text NOT NULL,
 status integer NOT NULL,
 body jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_key,request_id)
);
CREATE INDEX community_upload_receipts_created ON community_upload_receipts(created_at);
