ALTER TABLE "family_merge_candidates" ADD COLUMN "left_student_branch_crm_id" text;--> statement-breakpoint
ALTER TABLE "family_merge_candidates" ADD COLUMN "right_student_branch_crm_id" text;--> statement-breakpoint
UPDATE "family_merge_candidates"
SET
  "left_student_branch_crm_id" = COALESCE(
    "branch_crm_id",
    (
      SELECT CASE
        WHEN COUNT(DISTINCT student."branch_crm_id") = 1
          THEN MIN(student."branch_crm_id")
        ELSE NULL
      END
      FROM "crm_students" AS student
      WHERE student."crm_id" =
        "family_merge_candidates"."left_student_crm_id"
    )
  ),
  "right_student_branch_crm_id" = COALESCE(
    "branch_crm_id",
    (
      SELECT CASE
        WHEN COUNT(DISTINCT student."branch_crm_id") = 1
          THEN MIN(student."branch_crm_id")
        ELSE NULL
      END
      FROM "crm_students" AS student
      WHERE student."crm_id" =
        "family_merge_candidates"."right_student_crm_id"
    )
  );--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "family_merge_candidates"
    WHERE (
      "left_student_branch_crm_id" IS NULL
      OR "right_student_branch_crm_id" IS NULL
    )
      AND "status" NOT IN ('pending_review', 'stale')
  ) THEN
    RAISE EXCEPTION
      'family candidate migration blocked: a reviewed decision has ambiguous branch identity';
  END IF;
END
$$;--> statement-breakpoint
DELETE FROM "family_merge_candidates"
WHERE (
  "left_student_branch_crm_id" IS NULL
  OR "right_student_branch_crm_id" IS NULL
)
  AND "status" IN ('pending_review', 'stale');--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "family_merge_candidates"
    WHERE "left_student_branch_crm_id" IS NULL
       OR "right_student_branch_crm_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'family candidate migration blocked: branch identity remains unresolved';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "family_merge_candidates"
  ALTER COLUMN "left_student_branch_crm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "family_merge_candidates"
  ALTER COLUMN "right_student_branch_crm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "family_merge_candidates"
  DROP CONSTRAINT "family_merge_candidates_pair_uniq";--> statement-breakpoint
ALTER TABLE "family_merge_candidates"
  ADD CONSTRAINT "family_merge_candidates_pair_uniq"
  UNIQUE(
    "left_student_branch_crm_id",
    "left_student_crm_id",
    "right_student_branch_crm_id",
    "right_student_crm_id",
    "candidate_type"
  );
