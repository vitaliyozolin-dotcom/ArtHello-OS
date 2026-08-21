/**
 * P8.3 Migration: Create counterparty foundation tables.
 * Run: pnpm --filter @workspace/scripts run migrate-p83
 * Safe to re-run: uses CREATE TABLE IF NOT EXISTS.
 */
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("[P8.3 migration] Creating counterparties table…");
    await client.query(`
      CREATE TABLE IF NOT EXISTS counterparties (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        canonical_key     TEXT UNIQUE,
        display_name      TEXT,
        normalized_name   TEXT,
        inn               TEXT,
        kpp               TEXT,
        ogrn              TEXT,
        counterparty_type TEXT DEFAULT 'unknown',
        counterparty_role TEXT DEFAULT 'unknown',
        status            TEXT DEFAULT 'needs_review',
        confidence        TEXT DEFAULT 'low',
        source            TEXT DEFAULT 'bank_transactions',
        first_seen_at     DATE,
        last_seen_at      DATE,
        total_income      NUMERIC(15,2) DEFAULT 0,
        total_expense     NUMERIC(15,2) DEFAULT 0,
        operations_count  INTEGER DEFAULT 0,
        last_operation_id TEXT,
        risk_flags        JSONB DEFAULT '{}',
        notes             TEXT,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log("[P8.3 migration] Creating bank_transaction_counterparty_links table…");
    await client.query(`
      CREATE TABLE IF NOT EXISTS bank_transaction_counterparty_links (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bank_transaction_id   TEXT NOT NULL,
        counterparty_id       UUID NOT NULL,
        role                  TEXT DEFAULT 'unknown',
        match_method          TEXT DEFAULT 'inferred',
        confidence            TEXT DEFAULT 'low',
        created_at            TIMESTAMPTZ DEFAULT NOW(),
        updated_at            TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log("[P8.3 migration] Creating unique index on links…");
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_btcp_links_tx_cp_role
        ON bank_transaction_counterparty_links (bank_transaction_id, counterparty_id, role)
    `);

    console.log("[P8.3 migration] Creating counterparty_aliases table…");
    await client.query(`
      CREATE TABLE IF NOT EXISTS counterparty_aliases (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        counterparty_id UUID NOT NULL,
        alias_type      TEXT NOT NULL,
        alias_value     TEXT NOT NULL,
        source          TEXT DEFAULT 'bank_transactions',
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log("[P8.3 migration] Creating counterparty_duplicate_candidates table…");
    await client.query(`
      CREATE TABLE IF NOT EXISTS counterparty_duplicate_candidates (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        counterparty_a_id UUID NOT NULL,
        counterparty_b_id UUID NOT NULL,
        reason            TEXT NOT NULL,
        confidence        TEXT DEFAULT 'medium',
        severity          TEXT DEFAULT 'medium',
        status            TEXT DEFAULT 'open',
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query("COMMIT");
    console.log("[P8.3 migration] ✅ All tables created successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[P8.3 migration] ❌ Error:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
