DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "family_merge_candidates"
    WHERE "left_student_branch_crm_id"
        IS DISTINCT FROM "right_student_branch_crm_id"
       OR "branch_crm_id"
        IS DISTINCT FROM "left_student_branch_crm_id"
  ) OR EXISTS (
    SELECT 1
    FROM "family_merge_candidates"
    GROUP BY
      "left_student_crm_id",
      "right_student_crm_id",
      "candidate_type"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'rollback blocked: branch-scoped family candidates would lose identity; restore the pre-migration backup instead';
  END IF;
END
$$;

ALTER TABLE "family_merge_candidates"
  DROP CONSTRAINT IF EXISTS "family_merge_candidates_pair_uniq";
ALTER TABLE "family_merge_candidates"
  ADD CONSTRAINT "family_merge_candidates_pair_uniq"
  UNIQUE(
    "left_student_crm_id",
    "right_student_crm_id",
    "candidate_type"
  );
ALTER TABLE "family_merge_candidates"
  DROP COLUMN "left_student_branch_crm_id";
ALTER TABLE "family_merge_candidates"
  DROP COLUMN "right_student_branch_crm_id";
