import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeChangeLog,
  normalizeCustomerTariff,
  normalizeLead,
  normalizeReferenceRecord,
} from "../src/import-alfacrm-sandbox.ts";
import { requireExplicitAlfaProvenance } from "../../lib/db/src/schema/alfa-provenance.ts";
import {
  createBatch,
  createRawContext,
  openAlfaTestDatabase,
} from "./alfacrm-test-db.mjs";

const rollback = await readFile(
  new URL(
    "../../lib/db/rollbacks/0014_alfa_lineage_snapshot.down.sql",
    import.meta.url,
  ),
  "utf8",
);

test("new AlfaCRM entities require real raw and batch provenance", async () => {
  assert.throws(requireExplicitAlfaProvenance, /ALFACRM_PROVENANCE_REQUIRED/);
  const database = await openAlfaTestDatabase();
  try {
    const batchId = await createBatch(database);
    const leadContext = await createRawContext(database, batchId, {
      entityType: "leads",
      alphaId: "lead-test",
      scopeKey: "branch-test:leads",
    });
    await normalizeLead(
      database,
      "branch-test",
      { id: "lead-test", name: "Test Lead", status_id: 2 },
      leadContext,
    );
    await normalizeLead(
      database,
      "branch-test",
      { id: "lead-test", name: "Updated Test Lead", status_id: 5 },
      leadContext,
    );

    const tariffContext = await createRawContext(database, batchId, {
      entityType: "customer_tariffs",
      alphaId: "subscription-test",
      scopeKey: "branch-test:customer_tariffs:student-test",
    });
    await normalizeCustomerTariff(
      database,
      "branch-test",
      "student-test",
      {
        id: "subscription-test",
        tariff_id: "tariff-test",
        balance: "3.5",
        b_date: "01.07.2026",
        e_date: "31.07.2026",
      },
      tariffContext,
    );

    const referenceContext = await createRawContext(database, batchId, {
      entityType: "pay_types",
      alphaId: "pay-type-test",
      scopeKey: "branch-test:reference:pay_types",
    });
    await normalizeReferenceRecord(
      database,
      "branch-test",
      "pay_types",
      { id: "pay-type-test", name: "Test type", active: 1 },
      referenceContext,
    );

    const logContext = await createRawContext(database, batchId, {
      entityType: "change_log",
      alphaId: "log-test",
      scopeKey: "branch-test:change_log:full",
    });
    await normalizeChangeLog(
      database,
      "branch-test",
      {
        id: "log-test",
        entity: "customer",
        entity_id: "student-test",
        event: "update",
        date_time: "2026-07-25 12:30:00",
        fields_new: { status: 2 },
      },
      logContext,
    );

    const counts = await database.query(
      `SELECT
         (SELECT COUNT(*)::int FROM crm_leads) AS leads,
         (SELECT COUNT(*)::int FROM crm_customer_tariffs) AS tariffs,
         (SELECT COUNT(*)::int FROM crm_reference_records) AS references,
         (SELECT COUNT(*)::int FROM crm_change_log) AS logs`,
    );
    assert.deepEqual(counts.rows[0], {
      leads: 1,
      tariffs: 1,
      references: 1,
      logs: 1,
    });

    const lead = await database.query(
      `SELECT full_name, status, record_state
       FROM crm_leads
       WHERE branch_crm_id = 'branch-test' AND crm_id = 'lead-test'`,
    );
    assert.deepEqual(lead.rows[0], {
      full_name: "Updated Test Lead",
      status: "5",
      record_state: "current",
    });

    const tariff = await database.query(
      `SELECT customer_crm_id, tariff_crm_id, balance, valid_from, valid_to
       FROM crm_customer_tariffs`,
    );
    assert.equal(tariff.rows[0]?.customer_crm_id, "student-test");
    assert.equal(tariff.rows[0]?.tariff_crm_id, "tariff-test");
    assert.equal(tariff.rows[0]?.balance, "3.5");
    assert.equal(
      new Date(tariff.rows[0]?.valid_from).toISOString().slice(0, 10),
      "2026-07-01",
    );
    assert.equal(
      new Date(tariff.rows[0]?.valid_to).toISOString().slice(0, 10),
      "2026-07-31",
    );

    await assert.rejects(
      normalizeLead(
        database,
        "branch-test",
        { id: "orphan-lead", name: "Must fail" },
        {
          batchId,
          rawId: randomUUID(),
          scopeKey: "branch-test:leads",
        },
      ),
      /foreign key|violates/i,
    );

    await assert.rejects(
      database.query(
        `UPDATE alpha_raw_records SET source_payload = '{}'::jsonb
         WHERE id = $1`,
        [leadContext.rawId],
      ),
      /append-only/i,
    );
    await assert.rejects(
      database.query(`DELETE FROM alpha_raw_records WHERE id = $1`, [
        leadContext.rawId,
      ]),
      /append-only/i,
    );

    await database.exec(rollback);
    const remaining = await database.query(
      `SELECT COUNT(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'alpha_raw_observations',
           'alpha_sync_scope_runs'
         )`,
    );
    assert.equal(remaining.rows[0]?.count, 0);
  } finally {
    await database.close();
  }
});
