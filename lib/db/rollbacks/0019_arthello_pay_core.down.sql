-- Rollback companion for 0019_arthello_pay_core.sql.
-- This removes only additive ArtHello Pay tables and does not mutate existing finance data.
DROP TABLE IF EXISTS "fiscal_receipts";
DROP TABLE IF EXISTS "payment_events";
DROP TABLE IF EXISTS "payment_requests";
DROP TABLE IF EXISTS "payment_obligations";
DROP TABLE IF EXISTS "payment_routes";
