import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildFamilyCandidates,
  normalizeEntity,
} from "../src/import-alfacrm-sandbox.ts";
import {
  createBatch,
  createRawContext,
  executeMigrationSource,
  openAlfaTestDatabase,
} from "./alfacrm-test-db.mjs";

const migration17 = await readFile(
  new URL(
    "../../lib/db/drizzle/0018_green_typhoid_mary.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback17 = await readFile(
  new URL(
    "../../lib/db/rollbacks/0018_branch_scoped_family_candidates.down.sql",
    import.meta.url,
  ),
  "utf8",
);

async function normalizeStudent(database, batchId, branchId, item) {
  const context = await createRawContext(database, batchId, {
    branchId,
    entityType: "students",
    alphaId: item.id,
    scopeKey: `${branchId}:students`,
    payload: item,
  });
  await normalizeEntity(
    database,
    {
      branchId,
      endpoint: `${branchId}/customer/index`,
      recordType: "students",
      scopeKey: context.scopeKey,
    },
    item,
    context,
  );
}

async function insertLegacyCandidate(
  database,
  {
    leftId,
    rightId,
    branchId = null,
    status = "pending_review",
  },
) {
  await database.query(
    `INSERT INTO family_merge_candidates (
       left_student_crm_id,
       right_student_crm_id,
       branch_crm_id,
       candidate_type,
       reason_codes,
       evidence,
       confidence,
       status
     ) VALUES ($1, $2, $3, 'possible_shared_family', '[]'::jsonb,
       '{}'::jsonb, 0.65, $4)`,
    [leftId, rightId, branchId, status],
  );
}

test("family candidates retain both branch-scoped student identities", async () => {
  const database = await openAlfaTestDatabase();
  try {
    const batchId = await createBatch(database);
    for (const branchId of ["branch-a", "branch-b"]) {
      await normalizeStudent(database, batchId, branchId, {
        id: "student-shared",
        name: `Student ${branchId}`,
        phone: "+7 999 111 22 33",
        legal_name: "Shared Guardian",
      });
    }

    assert.equal(await buildFamilyCandidates(database), 1);
    assert.equal(await buildFamilyCandidates(database), 1);
    const candidates = await database.query(
      `SELECT
         left_student_branch_crm_id,
         left_student_crm_id,
         right_student_branch_crm_id,
         right_student_crm_id,
         branch_crm_id,
         status
       FROM family_merge_candidates`,
    );
    assert.deepEqual(candidates.rows, [
      {
        left_student_branch_crm_id: "branch-a",
        left_student_crm_id: "student-shared",
        right_student_branch_crm_id: "branch-b",
        right_student_crm_id: "student-shared",
        branch_crm_id: null,
        status: "pending_review",
      },
    ]);

    await database.query(
      `UPDATE family_merge_candidates
       SET status = 'confirmed', reviewed_by = 'owner', reviewed_at = now()`,
    );
    await buildFamilyCandidates(database);
    const preserved = await database.query(
      "SELECT status FROM family_merge_candidates",
    );
    assert.equal(preserved.rows[0]?.status, "confirmed");
    await assert.rejects(database.exec(rollback17), /rollback blocked/i);
  } finally {
    await database.close();
  }
});

test("migration 0018 preserves reviewed same-branch decisions and drops only ambiguous unreviewed derivatives", async () => {
  const database = await openAlfaTestDatabase(17);
  try {
    const batchId = await createBatch(database);
    for (const [branchId, ids] of [
      ["branch-a", ["reviewed-left", "reviewed-right", "shared-left", "shared-right"]],
      ["branch-b", ["shared-left", "shared-right"]],
    ]) {
      for (const id of ids) {
        await normalizeStudent(database, batchId, branchId, {
          id,
          name: `${id} ${branchId}`,
        });
      }
    }
    await insertLegacyCandidate(database, {
      leftId: "reviewed-left",
      rightId: "reviewed-right",
      branchId: "branch-a",
      status: "confirmed",
    });
    await insertLegacyCandidate(database, {
      leftId: "shared-left",
      rightId: "shared-right",
    });

    await executeMigrationSource(database, migration17);
    const remaining = await database.query(
      `SELECT
         left_student_branch_crm_id,
         right_student_branch_crm_id,
         status
       FROM family_merge_candidates`,
    );
    assert.deepEqual(remaining.rows, [
      {
        left_student_branch_crm_id: "branch-a",
        right_student_branch_crm_id: "branch-a",
        status: "confirmed",
      },
    ]);
    await database.exec(rollback17);
  } finally {
    await database.close();
  }
});

test("migration 0018 fails closed for an ambiguous reviewed family decision", async () => {
  const database = await openAlfaTestDatabase(17);
  try {
    const batchId = await createBatch(database);
    for (const branchId of ["branch-a", "branch-b"]) {
      for (const id of ["shared-left", "shared-right"]) {
        await normalizeStudent(database, batchId, branchId, {
          id,
          name: `${id} ${branchId}`,
        });
      }
    }
    await insertLegacyCandidate(database, {
      leftId: "shared-left",
      rightId: "shared-right",
      status: "confirmed",
    });

    await assert.rejects(
      executeMigrationSource(database, migration17),
      /reviewed decision has ambiguous branch identity/i,
    );
    const oldConstraint = await database.query(
      `SELECT COUNT(*)::int AS count
       FROM pg_constraint
       WHERE conname = 'family_merge_candidates_pair_uniq'
         AND cardinality(conkey) = 3`,
    );
    assert.equal(oldConstraint.rows[0]?.count, 1);
  } finally {
    await database.close();
  }
});
