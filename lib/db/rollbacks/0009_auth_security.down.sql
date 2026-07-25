-- Rollback companion for drizzle/0009_famous_ma_gnuci.sql.
-- Never run against production without a verified backup, an application
-- rollback to a version that does not require these tables, and explicit
-- quality-gate approval. Dropping auth_sessions revokes every active session.

DROP TABLE IF EXISTS "auth_login_attempts";
--> statement-breakpoint
DROP TABLE IF EXISTS "auth_sessions";
