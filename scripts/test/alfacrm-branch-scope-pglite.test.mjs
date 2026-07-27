import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeEntity } from "../src/import-alfacrm-sandbox.ts";
import {
  createBatch,
  createRawContext,
  executeMigrationSource,
  openAlfaTestDatabase,
} from "./alfacrm-test-db.mjs";

const migration16 = await readFile(
  new URL(
    "../../lib/db/drizzle/0017_serious_captain_cross.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback16 = await readFile(
  new URL(
    "../../lib/db/rollbacks/0017_branch_scoped_alfa_ids.down.sql",
    import.meta.url,
  ),
  "utf8",
);

async function replay(database, batchId, branchId, recordType, item) {
  const crmId = String(item.id);
  const context = await createRawContext(database, batchId, {
    branchId,
    entityType: recordType,
    alphaId: crmId,
    scopeKey: `${branchId}:${recordType}`,
    payload: item,
  });
  return normalizeEntity(
    database,
    {
      branchId,
      endpoint: `${branchId}/${recordType}/index`,
      recordType,
      scopeKey: context.scopeKey,
    },
    item,
    context,
  );
}

test("AlfaCRM ids and attendance are unique inside a branch, not globally", async () => {
  const database = await openAlfaTestDatabase(17);
  try {
    const batchId = await createBatch(database);
    for (const branchId of ["branch-a", "branch-b"]) {
      await replay(database, batchId, branchId, "students", {
        id: "student-shared",
        name: `Student ${branchId}`,
      });
      await replay(database, batchId, branchId, "teachers", {
        id: "teacher-shared",
        name: `Teacher ${branchId}`,
      });
      await replay(database, batchId, branchId, "groups", {
        id: "group-shared",
        name: `Group ${branchId}`,
      });
      await replay(database, batchId, branchId, "payments", {
        id: "payment-shared",
        customer_id: "student-shared",
        income: "100",
      });
      await replay(database, batchId, branchId, "lessons", {
        id: "lesson-shared",
        group_id: "group-shared",
        teacher_id: "teacher-shared",
        details: [{ customer_id: "student-shared", status: "visited" }],
      });
    }

    const counts = await database.query(
      `SELECT
         (SELECT COUNT(*)::int FROM crm_students
          WHERE crm_id = 'student-shared') AS students,
         (SELECT COUNT(*)::int FROM student_profiles
          WHERE student_crm_id = 'student-shared') AS profiles,
         (SELECT COUNT(*)::int FROM crm_teachers
          WHERE crm_id = 'teacher-shared') AS teachers,
         (SELECT COUNT(*)::int FROM crm_groups
          WHERE crm_id = 'group-shared') AS groups,
         (SELECT COUNT(*)::int FROM crm_payments
          WHERE crm_id = 'payment-shared') AS payments,
         (SELECT COUNT(*)::int FROM crm_lessons
          WHERE crm_id = 'lesson-shared') AS lessons,
         (SELECT COUNT(*)::int FROM crm_attendance
          WHERE lesson_crm_id = 'lesson-shared'
            AND student_crm_id = 'student-shared') AS attendance`,
    );
    assert.deepEqual(counts.rows[0], {
      students: 2,
      profiles: 2,
      teachers: 2,
      groups: 2,
      payments: 2,
      lessons: 2,
      attendance: 2,
    });

    await assert.rejects(database.exec(rollback16), /rollback blocked/i);
    const remainingConstraint = await database.query(
      `SELECT COUNT(*)::int AS count
       FROM pg_constraint
       WHERE conname = 'crm_students_branch_crm_uniq'`,
    );
    assert.equal(remainingConstraint.rows[0]?.count, 1);
  } finally {
    await database.close();
  }
});

test("migration 0017 fails before changing constraints when branch provenance is missing", async () => {
  const database = await openAlfaTestDatabase(16);
  try {
    const batchId = await createBatch(database);
    const context = await createRawContext(database, batchId, {
      entityType: "students",
      alphaId: "legacy-student",
    });
    await database.query(
      `INSERT INTO crm_students (
         crm_id, branch_crm_id, raw_record_id, raw_observation_id,
         last_seen_batch_id, source_scope
       ) VALUES ($1, NULL, $2, $3, $4, $5)`,
      [
        "legacy-student",
        context.rawId,
        context.observationId,
        context.batchId,
        context.scopeKey,
      ],
    );

    await assert.rejects(
      executeMigrationSource(database, migration16),
      /normalized rows lack branch_crm_id/i,
    );
    const constraints = await database.query(
      `SELECT conname
       FROM pg_constraint
       WHERE conname IN (
         'crm_students_crm_id_unique',
         'crm_students_branch_crm_uniq'
       )
       ORDER BY conname`,
    );
    assert.deepEqual(
      constraints.rows.map((row) => row.conname),
      ["crm_students_crm_id_unique"],
    );
  } finally {
    await database.close();
  }
});

test("migration 0017 backfills attendance branch from its exact observation", async () => {
  const database = await openAlfaTestDatabase(16);
  try {
    const batchId = await createBatch(database);
    const context = await createRawContext(database, batchId, {
      branchId: "branch-attendance",
      entityType: "lessons",
      alphaId: "lesson-attendance",
      scopeKey: "branch-attendance:lessons",
    });
    await database.query(
      `INSERT INTO crm_lessons (
         crm_id, branch_crm_id, raw_record_id, raw_observation_id,
         last_seen_batch_id, source_scope
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        "lesson-attendance",
        "branch-attendance",
        context.rawId,
        context.observationId,
        context.batchId,
        context.scopeKey,
      ],
    );
    await database.query(
      `INSERT INTO crm_attendance (
         lesson_crm_id, student_crm_id, raw_record_id, raw_observation_id,
         last_seen_batch_id, source_scope
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        "lesson-attendance",
        "student-attendance",
        context.rawId,
        context.observationId,
        context.batchId,
        context.scopeKey,
      ],
    );

    await executeMigrationSource(database, migration16);
    const attendance = await database.query(
      `SELECT branch_crm_id
       FROM crm_attendance
       WHERE lesson_crm_id = 'lesson-attendance'`,
    );
    assert.equal(attendance.rows[0]?.branch_crm_id, "branch-attendance");
  } finally {
    await database.close();
  }
});

test("migration 0017 rollback is clean before branch-id reuse exists", async () => {
  const database = await openAlfaTestDatabase(17);
  try {
    await database.exec(rollback16);
    const oldConstraint = await database.query(
      `SELECT COUNT(*)::int AS count
       FROM pg_constraint
       WHERE conname = 'crm_students_crm_id_unique'`,
    );
    const attendanceColumn = await database.query(
      `SELECT COUNT(*)::int AS count
       FROM information_schema.columns
       WHERE table_name = 'crm_attendance'
         AND column_name = 'branch_crm_id'`,
    );
    assert.equal(oldConstraint.rows[0]?.count, 1);
    assert.equal(attendanceColumn.rows[0]?.count, 0);
  } finally {
    await database.close();
  }
});
