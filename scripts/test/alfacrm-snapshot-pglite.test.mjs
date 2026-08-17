import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AlfaReadError,
  buildFamilyCandidates,
  importEntity,
} from "../src/import-alfacrm-sandbox.ts";
import {
  createBatch,
  executeMigrationSource,
  openAlfaTestDatabase,
} from "./alfacrm-test-db.mjs";

class FakeAlfaClient {
  constructor(handler) {
    this.handler = handler;
    this.calls = [];
  }

  async postIndex(endpoint, body) {
    this.calls.push({ endpoint, body });
    return this.handler(endpoint, body, this.calls.length);
  }
}

function studentsOptions(branchId, overrides = {}) {
  return {
    branchId,
    endpoint: `${branchId}/customer/index`,
    recordType: "students",
    scopeKey: `${branchId}:students`,
    body: { is_study: 1 },
    ...overrides,
  };
}

function pageClient(items) {
  return new FakeAlfaClient((_endpoint, body) => {
    const start = body.page * 50;
    return {
      total: items.length,
      items: items.slice(start, start + 50),
    };
  });
}

test("pagination uses pageSize and preserves immutable raw observations across batches", async () => {
  const database = await openAlfaTestDatabase();
  try {
    const items = Array.from({ length: 101 }, (_value, index) => ({
      id: `student-${index + 1}`,
      name: `Student ${index + 1}`,
      is_study: 1,
    }));
    const firstBatch = await createBatch(database);
    const firstClient = pageClient(items);
    const first = await importEntity(
      firstClient,
      database,
      firstBatch,
      studentsOptions("branch-page"),
    );
    assert.equal(first.pages, 3);
    assert.equal(first.records, 101);
    assert.equal(first.rawSaved, 101);
    assert.deepEqual(
      firstClient.calls.map((call) => call.body.page),
      [0, 1, 2],
    );
    for (const call of firstClient.calls) {
      assert.equal(call.body.pageSize, 50);
      assert.equal("count" in call.body, false);
    }

    const secondBatch = await createBatch(database);
    const second = await importEntity(
      pageClient(items),
      database,
      secondBatch,
      studentsOptions("branch-page"),
    );
    assert.equal(second.rawSaved, 0);

    const changedItems = items.map((item, index) =>
      index === 0 ? { ...item, name: "Changed Student 1" } : item,
    );
    const thirdBatch = await createBatch(database);
    const third = await importEntity(
      pageClient(changedItems),
      database,
      thirdBatch,
      studentsOptions("branch-page"),
    );
    assert.equal(third.rawSaved, 1);

    const lineage = await database.query(
      `SELECT
         (SELECT COUNT(*)::int FROM alpha_raw_records
          WHERE branch_id = 'branch-page' AND entity_type = 'students') AS raw,
         (SELECT COUNT(*)::int FROM alpha_raw_observations
          WHERE branch_id = 'branch-page' AND entity_type = 'students')
           AS observations`,
    );
    assert.deepEqual(lineage.rows[0], {
      raw: 102,
      observations: 303,
    });
  } finally {
    await database.close();
  }
});

test("remaining pages overlap network latency and commit in page order", async () => {
  const database = await openAlfaTestDatabase();
  try {
    const items = Array.from({ length: 201 }, (_value, index) => ({
      id: `parallel-${index + 1}`,
      name: `Parallel Student ${index + 1}`,
      is_study: 1,
    }));
    let active = 0;
    let maxActive = 0;
    const client = new FakeAlfaClient(async (_endpoint, body) => {
      const start = body.page * 50;
      if (body.page > 0) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(5, 45 - body.page * 5)),
        );
        active -= 1;
      }
      return {
        total: items.length,
        items: items.slice(start, start + 50),
      };
    });
    const batchId = await createBatch(database);
    const result = await importEntity(
      client,
      database,
      batchId,
      studentsOptions("branch-parallel"),
    );

    assert.equal(result.pages, 5);
    assert.equal(result.records, 201);
    assert.ok(maxActive >= 2);
    assert.deepEqual(
      client.calls.map((call) => call.body.page),
      [0, 1, 2, 3, 4],
    );
    const scope = await database.query(
      `SELECT status, pages_fetched, records_fetched
       FROM alpha_sync_scope_runs
       WHERE sync_batch_id = $1`,
      [batchId],
    );
    assert.deepEqual(scope.rows[0], {
      status: "completed",
      pages_fetched: 5,
      records_fetched: 201,
    });
  } finally {
    await database.close();
  }
});

