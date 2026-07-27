import { buildFamilyCandidates } from "./import-alfacrm-sandbox.js";
import { openSandboxDatabase } from "./sandbox-db.js";

const { database, migrationsApplied } = await openSandboxDatabase();
try {
  const pendingReviewCandidates = await buildFamilyCandidates(database);
  const counts = await database.query<{
    pending_review: number;
    reviewed: number;
    same_identity: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending_review')::int
         AS pending_review,
       COUNT(*) FILTER (
         WHERE status NOT IN ('pending_review', 'stale')
       )::int AS reviewed,
       COUNT(*) FILTER (
         WHERE left_student_branch_crm_id = right_student_branch_crm_id
           AND left_student_crm_id = right_student_crm_id
       )::int AS same_identity
     FROM family_merge_candidates`,
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "completed",
        migrationsApplied,
        generatedCandidates: pendingReviewCandidates,
        pendingReviewCandidates: Number(
          counts.rows[0]?.pending_review ?? 0,
        ),
        reviewedDecisions: Number(counts.rows[0]?.reviewed ?? 0),
        sameStudentIdentityCandidates: Number(
          counts.rows[0]?.same_identity ?? 0,
        ),
        automaticMergeAttempted: false,
        personalDataPrinted: false,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await database.close();
}
