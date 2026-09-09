import { Router } from "express";
import {
  branchId,
  logger,
  pool,
  sql,
  sqlOne,
} from "../../routes/coverage/shared.js";

export const entityReconciliationRouter = Router();

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/entity-reconciliation
// ══════════════════════════════════════════════════════════════════════════════
entityReconciliationRouter.get(
  "/coverage/entity-reconciliation",
  async (req, res) => {
    const bid = branchId(req);
    try {
      // ── Students ─────────────────────────────────────────────────────────────
      const studentsRaw = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM alpha_raw_records WHERE entity_type='students' AND branch_id=$1`,
        [bid],
      );
      const studentsNorm = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM crm_students WHERE branch_crm_id=$1`,
        [bid],
      );
      const studentsProfiles = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM student_profiles WHERE branch_crm_id=$1`,
        [bid],
      );
      const studentsInFamilies = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM student_profiles WHERE branch_crm_id=$1 AND family_id IS NOT NULL`,
        [bid],
      );

      // Lifecycle status from crm_students (populated by normalize-students-from-raw)
      const studentsLifecycle = await sql(
        `
      SELECT COALESCE(lifecycle_status, 'not_set') AS lifecycle_status, COUNT(*) AS cnt
      FROM crm_students WHERE branch_crm_id=$1
      GROUP BY 1
    `,
        [bid],
      );
      const studentsWithoutFamily = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM crm_students cs
      LEFT JOIN student_profiles sp ON sp.student_crm_id = cs.crm_id
      WHERE cs.branch_crm_id=$1 AND sp.id IS NULL
    `,
        [bid],
      );
      const studentsRawNotNormalized = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records ar
      LEFT JOIN crm_students cs ON cs.crm_id = ar.alpha_id AND cs.branch_crm_id=$1
      WHERE ar.entity_type='students' AND ar.branch_id=$1 AND cs.id IS NULL
    `,
        [bid],
      );

      // Student status from raw payloads
      const studentsByIsStudy = await sql(
        `
      SELECT
        (source_payload->>'is_study')::int AS is_study,
        COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type='students' AND branch_id=$1
      GROUP BY 1
    `,
        [bid],
      );

      const studentsByArchive = await sql(
        `
      SELECT
        (source_payload->>'is_archive')::int AS is_archive,
        COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type='students' AND branch_id=$1
      GROUP BY 1
    `,
        [bid],
      );

      // Students with/without lessons/payments from raw
      const studentsWithLessons = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(DISTINCT l.source_payload->>'customer_id') AS cnt
      FROM alpha_raw_records l
      WHERE l.entity_type='lessons' AND l.branch_id=$1
        AND l.source_payload->>'customer_id' IS NOT NULL
    `,
        [bid],
      );

      const studentsWithPayments = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(DISTINCT p.source_payload->>'customer_id') AS cnt
      FROM alpha_raw_records p
      WHERE p.entity_type='payments' AND p.branch_id=$1
        AND p.source_payload->>'customer_id' IS NOT NULL
    `,
        [bid],
      );

      // ── Families ──────────────────────────────────────────────────────────────
      const familiesTotal = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM families`,
        [],
      );
      const familiesWithChildren = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(DISTINCT f.id) AS cnt
      FROM families f
      JOIN student_profiles sp ON sp.family_id = f.id
    `,
        [],
      );
      const familiesWithoutChildren = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM families f
      LEFT JOIN student_profiles sp ON sp.family_id = f.id
      WHERE sp.id IS NULL
    `,
        [],
      );
      const familiesWithActiveChildren = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(DISTINCT f.id) AS cnt
      FROM families f
      JOIN student_profiles sp ON sp.family_id = f.id
      WHERE COALESCE(sp.status, '') NOT IN ('archived', 'inactive', 'deleted')
    `,
        [],
      );

      // ── Lessons ───────────────────────────────────────────────────────────────
      const lessonsRaw = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM alpha_raw_records WHERE entity_type='lessons' AND branch_id=$1`,
        [bid],
      );
      const lessonsNorm = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM crm_lessons WHERE branch_crm_id=$1`,
        [bid],
      );
      const lessonsAttendance = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM crm_attendance`,
        [],
      );

      const lessonsByMonth = await sql(
        `
      SELECT
        to_char(to_date(source_payload->>'date', 'YYYY-MM-DD'), 'YYYY-MM') AS month,
        COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type='lessons' AND branch_id=$1
        AND source_payload->>'date' IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `,
        [bid],
      );

      const lessonsWithoutGroup = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type='lessons' AND branch_id=$1
        AND (source_payload->'group_ids' = '[]'::jsonb OR source_payload->'group_ids' IS NULL)
    `,
        [bid],
      );

      const lessonsWithoutSubject = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type='lessons' AND branch_id=$1
        AND (source_payload->>'subject_id' IS NULL OR source_payload->>'subject_id' = '')
    `,
        [bid],
      );

      const lessonsWithoutTeacher = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type='lessons' AND branch_id=$1
        AND (source_payload->'teacher_ids' = '[]'::jsonb OR source_payload->'teacher_ids' IS NULL)
    `,
        [bid],
      );

      // ── Payments ──────────────────────────────────────────────────────────────
      const paymentsRaw = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM alpha_raw_records WHERE entity_type='payments' AND branch_id=$1`,
        [bid],
      );
      const paymentsNorm = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM crm_payments WHERE branch_crm_id=$1`,
        [bid],
      );

      // Use crm_payments when normalized, otherwise fall back to raw
      const paymentsNormCount = Number(paymentsNorm?.cnt ?? 0);
      const useNormPayments = paymentsNormCount > 100; // P7.5 has been run

      const paymentsLinkingStats = useNormPayments
        ? await sqlOne<{
            student_linked: string;
            inactive_linked: string;
            identity_linked: string;
            family_linked: string;
            unlinked: string;
            no_customer: string;
            income_sum: string;
            outcome_sum: string;
            correction_sum: string;
            suspicious_high: string;
            negative_cnt: string;
          }>(
            `SELECT
             COUNT(CASE WHEN student_id IS NOT NULL AND EXISTS(
               SELECT 1 FROM crm_students cs WHERE cs.id=crm_payments.student_id AND cs.lifecycle_status != 'inactive'
             ) THEN 1 END)::text AS student_linked,
             COUNT(CASE WHEN student_id IS NOT NULL AND EXISTS(
               SELECT 1 FROM crm_students cs WHERE cs.id=crm_payments.student_id AND cs.lifecycle_status = 'inactive'
             ) THEN 1 END)::text AS inactive_linked,
             COUNT(CASE WHEN student_identity_id IS NOT NULL THEN 1 END)::text   AS identity_linked,
             COUNT(CASE WHEN family_id IS NOT NULL THEN 1 END)::text             AS family_linked,
             COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL THEN 1 END)::text AS unlinked,
             COUNT(CASE WHEN student_crm_id IS NULL THEN 1 END)::text            AS no_customer,
             COALESCE(SUM(CASE WHEN direction='income'     THEN income  ELSE 0 END), 0)::text AS income_sum,
             COALESCE(SUM(CASE WHEN direction='outcome'    THEN outcome ELSE 0 END), 0)::text AS outcome_sum,
             COALESCE(SUM(CASE WHEN direction='correction' THEN income  ELSE 0 END), 0)::text AS correction_sum,
             COUNT(CASE WHEN ABS(COALESCE(income, outcome, 0)) > 100000 THEN 1 END)::text AS suspicious_high,
             COUNT(CASE WHEN COALESCE(income, 0) < 0 THEN 1 END)::text          AS negative_cnt
           FROM crm_payments WHERE branch_crm_id=$1`,
            [bid],
          )
        : null;

      const paymentsLinkedToStudent = useNormPayments
        ? { cnt: paymentsLinkingStats?.student_linked ?? "0" }
        : await sqlOne<{ cnt: string }>(
            `
          SELECT COUNT(*)::text AS cnt
          FROM alpha_raw_records p
          JOIN alpha_raw_records s ON s.alpha_id = p.source_payload->>'customer_id' AND s.entity_type='students' AND s.branch_id=$1
          WHERE p.entity_type='payments' AND p.branch_id=$1`,
            [bid],
          );

      const paymentsUnlinked = useNormPayments
        ? { cnt: paymentsLinkingStats?.unlinked ?? "0" }
        : await sqlOne<{ cnt: string }>(
            `
          SELECT COUNT(*)::text AS cnt FROM alpha_raw_records
          WHERE entity_type='payments' AND branch_id=$1
            AND (source_payload->>'customer_id' IS NULL OR source_payload->>'customer_id' = '')`,
            [bid],
          );

      const paymentsTotalIncome = useNormPayments
        ? { total: paymentsLinkingStats?.income_sum ?? "0" }
        : await sqlOne<{ total: string }>(
            `
          SELECT SUM((source_payload->>'income')::numeric)::text AS total
          FROM alpha_raw_records WHERE entity_type='payments' AND branch_id=$1`,
            [bid],
          );

      const paymentsByMonth = useNormPayments
        ? await sql(
            `SELECT TO_CHAR(document_date,'YYYY-MM') AS raw_month,
             COUNT(*) AS cnt,
             COALESCE(SUM(CASE WHEN direction='income' THEN income ELSE 0 END), 0) AS income_sum,
             COALESCE(SUM(CASE WHEN direction='outcome' THEN outcome ELSE 0 END), 0) AS outcome_sum,
             COALESCE(SUM(CASE WHEN direction='correction' THEN income ELSE 0 END), 0) AS correction_sum
           FROM crm_payments WHERE branch_crm_id=$1 AND document_date IS NOT NULL
           GROUP BY raw_month ORDER BY raw_month`,
            [bid],
          )
        : await sql(
            `
          SELECT raw_month, COUNT(*) AS cnt, SUM(income_sum) AS income_sum
          FROM (
            SELECT substring(source_payload->>'document_date' from 4 for 7) AS raw_month,
              split_part(source_payload->>'document_date', '.', 3) || '-' ||
              split_part(source_payload->>'document_date', '.', 2) AS sort_key,
              (source_payload->>'income')::numeric AS income_sum
            FROM alpha_raw_records
            WHERE entity_type='payments' AND branch_id=$1 AND source_payload->>'document_date' IS NOT NULL
          ) sub GROUP BY raw_month, sort_key ORDER BY sort_key`,
            [bid],
          );

      const paymentsSuspiciousHigh = useNormPayments
        ? await sql(
            `SELECT crm_id AS alpha_id, income::text, document_date::text AS date, student_crm_id AS customer_id, outcome::text, direction
           FROM crm_payments WHERE branch_crm_id=$1 AND ABS(COALESCE(income, outcome, 0)) > 100000
           ORDER BY ABS(COALESCE(income, outcome, 0)) DESC LIMIT 20`,
            [bid],
          )
        : await sql(
            `
          SELECT alpha_id, source_payload->>'income' AS income, source_payload->>'document_date' AS date,
                 source_payload->>'customer_id' AS customer_id
          FROM alpha_raw_records WHERE entity_type='payments' AND branch_id=$1
            AND (source_payload->>'income')::numeric > 100000
          ORDER BY (source_payload->>'income')::numeric DESC LIMIT 20`,
            [bid],
          );

      const paymentsNegative = useNormPayments
        ? await sql(
            `SELECT crm_id AS alpha_id, income::text, document_date::text AS date
           FROM crm_payments WHERE branch_crm_id=$1 AND COALESCE(income, 0) < 0
           ORDER BY income LIMIT 20`,
            [bid],
          )
        : await sql(
            `
          SELECT alpha_id, source_payload->>'income' AS income, source_payload->>'document_date' AS date
          FROM alpha_raw_records WHERE entity_type='payments' AND branch_id=$1
            AND (source_payload->>'income')::numeric < 0`,
            [bid],
          );

      // ── Groups ────────────────────────────────────────────────────────────────
      const groupsRaw = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM alpha_raw_records WHERE entity_type='groups' AND branch_id=$1`,
        [bid],
      );
      const groupsNorm = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM crm_groups WHERE branch_crm_id=$1`,
        [bid],
      );
      const groupsWithTeacher = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt FROM crm_groups
      WHERE branch_crm_id=$1
        AND jsonb_array_length(teacher_crm_ids) > 0
    `,
        [bid],
      );
      const groupsWithoutSubjectIssues = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt FROM alpha_linking_issues
      WHERE issue_type='group_without_subject' AND missing_reference_type=$1
    `,
        [bid],
      );
      const groupsWithoutTeacherIssues = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt FROM alpha_linking_issues
      WHERE issue_type='group_without_teacher' AND missing_reference_type=$1
    `,
        [bid],
      );
      const groupsLifecycle = await sql(
        `
      SELECT lifecycle_status, COUNT(*) AS cnt FROM crm_groups WHERE branch_crm_id=$1 GROUP BY 1
    `,
        [bid],
      );

      // ── Subjects ──────────────────────────────────────────────────────────────
      const subjectsRaw = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM alpha_raw_records WHERE entity_type='subjects' AND branch_id=$1`,
        [bid],
      );
      const subjectsReferencedByLessons = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(DISTINCT source_payload->>'subject_id') AS cnt
      FROM alpha_raw_records
      WHERE entity_type='lessons' AND branch_id=$1 AND source_payload->>'subject_id' IS NOT NULL
    `,
        [bid],
      );
      const subjectsReferencedByGroups = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(DISTINCT source_payload->>'subject_id') AS cnt
      FROM alpha_raw_records
      WHERE entity_type='groups' AND branch_id=$1 AND source_payload->>'subject_id' IS NOT NULL
    `,
        [bid],
      );
      const subjectIdsInLessonsNotInSubjects = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(DISTINCT l.source_payload->>'subject_id') AS cnt
      FROM alpha_raw_records l
      LEFT JOIN alpha_raw_records s ON s.alpha_id = l.source_payload->>'subject_id' AND s.entity_type='subjects' AND s.branch_id=$1
      WHERE l.entity_type='lessons' AND l.branch_id=$1
        AND l.source_payload->>'subject_id' IS NOT NULL
        AND s.id IS NULL
    `,
        [bid],
      );

      // ── Teachers ──────────────────────────────────────────────────────────────
      const teachersRaw = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM alpha_raw_records WHERE entity_type='teachers' AND branch_id=$1`,
        [bid],
      );
      const teachersNorm = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM crm_teachers WHERE branch_crm_id=$1`,
        [bid],
      );
      const teachersLinkedToLessons = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(DISTINCT tid) AS cnt
      FROM alpha_raw_records,
           jsonb_array_elements_text(source_payload->'teacher_ids') AS tid
      WHERE entity_type='lessons' AND branch_id=$1
    `,
        [bid],
      );
      const teachersLifecycle = await sql(
        `
      SELECT lifecycle_status, COUNT(*) AS cnt FROM crm_teachers WHERE branch_crm_id=$1 GROUP BY 1
    `,
        [bid],
      );
      const teachersWithPhone = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM crm_teachers WHERE branch_crm_id=$1 AND phone IS NOT NULL`,
        [bid],
      );

      res.json({
        branchId: bid,
        auditType: "entity-reconciliation",
        generatedAt: new Date().toISOString(),
        students: {
          raw: Number(studentsRaw?.cnt ?? 0),
          normalized: Number(studentsNorm?.cnt ?? 0),
          studentProfiles: Number(studentsProfiles?.cnt ?? 0),
          inFamilies: Number(studentsInFamilies?.cnt ?? 0),
          notNormalized:
            Number(studentsRaw?.cnt ?? 0) - Number(studentsNorm?.cnt ?? 0),
          rawNotNormalized: Number(studentsRawNotNormalized?.cnt ?? 0),
          normalizedWithoutProfile:
            Number(studentsNorm?.cnt ?? 0) - Number(studentsProfiles?.cnt ?? 0),
          withoutFamilyLink: Number(studentsWithoutFamily?.cnt ?? 0),
          lifecycleByStatus: studentsLifecycle,
          byIsStudy: studentsByIsStudy,
          byIsArchive: studentsByArchive,
          uniqueStudentIdsInLessons: Number(studentsWithLessons?.cnt ?? 0),
          uniqueStudentIdsInPayments: Number(studentsWithPayments?.cnt ?? 0),
          statusNote:
            "is_study=1: currently enrolled; is_archive=1: archived/left; lifecycle_status populated by P7.1 normalize-students-from-raw",
        },
        families: {
          total: Number(familiesTotal?.cnt ?? 0),
          withChildren: Number(familiesWithChildren?.cnt ?? 0),
          withoutChildren: Number(familiesWithoutChildren?.cnt ?? 0),
          withActiveChildren: Number(familiesWithActiveChildren?.cnt ?? 0),
          withOnlyInactiveChildren:
            Number(familiesWithChildren?.cnt ?? 0) -
            Number(familiesWithActiveChildren?.cnt ?? 0),
        },
        lessons: {
          raw: Number(lessonsRaw?.cnt ?? 0),
          normalized: Number(lessonsNorm?.cnt ?? 0),
          notNormalized:
            Number(lessonsRaw?.cnt ?? 0) - Number(lessonsNorm?.cnt ?? 0),
          normalizationRate: Math.round(
            (Number(lessonsNorm?.cnt ?? 0) / Number(lessonsRaw?.cnt ?? 1)) *
              100,
          ),
          attendanceRecords: Number(lessonsAttendance?.cnt ?? 0),
          withoutGroup: Number(lessonsWithoutGroup?.cnt ?? 0),
          withoutSubject: Number(lessonsWithoutSubject?.cnt ?? 0),
          withoutTeacher: Number(lessonsWithoutTeacher?.cnt ?? 0),
          byMonth: lessonsByMonth,
        },
        payments: {
          raw: Number(paymentsRaw?.cnt ?? 0),
          normalized: Number(paymentsNorm?.cnt ?? 0),
          notNormalized:
            Number(paymentsRaw?.cnt ?? 0) - Number(paymentsNorm?.cnt ?? 0),
          normalizationRate: Math.round(
            (Number(paymentsNorm?.cnt ?? 0) / Number(paymentsRaw?.cnt ?? 1)) *
              100,
          ),
          p75NormalizationDone: useNormPayments,
          linkedToActiveStudent: Number(
            paymentsLinkingStats?.student_linked ??
              paymentsLinkedToStudent?.cnt ??
              0,
          ),
          linkedToInactiveStudent: Number(
            paymentsLinkingStats?.inactive_linked ?? 0,
          ),
          linkedToIdentity: Number(paymentsLinkingStats?.identity_linked ?? 0),
          linkedToFamily: Number(paymentsLinkingStats?.family_linked ?? 0),
          unlinked: Number(
            paymentsLinkingStats?.unlinked ?? paymentsUnlinked?.cnt ?? 0,
          ),
          noCustomerId: Number(paymentsLinkingStats?.no_customer ?? 0),
          incomeSum: Number(
            paymentsLinkingStats?.income_sum ?? paymentsTotalIncome?.total ?? 0,
          ),
          outcomeSum: Number(paymentsLinkingStats?.outcome_sum ?? 0),
          correctionSum: Number(paymentsLinkingStats?.correction_sum ?? 0),
          suspiciousHighCount: Number(
            paymentsLinkingStats?.suspicious_high ?? 0,
          ),
          negativeCount: Number(paymentsLinkingStats?.negative_cnt ?? 0),
          suspiciousHigh: paymentsSuspiciousHigh,
          negative: paymentsNegative,
          byMonth: paymentsByMonth,
          note: "AlphaCRM payments = operational records. NOT bank truth. Reconciliation required. Run /coverage/payment-truth-audit for full breakdown.",
        },
        groups: {
          raw: Number(groupsRaw?.cnt ?? 0),
          normalized: Number(groupsNorm?.cnt ?? 0),
          notNormalized:
            Number(groupsRaw?.cnt ?? 0) - Number(groupsNorm?.cnt ?? 0),
          normalizationRate:
            Number(groupsNorm?.cnt ?? 0) > 0
              ? Math.round(
                  (Number(groupsNorm?.cnt ?? 0) / Number(groupsRaw?.cnt ?? 1)) *
                    100,
                )
              : 0,
          withTeacher: Number(groupsWithTeacher?.cnt ?? 0),
          withoutTeacher:
            Number(groupsRaw?.cnt ?? 0) - Number(groupsWithTeacher?.cnt ?? 0),
          withoutSubject: Number(groupsWithoutSubjectIssues?.cnt ?? 0),
          withSubject: 0,
          lifecycleByStatus: groupsLifecycle,
          subjectInference: await (async () => {
            const r = await sqlOne<{
              with_primary: string;
              ambiguous: string;
              still_without: string;
            }>(
              `
            SELECT
              COUNT(*) FILTER (WHERE inferred_subject_crm_id IS NOT NULL) AS with_primary,
              COUNT(*) FILTER (WHERE subject_inference_status='ambiguous')  AS ambiguous,
              COUNT(*) FILTER (WHERE inferred_subject_crm_id IS NULL AND subject_inference_status IS DISTINCT FROM 'ambiguous') AS still_without
            FROM crm_groups WHERE branch_crm_id=$1
          `,
              [bid],
            );
            return {
              withPrimary: Number(r?.with_primary ?? 0),
              ambiguous: Number(r?.ambiguous ?? 0),
              stillWithout: Number(r?.still_without ?? 0),
            };
          })(),
          note: "AlphaCRM groups have no subject_id field — subject is inferred from lessons referencing the group via P7.3",
        },
        subjects: {
          raw: Number(subjectsRaw?.cnt ?? 0),
          referencedByLessons: Number(subjectsReferencedByLessons?.cnt ?? 0),
          referencedByGroups: Number(subjectsReferencedByGroups?.cnt ?? 0),
          unresolvedInLessons: Number(
            subjectIdsInLessonsNotInSubjects?.cnt ?? 0,
          ),
        },
        teachers: {
          raw: Number(teachersRaw?.cnt ?? 0),
          normalized: Number(teachersNorm?.cnt ?? 0),
          notNormalized:
            Number(teachersRaw?.cnt ?? 0) - Number(teachersNorm?.cnt ?? 0),
          normalizationRate:
            Number(teachersNorm?.cnt ?? 0) > 0
              ? Math.round(
                  (Number(teachersNorm?.cnt ?? 0) /
                    Number(teachersRaw?.cnt ?? 1)) *
                    100,
                )
              : 0,
          withPhone: Number(teachersWithPhone?.cnt ?? 0),
          uniqueLinkedToLessons: Number(teachersLinkedToLessons?.cnt ?? 0),
          lifecycleByStatus: teachersLifecycle,
          statusNote:
            "all Atlas teachers have e_date='2030-12-31' — all active; lifecycle_status populated by P7.2 normalize-teachers-from-raw",
        },
        attendance: await (async () => {
          const attTotal = await sqlOne<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM crm_attendance WHERE branch_id=$1`,
            [bid],
          );
          const attLinkedStudent = await sqlOne<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM crm_attendance WHERE branch_id=$1 AND student_id IS NOT NULL`,
            [bid],
          );
          const attLinkedFamily = await sqlOne<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM crm_attendance WHERE branch_id=$1 AND family_id IS NOT NULL`,
            [bid],
          );
          const attPresent = await sqlOne<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM crm_attendance WHERE branch_id=$1 AND visit_status_normalized='present'`,
            [bid],
          );
          const attAbsent = await sqlOne<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM crm_attendance WHERE branch_id=$1 AND visit_status_normalized='absent'`,
            [bid],
          );
          const attUnknown = await sqlOne<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM crm_attendance WHERE branch_id=$1 AND visit_status_normalized='unknown'`,
            [bid],
          );
          const attDistinctStudents = await sqlOne<{ cnt: string }>(
            `SELECT COUNT(DISTINCT student_alpha_id) AS cnt FROM crm_attendance WHERE branch_id=$1`,
            [bid],
          );
          const attDistinctLessons = await sqlOne<{ cnt: string }>(
            `SELECT COUNT(DISTINCT lesson_id) AS cnt FROM crm_attendance WHERE branch_id=$1`,
            [bid],
          );
          const attLessonsWithout = await sqlOne<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM crm_lessons WHERE branch_crm_id=$1 AND raw_record_id IS NOT NULL AND (visits_count=0 OR visits_raw IS NULL)`,
            [bid],
          );
          const embedded = 99148;
          const normalized = Number(attTotal?.cnt ?? 0);
          return {
            embeddedVisitsInLessons: embedded,
            normalized,
            extractionRate:
              normalized > 0 ? Math.round((normalized / embedded) * 100) : 0,
            linkedToStudents: Number(attLinkedStudent?.cnt ?? 0),
            notLinkedToStudents:
              Number(attTotal?.cnt ?? 0) - Number(attLinkedStudent?.cnt ?? 0),
            linkedToFamilies: Number(attLinkedFamily?.cnt ?? 0),
            notLinkedToFamilies:
              Number(attTotal?.cnt ?? 0) - Number(attLinkedFamily?.cnt ?? 0),
            statusPresent: Number(attPresent?.cnt ?? 0),
            statusAbsent: Number(attAbsent?.cnt ?? 0),
            statusUnknown: Number(attUnknown?.cnt ?? 0),
            distinctStudentAlphaIds: Number(attDistinctStudents?.cnt ?? 0),
            distinctLessonsWithAttendance: Number(attDistinctLessons?.cnt ?? 0),
            lessonsWithoutAttendance: Number(attLessonsWithout?.cnt ?? 0),
            note: "student_id linked only for Atlas branch students (91 normalized). 308 distinct customers in visits; ~224 are from other branches.",
          };
        })(),
      });
    } catch (err) {
      logger.error({ err }, "entity-reconciliation failed");
      res.status(500).json({ error: "entity-reconciliation query failed" });
    }
  },
);
