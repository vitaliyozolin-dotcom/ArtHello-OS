DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "crm_groups" WHERE "branch_crm_id" IS NULL
    UNION ALL
    SELECT 1 FROM "crm_lessons" WHERE "branch_crm_id" IS NULL
    UNION ALL
    SELECT 1 FROM "crm_payments" WHERE "branch_crm_id" IS NULL
    UNION ALL
    SELECT 1 FROM "crm_students" WHERE "branch_crm_id" IS NULL
    UNION ALL
    SELECT 1 FROM "crm_teachers" WHERE "branch_crm_id" IS NULL
    UNION ALL
    SELECT 1 FROM "student_profiles" WHERE "branch_crm_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'branch-scoped AlfaCRM migration blocked: normalized rows lack branch_crm_id';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "crm_attendance" DROP CONSTRAINT "crm_attendance_lesson_student_uniq";--> statement-breakpoint
ALTER TABLE "crm_groups" DROP CONSTRAINT "crm_groups_crm_id_unique";--> statement-breakpoint
ALTER TABLE "crm_lessons" DROP CONSTRAINT "crm_lessons_crm_id_unique";--> statement-breakpoint
ALTER TABLE "crm_payments" DROP CONSTRAINT "crm_payments_crm_id_unique";--> statement-breakpoint
ALTER TABLE "crm_students" DROP CONSTRAINT "crm_students_crm_id_unique";--> statement-breakpoint
ALTER TABLE "crm_teachers" DROP CONSTRAINT "crm_teachers_crm_id_unique";--> statement-breakpoint
ALTER TABLE "student_profiles" DROP CONSTRAINT "student_profiles_student_crm_id_unique";--> statement-breakpoint
ALTER TABLE "crm_groups" ALTER COLUMN "branch_crm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_lessons" ALTER COLUMN "branch_crm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_payments" ALTER COLUMN "branch_crm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_students" ALTER COLUMN "branch_crm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_teachers" ALTER COLUMN "branch_crm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ALTER COLUMN "branch_crm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD COLUMN "branch_crm_id" text;--> statement-breakpoint
UPDATE "crm_attendance" AS attendance
SET "branch_crm_id" = observation."branch_id"
FROM "alpha_raw_observations" AS observation
WHERE observation."id" = attendance."raw_observation_id";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "crm_attendance"
    WHERE "branch_crm_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'branch-scoped AlfaCRM migration blocked: attendance provenance lacks branch_id';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "crm_attendance" ALTER COLUMN "branch_crm_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "student_profiles_branch_crm_uniq" ON "student_profiles" USING btree ("branch_crm_id","student_crm_id");--> statement-breakpoint
ALTER TABLE "crm_attendance" ADD CONSTRAINT "crm_attendance_lesson_student_uniq" UNIQUE("branch_crm_id","lesson_crm_id","student_crm_id");--> statement-breakpoint
ALTER TABLE "crm_groups" ADD CONSTRAINT "crm_groups_branch_crm_uniq" UNIQUE("branch_crm_id","crm_id");--> statement-breakpoint
ALTER TABLE "crm_lessons" ADD CONSTRAINT "crm_lessons_branch_crm_uniq" UNIQUE("branch_crm_id","crm_id");--> statement-breakpoint
ALTER TABLE "crm_payments" ADD CONSTRAINT "crm_payments_branch_crm_uniq" UNIQUE("branch_crm_id","crm_id");--> statement-breakpoint
ALTER TABLE "crm_students" ADD CONSTRAINT "crm_students_branch_crm_uniq" UNIQUE("branch_crm_id","crm_id");--> statement-breakpoint
ALTER TABLE "crm_teachers" ADD CONSTRAINT "crm_teachers_branch_crm_uniq" UNIQUE("branch_crm_id","crm_id");
