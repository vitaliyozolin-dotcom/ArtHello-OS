ALTER TABLE users ADD COLUMN central_user_id text;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN identity_source text DEFAULT 'school_diary' NOT NULL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN central_access_version integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX users_central_user_id_unique ON users (central_user_id) WHERE central_user_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE central_access_events (
  id text PRIMARY KEY NOT NULL,
  action text NOT NULL,
  central_user_id text NOT NULL,
  payload text NOT NULL,
  status text DEFAULT 'received' NOT NULL,
  result text DEFAULT '{}' NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  processed_at text
);
--> statement-breakpoint
CREATE INDEX central_access_events_user_idx ON central_access_events (central_user_id, created_at);