test("raw lineage is append-only and normalized rows reference the exact observation", async () => {
  const database = await openAlfaTestDatabase();
  try {
    const batchId = await createBatch(database);
    const item = { id: "student-lineage", name: "Lineage Student", is_study: 1 };
    await importEntity(
      pageClient([item]),
      database,
      batchId,
      studentsOptions("branch-lineage", {
        scopeKey: "branch-lineage:students:primary",
      }),
    );
    await importEntity(
      pageClient([item]),
      database,
      batchId,
      studentsOptions("branch-lineage", {
        scopeKey: "branch-lineage:students:secondary",
      }),
    );

    const lineage = await database.query(
      `SELECT
         student.raw_record_id,
         student.raw_observation_id,
         student.last_seen_batch_id,
         student.source_scope,
         observation.scope_key AS observation_scope,
         observation.page AS observation_page
       FROM crm_students AS student
       JOIN alpha_raw_observations AS observation
         ON observation.id = student.raw_observation_id
       WHERE student.branch_crm_id = 'branch-lineage'
         AND student.crm_id = 'student-lineage'`,
    );
    assert.equal(lineage.rows[0]?.source_scope, "branch-lineage:students:secondary");
    assert.equal(
      lineage.rows[0]?.observation_scope,
      "branch-lineage:students:secondary",
    );
    assert.equal(lineage.rows[0]?.observation_page, 0);

    const observations = await database.query(
      `SELECT id, scope_key
       FROM alpha_raw_observations
       WHERE sync_batch_id = $1
       ORDER BY scope_key`,
      [batchId],
    );
    assert.deepEqual(
      observations.rows.map((row) => row.scope_key),
      [
        "branch-lineage:students:primary",
        "branch-lineage:students:secondary",
      ],
    );
    await assert.rejects(
      database.query(
        `UPDATE crm_students
         SET raw_observation_id = $1
         WHERE branch_crm_id = 'branch-lineage'
           AND crm_id = 'student-lineage'`,
        [observations.rows[0]?.id],
      ),
      /foreign key|violates/i,
    );

    await assert.rejects(
      database.query(
        `UPDATE alpha_raw_records
         SET source_payload = '{}'::jsonb
         WHERE id = $1`,
        [lineage.rows[0]?.raw_record_id],
      ),
      /append-only/i,
    );
    await assert.rejects(
      database.query(
        `DELETE FROM alpha_raw_records
         WHERE id = $1`,
        [lineage.rows[0]?.raw_record_id],
      ),
      /append-only/i,
    );
    await assert.rejects(
      database.exec("TRUNCATE alpha_raw_records CASCADE"),
      /append-only/i,
    );
    await assert.rejects(
      database.query(
        `UPDATE alpha_raw_observations
         SET page = page + 1
         WHERE id = $1`,
        [lineage.rows[0]?.raw_observation_id],
      ),
      /append-only/i,
    );
    await assert.rejects(
      database.query(
        `DELETE FROM alpha_raw_observations
         WHERE id = $1`,
        [lineage.rows[0]?.raw_observation_id],
      ),
      /append-only/i,
    );
    await assert.rejects(
      database.exec("TRUNCATE alpha_raw_observations CASCADE"),
      /append-only/i,
    );
  } finally {
    await database.close();
  }
});

