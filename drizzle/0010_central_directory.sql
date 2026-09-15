CREATE TABLE central_directory_links (
  kind TEXT NOT NULL,
  central_id TEXT NOT NULL,
  local_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(kind, central_id),
  UNIQUE(kind, local_id)
);
--> statement-breakpoint
CREATE TABLE central_directory_state (
  id TEXT PRIMARY KEY NOT NULL,
  sequence INTEGER NOT NULL,
  digest TEXT NOT NULL
);
