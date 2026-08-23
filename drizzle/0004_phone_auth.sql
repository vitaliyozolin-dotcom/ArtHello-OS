ALTER TABLE users ADD COLUMN phone text;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN password_hash text;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN password_state text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN auth_version integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN failed_login_count integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN locked_until text;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN last_login_at text;
--> statement-breakpoint
CREATE UNIQUE INDEX users_phone_unique ON users (phone) WHERE phone IS NOT NULL;
--> statement-breakpoint
CREATE TABLE auth_sessions (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  token_hash text NOT NULL,
  auth_version integer NOT NULL,
  expires_at text NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX auth_sessions_token_hash_unique ON auth_sessions (token_hash);
--> statement-breakpoint
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);
--> statement-breakpoint
CREATE TABLE credential_tokens (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  token_hash text NOT NULL,
  purpose text NOT NULL,
  created_by_user_id text NOT NULL,
  expires_at text NOT NULL,
  used_at text,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX credential_tokens_token_hash_unique ON credential_tokens (token_hash);
--> statement-breakpoint
CREATE INDEX credential_tokens_user_id_idx ON credential_tokens (user_id);