test("raw, observation, and normalization roll back together on a page failure", async () => {
  const database = await openAlfaTestDatabase();
  try {
    await database.exec(`
      CREATE FUNCTION fail_test_student()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.crm_id = 'boom' THEN
          RAISE EXCEPTION 'injected normalization failure';
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER fail_test_student_trigger
      BEFORE INSERT OR UPDATE ON crm_students
      FOR EACH ROW
      EXECUTE FUNCTION fail_test_student()
    `);
    const batchId = await createBatch(database);
    await assert.rejects(
      importEntity(
        pageClient([
          { id: "page-ok", name: "Would otherwise persist" },
          { id: "boom", name: "Injected failure" },
        ]),
        database,
        batchId,
        studentsOptions("branch-atomic"),
      ),
      /injected normalization failure/,
    );
    const counts = await database.query(
      `SELECT
         (SELECT COUNT(*)::int FROM alpha_raw_records
          WHERE sync_batch_id = $1) AS raw,
         (SELECT COUNT(*)::int FROM alpha_raw_observations
          WHERE sync_batch_id = $1) AS observations,
         (SELECT COUNT(*)::int FROM crm_students
          WHERE branch_crm_id = 'branch-atomic') AS students`,
      [batchId],
    );
    assert.deepEqual(counts.rows[0], {
      raw: 0,
      observations: 0,
      students: 0,
    });
    const scope = await database.query(
      `SELECT status, pages_fetched, records_fetched
       FROM alpha_sync_scope_runs
       WHERE sync_batch_id = $1`,
      [batchId],
    );
    assert.deepEqual(scope.rows[0], {
      status: "incomplete",
      pages_fetched: 0,
      records_fetched: 0,
    });
  } finally {
    await database.close();
  }
});

test("a stale student cascades to children and downstream imports cannot revive them", async () => {
  const database = await openAlfaTestDatabase();
  try {
    const branchId = "branch-parent-lifecycle";
    const studentOptions = studentsOptions(branchId);
    const groupOptions = {
      branchId,
      endpoint: `${branchId}/group/index`,
      recordType: "groups",
      scopeKey: `${branchId}:groups`,
    };
    const membershipOptions = {
      branchId,
      endpoint: `${branchId}/cgi/index`,
      recordType: "group_memberships",
      scopeKey: `${branchId}:group_memberships:group-parent`,
      forcedGroupId: "group-parent",
    };
    const lessonOptions = {
      branchId,
      endpoint: `${branchId}/lesson/index`,
      recordType: "lessons",
      scopeKey: `${branchId}:lessons`,
    };
    const paymentOptions = {
      branchId,
      endpoint: `${branchId}/pay/index`,
      recordType: "payments",
      scopeKey: `${branchId}:payments`,
    };
    const student = { id: "student-parent", name: "Parent Test", is_study: 1 };
    const group = { id: "group-parent", name: "Parent Group" };
    const membership = {
      id: "membership-parent",
      customer_id: "student-parent",
      group_id: "group-parent",
    };
    const lesson = {
      id: "lesson-parent",
      group_id: "group-parent",
      date: "2026-07-25",
      details: [{ customer_id: "student-parent", status: "present" }],
    };
    const payment = {
      id: "payment-parent",
      customer_id: "student-parent",
      amount: "1000",
      document_date: "2026-07-25",
    };

    await importEntity(
      pageClient([student]),
      database,
      await createBatch(database),
      studentOptions,
    );
    await importEntity(
      pageClient([group]),
      database,
      await createBatch(database),
      groupOptions,
    );
    await importEntity(
      pageClient([membership]),
      database,
      await createBatch(database),
      membershipOptions,
    );
    await importEntity(
      pageClient([lesson]),
      database,
      await createBatch(database),
      lessonOptions,
    );
    await importEntity(
      pageClient([payment]),
      database,
      await createBatch(database),
      paymentOptions,
    );

    await importEntity(
      pageClient([]),
      database,
      await createBatch(database),
      studentOptions,
    );

    const cascaded = await database.query(
      `SELECT
         (SELECT record_state FROM crm_students
          WHERE branch_crm_id = $1 AND crm_id = 'student-parent')
           AS student,
         (SELECT record_state FROM crm_group_memberships
          WHERE branch_crm_id = $1
            AND group_crm_id = 'group-parent'
            AND student_crm_id = 'student-parent')
           AS membership,
         (SELECT record_state FROM crm_attendance
          WHERE lesson_crm_id = 'lesson-parent'
            AND student_crm_id = 'student-parent')
           AS attendance,
         (SELECT record_state FROM crm_payments
          WHERE branch_crm_id = $1 AND crm_id = 'payment-parent')
           AS payment`,
      [branchId],
    );
    assert.deepEqual(cascaded.rows[0], {
      student: "stale",
      membership: "stale",
      attendance: "stale",
      payment: "stale",
    });

    await importEntity(
      pageClient([membership]),
      database,
      await createBatch(database),
      membershipOptions,
    );
    await importEntity(
      pageClient([lesson]),
      database,
      await createBatch(database),
      lessonOptions,
    );
    await importEntity(
      pageClient([payment]),
      database,
      await createBatch(database),
      paymentOptions,
    );

    const afterDownstreamRetry = await database.query(
      `SELECT
         (SELECT record_state FROM crm_group_memberships
          WHERE branch_crm_id = $1
            AND group_crm_id = 'group-parent'
            AND student_crm_id = 'student-parent')
           AS membership,
         (SELECT record_state FROM crm_attendance
          WHERE lesson_crm_id = 'lesson-parent'
            AND student_crm_id = 'student-parent')
           AS attendance,
         (SELECT record_state FROM crm_payments
          WHERE branch_crm_id = $1 AND crm_id = 'payment-parent')
           AS payment`,
      [branchId],
    );
    assert.deepEqual(afterDownstreamRetry.rows[0], {
      membership: "stale",
      attendance: "stale",
      payment: "stale",
    });
  } finally {
    await database.close();
  }
});

