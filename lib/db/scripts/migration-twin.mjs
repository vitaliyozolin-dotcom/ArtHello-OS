#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";

const DB_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(DB_ROOT, "..", "..");
const MIGRATIONS = path.join(DB_ROOT, "drizzle");
const ROLLBACKS = path.join(DB_ROOT, "rollbacks");
const JOURNAL = path.join(MIGRATIONS, "meta", "_journal.json");
const reportArg = process.argv.indexOf("--report");
const REPORT_PATH =
  reportArg >= 0 && process.argv[reportArg + 1]
    ? path.resolve(process.cwd(), process.argv[reportArg + 1])
    : path.join(REPO_ROOT, ".artifacts", "migration-twin.json");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("DATABASE_URL is required for Migration Twin.");

const quoteIdent = (value) => `"${String(value).replaceAll('"', '""')}"`;
const digest = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const journal = JSON.parse(await fs.readFile(JOURNAL, "utf8"));
const tags = journal.entries.map((entry) => entry.tag);
const latest = tags.at(-1);
if (!latest) throw new Error("No migrations found in Drizzle journal.");
const rollbackPath = path.join(ROLLBACKS, `${latest}.down.sql`);
await fs.access(rollbackPath).catch(() => {
  throw new Error(
    `Rollback pair missing for latest migration: ${latest}.down.sql`,
  );
});

const baseUrl = new URL(databaseUrl);
const targetDb = baseUrl.pathname.slice(1);
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const twinDb = `arthello_twin_${process.pid}_${Date.now()}`.replace(
  /[^a-zA-Z0-9_]/g,
  "_",
);
const twinUrl = new URL(databaseUrl);
twinUrl.pathname = `/${twinDb}`;
const admin = new Client({ connectionString: adminUrl.toString() });
let db;
let adminConnected = false;
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  engine: "ArtHello Database Migration Twin",
  source_database: targetDb,
  twin_database: twinDb,
  latest_migration: latest,
  stages: [],
  failures: [],
};

async function schemaSnapshot(client) {
  const { rows } = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, COALESCE(column_default, '') AS column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name NOT LIKE '\\_migration\\_twin\\_%' ESCAPE '\\'
    ORDER BY table_name, column_name
  `);
  const constraints = await client.query(`
    SELECT conrelid::regclass::text AS table_name, conname, contype, pg_get_constraintdef(oid, true) AS definition
    FROM pg_constraint
    WHERE connamespace='public'::regnamespace AND conrelid::regclass::text NOT LIKE '_migration_twin_%'
    ORDER BY table_name, conname
  `);
  const indexes = await client.query(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname='public' AND tablename NOT LIKE '_migration_twin_%'
    ORDER BY tablename, indexname
  `);
  const value = {
    columns: rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
  };
  return { digest: digest(value), value };
}

function firstSchemaDifference(before, after) {
  for (const section of ["columns", "constraints", "indexes"]) {
    const beforeRows = before[section];
    const afterRows = after[section];
    const length = Math.max(beforeRows.length, afterRows.length);
    for (let index = 0; index < length; index += 1) {
      if (
        JSON.stringify(beforeRows[index]) !== JSON.stringify(afterRows[index])
      ) {
        return {
          section,
          index,
          before: beforeRows[index] ?? null,
          after: afterRows[index] ?? null,
        };
      }
    }
  }
  return null;
}

