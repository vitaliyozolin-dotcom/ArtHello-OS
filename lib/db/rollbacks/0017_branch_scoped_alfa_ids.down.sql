DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "crm_groups"
    GROUP BY "crm_id"
    HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1
    FROM "crm_lessons"
    GROUP BY "crm_id"
    HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1
    FROM "crm_payments"
    GROUP BY "crm_id"
    HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1
    FROM "crm_students"
    GROUP BY "crm_id"
    HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1
    FROM "crm_teachers"
    GROUP BY "crm_id"
    HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1
    FROM "student_profiles"
    GROUP BY "student_crm_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'rollback blocked: branch-scoped rows would be lost; restore the pre-migration backup instead';
  END IF;
END
$$;

ALTER TABLE "crm_attendance"
  DROP CONSTRAINT IF EXISTS "crm_attendance_lesson_student_uniq";
ALTER TABLE "crm_groups"
  DROP CONSTRAINT IF EXISTS "crm_groups_branch_crm_uniq";
ALTER TABLE "crm_lessons"
  DROP CONSTRAINT IF EXISTS "crm_lessons_branch_crm_uniq";
ALTER TABLE "crm_payments"
  DROP CONSTRAINT IF EXISTS "crm_payments_branch_crm_uniq";
ALTER TABLE "crm_students"
  DROP CONSTRAINT IF EXISTS "crm_students_branch_crm_uniq";
ALTER TABLE "crm_teachers"
  DROP CONSTRAINT IF EXISTS "crm_teachers_branch_crm_uniq";
DROP INDEX IF EXISTS "student_profiles_branch_crm_uniq";

ALTER TABLE "crm_attendance"
  ADD CONSTRAINT "crm_attendance_lesson_student_uniq"
  UNIQUE ("lesson_crm_id", "student_crm_id");
ALTER TABLE "crm_groups"
  ADD CONSTRAINT "crm_groups_crm_id_unique" UNIQUE ("crm_id");
ALTER TABLE "crm_lessons"
  ADD CONSTRAINT "crm_lessons_crm_id_unique" UNIQUE ("crm_id");
ALTER TABLE "crm_payments"
  ADD CONSTRAINT "crm_payments_crm_id_unique" UNIQUE ("crm_id");
ALTER TABLE "crm_students"
  ADD CONSTRAINT "crm_students_crm_id_unique" UNIQUE ("crm_id");
ALTER TABLE "crm_teachers"
  ADD CONSTRAINT "crm_teachers_crm_id_unique" UNIQUE ("crm_id");
ALTER TABLE "student_profiles"
  ADD CONSTRAINT "student_profiles_student_crm_id_unique"
  UNIQUE ("student_crm_id");

ALTER TABLE "crm_groups" ALTER COLUMN "branch_crm_id" DROP NOT NULL;
ALTER TABLE "crm_lessons" ALTER COLUMN "branch_crm_id" DROP NOT NULL;
ALTER TABLE "crm_payments" ALTER COLUMN "branch_crm_id" DROP NOT NULL;
ALTER TABLE "crm_students" ALTER COLUMN "branch_crm_id" DROP NOT NULL;
ALTER TABLE "crm_teachers" ALTER COLUMN "branch_crm_id" DROP NOT NULL;
ALTER TABLE "student_profiles" ALTER COLUMN "branch_crm_id" DROP NOT NULL;
ALTER TABLE "crm_attendance" DROP COLUMN "branch_crm_id";