test("completed snapshots stale missing rows and preserve reviewed family decisions", async () => {
  const database = await openAlfaTestDatabase();
  try {
    const initialStudents = ["a", "b", "c"].map((id) => ({
      id,
      name: `Student ${id}`,
      phone: "+7 999 111 22 33",
      legal_name: "Shared Guardian",
      is_study: 1,
    }));
    await importEntity(
      pageClient(initialStudents),
      database,
      await createBatch(database),
      studentsOptions("branch-family"),
    );
    await importEntity(
      pageClient([{ id: "tariff-for-c", tariff_id: "tariff-1" }]),
      database,
      await createBatch(database),
      {
        branchId: "branch-family",
        endpoint: "branch-family/customer-tariff/index",
        recordType: "customer_tariffs",
        scopeKey: "branch-family:customer_tariffs:c",
        forcedCustomerId: "c",
      },
    );
    assert.equal(await buildFamilyCandidates(database), 3);
    await database.query(
      `UPDATE family_merge_candidates
       SET status = 'confirmed', reviewed_by = 'owner', reviewed_at = now()
       WHERE left_student_crm_id = 'a'
         AND right_student_crm_id = 'b'`,
    );

    await importEntity(
      pageClient(initialStudents.slice(0, 2)),
      database,
      await createBatch(database),
      studentsOptions("branch-family"),
    );
    assert.equal(await buildFamilyCandidates(database), 1);

    const studentStates = await database.query(
      `SELECT crm_id, record_state
       FROM crm_students
       WHERE branch_crm_id = 'branch-family'
       ORDER BY crm_id`,
    );
    assert.deepEqual(studentStates.rows, [
      { crm_id: "a", record_state: "current" },
      { crm_id: "b", record_state: "current" },
      { crm_id: "c", record_state: "stale" },
    ]);
    const profileC = await database.query(
      `SELECT record_state
       FROM student_profiles
       WHERE student_crm_id = 'c'`,
    );
    assert.equal(profileC.rows[0]?.record_state, "stale");
    const tariffForC = await database.query(
      `SELECT record_state
       FROM crm_customer_tariffs
       WHERE crm_id = 'tariff-for-c'`,
    );
    assert.equal(tariffForC.rows[0]?.record_state, "stale");

    const candidates = await database.query(
      `SELECT left_student_crm_id, right_student_crm_id, status
       FROM family_merge_candidates
       ORDER BY left_student_crm_id, right_student_crm_id`,
    );
    assert.deepEqual(candidates.rows, [
      {
        left_student_crm_id: "a",
        right_student_crm_id: "b",
        status: "confirmed",
      },
      {
        left_student_crm_id: "a",
        right_student_crm_id: "c",
        status: "stale",
      },
      {
        left_student_crm_id: "b",
        right_student_crm_id: "c",
        status: "stale",
      },
    ]);

    const lifecycleBatch = await createBatch(database);
    await importEntity(
      pageClient([{ id: "converted", name: "Converted Lead" }]),
      database,
      lifecycleBatch,
      {
        branchId: "branch-lifecycle",
        endpoint: "branch-lifecycle/customer/index",
        recordType: "leads",
        scopeKey: "branch-lifecycle:leads",
        body: { is_study: 0 },
      },
    );
    await importEntity(
      pageClient([
        { id: "converted", name: "Converted Student", is_study: 1 },
      ]),
      database,
      lifecycleBatch,
      studentsOptions("branch-lifecycle"),
    );
    const classification = await database.query(
      `SELECT
         (SELECT record_state FROM crm_leads
          WHERE branch_crm_id = 'branch-lifecycle'
            AND crm_id = 'converted') AS lead_state,
         (SELECT record_state FROM crm_students
          WHERE branch_crm_id = 'branch-lifecycle'
            AND crm_id = 'converted') AS student_state`,
    );
    assert.deepEqual(classification.rows[0], {
      lead_state: "stale",
      student_state: "current",
    });

    const tariffOptions = {
      branchId: "branch-family",
      endpoint: "branch-family/customer-tariff/index",
      recordType: "customer_tariffs",
      scopeKey: "branch-family:customer_tariffs:a",
      forcedCustomerId: "a",
    };
    await importEntity(
      pageClient([{ id: "tariff-row", tariff_id: "tariff-1" }]),
      database,
      await createBatch(database),
      tariffOptions,
    );
    await importEntity(
      pageClient([]),
      database,
      await createBatch(database),
      tariffOptions,
    );
    const tariff = await database.query(
      `SELECT record_state FROM crm_customer_tariffs
       WHERE crm_id = 'tariff-row'`,
    );
    assert.equal(tariff.rows[0]?.record_state, "stale");

    const referenceOptions = {
      branchId: "branch-family",
      endpoint: "branch-family/pay-type/index",
      recordType: "pay_types",
      scopeKey: "branch-family:reference:pay_types",
    };
    await importEntity(
      pageClient([{ id: "pay-type-1", name: "Type" }]),
      database,
      await createBatch(database),
      referenceOptions,
    );
    await importEntity(
      pageClient([]),
      database,
      await createBatch(database),
      referenceOptions,
    );
    const reference = await database.query(
      `SELECT record_state FROM crm_reference_records
       WHERE crm_id = 'pay-type-1'`,
    );
    assert.equal(reference.rows[0]?.record_state, "stale");

    const groupOptions = {
      branchId: "branch-family",
      endpoint: "branch-family/group/index",
      recordType: "groups",
      scopeKey: "branch-family:groups",
    };
    await importEntity(
      pageClient([{ id: "group-1", name: "Group" }]),
      database,
      await createBatch(database),
      groupOptions,
    );
    await importEntity(
      pageClient([{ id: "membership-1", customer_id: "a" }]),
      database,
      await createBatch(database),
      {
        branchId: "branch-family",
        endpoint: "branch-family/cgi/index",
        recordType: "group_memberships",
        scopeKey: "branch-family:group_memberships:group-1",
        forcedGroupId: "group-1",
      },
    );
    await importEntity(
      pageClient([]),
      database,
      await createBatch(database),
      groupOptions,
    );
    const membership = await database.query(
      `SELECT record_state
       FROM crm_group_memberships
       WHERE group_crm_id = 'group-1' AND student_crm_id = 'a'`,
    );
    assert.equal(membership.rows[0]?.record_state, "stale");
  } finally {
    await database.close();
  }
});