async function fkOrphans(client) {
  const { rows: fks } = await client.query(`
    SELECT conname,
      conrelid::regclass::text AS child_table,
      confrelid::regclass::text AS parent_table,
      ARRAY(
        SELECT a.attname
        FROM unnest(conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid=conrelid AND a.attnum=k.attnum
        ORDER BY k.ord
      )::text[] AS child_cols,
      ARRAY(
        SELECT a.attname
        FROM unnest(confkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid=confrelid AND a.attnum=k.attnum
        ORDER BY k.ord
      )::text[] AS parent_cols
    FROM pg_constraint
    WHERE contype='f' AND connamespace='public'::regnamespace
    ORDER BY conname
  `);
  const details = [];
  let total = 0;
  for (const fk of fks) {
    const child = fk.child_table.split(".").map(quoteIdent).join(".");
    const parent = fk.parent_table.split(".").map(quoteIdent).join(".");
    const joins = fk.child_cols
      .map(
        (col, i) => `p.${quoteIdent(fk.parent_cols[i])}=c.${quoteIdent(col)}`,
      )
      .join(" AND ");
    const present = fk.child_cols
      .map((col) => `c.${quoteIdent(col)} IS NOT NULL`)
      .join(" AND ");
    const { rows } = await client.query(
      `SELECT count(*)::int AS count FROM ${child} c WHERE ${present} AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE ${joins})`,
    );
    const count = rows[0].count;
    total += count;
    if (count)
      details.push({
        constraint: fk.conname,
        child_table: fk.child_table,
        parent_table: fk.parent_table,
        count,
      });
  }
  return { total, details, constraints_checked: fks.length };
}

