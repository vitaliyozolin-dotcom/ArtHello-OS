CREATE TABLE passwordless_challenges (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  identifier_hash text NOT NULL,
  channel text NOT NULL,
  code_hash text NOT NULL,
  magic_token_hash text NOT NULL,
  return_to text DEFAULT '/' NOT NULL,
  expires_at integer NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 5 NOT NULL,
  used_at integer,
  request_ip_hash text DEFAULT '' NOT NULL,
  created_at integer NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
--> statement-breakpoint
CREATE INDEX passwordless_challenges_identifier_idx
  ON passwordless_challenges (identifier_hash, created_at);
--> statement-breakpoint
CREATE INDEX passwordless_challenges_user_idx
  ON passwordless_challenges (user_id, created_at);
--> statement-breakpoint
CREATE INDEX passwordless_challenges_expiry_idx
  ON passwordless_challenges (expires_at, used_at);