test("partial, repeated, and guarded pagination never reconcile missing rows", async () => {
  const database = await openAlfaTestDatabase();
  try {
    const items = Array.from({ length: 51 }, (_value, index) => ({
      id: `partial-${index + 1}`,
      name: `Student ${index + 1}`,
      is_study: 1,
    }));
    const options = studentsOptions("branch-partial");
    await importEntity(
      pageClient(items),
      database,
      await createBatch(database),
      options,
    );

    const failedBatch = await createBatch(database);
    const transportFailure = new FakeAlfaClient((_endpoint, body) => {
      if (body.page === 0) return { total: 51, items: items.slice(0, 50) };
      throw new AlfaReadError("network_timeout");
    });
    await assert.rejects(
      importEntity(transportFailure, database, failedBatch, options),
      /network_timeout/,
    );
    const afterFailure = await database.query(
      `SELECT
         COUNT(*) FILTER (WHERE record_state = 'current')::int AS current,
         COUNT(*) FILTER (WHERE record_state = 'stale')::int AS stale
       FROM crm_students
       WHERE branch_crm_id = 'branch-partial'`,
    );
    assert.deepEqual(afterFailure.rows[0], { current: 51, stale: 0 });
    const failedScope = await database.query(
      `SELECT status, pages_fetched, records_fetched
       FROM alpha_sync_scope_runs
       WHERE sync_batch_id = $1`,
      [failedBatch],
    );
    assert.deepEqual(failedScope.rows[0], {
      status: "incomplete",
      pages_fetched: 1,
      records_fetched: 50,
    });

    await database.query(
      `UPDATE alpha_sync_scope_runs
       SET status = 'running', pages_fetched = 0, records_fetched = 0
       WHERE sync_batch_id = $1`,
      [failedBatch],
    );
    const resumedClient = pageClient(items);
    const resumed = await importEntity(
      resumedClient,
      database,
      failedBatch,
      options,
    );
    assert.equal(resumed.pages, 2);
    assert.equal(resumed.records, 51);
    assert.deepEqual(
      resumedClient.calls.map((call) => call.body.page),
      [1],
    );
    const resumedScope = await database.query(
      `SELECT status, pages_fetched, records_fetched
       FROM alpha_sync_scope_runs
       WHERE sync_batch_id = $1`,
      [failedBatch],
    );
    assert.deepEqual(resumedScope.rows[0], {
      status: "completed",
      pages_fetched: 2,
      records_fetched: 51,
    });

    const retryCount = await database.query(
      `SELECT COUNT(*)::int AS count
       FROM crm_students
       WHERE branch_crm_id = 'branch-partial'`,
    );
    assert.equal(retryCount.rows[0]?.count, 51);

    const repeatedBatch = await createBatch(database);
    const repeatedPage = items.slice(0, 50);
    const repeatedClient = new FakeAlfaClient(() => ({
      total: 100,
      items: repeatedPage,
    }));
    await assert.rejects(
      importEntity(repeatedClient, database, repeatedBatch, options),
      /repeated_page/,
    );

    const guardBatch = await createBatch(database);
    await assert.rejects(
      importEntity(pageClient(items), database, guardBatch, {
        ...options,
        maxPages: 1,
      }),
      /pagination_guard/,
    );
    const incomplete = await database.query(
      `SELECT COUNT(*)::int AS count
       FROM alpha_sync_scope_runs
       WHERE sync_batch_id IN ($1, $2)
         AND status = 'incomplete'`,
      [repeatedBatch, guardBatch],
    );
    assert.equal(incomplete.rows[0]?.count, 2);
  } finally {
    await database.close();
  }
});