async function applySql(client, filename) {
  const sql = await fs.readFile(filename, "utf8");
  await client.query(sql.replaceAll("--> statement-breakpoint", ""));
}

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE DATABASE ${quoteIdent(twinDb)}`);
  report.stages.push({ stage: "CREATE_TWIN", status: "OK" });

  db = new Client({ connectionString: twinUrl.toString() });
  await db.connect();
  const securityStart = tags.indexOf("0009_famous_ma_gnuci");
  const securityScope = tags.indexOf("0010_outstanding_cargill");
  if (securityStart !== 9 || securityScope !== 10) {
    throw new Error(
      "Security migration order 0009/0010 no longer matches the approved journal.",
    );
  }

  for (const tag of tags.slice(0, securityStart)) {
    await applySql(db, path.join(MIGRATIONS, `${tag}.sql`));
  }
  await applySql(db, path.join(MIGRATIONS, `${tags[securityStart]}.sql`));
  await db.query(`
    INSERT INTO auth_login_attempts (key_hash, attempts) VALUES ('synthetic-login-key', 2);
    INSERT INTO auth_sessions (token_hash, role, display_name, csrf_hash, expires_at)
    VALUES
      ('synthetic-owner', 'owner', 'Synthetic Owner', 'csrf-owner', NOW() + INTERVAL '1 hour'),
      ('synthetic-accountant', 'accountant', 'Synthetic Accountant', 'csrf-accountant', NOW() + INTERVAL '1 hour'),
      ('synthetic-viewer', 'viewer', 'Synthetic Viewer', 'csrf-viewer', NOW() + INTERVAL '1 hour');
  `);
  await applySql(db, path.join(MIGRATIONS, `${tags[securityScope]}.sql`));

  const securityRows = await db.query(`
    SELECT role, scope_mode, branch_ids, legal_entity_ids, revoked_at IS NOT NULL AS revoked
    FROM auth_sessions ORDER BY role
  `);
  const expectedSecurityRows = [
    {
      role: "accountant",
      scope_mode: "restricted",
      branch_ids: [],
      legal_entity_ids: [],
      revoked: true,
    },
    {
      role: "owner",
      scope_mode: "unrestricted",
      branch_ids: [],
      legal_entity_ids: [],
      revoked: false,
    },
    {
      role: "viewer",
      scope_mode: "restricted",
      branch_ids: [],
      legal_entity_ids: [],
      revoked: true,
    },
  ];
  if (
    JSON.stringify(securityRows.rows) !== JSON.stringify(expectedSecurityRows)
  ) {
    throw new Error(
      `Security scope/revocation migration mismatch: ${JSON.stringify(securityRows.rows)}`,
    );
  }
  await db.query(`
    INSERT INTO security_access_audit
      (session_fingerprint, role, method, path, decision, policy, branch_ids, legal_entity_ids, request_id)
    VALUES
      ('synthetic-fingerprint', 'owner', 'GET', '/synthetic', 'allow', 'migration-twin', '[]', '[]', 'synthetic-request')
  `);
  const afterSecurity = await schemaSnapshot(db);
  report.stages.push({
    stage: "SECURITY_0009_0010_APPLY_WITH_REPRESENTATIVE_DATA",
    status: "OK",
    sessions: securityRows.rows.length,
    owner_unrestricted: true,
    non_owner_revoked: 2,
    audit_rows: 1,
  });

  await applySql(db, path.join(ROLLBACKS, "0010_auth_scope_audit.down.sql"));
  const rollbackState = await db.query(`
    SELECT
      (SELECT count(*)::int FROM auth_sessions) AS sessions,
      (SELECT count(*)::int FROM auth_sessions WHERE role <> 'owner' AND revoked_at IS NOT NULL) AS revoked_non_owner,
      to_regclass('public.security_access_audit') IS NULL AS audit_removed,
      NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='auth_sessions'
          AND column_name IN ('scope_mode', 'branch_ids', 'legal_entity_ids')
      ) AS scope_columns_removed
  `);
  if (
    JSON.stringify(rollbackState.rows[0]) !==
    JSON.stringify({
      sessions: 3,
      revoked_non_owner: 2,
      audit_removed: true,
      scope_columns_removed: true,
    })
  ) {
    throw new Error(
      `0010 rollback data contract mismatch: ${JSON.stringify(rollbackState.rows[0])}`,
    );
  }
  await applySql(db, path.join(MIGRATIONS, `${tags[securityScope]}.sql`));
  const securityRoundtrip = await schemaSnapshot(db);
  if (securityRoundtrip.digest !== afterSecurity.digest) {
    throw new Error(
      `0010 schema roundtrip mismatch: before=${afterSecurity.digest} after=${securityRoundtrip.digest}`,
    );
  }
  report.stages.push({
    stage: "SECURITY_0010_ROLLBACK_REAPPLY",
    status: "OK",
    sessions_preserved: 3,
    revoked_sessions_not_restored: 2,
    schema_roundtrip_equal: true,
  });

  await applySql(db, path.join(ROLLBACKS, "0010_auth_scope_audit.down.sql"));
  await applySql(db, path.join(ROLLBACKS, "0009_auth_security.down.sql"));
  const destructiveRollback = await db.query(`
    SELECT to_regclass('public.auth_sessions') IS NULL AS sessions_removed,
           to_regclass('public.auth_login_attempts') IS NULL AS attempts_removed
  `);
  if (
    !destructiveRollback.rows[0].sessions_removed ||
    !destructiveRollback.rows[0].attempts_removed
  ) {
    throw new Error("0009 rollback did not remove its auth tables.");
  }
  await applySql(db, path.join(MIGRATIONS, `${tags[securityStart]}.sql`));
  await applySql(db, path.join(MIGRATIONS, `${tags[securityScope]}.sql`));
  const securityCleanReapply = await schemaSnapshot(db);
  if (securityCleanReapply.digest !== afterSecurity.digest) {
    throw new Error(
      `0009/0010 clean reapply mismatch: before=${afterSecurity.digest} after=${securityCleanReapply.digest}`,
    );
  }
  report.stages.push({
    stage: "SECURITY_0009_0010_DESTRUCTIVE_ROLLBACK_REAPPLY",
    status: "OK",
    auth_data_loss_acknowledged: true,
    schema_roundtrip_equal: true,
  });

  for (const tag of tags.slice(securityScope + 1)) {
    await applySql(db, path.join(MIGRATIONS, `${tag}.sql`));
  }
  report.stages.push({
    stage: "APPLY_ALL",
    status: "OK",
    migrations: tags.length,
  });

  await db.query(
    "CREATE TABLE _migration_twin_parent (id text PRIMARY KEY, payload jsonb NOT NULL)",
  );
  await db.query(
    "CREATE TABLE _migration_twin_child (id text PRIMARY KEY, parent_id text NOT NULL REFERENCES _migration_twin_parent(id), payload jsonb NOT NULL)",
  );
  await db.query(
    `INSERT INTO _migration_twin_parent VALUES ('parent-1', '{"kind":"backup-probe"}')`,
  );
  await db.query(
    `INSERT INTO _migration_twin_child VALUES ('child-1', 'parent-1', '{"kind":"relation-probe"}')`,
  );

  const beforeRows = await db.query(`
    SELECT
      (SELECT count(*)::int FROM _migration_twin_parent) AS parents,
      (SELECT count(*)::int FROM _migration_twin_child) AS children
  `);
  const fullBefore = await schemaSnapshot(db);
  const orphansBefore = await fkOrphans(db);
  if (orphansBefore.total !== 0)
    throw new Error(
      `FK orphan invariant failed before rollback: ${orphansBefore.total}`,
    );
  report.stages.push({
    stage: "BACKUP_MANIFEST",
    status: "OK",
    schema_digest: fullBefore.digest,
    probe_rows: beforeRows.rows[0],
    fk_constraints_checked: orphansBefore.constraints_checked,
  });

  await applySql(db, rollbackPath);
  const afterRollback = await schemaSnapshot(db);
  if (afterRollback.digest === fullBefore.digest)
    throw new Error(`Rollback ${latest} produced no structural change.`);
  report.stages.push({
    stage: "ROLLBACK_LATEST",
    status: "OK",
    migration: latest,
    schema_digest: afterRollback.digest,
  });

  await applySql(db, path.join(MIGRATIONS, `${latest}.sql`));
  const fullAfter = await schemaSnapshot(db);
  if (fullAfter.digest !== fullBefore.digest) {
    const difference = firstSchemaDifference(fullBefore.value, fullAfter.value);
    throw new Error(
      `Schema digest mismatch after reapply: before=${fullBefore.digest} after=${fullAfter.digest} first_difference=${JSON.stringify(difference)}`,
    );
  }
  const afterRows = await db.query(`
    SELECT
      (SELECT count(*)::int FROM _migration_twin_parent) AS parents,
      (SELECT count(*)::int FROM _migration_twin_child) AS children
  `);
  if (
    JSON.stringify(afterRows.rows[0]) !== JSON.stringify(beforeRows.rows[0])
  ) {
    throw new Error("Probe row counts changed across rollback/reapply.");
  }
  const orphansAfter = await fkOrphans(db);
  if (orphansAfter.total !== 0)
    throw new Error(
      `FK orphan invariant failed after reapply: ${orphansAfter.total}`,
    );
  report.stages.push({
    stage: "REAPPLY_AND_VERIFY",
    status: "OK",
    schema_digest: fullAfter.digest,
    probe_rows: afterRows.rows[0],
    fk_constraints_checked: orphansAfter.constraints_checked,
    orphan_count: 0,
  });
  report.summary = {
    status: "PROVED",
    migrations_applied: tags.length,
    latest_rollback_tested: latest,
    schema_roundtrip_equal: true,
    probe_data_preserved: true,
    fk_orphans: 0,
  };
} catch (error) {
  report.failures.push({
    message: error instanceof Error ? error.message : String(error),
  });
  report.summary = { status: "FAILED" };
  process.exitCode = 1;
} finally {
  if (db) await db.end().catch(() => {});
  if (adminConnected) {
    await admin
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
        [twinDb],
      )
      .catch(() => {});
    await admin
      .query(`DROP DATABASE IF EXISTS ${quoteIdent(twinDb)}`)
      .catch(() => {});
    await admin.end().catch(() => {});
  }
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
}

if (process.exitCode)
  console.error(`Migration Twin: FAILED. Report: ${REPORT_PATH}`);
else
  console.log(
    `Migration Twin: PROVED ${tags.length} migrations; rollback/reapply ${latest}; FK orphans=0.`,
  );