test("migration 0014 fails closed when legacy normalized rows lack provenance", async () => {
  const database = await openAlfaTestDatabase(13);
  try {
    await database.query(
      `INSERT INTO crm_leads (
         branch_crm_id,
         crm_id,
         raw
       ) VALUES ('legacy-branch', 'legacy-lead', '{}'::jsonb)`,
    );
    const migration = await readFile(
      new URL(
        "../../lib/db/drizzle/0014_green_millenium_guard.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await assert.rejects(
      executeMigrationSource(database, migration),
      /fail-closed.*crm_leads/i,
    );
    const observations = await database.query(
      `SELECT to_regclass('public.alpha_raw_observations') AS relation`,
    );
    assert.equal(observations.rows[0]?.relation, null);
  } finally {
    await database.close();
  }
});

test("migration 0014 rolls back cleanly and can be reapplied before 0015", async () => {
  const database = await openAlfaTestDatabase(13);
  try {
    const migration14 = await readFile(
      new URL(
        "../../lib/db/drizzle/0014_green_millenium_guard.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const rollback14 = await readFile(
      new URL(
        "../../lib/db/rollbacks/0014_alfa_lineage_snapshot.down.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const migration15 = await readFile(
      new URL(
        "../../lib/db/drizzle/0015_peaceful_doomsday.sql",
        import.meta.url,
      ),
      "utf8",
    );

    await executeMigrationSource(database, migration14);
    await database.exec(rollback14);
    await executeMigrationSource(database, migration14);
    await executeMigrationSource(database, migration15);

    const schema = await database.query(
      `SELECT
         to_regclass('public.alpha_raw_observations') AS observations,
         EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'crm_students'
             AND column_name = 'raw_observation_id'
         ) AS exact_observation_lineage`,
    );
    assert.equal(schema.rows[0]?.observations, "alpha_raw_observations");
    assert.equal(schema.rows[0]?.exact_observation_lineage, true);
  } finally {
    await database.close();
  }
});
