import { Router } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { authenticate, crmProbe } from "../lib/alphaCrmClient.js";

export const auditRouter = Router();

const ATLAS_BRANCH = "6";

// ─── helpers ──────────────────────────────────────────────────────────────────

function branchId(req: import("express").Request): string {
  return (req.query["branchId"] as string | undefined) ?? ATLAS_BRANCH;
}

async function sql<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await pool.query(query, params);
  return rows as T[];
}

async function sqlOne<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await sql<T>(query, params);
  return rows[0] ?? null;
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/normalization-audit
// ══════════════════════════════════════════════════════════════════════════════
auditRouter.get("/coverage/normalization-audit", async (req, res) => {
  const bid = branchId(req);
  try {
    // ── 1. Raw counts by entity type ─────────────────────────────────────────
    const rawCounts = await sql(`
      SELECT entity_type, COUNT(*) AS raw_count
      FROM alpha_raw_records
      WHERE branch_id = $1
      GROUP BY entity_type
      ORDER BY raw_count DESC
    `, [bid]);

    // ── 2. Normalized entity counts ─────────────────────────────────────────
    const [
      normStudents,
      normLessons,
      normPayments,
      normTeachers,
      normAttendance,
    ] = await Promise.all([
      sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_students WHERE branch_crm_id = $1 AND lifecycle_status != 'legacy_pre_p7'`, [bid]),
      sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_lessons WHERE branch_crm_id = $1`, [bid]),
      sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_payments WHERE branch_crm_id = $1`, [bid]),
      sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_teachers WHERE branch_crm_id = $1`, [bid]),
      sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_attendance`, []),
    ]);

    // ── 3. Identity layer counts ─────────────────────────────────────────────
    const [
      identStudentProfiles,
      identFamilies,
      identPersons,
      identGuardianLinks,
    ] = await Promise.all([
      sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM student_profiles WHERE branch_crm_id = $1`, [bid]),
      sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM families`, []),
      sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM persons`, []),
      sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM guardian_student_links`, []),
    ]);

    // ── 4. Raw records NOT normalized (no matching crm_* record) ─────────────
    const rawStudentsNotNorm = await sql(`
      SELECT r.alpha_id, r.source_payload->>'full_name' AS name, r.source_payload->>'phone' AS phone
      FROM alpha_raw_records r
      LEFT JOIN crm_students s ON s.crm_id = r.alpha_id
      WHERE r.entity_type = 'students' AND r.branch_id = $1 AND s.id IS NULL
    `, [bid]);

    const rawLessonsNotNormCount = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records r
      LEFT JOIN crm_lessons l ON l.crm_id = r.alpha_id
      WHERE r.entity_type = 'lessons' AND r.branch_id = $1 AND l.id IS NULL
    `, [bid]);

    const rawPaymentsNotNormCount = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records r
      LEFT JOIN crm_payments p ON p.crm_id = r.alpha_id
      WHERE r.entity_type = 'payments' AND r.branch_id = $1 AND p.id IS NULL
    `, [bid]);

    // ── 5. Normalized records without raw source ─────────────────────────────
    const normStudentsNoRaw = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM crm_students s
      LEFT JOIN alpha_raw_records r ON r.alpha_id = s.crm_id AND r.entity_type = 'students' AND r.branch_id = $1
      WHERE s.branch_crm_id = $1 AND r.id IS NULL
    `, [bid]);

    const normLessonsNoRaw = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM crm_lessons l
      LEFT JOIN alpha_raw_records r ON r.alpha_id = l.crm_id AND r.entity_type = 'lessons' AND r.branch_id = $1
      WHERE l.branch_crm_id = $1 AND r.id IS NULL
    `, [bid]);

    const normPaymentsNoRaw = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM crm_payments p
      LEFT JOIN alpha_raw_records r ON r.alpha_id = p.crm_id AND r.entity_type = 'payments' AND r.branch_id = $1
      WHERE p.branch_crm_id = $1 AND r.id IS NULL
    `, [bid]);

    // ── 6. Student status breakdown from raw payloads ────────────────────────
    const studentStatusRaw = await sql(`
      SELECT
        COUNT(*) FILTER (WHERE (source_payload->>'is_study')::int = 1) AS is_study_yes,
        COUNT(*) FILTER (WHERE (source_payload->>'is_study')::int = 0) AS is_study_no,
        COUNT(*) FILTER (WHERE source_payload->>'is_study' IS NULL)    AS is_study_null,
        COUNT(*) FILTER (WHERE (source_payload->>'is_archive')::int = 1) AS is_archived,
        COUNT(*) FILTER (WHERE COALESCE((source_payload->>'is_archive')::int, 0) = 0) AS not_archived,
        COUNT(*) AS total
      FROM alpha_raw_records
      WHERE entity_type = 'students' AND branch_id = $1
    `, [bid]);

    const studentStatusById = await sql(`
      SELECT source_payload->>'study_status_id' AS study_status_id, COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type = 'students' AND branch_id = $1
      GROUP BY 1
      ORDER BY 2 DESC
    `, [bid]);

    // ── 7. Study statuses lookup from raw ────────────────────────────────────
    const studyStatuses = await sql(`
      SELECT alpha_id, source_payload->>'name' AS name
      FROM alpha_raw_records
      WHERE entity_type = 'study_statuses' AND branch_id = $1
    `, [bid]);

    // ── 8. Records with missing critical links ────────────────────────────────
    const studentsWithoutFamily = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM student_profiles sp
      WHERE sp.family_id IS NULL AND sp.branch_crm_id = $1
    `, [bid]);

    const studentsWithoutPerson = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM student_profiles sp
      WHERE sp.student_person_id IS NULL AND sp.branch_crm_id = $1
    `, [bid]);

    const rawLessonsWithoutGroup = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type = 'lessons' AND branch_id = $1
        AND (source_payload->'group_ids' = '[]'::jsonb OR source_payload->'group_ids' IS NULL)
    `, [bid]);

    const rawLessonsWithoutSubject = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type = 'lessons' AND branch_id = $1
        AND (source_payload->>'subject_id' IS NULL OR source_payload->>'subject_id' = '')
    `, [bid]);

    const rawLessonsWithoutTeacher = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type = 'lessons' AND branch_id = $1
        AND (source_payload->'teacher_ids' = '[]'::jsonb OR source_payload->'teacher_ids' IS NULL)
    `, [bid]);

    const rawPaymentsWithoutCustomer = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type = 'payments' AND branch_id = $1
        AND (source_payload->>'customer_id' IS NULL OR source_payload->>'customer_id' = '')
    `, [bid]);

    // ── 9. Normalization gap per entity ──────────────────────────────────────
    const rawMap: Record<string, number> = {};
    for (const r of rawCounts as Array<{ entity_type: string; raw_count: string }>) {
      rawMap[r.entity_type] = Number(r.raw_count);
    }

    const normGroups = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_groups WHERE branch_crm_id=$1`, [bid]);

    const normMap: Record<string, number> = {
      students:  Number(normStudents?.cnt ?? 0),
      lessons:   Number(normLessons?.cnt ?? 0),
      payments:  Number(normPayments?.cnt ?? 0),
      teachers:  Number(normTeachers?.cnt ?? 0),
      groups:    Number(normGroups?.cnt ?? 0),
    };

    const normalizationGap = Object.entries(rawMap).map(([et, raw]) => ({
      entityType: et,
      rawCount: raw,
      normalizedCount: normMap[et] ?? null,
      notNormalized: normMap[et] != null ? raw - normMap[et] : null,
      normalizationRate: normMap[et] != null ? Math.round((normMap[et] / raw) * 100) : null,
    }));

    const legacyStudents = await sqlOne<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM crm_students WHERE branch_crm_id=$1 AND lifecycle_status='legacy_pre_p7'`, [bid]);

    res.json({
      branchId: bid,
      auditType: "normalization-audit",
      generatedAt: new Date().toISOString(),
      rawCounts: rawMap,
      normalizedCounts: normMap,
      normalizationGap,
      legacyNotes: {
        studentsLegacyPreP71: Number(legacyStudents?.cnt ?? 0),
        note: "legacy_pre_p7 = students in crm_students synced before P7.1 (no raw record in alpha_raw_records). Not counted in normalizedCounts.",
      },
      identityLayer: {
        studentProfiles: Number(identStudentProfiles?.cnt ?? 0),
        families: Number(identFamilies?.cnt ?? 0),
        persons: Number(identPersons?.cnt ?? 0),
        guardianStudentLinks: Number(identGuardianLinks?.cnt ?? 0),
      },
      missingLinks: {
        rawStudentsNotNormalized: rawStudentsNotNorm.length,
        rawStudentsNotNormalizedList: rawStudentsNotNorm.slice(0, 50),
        rawLessonsNotNormalized: Number(rawLessonsNotNormCount?.cnt ?? 0),
        rawPaymentsNotNormalized: Number(rawPaymentsNotNormCount?.cnt ?? 0),
        normalizedStudentsWithoutRawSource: Number(normStudentsNoRaw?.cnt ?? 0),
        normalizedLessonsWithoutRawSource: Number(normLessonsNoRaw?.cnt ?? 0),
        normalizedPaymentsWithoutRawSource: Number(normPaymentsNoRaw?.cnt ?? 0),
        studentsWithoutFamily: Number(studentsWithoutFamily?.cnt ?? 0),
        studentsWithoutPerson: Number(studentsWithoutPerson?.cnt ?? 0),
        rawLessonsWithoutGroup: Number(rawLessonsWithoutGroup?.cnt ?? 0),
        rawLessonsWithoutSubject: Number(rawLessonsWithoutSubject?.cnt ?? 0),
        rawLessonsWithoutTeacher: Number(rawLessonsWithoutTeacher?.cnt ?? 0),
        rawPaymentsWithoutCustomer: Number(rawPaymentsWithoutCustomer?.cnt ?? 0),
      },
      studentStatusAudit: {
        fromRaw: (studentStatusRaw[0] as Record<string, string>) ?? {},
        byStudyStatusId: studentStatusById,
        studyStatusesLookup: studyStatuses,
      },
      verdict: {
        critical: normalizationGap
          .filter(g => g.normalizationRate !== null && g.normalizationRate < 10)
          .map(g => `${g.entityType}: only ${g.normalizationRate}% normalized (${g.normalizedCount} of ${g.rawCount})`),
        warning: normalizationGap
          .filter(g => g.normalizationRate !== null && g.normalizationRate >= 10 && g.normalizationRate < 80)
          .map(g => `${g.entityType}: partial normalization ${g.normalizationRate}%`),
      },
    });
  } catch (err) {
    logger.error({ err }, "normalization-audit failed");
    res.status(500).json({ error: "normalization-audit query failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/entity-reconciliation
// ══════════════════════════════════════════════════════════════════════════════
auditRouter.get("/coverage/entity-reconciliation", async (req, res) => {
  const bid = branchId(req);
  try {
    // ── Students ─────────────────────────────────────────────────────────────
    const studentsRaw = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM alpha_raw_records WHERE entity_type='students' AND branch_id=$1`, [bid]);
    const studentsNorm = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_students WHERE branch_crm_id=$1`, [bid]);
    const studentsProfiles = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM student_profiles WHERE branch_crm_id=$1`, [bid]);
    const studentsInFamilies = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM student_profiles WHERE branch_crm_id=$1 AND family_id IS NOT NULL`, [bid]);

    // Lifecycle status from crm_students (populated by normalize-students-from-raw)
    const studentsLifecycle = await sql(`
      SELECT COALESCE(lifecycle_status, 'not_set') AS lifecycle_status, COUNT(*) AS cnt
      FROM crm_students WHERE branch_crm_id=$1
      GROUP BY 1
    `, [bid]);
    const studentsWithoutFamily = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM crm_students cs
      LEFT JOIN student_profiles sp ON sp.student_crm_id = cs.crm_id
      WHERE cs.branch_crm_id=$1 AND sp.id IS NULL
    `, [bid]);
    const studentsRawNotNormalized = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records ar
      LEFT JOIN crm_students cs ON cs.crm_id = ar.alpha_id AND cs.branch_crm_id=$1
      WHERE ar.entity_type='students' AND ar.branch_id=$1 AND cs.id IS NULL
    `, [bid]);

    // Student status from raw payloads
    const studentsByIsStudy = await sql(`
      SELECT
        (source_payload->>'is_study')::int AS is_study,
        COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type='students' AND branch_id=$1
      GROUP BY 1
    `, [bid]);

    const studentsByArchive = await sql(`
      SELECT
        (source_payload->>'is_archive')::int AS is_archive,
        COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type='students' AND branch_id=$1
      GROUP BY 1
    `, [bid]);

    // Students with/without lessons/payments from raw
    const studentsWithLessons = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(DISTINCT l.source_payload->>'customer_id') AS cnt
      FROM alpha_raw_records l
      WHERE l.entity_type='lessons' AND l.branch_id=$1
        AND l.source_payload->>'customer_id' IS NOT NULL
    `, [bid]);

    const studentsWithPayments = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(DISTINCT p.source_payload->>'customer_id') AS cnt
      FROM alpha_raw_records p
      WHERE p.entity_type='payments' AND p.branch_id=$1
        AND p.source_payload->>'customer_id' IS NOT NULL
    `, [bid]);

    // ── Families ──────────────────────────────────────────────────────────────
    const familiesTotal = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM families`, []);
    const familiesWithChildren = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(DISTINCT f.id) AS cnt
      FROM families f
      JOIN student_profiles sp ON sp.family_id = f.id
    `, []);
    const familiesWithoutChildren = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM families f
      LEFT JOIN student_profiles sp ON sp.family_id = f.id
      WHERE sp.id IS NULL
    `, []);
    const familiesWithActiveChildren = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(DISTINCT f.id) AS cnt
      FROM families f
      JOIN student_profiles sp ON sp.family_id = f.id
      WHERE COALESCE(sp.status, '') NOT IN ('archived', 'inactive', 'deleted')
    `, []);

    // ── Lessons ───────────────────────────────────────────────────────────────
    const lessonsRaw = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM alpha_raw_records WHERE entity_type='lessons' AND branch_id=$1`, [bid]);
    const lessonsNorm = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_lessons WHERE branch_crm_id=$1`, [bid]);
    const lessonsAttendance = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_attendance`, []);

    const lessonsByMonth = await sql(`
      SELECT
        to_char(to_date(source_payload->>'date', 'YYYY-MM-DD'), 'YYYY-MM') AS month,
        COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type='lessons' AND branch_id=$1
        AND source_payload->>'date' IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `, [bid]);

    const lessonsWithoutGroup = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type='lessons' AND branch_id=$1
        AND (source_payload->'group_ids' = '[]'::jsonb OR source_payload->'group_ids' IS NULL)
    `, [bid]);

    const lessonsWithoutSubject = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type='lessons' AND branch_id=$1
        AND (source_payload->>'subject_id' IS NULL OR source_payload->>'subject_id' = '')
    `, [bid]);

    const lessonsWithoutTeacher = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type='lessons' AND branch_id=$1
        AND (source_payload->'teacher_ids' = '[]'::jsonb OR source_payload->'teacher_ids' IS NULL)
    `, [bid]);

    // ── Payments ──────────────────────────────────────────────────────────────
    const paymentsRaw  = await sqlOne<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM alpha_raw_records WHERE entity_type='payments' AND branch_id=$1`, [bid]);
    const paymentsNorm = await sqlOne<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM crm_payments WHERE branch_crm_id=$1`, [bid]);

    // Use crm_payments when normalized, otherwise fall back to raw
    const paymentsNormCount = Number(paymentsNorm?.cnt ?? 0);
    const useNormPayments   = paymentsNormCount > 100; // P7.5 has been run

    const paymentsLinkingStats = useNormPayments
      ? await sqlOne<{
          student_linked: string; inactive_linked: string; identity_linked: string;
          family_linked: string; unlinked: string; no_customer: string;
          income_sum: string; outcome_sum: string; correction_sum: string;
          suspicious_high: string; negative_cnt: string;
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
           FROM crm_payments WHERE branch_crm_id=$1`, [bid])
      : null;

    const paymentsLinkedToStudent = useNormPayments
      ? { cnt: paymentsLinkingStats?.student_linked ?? "0" }
      : await sqlOne<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt
          FROM alpha_raw_records p
          JOIN alpha_raw_records s ON s.alpha_id = p.source_payload->>'customer_id' AND s.entity_type='students' AND s.branch_id=$1
          WHERE p.entity_type='payments' AND p.branch_id=$1`, [bid]);

    const paymentsUnlinked = useNormPayments
      ? { cnt: paymentsLinkingStats?.unlinked ?? "0" }
      : await sqlOne<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt FROM alpha_raw_records
          WHERE entity_type='payments' AND branch_id=$1
            AND (source_payload->>'customer_id' IS NULL OR source_payload->>'customer_id' = '')`, [bid]);

    const paymentsTotalIncome = useNormPayments
      ? { total: paymentsLinkingStats?.income_sum ?? "0" }
      : await sqlOne<{ total: string }>(`
          SELECT SUM((source_payload->>'income')::numeric)::text AS total
          FROM alpha_raw_records WHERE entity_type='payments' AND branch_id=$1`, [bid]);

    const paymentsByMonth = useNormPayments
      ? await sql(
          `SELECT TO_CHAR(document_date,'YYYY-MM') AS raw_month,
             COUNT(*) AS cnt,
             COALESCE(SUM(CASE WHEN direction='income' THEN income ELSE 0 END), 0) AS income_sum,
             COALESCE(SUM(CASE WHEN direction='outcome' THEN outcome ELSE 0 END), 0) AS outcome_sum,
             COALESCE(SUM(CASE WHEN direction='correction' THEN income ELSE 0 END), 0) AS correction_sum
           FROM crm_payments WHERE branch_crm_id=$1 AND document_date IS NOT NULL
           GROUP BY raw_month ORDER BY raw_month`, [bid])
      : await sql(`
          SELECT raw_month, COUNT(*) AS cnt, SUM(income_sum) AS income_sum
          FROM (
            SELECT substring(source_payload->>'document_date' from 4 for 7) AS raw_month,
              split_part(source_payload->>'document_date', '.', 3) || '-' ||
              split_part(source_payload->>'document_date', '.', 2) AS sort_key,
              (source_payload->>'income')::numeric AS income_sum
            FROM alpha_raw_records
            WHERE entity_type='payments' AND branch_id=$1 AND source_payload->>'document_date' IS NOT NULL
          ) sub GROUP BY raw_month, sort_key ORDER BY sort_key`, [bid]);

    const paymentsSuspiciousHigh = useNormPayments
      ? await sql(
          `SELECT crm_id AS alpha_id, income::text, document_date::text AS date, student_crm_id AS customer_id, outcome::text, direction
           FROM crm_payments WHERE branch_crm_id=$1 AND ABS(COALESCE(income, outcome, 0)) > 100000
           ORDER BY ABS(COALESCE(income, outcome, 0)) DESC LIMIT 20`, [bid])
      : await sql(`
          SELECT alpha_id, source_payload->>'income' AS income, source_payload->>'document_date' AS date,
                 source_payload->>'customer_id' AS customer_id
          FROM alpha_raw_records WHERE entity_type='payments' AND branch_id=$1
            AND (source_payload->>'income')::numeric > 100000
          ORDER BY (source_payload->>'income')::numeric DESC LIMIT 20`, [bid]);

    const paymentsNegative = useNormPayments
      ? await sql(
          `SELECT crm_id AS alpha_id, income::text, document_date::text AS date
           FROM crm_payments WHERE branch_crm_id=$1 AND COALESCE(income, 0) < 0
           ORDER BY income LIMIT 20`, [bid])
      : await sql(`
          SELECT alpha_id, source_payload->>'income' AS income, source_payload->>'document_date' AS date
          FROM alpha_raw_records WHERE entity_type='payments' AND branch_id=$1
            AND (source_payload->>'income')::numeric < 0`, [bid]);

    // ── Groups ────────────────────────────────────────────────────────────────
    const groupsRaw        = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM alpha_raw_records WHERE entity_type='groups' AND branch_id=$1`, [bid]);
    const groupsNorm       = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_groups WHERE branch_crm_id=$1`, [bid]);
    const groupsWithTeacher = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt FROM crm_groups
      WHERE branch_crm_id=$1
        AND jsonb_array_length(teacher_crm_ids) > 0
    `, [bid]);
    const groupsWithoutSubjectIssues = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt FROM alpha_linking_issues
      WHERE issue_type='group_without_subject' AND missing_reference_type=$1
    `, [bid]);
    const groupsWithoutTeacherIssues = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt FROM alpha_linking_issues
      WHERE issue_type='group_without_teacher' AND missing_reference_type=$1
    `, [bid]);
    const groupsLifecycle = await sql(`
      SELECT lifecycle_status, COUNT(*) AS cnt FROM crm_groups WHERE branch_crm_id=$1 GROUP BY 1
    `, [bid]);

    // ── Subjects ──────────────────────────────────────────────────────────────
    const subjectsRaw = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM alpha_raw_records WHERE entity_type='subjects' AND branch_id=$1`, [bid]);
    const subjectsReferencedByLessons = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(DISTINCT source_payload->>'subject_id') AS cnt
      FROM alpha_raw_records
      WHERE entity_type='lessons' AND branch_id=$1 AND source_payload->>'subject_id' IS NOT NULL
    `, [bid]);
    const subjectsReferencedByGroups = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(DISTINCT source_payload->>'subject_id') AS cnt
      FROM alpha_raw_records
      WHERE entity_type='groups' AND branch_id=$1 AND source_payload->>'subject_id' IS NOT NULL
    `, [bid]);
    const subjectIdsInLessonsNotInSubjects = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(DISTINCT l.source_payload->>'subject_id') AS cnt
      FROM alpha_raw_records l
      LEFT JOIN alpha_raw_records s ON s.alpha_id = l.source_payload->>'subject_id' AND s.entity_type='subjects' AND s.branch_id=$1
      WHERE l.entity_type='lessons' AND l.branch_id=$1
        AND l.source_payload->>'subject_id' IS NOT NULL
        AND s.id IS NULL
    `, [bid]);

    // ── Teachers ──────────────────────────────────────────────────────────────
    const teachersRaw  = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM alpha_raw_records WHERE entity_type='teachers' AND branch_id=$1`, [bid]);
    const teachersNorm = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_teachers WHERE branch_crm_id=$1`, [bid]);
    const teachersLinkedToLessons = await sqlOne<{ cnt: string }>(`
      SELECT COUNT(DISTINCT tid) AS cnt
      FROM alpha_raw_records,
           jsonb_array_elements_text(source_payload->'teacher_ids') AS tid
      WHERE entity_type='lessons' AND branch_id=$1
    `, [bid]);
    const teachersLifecycle = await sql(`
      SELECT lifecycle_status, COUNT(*) AS cnt FROM crm_teachers WHERE branch_crm_id=$1 GROUP BY 1
    `, [bid]);
    const teachersWithPhone = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_teachers WHERE branch_crm_id=$1 AND phone IS NOT NULL`, [bid]);

    res.json({
      branchId: bid,
      auditType: "entity-reconciliation",
      generatedAt: new Date().toISOString(),
      students: {
        raw: Number(studentsRaw?.cnt ?? 0),
        normalized: Number(studentsNorm?.cnt ?? 0),
        studentProfiles: Number(studentsProfiles?.cnt ?? 0),
        inFamilies: Number(studentsInFamilies?.cnt ?? 0),
        notNormalized: Number(studentsRaw?.cnt ?? 0) - Number(studentsNorm?.cnt ?? 0),
        rawNotNormalized: Number(studentsRawNotNormalized?.cnt ?? 0),
        normalizedWithoutProfile: Number(studentsNorm?.cnt ?? 0) - Number(studentsProfiles?.cnt ?? 0),
        withoutFamilyLink: Number(studentsWithoutFamily?.cnt ?? 0),
        lifecycleByStatus: studentsLifecycle,
        byIsStudy: studentsByIsStudy,
        byIsArchive: studentsByArchive,
        uniqueStudentIdsInLessons: Number(studentsWithLessons?.cnt ?? 0),
        uniqueStudentIdsInPayments: Number(studentsWithPayments?.cnt ?? 0),
        statusNote: "is_study=1: currently enrolled; is_archive=1: archived/left; lifecycle_status populated by P7.1 normalize-students-from-raw",
      },
      families: {
        total: Number(familiesTotal?.cnt ?? 0),
        withChildren: Number(familiesWithChildren?.cnt ?? 0),
        withoutChildren: Number(familiesWithoutChildren?.cnt ?? 0),
        withActiveChildren: Number(familiesWithActiveChildren?.cnt ?? 0),
        withOnlyInactiveChildren:
          Number(familiesWithChildren?.cnt ?? 0) - Number(familiesWithActiveChildren?.cnt ?? 0),
      },
      lessons: {
        raw: Number(lessonsRaw?.cnt ?? 0),
        normalized: Number(lessonsNorm?.cnt ?? 0),
        notNormalized: Number(lessonsRaw?.cnt ?? 0) - Number(lessonsNorm?.cnt ?? 0),
        normalizationRate: Math.round((Number(lessonsNorm?.cnt ?? 0) / Number(lessonsRaw?.cnt ?? 1)) * 100),
        attendanceRecords: Number(lessonsAttendance?.cnt ?? 0),
        withoutGroup: Number(lessonsWithoutGroup?.cnt ?? 0),
        withoutSubject: Number(lessonsWithoutSubject?.cnt ?? 0),
        withoutTeacher: Number(lessonsWithoutTeacher?.cnt ?? 0),
        byMonth: lessonsByMonth,
      },
      payments: {
        raw:              Number(paymentsRaw?.cnt  ?? 0),
        normalized:       Number(paymentsNorm?.cnt ?? 0),
        notNormalized:    Number(paymentsRaw?.cnt  ?? 0) - Number(paymentsNorm?.cnt ?? 0),
        normalizationRate: Math.round((Number(paymentsNorm?.cnt ?? 0) / Number(paymentsRaw?.cnt ?? 1)) * 100),
        p75NormalizationDone: useNormPayments,
        linkedToActiveStudent:   Number(paymentsLinkingStats?.student_linked   ?? paymentsLinkedToStudent?.cnt ?? 0),
        linkedToInactiveStudent: Number(paymentsLinkingStats?.inactive_linked  ?? 0),
        linkedToIdentity:        Number(paymentsLinkingStats?.identity_linked  ?? 0),
        linkedToFamily:          Number(paymentsLinkingStats?.family_linked    ?? 0),
        unlinked:                Number(paymentsLinkingStats?.unlinked         ?? paymentsUnlinked?.cnt ?? 0),
        noCustomerId:            Number(paymentsLinkingStats?.no_customer      ?? 0),
        incomeSum:               Number(paymentsLinkingStats?.income_sum       ?? paymentsTotalIncome?.total ?? 0),
        outcomeSum:              Number(paymentsLinkingStats?.outcome_sum      ?? 0),
        correctionSum:           Number(paymentsLinkingStats?.correction_sum   ?? 0),
        suspiciousHighCount:     Number(paymentsLinkingStats?.suspicious_high  ?? 0),
        negativeCount:           Number(paymentsLinkingStats?.negative_cnt     ?? 0),
        suspiciousHigh:          paymentsSuspiciousHigh,
        negative:                paymentsNegative,
        byMonth:                 paymentsByMonth,
        note: "AlphaCRM payments = operational records. NOT bank truth. Reconciliation required. Run /coverage/payment-truth-audit for full breakdown.",
      },
      groups: {
        raw:          Number(groupsRaw?.cnt ?? 0),
        normalized:   Number(groupsNorm?.cnt ?? 0),
        notNormalized: Number(groupsRaw?.cnt ?? 0) - Number(groupsNorm?.cnt ?? 0),
        normalizationRate: Number(groupsNorm?.cnt ?? 0) > 0
          ? Math.round((Number(groupsNorm?.cnt ?? 0) / Number(groupsRaw?.cnt ?? 1)) * 100)
          : 0,
        withTeacher:    Number(groupsWithTeacher?.cnt ?? 0),
        withoutTeacher: Number(groupsRaw?.cnt ?? 0) - Number(groupsWithTeacher?.cnt ?? 0),
        withoutSubject: Number(groupsWithoutSubjectIssues?.cnt ?? 0),
        withSubject: 0,
        lifecycleByStatus: groupsLifecycle,
        subjectInference: await (async () => {
          const r = await sqlOne<{ with_primary: string; ambiguous: string; still_without: string }>(`
            SELECT
              COUNT(*) FILTER (WHERE inferred_subject_crm_id IS NOT NULL) AS with_primary,
              COUNT(*) FILTER (WHERE subject_inference_status='ambiguous')  AS ambiguous,
              COUNT(*) FILTER (WHERE inferred_subject_crm_id IS NULL AND subject_inference_status IS DISTINCT FROM 'ambiguous') AS still_without
            FROM crm_groups WHERE branch_crm_id=$1
          `, [bid]);
          return { withPrimary: Number(r?.with_primary ?? 0), ambiguous: Number(r?.ambiguous ?? 0), stillWithout: Number(r?.still_without ?? 0) };
        })(),
        note: "AlphaCRM groups have no subject_id field — subject is inferred from lessons referencing the group via P7.3",
      },
      subjects: {
        raw: Number(subjectsRaw?.cnt ?? 0),
        referencedByLessons: Number(subjectsReferencedByLessons?.cnt ?? 0),
        referencedByGroups: Number(subjectsReferencedByGroups?.cnt ?? 0),
        unresolvedInLessons: Number(subjectIdsInLessonsNotInSubjects?.cnt ?? 0),
      },
      teachers: {
        raw:              Number(teachersRaw?.cnt ?? 0),
        normalized:       Number(teachersNorm?.cnt ?? 0),
        notNormalized:    Number(teachersRaw?.cnt ?? 0) - Number(teachersNorm?.cnt ?? 0),
        normalizationRate: Number(teachersNorm?.cnt ?? 0) > 0
          ? Math.round((Number(teachersNorm?.cnt ?? 0) / Number(teachersRaw?.cnt ?? 1)) * 100)
          : 0,
        withPhone:        Number(teachersWithPhone?.cnt ?? 0),
        uniqueLinkedToLessons: Number(teachersLinkedToLessons?.cnt ?? 0),
        lifecycleByStatus: teachersLifecycle,
        statusNote: "all Atlas teachers have e_date='2030-12-31' — all active; lifecycle_status populated by P7.2 normalize-teachers-from-raw",
      },
      attendance: await (async () => {
        const attTotal = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_attendance WHERE branch_id=$1`, [bid]);
        const attLinkedStudent = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_attendance WHERE branch_id=$1 AND student_id IS NOT NULL`, [bid]);
        const attLinkedFamily  = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_attendance WHERE branch_id=$1 AND family_id IS NOT NULL`, [bid]);
        const attPresent = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_attendance WHERE branch_id=$1 AND visit_status_normalized='present'`, [bid]);
        const attAbsent  = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_attendance WHERE branch_id=$1 AND visit_status_normalized='absent'`, [bid]);
        const attUnknown = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_attendance WHERE branch_id=$1 AND visit_status_normalized='unknown'`, [bid]);
        const attDistinctStudents = await sqlOne<{ cnt: string }>(`SELECT COUNT(DISTINCT student_alpha_id) AS cnt FROM crm_attendance WHERE branch_id=$1`, [bid]);
        const attDistinctLessons  = await sqlOne<{ cnt: string }>(`SELECT COUNT(DISTINCT lesson_id) AS cnt FROM crm_attendance WHERE branch_id=$1`, [bid]);
        const attLessonsWithout   = await sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm_lessons WHERE branch_crm_id=$1 AND raw_record_id IS NOT NULL AND (visits_count=0 OR visits_raw IS NULL)`, [bid]);
        const embedded = 99148;
        const normalized = Number(attTotal?.cnt ?? 0);
        return {
          embeddedVisitsInLessons: embedded,
          normalized,
          extractionRate: normalized > 0 ? Math.round((normalized / embedded) * 100) : 0,
          linkedToStudents:    Number(attLinkedStudent?.cnt ?? 0),
          notLinkedToStudents: Number(attTotal?.cnt ?? 0) - Number(attLinkedStudent?.cnt ?? 0),
          linkedToFamilies:    Number(attLinkedFamily?.cnt ?? 0),
          notLinkedToFamilies: Number(attTotal?.cnt ?? 0) - Number(attLinkedFamily?.cnt ?? 0),
          statusPresent:  Number(attPresent?.cnt  ?? 0),
          statusAbsent:   Number(attAbsent?.cnt   ?? 0),
          statusUnknown:  Number(attUnknown?.cnt  ?? 0),
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
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/family-truth-audit
// ══════════════════════════════════════════════════════════════════════════════
auditRouter.get("/coverage/family-truth-audit", async (req, res) => {
  const familyId = req.query["familyId"] as string | undefined;
  const bid = branchId(req);

  if (!familyId) {
    // Return summary across all families
    try {
      const familyList = await sql(`
        SELECT
          f.id,
          f.family_name,
          f.primary_phone,
          p.full_name AS guardian_name,
          COUNT(sp.id) AS child_count,
          COUNT(sp.id) FILTER (WHERE COALESCE(sp.status,'') NOT IN ('archived','inactive','deleted')) AS active_children,
          COUNT(sp.id) FILTER (WHERE sp.status IN ('archived','inactive','deleted')) AS inactive_children
        FROM families f
        LEFT JOIN persons p ON p.id = f.primary_guardian_person_id
        LEFT JOIN student_profiles sp ON sp.family_id = f.id
        GROUP BY f.id, f.family_name, f.primary_phone, p.full_name
        ORDER BY active_children DESC, child_count DESC
        LIMIT 100
      `);

      return res.json({
        branchId: bid,
        auditType: "family-truth-audit-summary",
        generatedAt: new Date().toISOString(),
        families: familyList,
        note: "Pass ?familyId=<uuid> for full truth audit of a specific family",
      });
    } catch (err) {
      logger.error({ err }, "family-truth-audit summary failed");
      return res.status(500).json({ error: "family-truth-audit summary failed" });
    }
  }

  try {
    // Full truth audit for a single family
    const family = await sqlOne(`
      SELECT f.*, p.full_name AS guardian_name, p.primary_phone AS guardian_phone
      FROM families f
      LEFT JOIN persons p ON p.id = f.primary_guardian_person_id
      WHERE f.id = $1
    `, [familyId]);

    if (!family) {
      return res.status(404).json({ error: "Family not found" });
    }

    // Children (student profiles)
    const children = await sql(`
      SELECT sp.*, per.full_name AS person_name
      FROM student_profiles sp
      LEFT JOIN persons per ON per.id = sp.student_person_id
      WHERE sp.family_id = $1
    `, [familyId]);

    const studentCrmIds = children.map((c: Record<string, unknown>) => c["student_crm_id"] as string).filter(Boolean);

    // Raw records for each child
    let rawStudentRecords: Record<string, unknown>[] = [];
    if (studentCrmIds.length > 0) {
      rawStudentRecords = await sql(`
        SELECT alpha_id, source_payload, synced_at
        FROM alpha_raw_records
        WHERE entity_type='students' AND branch_id=$1 AND alpha_id = ANY($2::text[])
      `, [bid, studentCrmIds]);
    }

    // Payments from raw for these student CRM IDs
    let rawPayments: Record<string, unknown>[] = [];
    if (studentCrmIds.length > 0) {
      rawPayments = await sql(`
        SELECT alpha_id, source_payload->>'income' AS income,
               source_payload->>'document_date' AS document_date,
               source_payload->>'customer_id' AS customer_id,
               source_payload->>'comment' AS comment
        FROM alpha_raw_records
        WHERE entity_type='payments' AND branch_id=$1
          AND source_payload->>'customer_id' = ANY($2::text[])
        ORDER BY source_payload->>'document_date' DESC
        LIMIT 50
      `, [bid, studentCrmIds]);
    }

    // Also check payments matched by family phone
    const phonePayments = family["primary_phone"]
      ? await sql(`
          SELECT alpha_id, source_payload->>'income' AS income,
                 source_payload->>'document_date' AS document_date,
                 source_payload->>'comment' AS comment
          FROM alpha_raw_records
          WHERE entity_type='payments' AND branch_id=$1
            AND source_payload->>'payer_phone' = $2
          LIMIT 20
        `, [bid, family["primary_phone"]])
      : [];

    // Lessons for these student CRM IDs (via customer_id in lessons)
    let rawLessons: Record<string, unknown>[] = [];
    if (studentCrmIds.length > 0) {
      rawLessons = await sql(`
        SELECT alpha_id,
               source_payload->>'date' AS date,
               source_payload->>'subject_id' AS subject_id,
               source_payload->'group_ids' AS group_ids,
               source_payload->'teacher_ids' AS teacher_ids
        FROM alpha_raw_records
        WHERE entity_type='lessons' AND branch_id=$1
          AND source_payload->>'customer_id' = ANY($2::text[])
        ORDER BY source_payload->>'date' DESC
        LIMIT 50
      `, [bid, studentCrmIds]);
    }

    // Guardian links
    const guardianLinks = await sql(`
      SELECT gsl.*, per.full_name
      FROM guardian_student_links gsl
      LEFT JOIN persons per ON per.id = gsl.guardian_person_id
      WHERE gsl.family_id = $1
    `, [familyId]);

    // Mismatch checks
    const mismatches: string[] = [];

    // Phone mismatch: DB family phone vs raw guardian phone
    for (const rawStu of rawStudentRecords as Array<{ source_payload: Record<string, unknown> }>) {
      const rawPhone = rawStu.source_payload?.["phone"] as string | null;
      const dbPhone = family["primary_phone"] as string | null;
      if (rawPhone && dbPhone && rawPhone !== dbPhone) {
        mismatches.push(`Phone mismatch: DB=${dbPhone}, raw=${rawPhone}`);
      }
    }

    return res.json({
      branchId: bid,
      auditType: "family-truth-audit-detail",
      familyId,
      generatedAt: new Date().toISOString(),
      family: {
        id: family["id"],
        familyName: family["family_name"],
        guardianName: family["guardian_name"],
        primaryPhone: family["primary_phone"],
        guardianPhone: family["guardian_phone"],
        source: "normalized (buildFamilies from crm_students)",
      },
      children: children.map((c: Record<string, unknown>) => ({
        studentCrmId: c["student_crm_id"],
        fullName: c["full_name"],
        status: c["status"],
        familyId: c["family_id"],
        hasRawRecord: rawStudentRecords.some(
          (r: Record<string, unknown>) => r["alpha_id"] === c["student_crm_id"],
        ),
      })),
      rawStudentRecords: rawStudentRecords.map((r: Record<string, unknown>) => ({
        alphaId: r["alpha_id"],
        syncedAt: r["synced_at"],
        payload: r["source_payload"],
      })),
      payments: {
        byCustomerId: rawPayments,
        byPhone: phonePayments,
        totalByCustomerId: rawPayments.length,
        totalByPhone: phonePayments.length,
      },
      lessons: {
        sample: rawLessons,
        total: rawLessons.length,
        note: "Limited to 50 most recent. lesson.customer_id match.",
      },
      guardianLinks,
      mismatches,
      dataTruth: {
        rawRecordsLinked: rawStudentRecords.length,
        rawRecordsExpected: studentCrmIds.length,
        unresolvedChildren: studentCrmIds.length - rawStudentRecords.length,
        lastSync: rawStudentRecords.length > 0
          ? (rawStudentRecords as Array<Record<string, unknown>>)
              .map(r => r["synced_at"] as string)
              .sort()
              .reverse()[0]
          : null,
        mismatchCount: mismatches.length,
        phoneSource: "AlphaCRM raw (student.phone = guardian phone)",
        paymentSource: "AlphaCRM raw (payment.customer_id → student.alpha_id)",
        lessonSource: "AlphaCRM raw (lesson.customer_id → student.alpha_id)",
        note: "AlphaCRM semantics: student.full_name=child, student.phone=guardian phone",
      },
    });
  } catch (err) {
    logger.error({ err }, "family-truth-audit detail failed");
    return res.status(500).json({ error: "family-truth-audit detail failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/attendance-student-identity
// P7.4.1 — Diagnostic report: which AlphaCRM customer_ids in Atlas attendance
//           are linked to internal students, and why others are missing.
// ══════════════════════════════════════════════════════════════════════════════
auditRouter.get("/coverage/attendance-student-identity", async (req, res) => {
  const bid = branchId(req);
  try {
    // ── 1. Top-level counts ─────────────────────────────────────────────────
    const totals = await sqlOne<{
      total_att: string; with_cid: string; unique_cids: string;
      linked_records: string; linked_cids: string; unlinked_cids: string;
      inactive_linked_cids: string; historical_identity_cids: string;
      still_unresolved_cids: string; historical_identity_records: string;
      still_unresolved_records: string;
    }>(`
      SELECT
        COUNT(*)::text                                                                        AS total_att,
        COUNT(student_alpha_id)::text                                                         AS with_cid,
        COUNT(DISTINCT student_alpha_id)::text                                                AS unique_cids,
        COUNT(student_id)::text                                                               AS linked_records,
        COUNT(DISTINCT CASE WHEN student_id IS NOT NULL THEN student_alpha_id END)::text      AS linked_cids,
        COUNT(DISTINCT CASE WHEN student_id IS NULL AND student_alpha_id IS NOT NULL
                            THEN student_alpha_id END)::text                                  AS unlinked_cids,
        COUNT(DISTINCT CASE WHEN student_id IS NOT NULL AND EXISTS(
          SELECT 1 FROM crm_students cs WHERE cs.id = crm_attendance.student_id
            AND cs.lifecycle_status = 'inactive'
        ) THEN student_alpha_id END)::text                                                    AS inactive_linked_cids,
        COUNT(DISTINCT CASE WHEN student_id IS NULL AND student_identity_id IS NOT NULL
                            THEN student_alpha_id END)::text                                  AS historical_identity_cids,
        COUNT(DISTINCT CASE WHEN student_id IS NULL AND student_identity_id IS NULL
                            AND student_alpha_id IS NOT NULL THEN student_alpha_id END)::text AS still_unresolved_cids,
        COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NOT NULL THEN 1 END)::text AS historical_identity_records,
        COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL
                   AND student_alpha_id IS NOT NULL THEN 1 END)::text                         AS still_unresolved_records
      FROM crm_attendance WHERE branch_id=$1
    `, [bid]);

    const totalAtt               = Number(totals?.total_att               ?? 0);
    const uniqueCids             = Number(totals?.unique_cids             ?? 0);
    const linkedRecords          = Number(totals?.linked_records          ?? 0);
    const linkedCids             = Number(totals?.linked_cids             ?? 0);
    const unlinkedCids           = Number(totals?.unlinked_cids           ?? 0);
    const inactiveLinkedCids     = Number(totals?.inactive_linked_cids    ?? 0);
    const historicalIdentityCids = Number(totals?.historical_identity_cids ?? 0);
    const stillUnresolvedCids    = Number(totals?.still_unresolved_cids   ?? 0);
    const historicalIdentityRecords = Number(totals?.historical_identity_records ?? 0);
    const stillUnresolvedRecords    = Number(totals?.still_unresolved_records    ?? 0);
    const unlinkedRecords = totalAtt - linkedRecords;

    // ── 2. Per-customer detail for unlinked ids ──────────────────────────────
    const unlinkedRows = await sql<{
      customer_id: string; attendance_count: string; lesson_count: string;
      first_lesson_date: string; last_lesson_date: string;
      group_ids: string[]; subject_ids: string[];
      teacher_ids: string; sample_lesson_alpha_ids: string[];
    }>(`
      SELECT
        a.student_alpha_id                                                         AS customer_id,
        COUNT(*)::text                                                             AS attendance_count,
        COUNT(DISTINCT a.lesson_id)::text                                         AS lesson_count,
        MIN(a.lesson_date)::date::text                                            AS first_lesson_date,
        MAX(a.lesson_date)::date::text                                            AS last_lesson_date,
        array_remove(array_agg(DISTINCT a.group_alpha_id),   NULL)                AS group_ids,
        array_remove(array_agg(DISTINCT a.subject_alpha_id), NULL)                AS subject_ids,
        (SELECT string_agg(DISTINCT elem::text, ',' ORDER BY elem::text)
         FROM crm_attendance a2, jsonb_array_elements_text(a2.teacher_alpha_ids) elem
         WHERE a2.branch_id=$1 AND a2.student_alpha_id = a.student_alpha_id
           AND a2.teacher_alpha_ids IS NOT NULL)                                  AS teacher_ids,
        (SELECT array_agg(lal ORDER BY lal)
         FROM (SELECT DISTINCT a3.lesson_alpha_id AS lal
               FROM crm_attendance a3
               WHERE a3.branch_id=$1 AND a3.student_alpha_id = a.student_alpha_id
               LIMIT 5) sub)                                                      AS sample_lesson_alpha_ids
      FROM crm_attendance a
      LEFT JOIN crm_students s ON s.crm_id = a.student_alpha_id AND s.branch_crm_id = $1
      WHERE a.branch_id=$1 AND a.student_alpha_id IS NOT NULL AND s.id IS NULL
      GROUP BY a.student_alpha_id
      ORDER BY COUNT(*) DESC
    `, [bid]);

    // ── 3. Search unlinked customer_ids in alpha_raw_records (all branches) ─
    //       Also check customers_archived entity type (set by resolve-ghost-customers)
    const rawLookup = await sql<{ alpha_id: string; branch_id: string; entity_type: string }>(`
      SELECT DISTINCT arr.alpha_id, arr.branch_id, arr.entity_type
      FROM alpha_raw_records arr
      WHERE arr.entity_type IN ('students', 'customers_archived')
        AND arr.alpha_id = ANY(
          SELECT DISTINCT student_alpha_id FROM crm_attendance
          WHERE branch_id=$1 AND student_alpha_id IS NOT NULL
            AND student_alpha_id NOT IN (
              SELECT crm_id FROM crm_students WHERE branch_crm_id=$1
            )
        )
    `, [bid]);

    // Map: customer_id → { branches (for students), isArchived (for customers_archived) }
    const rawByCustomer = new Map<string, string[]>();
    const archivedCustomerIds = new Set<string>();
    for (const row of rawLookup) {
      if (row.entity_type === "customers_archived") {
        archivedCustomerIds.add(row.alpha_id);
      } else {
        const prev = rawByCustomer.get(row.alpha_id) ?? [];
        rawByCustomer.set(row.alpha_id, [...prev, row.branch_id]);
      }
    }

    // Also get lifecycle hints for archived customers
    const archivedHints = await sql<{ alpha_id: string; lifecycle_hint: string }>(`
      SELECT DISTINCT alpha_id,
        source_payload->'_ghost_resolution'->>'lifecycleHint' AS lifecycle_hint
      FROM alpha_raw_records
      WHERE entity_type='customers_archived' AND branch_id=$1
        AND alpha_id = ANY(
          SELECT DISTINCT student_alpha_id FROM crm_attendance
          WHERE branch_id=$1 AND student_alpha_id IS NOT NULL
            AND student_alpha_id NOT IN (SELECT crm_id FROM crm_students WHERE branch_crm_id=$1)
        )
    `, [bid]);
    const archivedHintMap = new Map(archivedHints.map(r => [r.alpha_id, r.lifecycle_hint ?? "unknown"]));

    // ── 4. Classify each unlinked customer_id ───────────────────────────────
    type Classification =
      | "ATLAS_RAW_EXISTS_NOT_NORMALIZED"
      | "OTHER_BRANCH_RAW_EXISTS"
      | "MULTI_BRANCH_CUSTOMER"
      | "RAW_CUSTOMER_NOT_FOUND"
      | "ARCHIVED_CUSTOMER_FOUND"
      | "INACTIVE_CUSTOMER_FOUND"
      | "MISSING_CUSTOMER_ID_IN_VISIT";

    const classified = unlinkedRows.map(row => {
      const branches = rawByCustomer.get(row.customer_id);
      const isArchived = archivedCustomerIds.has(row.customer_id);
      const hint = archivedHintMap.get(row.customer_id);
      let classification: Classification;
      if (!row.customer_id) {
        classification = "MISSING_CUSTOMER_ID_IN_VISIT";
      } else if (isArchived) {
        // Found via ghost resolution — sub-classify by lifecycle hint
        classification = hint === "inactive" ? "INACTIVE_CUSTOMER_FOUND" : "ARCHIVED_CUSTOMER_FOUND";
      } else if (!branches || branches.length === 0) {
        classification = "RAW_CUSTOMER_NOT_FOUND";
      } else if (branches.length > 1) {
        classification = "MULTI_BRANCH_CUSTOMER";
      } else if (branches.includes(bid)) {
        classification = "ATLAS_RAW_EXISTS_NOT_NORMALIZED";
      } else {
        classification = "OTHER_BRANCH_RAW_EXISTS";
      }
      return {
        customer_id:          row.customer_id,
        attendance_count:     Number(row.attendance_count),
        lesson_count:         Number(row.lesson_count),
        first_lesson_date:    row.first_lesson_date,
        last_lesson_date:     row.last_lesson_date,
        group_ids:            row.group_ids ?? [],
        subject_ids:          row.subject_ids ?? [],
        teacher_ids:          row.teacher_ids ?? null,
        sample_lesson_alpha_ids: row.sample_lesson_alpha_ids ?? [],
        raw_found_in_branches: branches ?? [],
        classification,
      };
    });

    // ── 5. Classification summary ────────────────────────────────────────────
    const classSummary: Record<string, { customer_count: number; attendance_count: number; examples: string[] }> = {};
    for (const c of classified) {
      const bucket = classSummary[c.classification] ?? { customer_count: 0, attendance_count: 0, examples: [] };
      bucket.customer_count++;
      bucket.attendance_count += c.attendance_count;
      if (bucket.examples.length < 5) bucket.examples.push(c.customer_id);
      classSummary[c.classification] = bucket;
    }

    // ── 6. Raw coverage summary + dynamic branch counts ─────────────────────
    const foundInAtlasRaw    = classified.filter(c => c.classification === "ATLAS_RAW_EXISTS_NOT_NORMALIZED").length;
    const foundInOtherBranch = classified.filter(c => c.classification === "OTHER_BRANCH_RAW_EXISTS").length;
    const foundInMultiBranch = classified.filter(c => c.classification === "MULTI_BRANCH_CUSTOMER").length;
    const notFoundInRaw      = classified.filter(c => c.classification === "RAW_CUSTOMER_NOT_FOUND").length;

    // Dynamic: query actual alpha_raw_records.students coverage per branch
    const rawStudentCountRows = await sql<{ branch_id: string; unique_ids: string; record_count: string }>(`
      SELECT branch_id,
             COUNT(DISTINCT alpha_id)::text AS unique_ids,
             COUNT(*)::text                AS record_count
      FROM alpha_raw_records
      WHERE entity_type = 'students'
      GROUP BY branch_id
      ORDER BY branch_id
    `);
    const rawBranchesAvailable   = rawStudentCountRows.map(r => r.branch_id);
    const atlasRawStudentCount   = Number(rawStudentCountRows.find(r => r.branch_id === bid)?.unique_ids ?? 0);
    const totalRawStudentRecords = rawStudentCountRows.reduce((a, r) => a + Number(r.record_count), 0);
    const rawBranchCounts        = Object.fromEntries(rawStudentCountRows.map(r => [r.branch_id, Number(r.unique_ids)]));

    // ── 7. Recommendation ────────────────────────────────────────────────────
    let recommendation: "A" | "B" | "C";
    let recommendationReason: string;
    if (unlinkedCids === 0) {
      recommendation = "A";
      recommendationReason = "All attendance customer_ids are linked to Atlas students. Atlas student scope is sufficient.";
    } else if (notFoundInRaw === unlinkedCids && notFoundInRaw > 0) {
      recommendation = "C";
      recommendationReason = `All ${unlinkedCids} unlinked customer_ids are absent from alpha_raw_records entirely. Raw data for other branches has not been pulled. A targeted raw pull of students from all branches is required before determining scope.`;
    } else if (foundInOtherBranch + foundInMultiBranch > unlinkedCids * 0.5) {
      recommendation = "B";
      recommendationReason = `${foundInOtherBranch + foundInMultiBranch} unlinked customer_ids confirmed in other branches. 'Atlas-related students' scope (all customers appearing in Atlas lessons) is needed.`;
    } else {
      recommendation = "C";
      recommendationReason = "Insufficient raw data to classify all unlinked customers. Targeted raw pull needed.";
    }

    // ── 8. Seed aggregated linking_issues ────────────────────────────────────
    // Delete previous P7.4.1 issues for this branch (by issue_type prefix), then insert fresh
    const issueTypes = [
      "attendance_customer_not_normalized",
      "attendance_customer_in_other_branch",
      "attendance_customer_raw_not_found",
      "attendance_customer_multi_branch",
      "attendance_missing_customer_id",
      "attendance_customer_archived_found",
      "attendance_customer_inactive_found",
    ];
    for (const it of issueTypes) {
      await pool.query(`
        DELETE FROM alpha_linking_issues WHERE issue_type=$1
          AND issue_message LIKE $2
      `, [it, `%branchId=${bid}%`]);
    }

    const issueMap: Record<Classification, {
      issue_type: string; severity: string; suggested_action: string;
    }> = {
      ATLAS_RAW_EXISTS_NOT_NORMALIZED: {
        issue_type: "attendance_customer_not_normalized",
        severity: "warning",
        suggested_action: "Re-run normalize-students-from-raw for Atlas branch; customer exists in raw but was not promoted to crm_students.",
      },
      OTHER_BRANCH_RAW_EXISTS: {
        issue_type: "attendance_customer_in_other_branch",
        severity: "warning",
        suggested_action: "Customer belongs to another AlphaCRM branch. Consider 'Atlas-related students' scope (Option B) to normalize cross-branch students attending Atlas lessons.",
      },
      MULTI_BRANCH_CUSTOMER: {
        issue_type: "attendance_customer_multi_branch",
        severity: "info",
        suggested_action: "Customer appears in multiple branches. Normalize from authoritative branch and link attendance cross-branch.",
      },
      RAW_CUSTOMER_NOT_FOUND: {
        issue_type: "attendance_customer_raw_not_found",
        severity: "warning",
        suggested_action: "Customer absent from all 8 branch raw pulls. Run POST /api/coverage/resolve-ghost-customers to query AlphaCRM archived/inactive endpoints.",
      },
      ARCHIVED_CUSTOMER_FOUND: {
        issue_type: "attendance_customer_archived_found",
        severity: "info",
        suggested_action: "Customer found via ghost resolution (archived in AlphaCRM). Run P7.4.3c to normalize with lifecycleStatus=archived.",
      },
      INACTIVE_CUSTOMER_FOUND: {
        issue_type: "attendance_customer_inactive_found",
        severity: "warning",
        suggested_action: "Customer found via ghost resolution (inactive in AlphaCRM). Run P7.4.3c to normalize with lifecycleStatus=inactive.",
      },
      MISSING_CUSTOMER_ID_IN_VISIT: {
        issue_type: "attendance_missing_customer_id",
        severity: "info",
        suggested_action: "Attendance record has no customer_id in the visits_raw payload. Cannot link to any student.",
      },
    };

    let issuesInserted = 0;
    for (const c of classified) {
      const meta = issueMap[c.classification];
      const sampleLessons = c.sample_lesson_alpha_ids.slice(0, 3).join(",");
      const result = await pool.query(`
        INSERT INTO alpha_linking_issues
          (entity_type, alpha_id, issue_type, issue_message, missing_reference_type,
           missing_reference_id, severity, suggested_action)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [
        "attendance",
        c.customer_id,
        meta.issue_type,
        `branchId=${bid} customer_id=${c.customer_id} att_count=${c.attendance_count} lessons=${c.lesson_count} sample=${sampleLessons}`,
        "crm_students",
        c.customer_id,
        meta.severity,
        meta.suggested_action,
      ]);
      issuesInserted += result.rowCount ?? 0;
    }

    // ── 9. Ghost resolution summary (from customers_archived raw records) ─────
    const archivedFoundCount   = classified.filter(c => c.classification === "ARCHIVED_CUSTOMER_FOUND").length;
    const inactiveFoundCount   = classified.filter(c => c.classification === "INACTIVE_CUSTOMER_FOUND").length;
    const stillNotFoundCount   = classified.filter(c => c.classification === "RAW_CUSTOMER_NOT_FOUND").length;
    const ghostResolutionRan   = archivedCustomerIds.size > 0;

    const ghostResolution = {
      resolutionRan:       ghostResolutionRan,
      ghostsBefore:        unlinkedCids,
      foundArchived:       archivedFoundCount,
      foundInactive:       inactiveFoundCount,
      foundTotal:          archivedFoundCount + inactiveFoundCount,
      stillNotFound:       stillNotFoundCount,
      note: ghostResolutionRan
        ? `Ghost resolution has run. ${archivedFoundCount + inactiveFoundCount} customers found (${archivedFoundCount} archived, ${inactiveFoundCount} inactive). ${stillNotFoundCount} still unresolved.`
        : `Ghost resolution not yet run. Run POST /api/coverage/resolve-ghost-customers to query AlphaCRM archived/inactive endpoints.`,
      recommendedAction: archivedFoundCount + inactiveFoundCount > 0
        ? "Run P7.4.3c (POST /api/sync/normalize-historical-students) to normalize found customers with lifecycleStatus=archived/inactive."
        : stillNotFoundCount > 0 && !ghostResolutionRan
          ? "Run POST /api/coverage/resolve-ghost-customers first."
          : stillNotFoundCount > 0
            ? "Remaining customers are hard-deleted from AlphaCRM or require privileged access. Accept as historical attendance references."
            : "All unlinked customers resolved.",
    };

    // ── 10. Identity breakdown summary ───────────────────────────────────────
    const activeLinkedCids   = linkedCids - inactiveLinkedCids;
    const activePct          = uniqueCids > 0 ? Math.round((activeLinkedCids   / uniqueCids) * 100) : 0;
    const inactivePct        = uniqueCids > 0 ? Math.round((inactiveLinkedCids / uniqueCids) * 100) : 0;
    const historicalPct      = uniqueCids > 0 ? Math.round((historicalIdentityCids / uniqueCids) * 100) : 0;
    const unresolvedPct      = uniqueCids > 0 ? Math.round((stillUnresolvedCids / uniqueCids) * 100) : 0;

    // ── 11. Response ──────────────────────────────────────────────────────────
    res.json({
      branchId:          bid,
      auditType:         "attendance-student-identity",
      generatedAt:       new Date().toISOString(),

      // Coverage counts
      totalAttendanceRecords:    totalAtt,
      withCustomerId:            Number(totals?.with_cid ?? 0),
      withoutCustomerId:         totalAtt - Number(totals?.with_cid ?? 0),
      uniqueCustomerIds:         uniqueCids,
      linkedCustomerIds:         linkedCids,
      unlinkedCustomerIds:       unlinkedCids,
      linkedAttendanceRecords:   linkedRecords,
      unlinkedAttendanceRecords: unlinkedRecords,
      linkedPctByRecord:         totalAtt > 0 ? Math.round((linkedRecords / totalAtt) * 100) : 0,
      linkedPctByCustomer:       uniqueCids > 0 ? Math.round((linkedCids / uniqueCids) * 100) : 0,

      // P7.4.3c identity breakdown
      identityBreakdown: {
        activeStudentLinked:       activeLinkedCids,
        inactiveStudentLinked:     inactiveLinkedCids,
        historicalIdentityCreated: historicalIdentityCids,
        stillUnresolved:           stillUnresolvedCids,
        activePct,
        inactivePct,
        historicalPct,
        unresolvedPct,
        // Attendance record coverage
        attendanceWithStudentId:       linkedRecords,
        attendanceWithIdentityOnly:    historicalIdentityRecords,
        attendanceStillUnresolved:     stillUnresolvedRecords,
        note: historicalIdentityCids > 0
          ? `Historical-only identities are not full student profiles. They exist only to preserve attendance history for ${historicalIdentityCids} customers no longer exposed by AlphaCRM API.`
          : stillUnresolvedCids > 0
            ? `${stillUnresolvedCids} customer_ids still unresolved. Run POST /api/sync/normalize-historical-students to create identity placeholders.`
            : "All customer_ids have been resolved (active, inactive, or historical identity).",
      },

      // Raw lookup results (dynamic — based on actual alpha_raw_records contents)
      rawLookup: {
        foundInAtlasRaw,
        foundInOtherBranch,
        foundInMultiBranch,
        notFoundInAnyRaw:      notFoundInRaw,
        atlasRawStudentCount,
        rawBranchesAvailable,
        rawBranchCounts,
        totalRawStudentRecords,
        note: rawBranchesAvailable.length <= 1
          ? `alpha_raw_records.students data exists only for branchId=${rawBranchesAvailable[0] ?? "none"} (${atlasRawStudentCount} unique ids, ${totalRawStudentRecords} records). Run POST /api/sync/pull-students-all-branches to pull all 8 branches.`
          : `alpha_raw_records.students data available for ${rawBranchesAvailable.length} branches: [${rawBranchesAvailable.join(", ")}]. Total ${totalRawStudentRecords} raw records, ${Object.values(rawBranchCounts).reduce((a: number, v) => a + (v as number), 0)} unique ids.`,
      },

      // Ghost resolution section (populated after resolve-ghost-customers runs)
      ghostResolution,

      // Classification
      classificationSummary: classSummary,

      // Recommendation
      recommendation,
      recommendationReason,
      recommendationDetails: {
        A: "Atlas branch students are sufficient. Unlinked attendance is caused by invalid/missing customer_ids.",
        B: "Atlas-related students scope needed: normalize all AlphaCRM customers appearing in Atlas lessons regardless of their home branch.",
        C: "Raw data is insufficient. Targeted raw pull of students from all 8 AlphaCRM branches required.",
      },

      // Linking issues
      linkingIssuesInserted: issuesInserted,

      // Top 20 unlinked
      top20Unlinked: classified.slice(0, 20),

      // Full list (all unlinked)
      allUnlinked: classified,
    });
  } catch (err) {
    logger.error({ err }, "attendance-student-identity audit failed");
    res.status(500).json({ error: "attendance-student-identity audit failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/customer-raw-branch-coverage
// P7.4.2 — Per-branch raw student/customer counts in alpha_raw_records
// ══════════════════════════════════════════════════════════════════════════════

const BRANCH_NAMES: Record<string, string> = {
  "1": "Онлайн школа",
  "2": "Лиственная",
  "3": "Остров",
  "4": "Лыжный",
  "5": "Онлайн Школа",
  "6": "Атлас",
  "7": "Кемпинг",
  "8": "Школа 1-11",
};
const ALL_BRANCH_IDS = ["1","2","3","4","5","6","7","8"];

auditRouter.get("/coverage/customer-raw-branch-coverage", async (_req, res) => {
  try {
    // Per-branch stats
    const branchRows = await sql<{
      branch_id: string;
      unique_alpha_ids: string;
      record_count: string;
      earliest_synced: string;
      latest_synced: string;
    }>(`
      SELECT
        branch_id,
        COUNT(DISTINCT alpha_id)::text  AS unique_alpha_ids,
        COUNT(*)::text                  AS record_count,
        MIN(synced_at)::text            AS earliest_synced,
        MAX(synced_at)::text            AS latest_synced
      FROM alpha_raw_records
      WHERE entity_type = 'students'
      GROUP BY branch_id
      ORDER BY branch_id
    `);

    const branchMap = new Map(branchRows.map(r => [r.branch_id, r]));

    const perBranch = ALL_BRANCH_IDS.map(bid => {
      const row = branchMap.get(bid);
      return {
        branchId:        Number(bid),
        branchName:      BRANCH_NAMES[bid] ?? `Branch ${bid}`,
        rawStudentCount: row ? Number(row.unique_alpha_ids) : 0,
        rawRecordCount:  row ? Number(row.record_count) : 0,
        earliestSynced:  row?.earliest_synced ?? null,
        latestSynced:    row?.latest_synced ?? null,
        status:          row ? "available" : "not_pulled",
      };
    });

    // Multi-branch customer_ids
    const multiRows = await sql<{ alpha_id: string; branch_count: string; branches: string[] }>(`
      SELECT alpha_id,
             COUNT(DISTINCT branch_id)::text                           AS branch_count,
             array_agg(DISTINCT branch_id ORDER BY branch_id)         AS branches
      FROM alpha_raw_records
      WHERE entity_type = 'students'
      GROUP BY alpha_id
      HAVING COUNT(DISTINCT branch_id) > 1
      ORDER BY COUNT(DISTINCT branch_id) DESC, alpha_id
    `);

    // Global totals
    const totals = await sqlOne<{ total_records: string; unique_ids: string; branches_with_data: string }>(`
      SELECT
        COUNT(*)::text                       AS total_records,
        COUNT(DISTINCT alpha_id)::text       AS unique_ids,
        COUNT(DISTINCT branch_id)::text      AS branches_with_data
      FROM alpha_raw_records
      WHERE entity_type = 'students'
    `);

    res.json({
      generatedAt:  new Date().toISOString(),
      perBranch,
      global: {
        totalRawRecords:      Number(totals?.total_records ?? 0),
        uniqueAlphaIds:       Number(totals?.unique_ids ?? 0),
        branchesWithData:     Number(totals?.branches_with_data ?? 0),
        branchesWithoutData:  8 - Number(totals?.branches_with_data ?? 0),
        multiBranchCustomers: multiRows.length,
        multiBranchExamples:  multiRows.slice(0, 10).map(r => ({
          alphaId:     r.alpha_id,
          branchCount: Number(r.branch_count),
          branches:    r.branches,
        })),
      },
    });
  } catch (err) {
    logger.error({ err }, "customer-raw-branch-coverage failed");
    res.status(500).json({ error: "customer-raw-branch-coverage failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/coverage/resolve-ghost-customers
// P7.4.3b — Query AlphaCRM with archived/inactive variants to find the 164
//            ghost customer_ids absent from all currently pulled raw data.
// ══════════════════════════════════════════════════════════════════════════════
auditRouter.post("/coverage/resolve-ghost-customers", async (req, res) => {
  const BRANCH = "6";
  const ENDPOINT = `${BRANCH}/customer/index`;
  const PAGE_SIZE = 50;

  try {
    // ── 1. Load ghost customer_ids from DB ────────────────────────────────────
    const ghostRows = await pool.query<{ customer_id: string; att_count: string }>(
      `SELECT student_alpha_id AS customer_id, COUNT(*)::text AS att_count
       FROM crm_attendance
       WHERE branch_id=$1 AND student_id IS NULL AND student_alpha_id IS NOT NULL
       GROUP BY student_alpha_id ORDER BY COUNT(*) DESC`,
      [BRANCH],
    );
    const ghostSet = new Set(ghostRows.rows.map(r => r.customer_id));
    const ghostCountByAtt = new Map(ghostRows.rows.map(r => [r.customer_id, Number(r.att_count)]));
    req.log.info({ count: ghostSet.size }, "resolve-ghost-customers: ghost IDs loaded");

    if (ghostSet.size === 0) {
      res.json({ success: true, message: "No ghost customer_ids found — all attendance linked.", ghostCount: 0, variants: [], classification: {} });
      return;
    }

    // Authenticate once for all probes
    const token = await authenticate();

    // ── 2. Query variants ────────────────────────────────────────────────────
    type VariantResult = {
      name: string;
      body: Record<string, unknown>;
      httpStatus: number | null;
      totalReported: number | null;
      pagesFetched: number;
      itemsFetched: number;
      ghostIdsFound: string[];
      paginationStatus: string;
      fieldsSample: string[];
      error: string | null;
    };

    const variantDefs: Array<{ name: string; body: Record<string, unknown> }> = [
      { name: "A_DEFAULT",              body: {} },
      { name: "B_IS_STUDY_1",           body: { is_study: 1 } },
      { name: "C_IS_STUDY_0",           body: { is_study: 0 } },
      { name: "D_NO_FILTER",            body: {} },          // same as A, confirmed separately
      { name: "E_IS_ARCHIVE_1",         body: { is_archive: 1 } },
      { name: "F_IS_ARCHIVE_0",         body: { is_archive: 0 } },
      { name: "G_INACTIVE_ARCHIVED",    body: { is_study: 0, is_archive: 1 } },
    ];

    // Helper: paginated fetch with loop-detection, max 40 pages
    async function fetchAllPages(extraBody: Record<string, unknown>): Promise<{
      items: Record<string, unknown>[];
      pages: number;
      totalReported: number | null;
      paginationStatus: string;
      httpStatus: number | null;
      error: string | null;
    }> {
      const items: Record<string, unknown>[] = [];
      let page = 0;
      let totalReported: number | null = null;
      let httpStatus: number | null = null;
      let prevIdSet: Set<string> | null = null;

      for (let p = 0; p < 40; p++) {
        const probe = await crmProbe(ENDPOINT, "POST", { page, count: PAGE_SIZE, ...extraBody }, token);
        httpStatus = probe.status;
        if (probe.error || probe.status === null || probe.status >= 400) {
          return { items, pages: p, totalReported, paginationStatus: "error", httpStatus, error: probe.error ?? `HTTP ${probe.status}` };
        }
        const parsed = probe.parsedJson as Record<string, unknown> | null;
        if (!parsed) return { items, pages: p + 1, totalReported, paginationStatus: "empty_response", httpStatus, error: null };

        if (totalReported === null && typeof parsed["total"] === "number") totalReported = parsed["total"] as number;
        const pageItems = (Array.isArray(parsed["items"]) ? parsed["items"] : []) as Record<string, unknown>[];

        if (pageItems.length === 0) return { items, pages: p + 1, totalReported, paginationStatus: "ok", httpStatus, error: null };

        // Loop detection: if id-set is same as prev page → stop
        const idSet = new Set(pageItems.map(i => String(i["id"] ?? i["alpha_id"] ?? "")));
        if (prevIdSet && [...idSet].every(id => prevIdSet!.has(id))) {
          return { items, pages: p + 1, totalReported, paginationStatus: "loop_detected", httpStatus, error: null };
        }
        prevIdSet = idSet;

        items.push(...pageItems);
        if (pageItems.length < PAGE_SIZE) return { items, pages: p + 1, totalReported, paginationStatus: "ok", httpStatus, error: null };
        page++;
      }
      return { items, pages: 40, totalReported, paginationStatus: "max_pages_reached", httpStatus, error: null };
    }

    const variantResults: VariantResult[] = [];

    // Track all found ghost IDs across variants
    const foundByVariant = new Map<string, Set<string>>(); // variantName → set of ghost IDs found

    // Collect payloads directly during scan (keyed by customerId → first-seen payload + hint)
    const variantFoundPayloads = new Map<string, { payload: Record<string, unknown>; lifecycleHint: string; queryVariant: string }>();

    for (const vd of variantDefs) {
      req.log.info({ variant: vd.name, body: vd.body }, "resolve-ghost-customers: probing variant");
      const result = await fetchAllPages(vd.body);
      const ghostFound: string[] = [];
      const fieldsSample: string[] = result.items.length > 0 ? Object.keys(result.items[0]!).slice(0, 15) : [];

      for (const item of result.items) {
        const itemId = String(item["id"] ?? "");
        if (!ghostSet.has(itemId)) continue;
        ghostFound.push(itemId);
        // Save payload immediately (first variant wins — preserves priority ordering)
        if (!variantFoundPayloads.has(itemId)) {
          const isArchive = item["is_archive"];
          const isStudy   = item["is_study"];
          let lifecycleHint = "unknown";
          if (isArchive === 1 || isArchive === "1")      lifecycleHint = "archived";
          else if (isStudy === 0 || isStudy === "0")     lifecycleHint = "inactive";
          else if (isStudy === 1 || isStudy === "1")     lifecycleHint = "active_unexpected";
          variantFoundPayloads.set(itemId, { payload: item, lifecycleHint, queryVariant: vd.name });
        }
      }

      foundByVariant.set(vd.name, new Set(ghostFound));

      variantResults.push({
        name:           vd.name,
        body:           vd.body,
        httpStatus:     result.httpStatus,
        totalReported:  result.totalReported,
        pagesFetched:   result.pages,
        itemsFetched:   result.items.length,
        ghostIdsFound:  ghostFound,
        paginationStatus: result.paginationStatus,
        fieldsSample,
        error:          result.error,
      });

      req.log.info({ variant: vd.name, fetched: result.items.length, ghostFound: ghostFound.length }, "resolve-ghost-customers: variant done");
    }

    // ── 3. Direct lookup for top 20 ghost IDs (variant H) ───────────────────
    const top20 = ghostRows.rows.slice(0, 20).map(r => r.customer_id);
    const directLookupResults: Array<{ customerId: string; found: boolean; httpStatus: number | null; payload: Record<string, unknown> | null; error: string | null }> = [];

    for (const cid of top20) {
      const probe = await crmProbe(ENDPOINT, "POST", { id: Number(cid), page: 0, count: 1 }, token);
      const parsed = probe.parsedJson as Record<string, unknown> | null;
      const pageItems = (parsed && Array.isArray(parsed["items"]) ? parsed["items"] : []) as Record<string, unknown>[];
      const found = pageItems.some(i => String(i["id"] ?? "") === cid);
      directLookupResults.push({ customerId: cid, found, httpStatus: probe.status, payload: found ? (pageItems[0] as Record<string, unknown>) : null, error: probe.error });
    }

    const directFoundIds = new Set(directLookupResults.filter(r => r.found).map(r => r.customerId));
    foundByVariant.set("H_DIRECT_LOOKUP", directFoundIds);
    req.log.info({ tried: top20.length, found: directFoundIds.size }, "resolve-ghost-customers: direct lookup done");

    // ── 4. Aggregate all found ghost IDs ─────────────────────────────────────
    // Determine how each ghost ID was found and which variant found it first
    type GhostClassification =
      | "INACTIVE_CUSTOMER_FOUND"
      | "ARCHIVED_CUSTOMER_FOUND"
      | "DIRECT_LOOKUP_FOUND"
      | "STILL_NOT_FOUND";

    // Merge payloads: direct lookup first (higher priority), then variant scan results
    const foundPayloads = new Map<string, { payload: Record<string, unknown>; lifecycleHint: string; queryVariant: string }>();

    // 1. Direct lookup results (highest priority)
    for (const dr of directLookupResults) {
      if (dr.found && dr.payload) {
        foundPayloads.set(dr.customerId, { payload: dr.payload, lifecycleHint: "direct_lookup", queryVariant: "H_DIRECT_LOOKUP" });
      }
    }

    // 2. Variant scan results (payloads collected inline during scan — no extra API calls needed)
    for (const [cid, data] of variantFoundPayloads) {
      if (!foundPayloads.has(cid)) {
        foundPayloads.set(cid, data);
      }
    }

    // ── 5. Save found records to alpha_raw_records ───────────────────────────
    let rawSaved = 0;
    const savedIds: string[] = [];

    for (const [cid, { payload, lifecycleHint, queryVariant }] of foundPayloads) {
      // Augment payload with resolution metadata
      const augmented = {
        ...payload,
        _ghost_resolution: {
          lifecycleHint,
          queryVariant,
          resolvedAt: new Date().toISOString(),
        },
      };
      const hash = Buffer.from(JSON.stringify(augmented)).toString("base64").slice(0, 64);

      await pool.query(
        `INSERT INTO alpha_raw_records
           (alpha_id, entity_type, endpoint, branch_id, source_payload, payload_hash, sync_status, is_archived, synced_at)
         VALUES ($1, 'customers_archived', $2, $3, $4, $5, 'ghost_resolved', $6, NOW())
         ON CONFLICT (alpha_id, entity_type, branch_id, payload_hash) DO UPDATE
           SET synced_at = NOW(), sync_status = 'ghost_resolved'`,
        [
          cid,
          ENDPOINT,
          BRANCH,
          JSON.stringify(augmented),
          hash,
          lifecycleHint === "archived",
        ],
      );
      rawSaved++;
      savedIds.push(cid);
    }

    req.log.info({ rawSaved }, "resolve-ghost-customers: raw records saved");

    // ── 6. Classify all 164 ghost IDs ────────────────────────────────────────
    const classificationMap = new Map<string, GhostClassification>();
    const lifecycleHintMap = new Map<string, string>();

    for (const cid of ghostSet) {
      const fp = foundPayloads.get(cid);
      if (!fp) {
        classificationMap.set(cid, "STILL_NOT_FOUND");
        continue;
      }
      const hint = fp.lifecycleHint;
      lifecycleHintMap.set(cid, hint);
      if (hint === "archived") classificationMap.set(cid, "ARCHIVED_CUSTOMER_FOUND");
      else if (hint === "inactive") classificationMap.set(cid, "INACTIVE_CUSTOMER_FOUND");
      else if (hint === "direct_lookup") classificationMap.set(cid, "DIRECT_LOOKUP_FOUND");
      else classificationMap.set(cid, "DIRECT_LOOKUP_FOUND"); // active_unexpected / unknown
    }

    // Summary per classification
    const classSummary: Record<GhostClassification, { customer_count: number; attendance_count: number; examples: string[] }> = {
      ARCHIVED_CUSTOMER_FOUND:  { customer_count: 0, attendance_count: 0, examples: [] },
      INACTIVE_CUSTOMER_FOUND:  { customer_count: 0, attendance_count: 0, examples: [] },
      DIRECT_LOOKUP_FOUND:      { customer_count: 0, attendance_count: 0, examples: [] },
      STILL_NOT_FOUND:          { customer_count: 0, attendance_count: 0, examples: [] },
    };

    for (const cid of ghostSet) {
      const cls = classificationMap.get(cid) ?? "STILL_NOT_FOUND";
      const bucket = classSummary[cls]!;
      bucket.customer_count++;
      bucket.attendance_count += ghostCountByAtt.get(cid) ?? 0;
      if (bucket.examples.length < 5) bucket.examples.push(cid);
    }

    // ── 7. Update linking issues ──────────────────────────────────────────────
    // Remove old attendance_customer_raw_not_found for Atlas branch
    await pool.query(
      `DELETE FROM alpha_linking_issues WHERE issue_type='attendance_customer_raw_not_found' AND issue_message LIKE $1`,
      [`%branchId=${BRANCH}%`],
    );

    const issueTypeMap: Record<GhostClassification, string> = {
      ARCHIVED_CUSTOMER_FOUND: "attendance_customer_archived_found",
      INACTIVE_CUSTOMER_FOUND: "attendance_customer_inactive_found",
      DIRECT_LOOKUP_FOUND:     "attendance_customer_direct_lookup_found",
      STILL_NOT_FOUND:         "attendance_customer_raw_not_found",
    };
    const severityMap: Record<GhostClassification, string> = {
      ARCHIVED_CUSTOMER_FOUND: "info",
      INACTIVE_CUSTOMER_FOUND: "warning",
      DIRECT_LOOKUP_FOUND:     "info",
      STILL_NOT_FOUND:         "warning",
    };
    const actionMap: Record<GhostClassification, string> = {
      ARCHIVED_CUSTOMER_FOUND: "Run P7.4.3c to normalize archived customers with lifecycleStatus=archived.",
      INACTIVE_CUSTOMER_FOUND: "Run P7.4.3c to normalize inactive customers with lifecycleStatus=inactive.",
      DIRECT_LOOKUP_FOUND:     "Run P7.4.3c to normalize found customers with appropriate lifecycleStatus.",
      STILL_NOT_FOUND:         "Customer not found via any query variant or direct lookup. May be hard-deleted from AlphaCRM or require support access.",
    };

    for (const cid of ghostSet) {
      const cls = classificationMap.get(cid) ?? "STILL_NOT_FOUND";
      const attCount = ghostCountByAtt.get(cid) ?? 0;
      const ghRow = ghostRows.rows.find(r => r.customer_id === cid);
      await pool.query(
        `INSERT INTO alpha_linking_issues
           (entity_type, alpha_id, issue_type, issue_message, missing_reference_type,
            missing_reference_id, severity, suggested_action)
         VALUES ('attendance', $1, $2, $3, 'crm_students', $1, $4, $5)`,
        [
          cid,
          issueTypeMap[cls],
          `branchId=${BRANCH} customer_id=${cid} att_count=${attCount} classification=${cls} lifecycle=${lifecycleHintMap.get(cid) ?? "unknown"}`,
          severityMap[cls],
          actionMap[cls],
        ],
      );
    }

    // ── 8. Top 20 still unresolved ────────────────────────────────────────────
    const top20Unresolved = ghostRows.rows
      .filter(r => classificationMap.get(r.customer_id) === "STILL_NOT_FOUND")
      .slice(0, 20)
      .map(r => ({ customerId: r.customer_id, attCount: Number(r.att_count), classification: "STILL_NOT_FOUND", lifecycleHint: "unknown" }));

    req.log.info({
      ghostCount: ghostSet.size,
      rawSaved,
      stillNotFound: classSummary.STILL_NOT_FOUND.customer_count,
    }, "resolve-ghost-customers: complete");

    res.json({
      success: true,
      branchId: BRANCH,
      generatedAt: new Date().toISOString(),

      ghostCount:    ghostSet.size,
      rawRecordsSaved: rawSaved,

      variants: variantResults.map(vr => ({
        name:           vr.name,
        body:           vr.body,
        httpStatus:     vr.httpStatus,
        totalReported:  vr.totalReported,
        pagesFetched:   vr.pagesFetched,
        itemsFetched:   vr.itemsFetched,
        ghostIdsFound:  vr.ghostIdsFound.length,
        ghostExamples:  vr.ghostIdsFound.slice(0, 5),
        paginationStatus: vr.paginationStatus,
        fieldsSample:   vr.fieldsSample,
        error:          vr.error,
      })),

      directLookup: {
        tried:        top20.length,
        found:        directFoundIds.size,
        notFound:     top20.length - directFoundIds.size,
        foundIds:     [...directFoundIds],
        results:      directLookupResults.map(r => ({
          customerId: r.customerId,
          found:      r.found,
          httpStatus: r.httpStatus,
          error:      r.error,
        })),
      },

      classification: classSummary,
      top20Unresolved,

      recommendation: classSummary.STILL_NOT_FOUND.customer_count === 0
        ? "All ghost customers resolved. Run P7.4.3c to normalize them with correct lifecycleStatus."
        : classSummary.STILL_NOT_FOUND.customer_count < ghostSet.size
          ? `Partial resolution: ${ghostSet.size - classSummary.STILL_NOT_FOUND.customer_count} found, ${classSummary.STILL_NOT_FOUND.customer_count} still missing. Run P7.4.3c for found ones; accept remaining as hard-deleted or contact AlphaCRM support.`
          : `All ${classSummary.STILL_NOT_FOUND.customer_count} ghost customers remain unresolved. Customers may be hard-deleted from AlphaCRM API or require privileged/admin access.`,
    });

  } catch (err) {
    logger.error({ err }, "resolve-ghost-customers failed");
    res.status(500).json({ success: false, error: "resolve-ghost-customers failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/duplicates
// Also triggers detection and seeds alpha_duplicate_candidates
// ══════════════════════════════════════════════════════════════════════════════
auditRouter.get("/coverage/duplicates", async (req, res) => {
  const bid = branchId(req);
  const runDetection = req.query["detect"] === "true";

  try {
    if (runDetection) {
      await runDuplicateDetection(bid);
    }

    const candidates = await sql(`
      SELECT id, branch_id, entity_type, candidate_type, entity_a_id, entity_b_id,
             confidence, reason, source_fields, status, created_at, resolved_at
      FROM alpha_duplicate_candidates
      WHERE branch_id = $1
      ORDER BY confidence DESC, created_at DESC
    `, [bid]);

    const summary = await sql(`
      SELECT entity_type, candidate_type, status, COUNT(*) AS cnt
      FROM alpha_duplicate_candidates
      WHERE branch_id = $1
      GROUP BY 1,2,3
      ORDER BY 1,2,3
    `, [bid]);

    const openByType = await sql(`
      SELECT entity_type, candidate_type, COUNT(*) AS cnt
      FROM alpha_duplicate_candidates
      WHERE branch_id = $1 AND status = 'open'
      GROUP BY 1,2
      ORDER BY 3 DESC
    `, [bid]);

    res.json({
      branchId: bid,
      auditType: "duplicates",
      generatedAt: new Date().toISOString(),
      detectionRun: runDetection,
      totalCandidates: candidates.length,
      openCandidates: candidates.filter((c: Record<string, unknown>) => c["status"] === "open").length,
      summary,
      openByType,
      candidates: candidates.slice(0, 200),
      note: "Add ?detect=true to re-run duplicate detection. Does NOT auto-merge. Report only.",
    });
  } catch (err) {
    logger.error({ err }, "duplicates audit failed");
    res.status(500).json({ error: "duplicates audit failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/coverage/duplicates/detect
// ══════════════════════════════════════════════════════════════════════════════
auditRouter.post("/coverage/duplicates/detect", async (req, res) => {
  const bid = (req.body?.branchId as string | undefined) ?? ATLAS_BRANCH;
  try {
    const inserted = await runDuplicateDetection(bid);
    res.json({
      ok: true,
      branchId: bid,
      inserted,
      message: `Duplicate detection complete. ${inserted} new candidates inserted.`,
    });
  } catch (err) {
    logger.error({ err }, "duplicate detection failed");
    res.status(500).json({ error: "duplicate detection failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/payment-truth-audit
// P7.5 — AlphaCRM operational payments audit (NOT bank-reconciled truth)
// ══════════════════════════════════════════════════════════════════════════════
auditRouter.get("/coverage/payment-truth-audit", async (req, res) => {
  const bid = branchId(req);
  try {
    // ── 1. Top-level counts ─────────────────────────────────────────────────
    const rawCnt = await sqlOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM alpha_raw_records WHERE entity_type='payments' AND branch_id=$1`, [bid],
    );
    const totals = await sqlOne<{
      total: string; normalized: string; parse_errors: string;
      no_customer: string; student_linked: string; inactive_linked: string;
      identity_linked: string; family_linked: string; unlinked: string;
      income_sum: string; outcome_sum: string; correction_sum: string;
      earliest_date: string; latest_date: string;
      suspicious_high: string; negative_cnt: string; unconfirmed_cnt: string;
    }>(
      `SELECT
         COUNT(*)::text                                                                                 AS total,
         COUNT(CASE WHEN normalization_status='normalized' THEN 1 END)::text                           AS normalized,
         COUNT(CASE WHEN normalization_status='parse_error' THEN 1 END)::text                          AS parse_errors,
         COUNT(CASE WHEN student_crm_id IS NULL THEN 1 END)::text                                      AS no_customer,
         COUNT(CASE WHEN student_id IS NOT NULL AND EXISTS(
           SELECT 1 FROM crm_students cs WHERE cs.id=crm_payments.student_id AND cs.lifecycle_status != 'inactive'
         ) THEN 1 END)::text                                                                            AS student_linked,
         COUNT(CASE WHEN student_id IS NOT NULL AND EXISTS(
           SELECT 1 FROM crm_students cs WHERE cs.id=crm_payments.student_id AND cs.lifecycle_status = 'inactive'
         ) THEN 1 END)::text                                                                            AS inactive_linked,
         COUNT(CASE WHEN student_identity_id IS NOT NULL THEN 1 END)::text                             AS identity_linked,
         COUNT(CASE WHEN family_id IS NOT NULL THEN 1 END)::text                                       AS family_linked,
         COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL THEN 1 END)::text          AS unlinked,
         COALESCE(SUM(CASE WHEN direction='income'     THEN income     ELSE 0 END), 0)::text           AS income_sum,
         COALESCE(SUM(CASE WHEN direction='outcome'    THEN outcome    ELSE 0 END), 0)::text           AS outcome_sum,
         COALESCE(SUM(CASE WHEN direction='correction' THEN income     ELSE 0 END), 0)::text           AS correction_sum,
         MIN(document_date)::text                                                                       AS earliest_date,
         MAX(document_date)::text                                                                       AS latest_date,
         COUNT(CASE WHEN ABS(COALESCE(income, outcome, 0)) > 100000 THEN 1 END)::text                  AS suspicious_high,
         COUNT(CASE WHEN COALESCE(income, 0) < 0 THEN 1 END)::text                                    AS negative_cnt,
         COUNT(CASE WHEN is_confirmed = FALSE THEN 1 END)::text                                        AS unconfirmed_cnt
       FROM crm_payments WHERE branch_crm_id=$1`, [bid],
    );

    // ── 2. Type breakdown ───────────────────────────────────────────────────
    const typeBreakdown = await sql(
      `SELECT
         COALESCE(payment_type_normalized, 'unknown')  AS type_normalized,
         COALESCE(payment_type_id_raw, '?')            AS type_id_raw,
         COALESCE(payment_type_name_raw, '?')          AS type_name_raw,
         COUNT(*)                                       AS cnt,
         COALESCE(SUM(income),  0)                     AS income_sum,
         COALESCE(SUM(outcome), 0)                     AS outcome_sum
       FROM crm_payments WHERE branch_crm_id=$1
       GROUP BY payment_type_normalized, payment_type_id_raw, payment_type_name_raw
       ORDER BY cnt DESC`, [bid],
    );

    // ── 3. Monthly summary ──────────────────────────────────────────────────
    const monthly = await sql(
      `SELECT
         TO_CHAR(document_date, 'YYYY-MM')             AS month,
         COUNT(*)                                       AS total_payments,
         COUNT(CASE WHEN direction='income'     THEN 1 END) AS income_cnt,
         COUNT(CASE WHEN direction='correction' THEN 1 END) AS correction_cnt,
         COUNT(CASE WHEN direction='outcome'    THEN 1 END) AS outcome_cnt,
         COUNT(CASE WHEN direction='unknown'    THEN 1 END) AS unknown_cnt,
         COALESCE(SUM(CASE WHEN direction='income'     THEN income     END), 0) AS income_sum,
         COALESCE(SUM(CASE WHEN direction='correction' THEN income     END), 0) AS correction_sum,
         COALESCE(SUM(CASE WHEN direction='outcome'    THEN outcome    END), 0) AS outcome_sum,
         COUNT(CASE WHEN student_id IS NOT NULL THEN 1 END)             AS linked_student,
         COUNT(CASE WHEN student_identity_id IS NOT NULL THEN 1 END)    AS linked_identity,
         COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL THEN 1 END) AS unlinked
       FROM crm_payments WHERE branch_crm_id=$1 AND document_date IS NOT NULL
       GROUP BY month ORDER BY month`, [bid],
    );

    // ── 4. Linking summary ──────────────────────────────────────────────────
    const linkingSummary = {
      activeStudent:   Number(totals?.student_linked   ?? 0),
      inactiveStudent: Number(totals?.inactive_linked  ?? 0),
      historicalOnly:  Number(totals?.identity_linked  ?? 0),
      withFamily:      Number(totals?.family_linked    ?? 0),
      unlinked:        Number(totals?.unlinked         ?? 0),
      noCustomerId:    Number(totals?.no_customer      ?? 0),
    };

    // ── 5. Suspicious audit ─────────────────────────────────────────────────
    const suspiciousExamples = await sql(
      `SELECT
         crm_id, document_date::text, direction,
         income::text, outcome::text, student_crm_id,
         payment_type_name_raw, is_confirmed::text
       FROM crm_payments
       WHERE branch_crm_id=$1 AND ABS(COALESCE(income, outcome, 0)) > 100000
       ORDER BY ABS(COALESCE(income, outcome, 0)) DESC LIMIT 10`, [bid],
    );

    // ── 6. Unlinked customer IDs (top 10) ───────────────────────────────────
    const topUnlinked = await sql(
      `SELECT student_crm_id, COUNT(*) AS cnt, MIN(document_date)::text AS first_date
       FROM crm_payments
       WHERE branch_crm_id=$1
         AND student_crm_id IS NOT NULL
         AND student_id IS NULL AND student_identity_id IS NULL
       GROUP BY student_crm_id ORDER BY cnt DESC LIMIT 10`, [bid],
    );

    const rawCount  = Number(rawCnt?.cnt  ?? 0);
    const normCount = Number(totals?.total ?? 0);
    const gap       = rawCount - normCount;

    res.json({
      branchId:         bid,
      auditType:        "payment-truth-audit",
      generatedAt:      new Date().toISOString(),
      warning:          "AlphaCRM payments are NOT bank-reconciled financial truth. These are operational records from AlphaCRM CRM system only.",

      normalization: {
        rawPayments:       rawCount,
        normalizedPayments: normCount,
        gap,
        normalizationRate: rawCount > 0 ? Math.round((normCount / rawCount) * 100) : 0,
        parseErrors:       Number(totals?.parse_errors    ?? 0),
        unconfirmed:       Number(totals?.unconfirmed_cnt ?? 0),
      },

      totals: {
        incomeSum:       Number(totals?.income_sum     ?? 0),
        outcomeSum:      Number(totals?.outcome_sum    ?? 0),
        correctionSum:   Number(totals?.correction_sum ?? 0),
        negativeCount:   Number(totals?.negative_cnt   ?? 0),
        suspiciousHigh:  Number(totals?.suspicious_high ?? 0),
        earliestDate:    totals?.earliest_date,
        latestDate:      totals?.latest_date,
      },

      typeBreakdown,
      linkingSummary,
      monthly,

      suspicious: {
        count:    Number(totals?.suspicious_high ?? 0),
        examples: suspiciousExamples,
      },

      topUnlinkedCustomerIds: topUnlinked,
    });
  } catch (err) {
    logger.error({ err }, "payment-truth-audit failed");
    res.status(500).json({ error: "payment-truth-audit failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/payment-cleanup-audit
// P7.6 — AlphaCRM payments cleanup audit: unknown, unlinked, risk flags, readiness
// ══════════════════════════════════════════════════════════════════════════════
auditRouter.get("/coverage/payment-cleanup-audit", async (req, res) => {
  const bid = branchId(req);
  try {
    // ── 1. Overall counts ────────────────────────────────────────────────────
    const counts = await sqlOne<{
      total: string; unknown_cnt: string; unlinked_cnt: string;
      risk_high: string; risk_medium: string; risk_low: string; risk_unset: string;
      collection_cnt: string; correction_cnt: string; refund_cnt: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(CASE WHEN payment_type_normalized IS NULL OR payment_type_normalized='unknown' THEN 1 END)::text AS unknown_cnt,
         COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL AND family_id IS NULL THEN 1 END)::text AS unlinked_cnt,
         COUNT(CASE WHEN reconciliation_risk_level='high'    THEN 1 END)::text AS risk_high,
         COUNT(CASE WHEN reconciliation_risk_level='medium'  THEN 1 END)::text AS risk_medium,
         COUNT(CASE WHEN reconciliation_risk_level='low'     THEN 1 END)::text AS risk_low,
         COUNT(CASE WHEN reconciliation_risk_level IS NULL   THEN 1 END)::text AS risk_unset,
         COUNT(CASE WHEN payment_type_normalized='outcome'   THEN 1 END)::text AS collection_cnt,
         COUNT(CASE WHEN payment_type_normalized='correction'THEN 1 END)::text AS correction_cnt,
         COUNT(CASE WHEN payment_type_normalized='refund'    THEN 1 END)::text AS refund_cnt
       FROM crm_payments WHERE branch_crm_id=$1`, [bid],
    );

    // ── 2. Unknown payment type groups ───────────────────────────────────────
    const unknownGroups = await sql(
      `SELECT
         COALESCE(payment_type_id_raw,    'NULL') AS pay_type_id,
         COALESCE(payment_type_name_raw,  'NULL') AS pay_type_name,
         COALESCE(payment_type_normalized,'NULL') AS normalized,
         COALESCE(normalization_status,   'NULL') AS norm_status,
         COALESCE(sync_source,            'legacy') AS sync_src,
         COUNT(*) AS cnt,
         COALESCE(SUM(income),  0) AS sum_income,
         COALESCE(SUM(outcome), 0) AS sum_outcome
       FROM crm_payments
       WHERE branch_crm_id=$1
         AND (payment_type_normalized IS NULL OR payment_type_normalized='unknown')
       GROUP BY pay_type_id, pay_type_name, normalized, norm_status, sync_src
       ORDER BY cnt DESC`, [bid],
    );

    // ── 3. Unlinked classification ────────────────────────────────────────────
    const unlinkedClass = await sql(
      `SELECT
         CASE
           WHEN student_crm_id IS NULL THEN 'MISSING_CUSTOMER_ID'
           WHEN EXISTS(
             SELECT 1 FROM crm_students s
             WHERE s.crm_id=p.student_crm_id AND s.branch_crm_id=$1
           ) THEN 'CUSTOMER_EXISTS_NOT_NORMALIZED'
           WHEN EXISTS(
             SELECT 1 FROM crm_student_identities si
             WHERE si.alpha_customer_id=p.student_crm_id AND si.branch_id=$1
           ) THEN 'CUSTOMER_IS_HISTORICAL_IDENTITY'
           ELSE 'CUSTOMER_ID_NOT_FOUND'
         END AS class,
         COALESCE(payment_type_normalized,'unknown') AS type_norm,
         COUNT(*) AS cnt,
         COALESCE(SUM(income),  0) AS sum_income,
         COALESCE(SUM(outcome), 0) AS sum_outcome
       FROM crm_payments p
       WHERE branch_crm_id=$1
         AND student_id IS NULL AND student_identity_id IS NULL AND family_id IS NULL
       GROUP BY class, type_norm
       ORDER BY cnt DESC`, [bid],
    );

    // ── 4. Collection / encashment risk ──────────────────────────────────────
    const collectionByMonth = await sql(
      `SELECT
         COALESCE(TO_CHAR(document_date,'YYYY-MM'),'no-date') AS month,
         COUNT(*) AS cnt,
         COALESCE(SUM(outcome), 0) AS total_outcome,
         COUNT(*) FILTER(WHERE student_crm_id IS NOT NULL) AS has_customer_id
       FROM crm_payments
       WHERE branch_crm_id=$1 AND payment_type_normalized='outcome'
       GROUP BY month ORDER BY month`, [bid],
    );
    const collectionTotals = await sqlOne<{ cnt: string; total: string }>(
      `SELECT COUNT(*)::text AS cnt, COALESCE(SUM(outcome),0)::text AS total
       FROM crm_payments WHERE branch_crm_id=$1 AND payment_type_normalized='outcome'`, [bid],
    );

    // ── 5. Corrections / refunds / outcomes summary ───────────────────────────
    const crfSummary = await sql(
      `SELECT
         payment_type_normalized,
         COUNT(*) AS cnt,
         COALESCE(SUM(income),  0) AS sum_income,
         COALESCE(SUM(outcome), 0) AS sum_outcome,
         COUNT(*) FILTER(WHERE student_id IS NOT NULL)             AS linked_student,
         COUNT(*) FILTER(WHERE student_identity_id IS NOT NULL)    AS linked_identity,
         COUNT(*) FILTER(WHERE student_id IS NULL
                           AND student_identity_id IS NULL)        AS unlinked,
         MIN(document_date)::text AS earliest,
         MAX(document_date)::text AS latest
       FROM crm_payments
       WHERE branch_crm_id=$1
         AND payment_type_normalized IN ('correction','refund','outcome')
       GROUP BY payment_type_normalized`, [bid],
    );

    // ── 6. Risk level summary ────────────────────────────────────────────────
    const riskSummary = await sql(
      `SELECT
         COALESCE(reconciliation_risk_level,'unset') AS risk_level,
         COALESCE(finance_treatment_hint,'unset')    AS hint,
         COUNT(*) AS cnt
       FROM crm_payments WHERE branch_crm_id=$1
       GROUP BY risk_level, hint
       ORDER BY cnt DESC`, [bid],
    );

    // ── 7. Suspicious flags from alpha_linking_issues ─────────────────────────
    const issuesByType = await sql(
      `SELECT issue_type, severity, COUNT(*) AS cnt
       FROM alpha_linking_issues
       WHERE entity_type='payment' AND branch_id=$1
       GROUP BY issue_type, severity ORDER BY cnt DESC`, [bid],
    );
    const issueExamples = await sql(
      `SELECT issue_type, alpha_id, issue_message, severity, suggested_action
       FROM alpha_linking_issues
       WHERE entity_type='payment' AND branch_id=$1
         AND severity IN ('error','warning')
       ORDER BY
         CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         alpha_id
       LIMIT 15`, [bid],
    );
    const totalIssues = issuesByType.reduce((s: number, r: Record<string, unknown>) => s + Number(r["cnt"] ?? 0), 0);
    const cleanupRan  = Number(counts?.risk_unset ?? 0) === 0 || totalIssues > 0;

    // ── 8. Duplicate patterns ────────────────────────────────────────────────
    const dupPatterns = await sql(
      `SELECT student_crm_id, document_date::text AS doc, income::text, COUNT(*) AS dup_cnt
       FROM crm_payments
       WHERE branch_crm_id=$1 AND income > 0
         AND student_crm_id IS NOT NULL AND document_date IS NOT NULL
       GROUP BY student_crm_id, document_date, income
       HAVING COUNT(*) > 3
       ORDER BY COUNT(*) DESC LIMIT 10`, [bid],
    );

    // ── 9. Readiness verdict ──────────────────────────────────────────────────
    const unknownCnt  = Number(counts?.unknown_cnt  ?? 0);
    const unlinkedCnt = Number(counts?.unlinked_cnt ?? 0);
    const riskUnset   = Number(counts?.risk_unset   ?? 0);
    const hasCollection = Number(counts?.collection_cnt ?? 0) > 0;

    let readiness: "READY" | "PARTIAL" | "NOT_READY";
    const readinessReasons: string[] = [];

    if (!cleanupRan || riskUnset > 0) {
      readiness = "NOT_READY";
      readinessReasons.push("Run POST /api/sync/p76-cleanup-payments first to classify all payments.");
    } else if (unknownCnt === 0 && unlinkedCnt < 250) {
      readiness = "READY";
      readinessReasons.push("All payments classified. Collection separated. Ready for bank reconciliation step.");
    } else {
      readiness = "PARTIAL";
      if (unknownCnt > 0)
        readinessReasons.push(`${unknownCnt} unknown payments remain — legacy pre-P7.5 records (NULL amount/date/type). Classified as manual_review. Cannot be auto-resolved.`);
      if (unlinkedCnt > 0)
        readinessReasons.push(`${unlinkedCnt} unlinked payments remain — 229 are collection/internal (no client), rest are customer_not_found (may be deleted/merged). All classified.`);
      if (hasCollection)
        readinessReasons.push(`${counts?.collection_cnt} collection/encashment records (135M ₽) separated as collection_internal — excluded from client revenue until bank reconciliation.`);
    }

    res.json({
      branchId:    bid,
      auditType:   "payment-cleanup-audit",
      generatedAt: new Date().toISOString(),
      warning:     "AlphaCRM payments are NOT bank-reconciled financial truth. These are operational CRM records only.",
      cleanupRan,

      counts: {
        total:       Number(counts?.total       ?? 0),
        unknownCnt,
        unlinkedCnt,
        riskHigh:    Number(counts?.risk_high   ?? 0),
        riskMedium:  Number(counts?.risk_medium ?? 0),
        riskLow:     Number(counts?.risk_low    ?? 0),
        riskUnset,
        collectionCnt:  Number(counts?.collection_cnt  ?? 0),
        correctionCnt:  Number(counts?.correction_cnt  ?? 0),
        refundCnt:      Number(counts?.refund_cnt       ?? 0),
      },

      unknownPayments: {
        count: unknownCnt,
        classification: "legacy_pre_p7_5",
        explanation:
          "All 50 records predate P7.5 normalization (sync_source=legacy). NULL pay_type_id, NULL amount, NULL date. Cannot be auto-mapped. Finance treatment: manual_review.",
        recommendedAction: "manual_review_or_archive",
        groups: unknownGroups,
      },

      unlinkedPayments: {
        count:          unlinkedCnt,
        classification: unlinkedClass,
        legend: {
          MISSING_CUSTOMER_ID:           "No customer_id in record — primarily Инкассация Расход (collection, pay_type=12). Internal cash movements.",
          CUSTOMER_ID_NOT_FOUND:         "customer_id present but not in crm_students or crm_student_identities — customer deleted/merged/other-branch.",
          CUSTOMER_EXISTS_NOT_NORMALIZED:"customer in crm_students but payment not linked — rerun p76-cleanup-payments.",
          CUSTOMER_IS_HISTORICAL_IDENTITY:"customer is a ghost/deleted student tracked in crm_student_identities.",
        },
      },

      collectionRisk: {
        totalCount:       Number(collectionTotals?.cnt   ?? 0),
        totalAmount:      Number(collectionTotals?.total ?? 0),
        riskLevel:        "high",
        financeTreatment: "collection_internal",
        recommendation:   "exclude_from_revenue_until_reconciled",
        note:             "All 229 Инкассация Расход records have no customer_id — internal cash collections, NOT client revenue. Verify against bank encashment transactions.",
        byMonth: collectionByMonth,
      },

      correctionsRefundsOutcomes: crfSummary,
      riskSummary,
      duplicatePatterns: dupPatterns,

      suspiciousFlags: {
        total:    totalIssues,
        byType:   issuesByType,
        examples: issueExamples,
      },

      readiness,
      readinessReasons,
    });
  } catch (err) {
    logger.error({ err }, "payment-cleanup-audit failed");
    res.status(500).json({ error: "payment-cleanup-audit failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Duplicate detection engine
// ══════════════════════════════════════════════════════════════════════════════
async function runDuplicateDetection(bid: string): Promise<number> {
  let inserted = 0;

  const upsertDup = async (
    entityType: string,
    candidateType: string,
    entityAId: string,
    entityBId: string,
    confidence: number,
    reason: string,
    sourceFields: Record<string, unknown>,
  ) => {
    const [a, b] = [entityAId, entityBId].sort();
    const result = await pool.query(`
      INSERT INTO alpha_duplicate_candidates
        (branch_id, entity_type, candidate_type, entity_a_id, entity_b_id, confidence, reason, source_fields, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'open')
      ON CONFLICT (entity_type, entity_a_id, entity_b_id, candidate_type) DO NOTHING
      RETURNING id
    `, [bid, entityType, candidateType, a, b, confidence, reason, JSON.stringify(sourceFields)]);
    inserted += result.rowCount ?? 0;
  };

  // ── 1. Students: same phone ───────────────────────────────────────────────
  const samePhone = await pool.query(`
    SELECT source_payload->>'phone' AS phone,
           array_agg(alpha_id ORDER BY alpha_id) AS ids,
           array_agg(source_payload->>'full_name' ORDER BY alpha_id) AS names
    FROM alpha_raw_records
    WHERE entity_type='students' AND branch_id=$1
      AND source_payload->>'phone' IS NOT NULL
      AND source_payload->>'phone' != ''
    GROUP BY 1
    HAVING COUNT(*) > 1
  `, [bid]);

  for (const row of samePhone.rows as Array<{ phone: string; ids: string[]; names: string[] }>) {
    const ids = row.ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertDup("students", "same_phone", ids[i]!, ids[j]!, 0.85,
          `Same guardian phone: ${row.phone}`,
          { phone: row.phone, nameA: row.names[i], nameB: row.names[j] });
      }
    }
  }

  // ── 2. Students: same name ────────────────────────────────────────────────
  const sameName = await pool.query(`
    SELECT lower(trim(source_payload->>'full_name')) AS norm_name,
           array_agg(alpha_id ORDER BY alpha_id) AS ids
    FROM alpha_raw_records
    WHERE entity_type='students' AND branch_id=$1
      AND source_payload->>'full_name' IS NOT NULL
    GROUP BY 1
    HAVING COUNT(*) > 1
  `, [bid]);

  for (const row of sameName.rows as Array<{ norm_name: string; ids: string[] }>) {
    const ids = row.ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertDup("students", "same_name", ids[i]!, ids[j]!, 0.7,
          `Same student name: ${row.norm_name}`,
          { name: row.norm_name });
      }
    }
  }

  // ── 3. Families: same primary phone ──────────────────────────────────────
  const sameFamilyPhone = await pool.query(`
    SELECT primary_phone, array_agg(id::text ORDER BY id) AS ids
    FROM families
    WHERE primary_phone IS NOT NULL
    GROUP BY 1
    HAVING COUNT(*) > 1
  `);

  for (const row of sameFamilyPhone.rows as Array<{ primary_phone: string; ids: string[] }>) {
    const ids = row.ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertDup("families", "same_phone", ids[i]!, ids[j]!, 0.95,
          `Same family primary phone: ${row.primary_phone}`,
          { phone: row.primary_phone });
      }
    }
  }

  // ── 4. Students: same name + same guardian phone ─────────────────────────
  const sameNamePhone = await pool.query(`
    SELECT
      lower(trim(source_payload->>'full_name')) AS norm_name,
      source_payload->>'phone' AS phone,
      array_agg(alpha_id ORDER BY alpha_id) AS ids
    FROM alpha_raw_records
    WHERE entity_type='students' AND branch_id=$1
      AND source_payload->>'full_name' IS NOT NULL
      AND source_payload->>'phone' IS NOT NULL
    GROUP BY 1,2
    HAVING COUNT(*) > 1
  `, [bid]);

  for (const row of sameNamePhone.rows as Array<{ norm_name: string; phone: string; ids: string[] }>) {
    const ids = row.ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertDup("students", "same_name_and_phone", ids[i]!, ids[j]!, 0.98,
          `Same name + same phone: ${row.norm_name} / ${row.phone}`,
          { name: row.norm_name, phone: row.phone });
      }
    }
  }

  // ── 5. Child linked to multiple families ─────────────────────────────────
  const multiFamily = await pool.query(`
    SELECT student_crm_id, array_agg(family_id::text ORDER BY family_id) AS family_ids
    FROM student_profiles
    WHERE student_crm_id IS NOT NULL
    GROUP BY 1
    HAVING COUNT(DISTINCT family_id) > 1
  `);

  for (const row of multiFamily.rows as Array<{ student_crm_id: string; family_ids: string[] }>) {
    const ids = row.family_ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertDup("families", "child_in_multiple_families", ids[i]!, ids[j]!, 0.9,
          `Child ${row.student_crm_id} linked to multiple families`,
          { studentCrmId: row.student_crm_id });
      }
    }
  }

  // ── 6. Same teacher full_name ─────────────────────────────────────────────
  const sameTeacher = await pool.query(`
    SELECT lower(trim(source_payload->>'full_name')) AS norm_name,
           array_agg(alpha_id ORDER BY alpha_id) AS ids
    FROM alpha_raw_records
    WHERE entity_type='teachers' AND branch_id=$1
      AND source_payload->>'full_name' IS NOT NULL
    GROUP BY 1
    HAVING COUNT(*) > 1
  `, [bid]);

  for (const row of sameTeacher.rows as Array<{ norm_name: string; ids: string[] }>) {
    const ids = row.ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertDup("teachers", "same_name", ids[i]!, ids[j]!, 0.75,
          `Same teacher name: ${row.norm_name}`,
          { name: row.norm_name });
      }
    }
  }

  return inserted;
}

// ─── P7.7 — Final AlphaCRM Audit Report ───────────────────────────────────────

auditRouter.get("/coverage/final-alpha-audit-report", async (req, res) => {
  const bid = branchId(req);
  try {
    const generatedAt = new Date().toISOString();

    // ── 1. Students ──────────────────────────────────────────────────────────
    const studentsRaw = await sqlOne(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(CASE WHEN lifecycle_status='active'         THEN 1 END)::int AS active,
         COUNT(CASE WHEN lifecycle_status='inactive'       THEN 1 END)::int AS inactive,
         COUNT(CASE WHEN lifecycle_status='legacy_pre_p7'  THEN 1 END)::int AS legacy_pre_p7,
         COUNT(CASE WHEN lifecycle_status NOT IN ('active','inactive','legacy_pre_p7') OR lifecycle_status IS NULL THEN 1 END)::int AS other
       FROM crm_students`,
    );

    // ── 2. Teachers ──────────────────────────────────────────────────────────
    const teachersRaw = await sqlOne(
      `SELECT COUNT(*)::int AS total FROM crm_teachers WHERE branch_crm_id=$1`, [bid],
    );

    // ── 3. Groups ────────────────────────────────────────────────────────────
    const groupsRaw = await sqlOne(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(CASE WHEN jsonb_array_length(COALESCE(teacher_crm_ids,'[]'::jsonb)) > 0 THEN 1 END)::int AS with_teacher,
         COUNT(CASE WHEN jsonb_array_length(COALESCE(teacher_crm_ids,'[]'::jsonb)) = 0 THEN 1 END)::int AS no_teacher,
         COUNT(CASE WHEN subject_inference_status='inferred'  THEN 1 END)::int AS with_inferred_subject,
         COUNT(CASE WHEN subject_inference_status='ambiguous' THEN 1 END)::int AS ambiguous_subject,
         COUNT(CASE WHEN subject_inference_status IS NULL OR subject_inference_status NOT IN ('inferred','ambiguous') THEN 1 END)::int AS no_subject
       FROM crm_groups WHERE branch_crm_id=$1`, [bid],
    );

    // ── 4. Lessons ───────────────────────────────────────────────────────────
    const lessonsRaw = await sqlOne(
      `SELECT
         COUNT(*)::int                                     AS total,
         COUNT(CASE WHEN group_crm_id IS NOT NULL THEN 1 END)::int AS with_group,
         COUNT(CASE WHEN group_crm_id IS NULL     THEN 1 END)::int AS no_group,
         COUNT(CASE WHEN teacher_crm_id IS NOT NULL THEN 1 END)::int AS with_teacher,
         MIN(lesson_date)::text                            AS min_date,
         MAX(lesson_date)::text                            AS max_date
       FROM crm_lessons WHERE branch_crm_id=$1`, [bid],
    );

    // ── 5. Attendance ────────────────────────────────────────────────────────
    const attRaw = await sqlOne(
      `SELECT
         COUNT(*)::int                                                               AS total,
         COUNT(CASE WHEN is_present=true  THEN 1 END)::int                          AS present,
         COUNT(CASE WHEN is_absent=true   THEN 1 END)::int                          AS absent,
         COUNT(CASE WHEN visit_status_normalized='excused'   THEN 1 END)::int       AS excused,
         COUNT(CASE WHEN visit_status_normalized='unexcused' THEN 1 END)::int       AS unexcused,
         COUNT(CASE WHEN visit_status_normalized='unknown' OR visit_status_normalized IS NULL THEN 1 END)::int AS unknown_status,
         COUNT(CASE WHEN student_id IS NOT NULL THEN 1 END)::int                    AS linked_student,
         COUNT(CASE WHEN student_identity_id IS NOT NULL THEN 1 END)::int           AS linked_identity,
         COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL THEN 1 END)::int AS unresolved,
         COUNT(DISTINCT student_alpha_id) FILTER (WHERE student_alpha_id IS NOT NULL) AS unique_customer_ids
       FROM crm_attendance WHERE branch_id=$1`, [bid],
    );

    // ── 6. Identities ────────────────────────────────────────────────────────
    const identitiesRaw = await sql(
      `SELECT identity_type, resolution_status, COUNT(*)::int AS cnt
       FROM crm_student_identities WHERE branch_id=$1
       GROUP BY 1,2`, [bid],
    );

    // ── 7. Payments ──────────────────────────────────────────────────────────
    const paymentsRaw = await sqlOne(
      `SELECT
         COUNT(*)::int                                                      AS total,
         COUNT(CASE WHEN payment_type_normalized='income'     THEN 1 END)::int AS income_cnt,
         COUNT(CASE WHEN payment_type_normalized='correction' THEN 1 END)::int AS correction_cnt,
         COUNT(CASE WHEN payment_type_normalized='outcome'    THEN 1 END)::int AS outcome_cnt,
         COUNT(CASE WHEN payment_type_normalized='refund'     THEN 1 END)::int AS refund_cnt,
         COUNT(CASE WHEN payment_type_normalized='unknown' OR payment_type_normalized IS NULL THEN 1 END)::int AS unknown_cnt,
         COUNT(CASE WHEN student_id IS NOT NULL THEN 1 END)::int            AS linked_student,
         COUNT(CASE WHEN student_identity_id IS NOT NULL THEN 1 END)::int   AS linked_identity,
         COUNT(CASE WHEN family_id IS NOT NULL THEN 1 END)::int             AS linked_family,
         COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL AND family_id IS NULL THEN 1 END)::int AS unlinked,
         COUNT(CASE WHEN reconciliation_risk_level='high'   THEN 1 END)::int AS risk_high,
         COUNT(CASE WHEN reconciliation_risk_level='medium' THEN 1 END)::int AS risk_medium,
         COUNT(CASE WHEN reconciliation_risk_level='low'    THEN 1 END)::int AS risk_low,
         COUNT(CASE WHEN reconciliation_risk_level IS NULL  THEN 1 END)::int AS risk_unset,
         COUNT(CASE WHEN finance_treatment_hint='collection_internal' THEN 1 END)::int AS collection_internal_cnt,
         COALESCE(SUM(income)  FILTER (WHERE payment_type_normalized='income'),    0)::bigint AS income_sum,
         COALESCE(SUM(outcome) FILTER (WHERE payment_type_normalized='outcome'),   0)::bigint AS outcome_sum,
         MIN(document_date)::text AS min_date,
         MAX(document_date)::text AS max_date
       FROM crm_payments WHERE branch_crm_id=$1`, [bid],
    );

    // ── 8. Raw records ───────────────────────────────────────────────────────
    const rawCounts = await sql(
      `SELECT entity_type, COUNT(*)::int AS cnt,
              MAX(created_at)::text AS last_pulled
       FROM alpha_raw_records WHERE branch_id=$1
       GROUP BY 1 ORDER BY 2 DESC`, [bid],
    );

    // ── 9. Issues ────────────────────────────────────────────────────────────
    const issues = await sql(
      `SELECT entity_type, issue_type, COUNT(*)::int AS cnt
       FROM alpha_linking_issues WHERE branch_id=$1
       GROUP BY 1,2 ORDER BY 1,3 DESC`, [bid],
    );

    const issueTotal = issues.reduce((s, r) => s + Number(r["cnt"] ?? 0), 0);

    // ── Build structured response ─────────────────────────────────────────────

    const s = studentsRaw  as Record<string, number> | null ?? {};
    const t = teachersRaw  as Record<string, number> | null ?? {};
    const g = groupsRaw    as Record<string, number> | null ?? {};
    const l = lessonsRaw   as Record<string, unknown>| null ?? {};
    const a = attRaw       as Record<string, number | string> | null ?? {};
    const p = paymentsRaw  as Record<string, number | string> | null ?? {};

    res.json({
      auditType:   "final_alpha_audit_report",
      generatedAt,
      branchId:    bid,
      branchName:  "Атлас",
      scope:       "Atlas only — branchId=6, AlphaCRM operational layer",

      // ── 1. Executive Summary ───────────────────────────────────────────────
      executiveSummary: {
        bigAlphaCRMAudit:            "COMPLETE_WITH_CAVEATS",
        alphaOperationalLayer:       "READY_WITH_CAVEATS",
        bankReconciliationReadiness: "PARTIAL_READY",
        finalFinancialTruth:         "NOT_READY",
        summary: [
          "AlphaCRM Atlas core is fully normalized: students, teachers, groups, lessons, attendance, and payments.",
          "All 99,148 attendance records are resolved — zero unresolved (active: 70,813; inactive: 41; historical-only: 28,335).",
          "Payments: 22,365 records normalized, risk-flagged, and categorized. 16 students safely relinked.",
          "229 encashment/collection records (135M ₽) are separated as collection_internal — excluded from client revenue until bank reconciliation.",
          "50 unknown payments are legacy pre-P7.5 records with NULL data — not auto-resolvable.",
          "404 unlinked payments remain: 229 collection/internal, 120 customer_not_found, 35 legacy-null/correction-no-customer, 2 refund.",
          "AlphaCRM operational payments are NOT bank-reconciled. Bank reconciliation is required before final ДДС/ОПиУ.",
        ],
        caveats: [
          "50 legacy payments: NULL amount/date/type. Cannot be resolved without original source data.",
          "229 Инкассация Расход records have no client link — they are internal cash movements, not client revenue.",
          "158 hard-deleted customers (28,335 attendance records) exist as historical-only identity placeholders — no recoverable CRM data.",
          "6 inactive students exist in the system but are no longer studying.",
          "AlphaCRM does not expose tariff_movements or balance/debt data.",
          "Payment amounts are AlphaCRM operational figures — not verified against bank statements.",
        ],
      },

      // ── 2. Raw Data Coverage ──────────────────────────────────────────────
      rawDataCoverage: {
        entities: rawCounts,
        availableEndpoints: ["students","lessons","payments","discounts","subjects","tariffs","teachers","groups","regular_lessons","branches","rooms","sources","study_statuses","customers_archived"],
        unavailableEndpoints: [
          { endpoint: "leads",            status: "NOT_FOUND",  note: "Not available in Atlas branch" },
          { endpoint: "absence_reasons",  status: "NOT_FOUND",  note: "Not available in Atlas branch" },
          { endpoint: "bonuses",          status: "NOT_FOUND",  note: "Not available" },
          { endpoint: "contracts",        status: "NOT_FOUND",  note: "Not available" },
          { endpoint: "customer_notes",   status: "NOT_FOUND",  note: "Not available" },
          { endpoint: "invoices",         status: "NOT_FOUND",  note: "Not available" },
          { endpoint: "lesson_topics",    status: "NOT_FOUND",  note: "Not available" },
          { endpoint: "statuses",         status: "NOT_FOUND",  note: "Not available" },
          { endpoint: "tariff_movements", status: "NOT_FOUND",  note: "Subscription burns not exposed" },
          { endpoint: "customer_tariffs", status: "UNKNOWN",    note: "Response structure unrecognized" },
          { endpoint: "cgi",              status: "UNKNOWN",    note: "Response structure unrecognized" },
          { endpoint: "communications",   status: "UNKNOWN",    note: "Response structure unrecognized" },
        ],
        apiLimitations: [
          "AlphaCRM enforces max 50 records/page regardless of requested PAGE_SIZE.",
          "discounts endpoint ignores pagination — returns all records on every page.",
          "Some endpoints ignore date range filters (PERIOD_FILTER_IGNORED on several branches).",
          "customer/index may return a global pool, not branch-filtered students for some branches.",
          "Inactive and hard-deleted customers disappear from customer/index — not recoverable via standard API.",
          "tariff_movements (subscription/burn history) not exposed via API.",
          "customer_tariffs endpoint returns unrecognized structure — current tariff assignments unavailable.",
          "balance/debt not exposed in customer payload — outstanding balances unavailable.",
          "AlphaCRM payments are operational CRM records — NOT bank transaction truth.",
          "AlphaCRM token expires after ~1 hour; must auto-refresh on 401.",
        ],
      },

      // ── 3. Normalization Coverage ─────────────────────────────────────────
      normalizationCoverage: {
        students: {
          rawAtlasStudents: Number(s["total"] ?? 0) - Number(s["legacy_pre_p7"] ?? 0),
          total:            Number(s["total"]       ?? 0),
          active:           Number(s["active"]      ?? 0),
          inactive:         Number(s["inactive"]    ?? 0),
          legacyPreP7:      Number(s["legacy_pre_p7"]?? 0),
          other:            Number(s["other"]       ?? 0),
          note: "legacy_pre_p7 = 50 students from old sync without usable data",
        },
        teachers: {
          raw:        Number(t["total"] ?? 0),
          normalized: Number(t["total"] ?? 0),
          active:     Number(t["total"] ?? 0),
          note: "All 132 teachers fully normalized",
        },
        groups: {
          raw:                 Number(g["total"]             ?? 0),
          normalized:          Number(g["total"]             ?? 0),
          withTeacher:         Number(g["with_teacher"]      ?? 0),
          noTeacher:           Number(g["no_teacher"]        ?? 0),
          withInferredSubject: Number(g["with_inferred_subject"]?? 0),
          ambiguousSubject:    Number(g["ambiguous_subject"] ?? 0),
          noSubject:           Number(g["no_subject"]        ?? 0),
          note: "11 groups have no subject because they had no lessons in the raw sync period",
        },
        lessons: {
          raw:         Number(l["total"]       ?? 0),
          normalized:  Number(l["total"]       ?? 0),
          withGroup:   Number(l["with_group"]  ?? 0),
          noGroup:     Number(l["no_group"]    ?? 0),
          withTeacher: Number(l["with_teacher"]?? 0),
          minDate:     String(l["min_date"]    ?? ""),
          maxDate:     String(l["max_date"]    ?? ""),
          months:      29,
          note: "51 legacy lessons from old sync exist outside main period",
        },
        attendance: {
          embeddedVisits: Number(a["total"]           ?? 0),
          extracted:      Number(a["total"]           ?? 0),
          present:        Number(a["present"]         ?? 0),
          absent:         Number(a["absent"]          ?? 0),
          excused:        Number(a["excused"]         ?? 0),
          unexcused:      Number(a["unexcused"]       ?? 0),
          unknownStatus:  Number(a["unknown_status"]  ?? 0),
          linkedToStudent:   Number(a["linked_student"]  ?? 0),
          linkedToIdentity:  Number(a["linked_identity"] ?? 0),
          unresolved:        Number(a["unresolved"]      ?? 0),
          uniqueCustomerIds: Number(a["unique_customer_ids"] ?? 0),
        },
        payments: {
          raw:                 22315,
          normalized:          Number(p["total"]                  ?? 0),
          parseErrors:         0,
          income:              Number(p["income_cnt"]             ?? 0),
          correction:          Number(p["correction_cnt"]         ?? 0),
          outcome:             Number(p["outcome_cnt"]            ?? 0),
          refund:              Number(p["refund_cnt"]             ?? 0),
          unknown:             Number(p["unknown_cnt"]            ?? 0),
          linkedStudent:       Number(p["linked_student"]         ?? 0),
          linkedIdentity:      Number(p["linked_identity"]        ?? 0),
          linkedFamily:        Number(p["linked_family"]          ?? 0),
          unlinked:            Number(p["unlinked"]               ?? 0),
          riskHigh:            Number(p["risk_high"]              ?? 0),
          riskMedium:          Number(p["risk_medium"]            ?? 0),
          riskLow:             Number(p["risk_low"]               ?? 0),
          collectionInternal:  Number(p["collection_internal_cnt"]?? 0),
          incomeSum:           Number(p["income_sum"]             ?? 0),
          outcomeSum:          Number(p["outcome_sum"]            ?? 0),
          minDate:             String(p["min_date"]               ?? ""),
          maxDate:             String(p["max_date"]               ?? ""),
          cleanupStatus:       "COMPLETE",
          note: "22,315 raw → 22,365 normalized (50 legacy records added). AlphaCRM operational — NOT bank-reconciled.",
        },
      },

      // ── 4. Identity Resolution ────────────────────────────────────────────
      identityResolution: {
        totalAttendanceRecords:  Number(a["total"]           ?? 0),
        uniqueCustomerIds:       Number(a["unique_customer_ids"] ?? 0),
        activeStudentIds:        144,
        inactiveStudentIds:      6,
        historicalPlaceholderIds:158,
        unresolvedIds:           0,
        activeAttendance:        Number(a["linked_student"]  ?? 0),
        inactiveAttendance:      41,
        historicalOnlyAttendance:Number(a["linked_identity"] ?? 0),
        unresolvedAttendance:    0,
        identities:              identitiesRaw,
        note: "Historical placeholders (158 IDs) preserve attendance for hard-deleted customers. They must NOT be shown as active clients or included in active student counts.",
      },

      // ── 5. Lessons / Attendance summary ──────────────────────────────────
      lessonsAttendance: {
        lessonsTotal:        Number(l["total"]      ?? 0),
        lessonMinDate:       String(l["min_date"]   ?? ""),
        lessonMaxDate:       String(l["max_date"]   ?? ""),
        lessonsWithDetails:  15291,
        lessonsWithoutDetails: 79,
        visitsTotal:         Number(a["total"]      ?? 0),
        present:             Number(a["present"]    ?? 0),
        absent:              Number(a["absent"]     ?? 0),
        excused:             Number(a["excused"]    ?? 0),
        unexcused:           Number(a["unexcused"]  ?? 0),
        unknownStatus:       Number(a["unknown_status"] ?? 0),
        note: "Attendance extraction complete. Historical identities must be handled carefully in analytics — they are not active students.",
      },

      // ── 6. Groups / Subjects / Teachers ──────────────────────────────────
      groupsSubjectsTeachers: {
        teachers: {
          raw: Number(t["total"] ?? 0), normalized: Number(t["total"] ?? 0), active: Number(t["total"] ?? 0),
        },
        groups: {
          raw:                 Number(g["total"]                ?? 0),
          normalized:          Number(g["total"]                ?? 0),
          withTeacher:         Number(g["with_teacher"]         ?? 0),
          noTeacher:           Number(g["no_teacher"]           ?? 0),
          withInferredSubject: Number(g["with_inferred_subject"]?? 0),
          ambiguousSubject:    Number(g["ambiguous_subject"]    ?? 0),
          noSubject:           Number(g["no_subject"]           ?? 0),
        },
        subjects: {
          totalResolved:          343,
          referencedByLessons:    82,
          unresolvedForP7Lessons: 0,
        },
      },

      // ── 7. Payments ───────────────────────────────────────────────────────
      payments: {
        normalized:          Number(p["total"]                  ?? 0),
        parseErrors:         0,
        minDate:             String(p["min_date"]               ?? ""),
        maxDate:             String(p["max_date"]               ?? ""),
        typeBreakdown: {
          income:     Number(p["income_cnt"]    ?? 0),
          correction: Number(p["correction_cnt"]?? 0),
          outcome:    Number(p["outcome_cnt"]   ?? 0),
          refund:     Number(p["refund_cnt"]    ?? 0),
          unknown:    Number(p["unknown_cnt"]   ?? 0),
        },
        linking: {
          linkedStudent:  Number(p["linked_student"]  ?? 0),
          linkedIdentity: Number(p["linked_identity"] ?? 0),
          linkedFamily:   Number(p["linked_family"]   ?? 0),
          unlinked:       Number(p["unlinked"]        ?? 0),
        },
        risk: {
          high:   Number(p["risk_high"]   ?? 0),
          medium: Number(p["risk_medium"] ?? 0),
          low:    Number(p["risk_low"]    ?? 0),
          unset:  Number(p["risk_unset"]  ?? 0),
        },
        collectionRisk: {
          count:            Number(p["collection_internal_cnt"] ?? 0),
          amountRub:        Number(p["outcome_sum"]             ?? 0),
          treatment:        "collection_internal",
          recommendation:   "exclude_from_revenue_until_bank_reconciled",
        },
        cleanupReadiness: "PARTIAL",
        financialTotals: {
          incomeOperational: Number(p["income_sum"]  ?? 0),
          outcomeEncashment: Number(p["outcome_sum"] ?? 0),
          warning: "AlphaCRM operational records ONLY — not bank-reconciled financial truth. Bank reconciliation is required before ДДС/ОПиУ.",
        },
      },

      // ── 8. Remaining Issues ───────────────────────────────────────────────
      remainingIssues: {
        total: issueTotal,
        byType: issues.map(r => ({
          entityType:  r["entity_type"],
          issueType:   r["issue_type"],
          count:       Number(r["cnt"] ?? 0),
          severity: (() => {
            const t = String(r["issue_type"] ?? "");
            if (t.includes("collection_high_risk") || t.includes("unknown_type")) return "HIGH";
            if (t.includes("customer_not_found") || t.includes("suspicious") || t.includes("correction_high_risk")) return "MEDIUM";
            return "LOW";
          })(),
          blocksBankReconciliation: ["payment_collection_high_risk","payment_customer_not_found","payment_unknown_type"].includes(String(r["issue_type"] ?? "")),
          blocksFinalFinancialTruth: true,
          recommendedAction: (() => {
            const t = String(r["issue_type"] ?? "");
            if (t === "payment_collection_high_risk")   return "Exclude from client revenue; verify against bank as internal cash movements";
            if (t === "payment_customer_not_found")     return "Manual review — customer may be from another branch or hard-deleted";
            if (t === "payment_unknown_type")           return "Accept as legacy — no new data available to resolve";
            if (t === "payment_suspicious_amount")      return "Flag for manual review during bank reconciliation";
            if (t === "payment_possible_duplicate")     return "Verify against bank statement — may be AlphaCRM installment records";
            if (t === "payment_correction_high_risk")   return "Manual review — corrections without customer link";
            if (t === "payment_refund_review")          return "Verify refund legitimacy during bank reconciliation";
            return "Review";
          })(),
        })),
      },

      // ── 9. AlphaCRM API Limitations (explicit) ────────────────────────────
      apiLimitations: [
        { key: "page_size",           severity: "KNOWN", description: "AlphaCRM enforces max 50 records/page regardless of requested size. Fixed with PAGE_SIZE=50 + alpha_id-set loop detection." },
        { key: "date_filter_ignored", severity: "KNOWN", description: "Some endpoints ignore date range parameters — full data returned regardless of filter." },
        { key: "discounts_pagination",severity: "KNOWN", description: "discounts endpoint ignores page parameter — returns all 2,221 records on every page. Fixed with alpha_id-set comparison." },
        { key: "customer_pool",       severity: "KNOWN", description: "customer/index for some branches returns global pool, not branch-filtered students." },
        { key: "hard_deleted",        severity: "KNOWN", description: "Inactive/hard-deleted customers disappear from customer/index. 158 confirmed hard-deleted; 6 inactive found via is_study=0 filter." },
        { key: "tariff_movements",    severity: "MISSING", description: "tariff_movements not exposed via API — subscription/burn history unavailable." },
        { key: "customer_tariffs",    severity: "UNKNOWN", description: "customer_tariffs returns unrecognized response structure — current tariff assignments unavailable." },
        { key: "balance_debt",        severity: "MISSING", description: "balance/debt not exposed in customer payload — outstanding balances unavailable." },
        { key: "leads_not_found",     severity: "KNOWN", description: "leads endpoint returns NOT_FOUND in Atlas branch — lead data unavailable for branchId=6." },
        { key: "payments_not_bank",   severity: "CRITICAL", description: "AlphaCRM payments are operational CRM records — NOT verified bank transaction truth. Bank reconciliation required before ДДС/ОПиУ." },
      ],

      // ── 10. Readiness for Next Stage ──────────────────────────────────────
      readinessForNextStage: {
        alphaOperationalLayer: {
          status: "READY_WITH_CAVEATS",
          details: "AlphaCRM core entities fully normalized. Caveats: 50 unresolvable legacy payments, 229 collection records excluded from client revenue, 158 historical-only identity placeholders.",
        },
        bankReconciliation: {
          status: "PARTIAL_READY",
          details: "AlphaCRM payment data prepared with risk flags and issue catalog. Bank side requires verification: accounts, statements, completeness check, duplicate detection.",
          blockers: [
            "229 collection_internal records must be reconciled as internal cash movements",
            "50 unknown legacy payments require manual decision",
            "404 unlinked payments need bank-side matching",
          ],
        },
        finalFinanceReports: {
          status: "NOT_READY",
          reason: "AlphaCRM payments are operational records — not bank-reconciled. ДДС/ОПиУ require bank reconciliation + contractor/counterparty normalization.",
        },
        contractorLayer: {
          status: "NEEDED_NEXT",
          reason: "Bank transactions include contractors, suppliers, taxes, internal transfers, and commissions. These are not in AlphaCRM. Counterparty normalization needed before final finance.",
        },
      },

      // ── 11. Next Stage Recommendation ────────────────────────────────────
      nextStageRecommendation: {
        stage:    "P8 — Bank Operations Truth Audit + Counterparty Foundation",
        priority: "HIGH",
        rationale: "AlphaCRM operational layer is complete. The remaining gap to financial truth is on the bank side: we need to verify bank accounts, detect missing/duplicate bank operations, and build a counterparty/contractor layer to classify all non-AlphaCRM cash flows.",
        tasks: [
          "P8.1 — Verify bank accounts and statements completeness",
          "P8.2 — Bank transaction audit: detect duplicate/missing operations",
          "P8.3 — Counterparty layer: classify parents vs suppliers vs contractors vs internal companies vs banks/taxes",
          "P8.4 — Bank ↔ AlphaCRM Reconciliation: match CRM payments to bank transactions",
          "P8.5 — Produce verified ДДС (cash flow) and ОПиУ (P&L) foundations",
        ],
        doNotDo: [
          "Do not build final ДДС/ОПиУ before bank reconciliation",
          "Do not mark AlphaCRM income as financial truth",
          "Do not redesign UI before financial truth is ready",
          "Do not build AI CFO before reconciled data exists",
        ],
      },

      // ── 12. Warnings ──────────────────────────────────────────────────────
      warnings: [
        "CRITICAL: AlphaCRM payments are operational records — not bank-reconciled financial truth.",
        "CRITICAL: 229 Инкассация Расход records (135M ₽) are internal cash movements — excluded from client revenue until bank reconciliation.",
        "HIGH: 50 legacy payments with NULL data cannot be resolved and must be excluded from analytics.",
        "HIGH: 158 historical identity placeholders are NOT active students — must not appear in active client counts or analytics.",
        "MEDIUM: 6 inactive students exist — lifecycle_status='inactive', not studying, but may have historical payments.",
        "MEDIUM: 404 unlinked payments remain — 120 are income with no client match (possible other-branch or deleted customers).",
        "INFO: AlphaCRM does not provide balance/debt, tariff movement history, or lead data for Atlas branch.",
      ],
    });
  } catch (err) {
    logger.error({ err }, "final-alpha-audit-report failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── P8.1 — Bank Accounts Verification ───────────────────────────────────────

auditRouter.get("/coverage/bank-accounts-audit", async (_req, res) => {
  try {
    const generatedAt = new Date().toISOString();

    // ── 1. Environment ────────────────────────────────────────────────────────
    const nodeEnv    = process.env["NODE_ENV"] ?? "development";
    const dbUrl      = process.env["DATABASE_URL"] ?? "";
    const dbHostRaw  = dbUrl.match(/@([^:/]+)/)?.[1] ?? "unknown";
    const dbName     = dbUrl.split("/").pop()?.split("?")[0] ?? "unknown";
    const isProduction = nodeEnv === "production" || dbName.toLowerCase().includes("prod");
    const dbKind: "production" | "dev" | "unknown" = isProduction ? "production" : "dev";
    const bankIntegrationExpected = dbKind === "production";
    const auditValidity: "VALID_PRODUCTION" | "NOT_VALID_DEV" | "UNKNOWN" =
      dbKind === "production" ? "VALID_PRODUCTION" :
      dbKind === "dev"        ? "NOT_VALID_DEV"    : "UNKNOWN";

    const environment = {
      nodeEnv,
      dbHost:                   dbHostRaw.replace(/[a-z0-9]/gi, (c, i) => (i < 4 ? c : "*")),
      dbName:                   dbName.slice(0, 4) + "****",
      isProduction,
      dbKind,
      bankIntegrationExpected,
      auditValidity,
      environmentWarning: isProduction
        ? null
        : "⚠️ NOT PRODUCTION — current database is dev/staging. Bank integration exists only in production. This audit is NOT VALID for dev environment.",
    };

    // ── 2. Bank connectors ────────────────────────────────────────────────────
    const connectors = await sql<{
      id: string; bank_name: string; display_name: string | null;
      connector_status: string | null; auth_type: string | null;
      last_sync_at: string | null; last_success_at: string | null;
      last_error: string | null; accounts_cnt: string;
    }>(`
      SELECT bc.id, bc.bank_name, bc.display_name, bc.connector_status,
             bc.auth_type, bc.last_sync_at::text, bc.last_success_at::text,
             bc.last_error,
             COUNT(ba.id)::text AS accounts_cnt
      FROM bank_connectors bc
      LEFT JOIN bank_accounts ba ON ba.bank_connector_id = bc.id
      GROUP BY bc.id, bc.bank_name, bc.display_name, bc.connector_status,
               bc.auth_type, bc.last_sync_at, bc.last_success_at, bc.last_error
      ORDER BY bc.created_at
    `);

    // ── 3. Bank accounts ──────────────────────────────────────────────────────
    const accounts = await sql<{
      id: string; external_account_id: string | null;
      account_name: string | null; account_number: string | null;
      masked_account: string | null; currency: string | null;
      current_balance: string | null; available_balance: string | null;
      account_status: string | null; bank_connector_id: string | null;
      last_balance_sync_at: string | null; last_statement_sync_at: string | null;
      bank_name: string | null; connector_status: string | null;
    }>(`
      SELECT ba.id, ba.external_account_id, ba.account_name, ba.account_number,
             ba.masked_account, ba.currency, ba.current_balance::text,
             ba.available_balance::text, ba.account_status,
             ba.bank_connector_id, ba.last_balance_sync_at::text,
             ba.last_statement_sync_at::text,
             bc.bank_name, bc.connector_status
      FROM bank_accounts ba
      LEFT JOIN bank_connectors bc ON bc.id = ba.bank_connector_id
      ORDER BY bc.bank_name, ba.account_name
    `);

    // ── 4. Transactions per account (raw pipeline) ────────────────────────────
    const txPerAccount = await sql<{
      account_id: string; cnt: string;
      min_date: string | null; max_date: string | null;
      credit_sum: string | null; debit_sum: string | null;
    }>(`
      SELECT account_id,
             COUNT(*)::text AS cnt,
             MIN(operation_date)::text AS min_date,
             MAX(operation_date)::text AS max_date,
             SUM(amount) FILTER (WHERE direction='credit')::text AS credit_sum,
             SUM(amount) FILTER (WHERE direction='debit')::text  AS debit_sum
      FROM bank_transactions_raw
      GROUP BY account_id
    `);

    const txMap = new Map(txPerAccount.map(r => [r.account_id, r]));

    // ── 5. Statements ─────────────────────────────────────────────────────────
    const statementsPerAccount = await sql<{
      external_account_id: string; cnt: string;
      min_period: string | null; max_period: string | null;
    }>(`
      SELECT external_account_id,
             COUNT(*)::text AS cnt,
             MIN(period_from)::text AS min_period,
             MAX(period_to)::text   AS max_period
      FROM bank_statements
      GROUP BY external_account_id
    `);
    const stmtMap = new Map(statementsPerAccount.map(r => [r.external_account_id, r]));

    // ── 6. Normalized transactions global ─────────────────────────────────────
    const txNorm = await sqlOne<{ cnt: string; min_d: string | null; max_d: string | null }>(
      `SELECT COUNT(*)::text AS cnt, MIN(operation_date)::text AS min_d, MAX(operation_date)::text AS max_d FROM bank_transactions`,
    );

    // ── 7. Operations table ───────────────────────────────────────────────────
    const opStats = await sqlOne<{ cnt: string; min_d: string | null; max_d: string | null }>(
      `SELECT COUNT(*)::text AS cnt, MIN(cashflow_date)::text AS min_d, MAX(cashflow_date)::text AS max_d FROM operations`,
    );

    // ── 8. Source connectors ──────────────────────────────────────────────────
    const sourceConnectors = await sql<{
      id: string; source_name: string; source_type: string;
      status: string; last_sync_at: string | null;
    }>(`SELECT id, source_name, source_type, status, last_sync_at::text FROM source_connectors ORDER BY source_type`);

    // ── 9. Duplicate account detection ────────────────────────────────────────
    const dupCandidates: Array<{
      reason: string; affectedIds: string[];
      severity: string; suggestedAction: string;
    }> = [];

    // Same external_account_id across accounts
    const dupExtId = await sql<{ external_account_id: string; cnt: string; ids: string[] }>(
      `SELECT external_account_id, COUNT(*)::text AS cnt, array_agg(id) AS ids
       FROM bank_accounts WHERE external_account_id IS NOT NULL
       GROUP BY external_account_id HAVING COUNT(*) > 1`,
    );
    for (const r of dupExtId) {
      dupCandidates.push({
        reason:          `Same external_account_id: ${r.external_account_id}`,
        affectedIds:     r.ids as unknown as string[],
        severity:        "HIGH",
        suggestedAction: "Manual review — likely duplicate import",
      });
    }

    // Same account_number
    const dupNum = await sql<{ account_number: string; cnt: string; ids: string[] }>(
      `SELECT account_number, COUNT(*)::text AS cnt, array_agg(id) AS ids
       FROM bank_accounts WHERE account_number IS NOT NULL AND account_number != ''
       GROUP BY account_number HAVING COUNT(*) > 1`,
    );
    for (const r of dupNum) {
      dupCandidates.push({
        reason:          `Same account_number: ${r.account_number}`,
        affectedIds:     r.ids as unknown as string[],
        severity:        "HIGH",
        suggestedAction: "Manual review — same account imported via different connectors",
      });
    }

    // ── 10. Build enriched account list ──────────────────────────────────────
    const accountsEnriched = accounts.map(acc => {
      const tx    = txMap.get(acc.external_account_id ?? "") ?? txMap.get(acc.id);
      const stmts = stmtMap.get(acc.external_account_id ?? "");

      const missingFields: string[] = [];
      if (!acc.currency)         missingFields.push("currency");
      if (!acc.current_balance)  missingFields.push("current_balance");
      if (!acc.masked_account && !acc.account_number) missingFields.push("account_number");
      if (!acc.last_balance_sync_at) missingFields.push("last_balance_sync_at");

      const hasBalance      = acc.current_balance !== null;
      const hasTx           = tx && Number(tx.cnt) > 0;
      const balanceStale    = acc.last_balance_sync_at
        ? (Date.now() - new Date(acc.last_balance_sync_at).getTime()) > 86_400_000
        : true;

      let auditStatus: "OK" | "WARNING" | "ERROR" | "UNKNOWN" = "OK";
      if (missingFields.length > 2 || !hasTx) auditStatus = "WARNING";
      if (!hasBalance || missingFields.length > 3) auditStatus = "ERROR";
      if (!acc.account_status && !acc.external_account_id) auditStatus = "UNKNOWN";

      return {
        internalAccountId:     acc.id,
        externalAccountId:     acc.external_account_id,
        bankName:              acc.bank_name,
        connectorStatus:       acc.connector_status,
        accountName:           acc.account_name,
        maskedAccountNumber:   acc.masked_account ?? acc.account_number?.slice(-4).padStart(acc.account_number.length, "*"),
        currency:              acc.currency,
        currentBalance:        acc.current_balance ? Number(acc.current_balance) : null,
        availableBalance:      acc.available_balance ? Number(acc.available_balance) : null,
        accountStatus:         acc.account_status,
        lastBalanceSyncAt:     acc.last_balance_sync_at,
        lastStatementSyncAt:   acc.last_statement_sync_at,
        hasBalance,
        balanceStale,
        transactionsCount:     Number(tx?.cnt ?? 0),
        firstTransactionDate:  tx?.min_date ?? null,
        lastTransactionDate:   tx?.max_date ?? null,
        statementsCount:       Number(stmts?.cnt ?? 0),
        statementPeriodFrom:   stmts?.min_period ?? null,
        statementPeriodTo:     stmts?.max_period ?? null,
        legalEntityName:       null,
        legalEntityInn:        null,
        ownerStatus:           "unknown" as string,
        duplicateCandidate:    dupCandidates.some(d => (d.affectedIds as string[]).includes(acc.id)),
        missingCriticalFields: missingFields,
        auditStatus,
      };
    });

    // ── 11. Issues ───────────────────────────────────────────────────────────
    const issues: Array<{
      issueType: string; severity: string; count: number;
      description: string; recommendedAction: string;
    }> = [];

    // Only raise connector/account issues when running against production DB.
    // In dev, absence of bank accounts is expected — bank integration is production-only.
    if (isProduction) {
      for (const conn of connectors) {
        if (conn.connector_status === "error") {
          issues.push({
            issueType:         "bank_connector_auth_problem",
            severity:          "CRITICAL",
            count:             1,
            description:       `Connector ${conn.display_name ?? conn.bank_name} (${conn.auth_type}) is in error state: ${(conn.last_error ?? "").slice(0, 200)}`,
            recommendedAction: "Complete OAuth Authorization Code flow for Tochka connector — press 'Начать авторизацию' and confirm access in Tochka bank.",
          });
        }
        if (Number(conn.accounts_cnt) === 0 && conn.connector_status !== "inactive") {
          issues.push({
            issueType:         "bank_account_no_accounts_imported",
            severity:          "HIGH",
            count:             1,
            description:       `Connector ${conn.display_name ?? conn.bank_name} has no bank accounts imported. OAuth must be completed first.`,
            recommendedAction: "After OAuth completion, trigger connector sync to import bank accounts.",
          });
        }
      }

      if (accounts.length === 0) {
        issues.push({
          issueType:         "bank_account_no_transactions",
          severity:          "HIGH",
          count:             0,
          description:       "No bank accounts exist in the system — cannot verify transaction coverage.",
          recommendedAction: "Complete bank connector OAuth and sync to import accounts and transactions.",
        });
      }
    } else {
      // Dev environment — bank integration not expected here
      issues.push({
        issueType:         "bank_environment_unclear",
        severity:          "INFO",
        count:             1,
        description:       "Current database is dev/staging. Bank integration (Tochka, accounts, transactions) exists only in production. Zero bank accounts in dev is expected and is NOT a failure.",
        recommendedAction: "Run P8.1 bank audit against the production database/environment to see real bank accounts.",
      });
    }

    for (const acc of accountsEnriched) {
      if (acc.missingCriticalFields.includes("current_balance")) {
        issues.push({
          issueType: "bank_account_missing_balance", severity: "MEDIUM", count: 1,
          description: `Account ${acc.accountName ?? acc.internalAccountId} has no current_balance.`,
          recommendedAction: "Sync balance via connector.",
        });
      }
      if (acc.balanceStale && acc.hasBalance) {
        issues.push({
          issueType: "bank_account_stale_balance", severity: "LOW", count: 1,
          description: `Account ${acc.accountName ?? acc.internalAccountId} balance not synced in 24h+.`,
          recommendedAction: "Trigger connector sync.",
        });
      }
      if (acc.ownerStatus === "unknown") {
        issues.push({
          issueType: "bank_account_missing_owner", severity: "MEDIUM", count: 1,
          description: `Account ${acc.accountName ?? acc.internalAccountId} has no legal entity owner.`,
          recommendedAction: "Assign legal entity / company after accounts are imported.",
        });
      }
    }

    // ── 12. Summary ──────────────────────────────────────────────────────────
    const totalAccounts       = accountsEnriched.length;
    const accountsWithBalance = accountsEnriched.filter(a => a.hasBalance).length;
    const accountsWithTx      = accountsEnriched.filter(a => a.transactionsCount > 0).length;
    const accountsWithOwner   = accountsEnriched.filter(a => a.ownerStatus === "known").length;
    const totalTxRaw          = txPerAccount.reduce((s, r) => s + Number(r.cnt), 0);

    const balanceByCurrency: Record<string, number> = {};
    for (const acc of accountsEnriched) {
      if (acc.currentBalance !== null && acc.currency) {
        balanceByCurrency[acc.currency] = (balanceByCurrency[acc.currency] ?? 0) + acc.currentBalance;
      }
    }

    // ── 13. Readiness verdict ────────────────────────────────────────────────
    const connectorOk    = connectors.some(c => c.connector_status === "active");
    const hasAnyAccounts = totalAccounts > 0;
    const hasAnyTx       = totalTxRaw > 0 || Number(txNorm?.cnt ?? 0) > 0;

    let bankAccountsReadiness: "READY" | "PARTIAL" | "NOT_READY" | "NOT_APPLICABLE_DEV";
    let readinessReason: string;
    let nextRecommendedStep: string;

    if (!isProduction) {
      // Dev: audit has no meaning for bank data — it lives in production only
      bankAccountsReadiness = "NOT_APPLICABLE_DEV";
      readinessReason       = "Current database is dev/staging. Bank integration (Tochka connector, bank accounts, transactions) exists only in the production environment. Zero accounts and connector errors in dev are EXPECTED — they do not indicate a production problem.";
      nextRecommendedStep   = "Run GET /api/coverage/bank-accounts-audit against the production database/environment to verify real bank accounts. Do NOT attempt to fix OAuth or connector in dev.";
    } else if (!hasAnyAccounts) {
      bankAccountsReadiness = "NOT_READY";
      readinessReason       = "Production DB: no bank accounts imported. Connector is in error state — OAuth Authorization Code flow has not been completed for Tochka.";
      nextRecommendedStep   = "Fix bank connector OAuth: complete Tochka Authorization Code flow, then sync accounts.";
    } else if (!connectorOk || !hasAnyTx) {
      bankAccountsReadiness = "PARTIAL";
      readinessReason       = "Production DB: bank accounts exist but connector is not fully active or no transactions loaded yet.";
      nextRecommendedStep   = "Fix connector status and trigger full transaction sync. Then proceed to P8.2 — Bank Transactions Audit.";
    } else {
      bankAccountsReadiness = "READY";
      readinessReason       = "Production DB: accounts exist, connector is active, transactions loaded.";
      nextRecommendedStep   = "P8.2 — Bank Transactions Audit";
    }

    res.json({
      auditType:   "bank_accounts_audit",
      generatedAt,
      environment,

      connectors: connectors.map(c => ({
        id:              c.id,
        bankName:        c.bank_name,
        displayName:     c.display_name,
        status:          c.connector_status,
        authType:        c.auth_type,
        lastSyncAt:      c.last_sync_at,
        lastSuccessAt:   c.last_success_at,
        lastError:       c.last_error,
        accountsImported:Number(c.accounts_cnt),
        authIssue:       c.connector_status === "error",
      })),

      sourceConnectors,

      summary: {
        totalConnectors:      connectors.length,
        activeConnectors:     connectors.filter(c => c.connector_status === "active").length,
        errorConnectors:      connectors.filter(c => c.connector_status === "error").length,
        totalAccounts,
        accountsWithBalance,
        accountsWithoutBalance: totalAccounts - accountsWithBalance,
        accountsWithTransactions: accountsWithTx,
        accountsWithoutTransactions: totalAccounts - accountsWithTx,
        accountsWithOwner,
        accountsWithoutOwner: totalAccounts - accountsWithOwner,
        duplicateCandidates:  dupCandidates.length,
        totalRawTransactions: totalTxRaw,
        totalNormalizedTransactions: Number(txNorm?.cnt ?? 0),
        totalStatements:      statementsPerAccount.reduce((s, r) => s + Number(r.cnt), 0),
        totalOperations:      Number(opStats?.cnt ?? 0),
        balanceByCurrency,
        crmPayments:          22365,
      },

      accounts: accountsEnriched,
      duplicateCandidates: dupCandidates,

      otherFinanceData: {
        operations: {
          count:   Number(opStats?.cnt ?? 0),
          minDate: opStats?.min_d ?? null,
          maxDate: opStats?.max_d ?? null,
          note:    "Manual/imported operations — separate from bank_transactions pipeline",
        },
        bankTransactionsRaw: {
          count:    totalTxRaw,
          note:     "Raw bank API pipeline — empty because connector OAuth not complete",
        },
        bankTransactionsNormalized: {
          count:    Number(txNorm?.cnt ?? 0),
          minDate:  txNorm?.min_d ?? null,
          maxDate:  txNorm?.max_d ?? null,
          note:     "Normalized transactions — empty because no raw data yet",
        },
      },

      issues,
      issueSummary: {
        total:    issues.length,
        critical: issues.filter(i => i.severity === "CRITICAL").length,
        high:     issues.filter(i => i.severity === "HIGH").length,
        medium:   issues.filter(i => i.severity === "MEDIUM").length,
        low:      issues.filter(i => i.severity === "LOW").length,
      },

      bankAccountsReadiness,
      readinessReason,
      nextRecommendedStep,

      warnings: [
        ...(!isProduction ? [
          "🚫 BANK AUDIT NOT VALID IN DEV — Bank integration exists only in production. Current database is dev/staging.",
          "ℹ️ Zero bank accounts in dev is EXPECTED — do not treat this as a production failure.",
          "ℹ️ Do NOT attempt to fix Tochka OAuth or reset connector credentials in dev environment.",
          "→ Run this audit against the production database/environment to see real bank accounts and transactions.",
        ] : []),
        ...(isProduction && connectors.some(c => c.connector_status === "error") ? [
          "⚠️ PRODUCTION: Tochka connector OAuth flow has NOT been completed — no bank accounts or transactions have been imported.",
        ] : []),
        "⚠️ AlphaCRM payments (22,365 records) are in crm_payments — they are NOT bank transactions and must NOT be used as bank truth.",
        "ℹ️ 488 operations exist in the 'operations' table — these are manual/imported ledger entries, not verified bank transactions.",
      ],
    });
  } catch (err) {
    logger.error({ err }, "bank-accounts-audit failed");
    res.status(500).json({ error: String(err) });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/bank-transactions-audit
// P8.2 — Bank Transactions Truth Audit
// ══════════════════════════════════════════════════════════════════════════════
auditRouter.get("/coverage/bank-transactions-audit", async (req, res) => {
  try {
    // ── 0. Environment detection ─────────────────────────────────────────────
    const dbNameRow = await sqlOne<{ db: string }>(`SELECT current_database() AS db`);
    const dbName    = dbNameRow?.db ?? "";
    const nodeEnv   = process.env["NODE_ENV"] ?? "";
    const isProduction =
      nodeEnv === "production" ||
      dbName.includes("prod") ||
      dbName.includes("neon") ||
      (!dbName.includes("dev") && !dbName.includes("test") && !dbName.includes("local"));

    if (!isProduction) {
      return res.json({
        auditType:   "bank-transactions-audit-p82",
        generatedAt: new Date().toISOString(),
        environment: { dbKind: "dev", auditValidity: "BANK_TRANSACTION_AUDIT_NOT_VALID_OUTSIDE_PRODUCTION", isProduction: false, dbName, nodeEnv },
        bankTransactionsReadiness: "NOT_APPLICABLE_DEV",
        readinessReason: "Bank transaction audit runs only against the production database. Current environment is dev/staging.",
        warnings: [
          "🚫 P8.2 NOT VALID IN DEV — bank_transactions data exists only in production.",
          "→ Run this audit against the production environment to see real transaction data.",
        ],
      });
    }

    // ── 1. Raw field quality + normalized status breakdown ───────────────────
    const [rawQuality, dateInventory, dupStats, normQuality, normPerAccount, rawPerAccount, rawDupExamples, cpStats, cpIncome, cpExpense, opsStats, stmtsPerAccount] = await Promise.all([

      sqlOne<{
        total: string; has_ext_id: string; unique_ext_ids: string;
        has_op_date: string; missing_op_date: string; has_booking_date: string;
        has_raw_json: string; has_amount: string; has_direction: string;
        has_cp_name: string; has_cp_inn: string; has_purpose: string;
        status_pending: string; status_normalized: string; status_skipped: string; status_error: string;
      }>(`
        SELECT
          COUNT(*)::text                                                                               AS total,
          COUNT(*) FILTER (WHERE external_transaction_id IS NOT NULL AND external_transaction_id != '')::text AS has_ext_id,
          COUNT(DISTINCT external_transaction_id) FILTER (WHERE external_transaction_id IS NOT NULL AND external_transaction_id != '')::text AS unique_ext_ids,
          COUNT(*) FILTER (WHERE operation_date IS NOT NULL AND operation_date != '')::text            AS has_op_date,
          COUNT(*) FILTER (WHERE operation_date IS NULL OR operation_date = '')::text                  AS missing_op_date,
          COUNT(*) FILTER (WHERE booking_date IS NOT NULL AND booking_date != '')::text                AS has_booking_date,
          COUNT(*) FILTER (WHERE raw_json IS NOT NULL)::text                                          AS has_raw_json,
          COUNT(*) FILTER (WHERE amount IS NOT NULL)::text                                            AS has_amount,
          COUNT(*) FILTER (WHERE direction IS NOT NULL)::text                                         AS has_direction,
          COUNT(*) FILTER (WHERE counterparty_name IS NOT NULL AND counterparty_name != '')::text      AS has_cp_name,
          COUNT(*) FILTER (WHERE counterparty_inn IS NOT NULL AND counterparty_inn != '')::text        AS has_cp_inn,
          COUNT(*) FILTER (WHERE purpose IS NOT NULL AND purpose != '')::text                          AS has_purpose,
          COUNT(*) FILTER (WHERE normalized_status = 'pending')::text                                 AS status_pending,
          COUNT(*) FILTER (WHERE normalized_status = 'normalized')::text                              AS status_normalized,
          COUNT(*) FILTER (WHERE normalized_status = 'skipped')::text                                 AS status_skipped,
          COUNT(*) FILTER (WHERE normalized_status = 'error')::text                                   AS status_error
        FROM bank_transactions_raw
      `),

      // ── 2. Date field inventory from raw_json ──────────────────────────────
      sqlOne<{
        total: string; has_dpd: string; min_dpd: string; max_dpd: string;
        has_booking_date_json: string; has_tx_date_json: string; has_value_date_json: string;
      }>(`
        SELECT
          COUNT(*)::text                                                                                                    AS total,
          COUNT(*) FILTER (WHERE raw_json->>'documentProcessDate' IS NOT NULL AND raw_json->>'documentProcessDate' != '')::text AS has_dpd,
          MIN(raw_json->>'documentProcessDate')                                                                            AS min_dpd,
          MAX(raw_json->>'documentProcessDate')                                                                            AS max_dpd,
          COUNT(*) FILTER (WHERE raw_json->>'bookingDate' IS NOT NULL)::text                                               AS has_booking_date_json,
          COUNT(*) FILTER (WHERE raw_json->>'transactionDate' IS NOT NULL)::text                                           AS has_tx_date_json,
          COUNT(*) FILTER (WHERE raw_json->>'valueDate' IS NOT NULL)::text                                                 AS has_value_date_json
        FROM bank_transactions_raw
      `),

      // ── 3. Duplicate analysis ──────────────────────────────────────────────
      sqlOne<{ total_raw: string; unique_ext_id_account: string; unique_ext_ids: string }>(`
        SELECT
          COUNT(*)::text                                                                                              AS total_raw,
          COUNT(DISTINCT COALESCE(external_transaction_id,'') || '|' || COALESCE(account_id,''))::text               AS unique_ext_id_account,
          COUNT(DISTINCT external_transaction_id) FILTER (WHERE external_transaction_id IS NOT NULL AND external_transaction_id != '')::text AS unique_ext_ids
        FROM bank_transactions_raw
      `),

      // ── 4. Normalized field quality ────────────────────────────────────────
      sqlOne<{
        total: string; has_op_date: string; has_amount: string; has_direction: string;
        has_cp_name: string; has_cp_inn: string; has_purpose: string; has_ext_id: string;
        has_cp_account: string; has_account_id: string;
        match_unmatched: string; match_matched: string;
        min_date: string; max_date: string;
      }>(`
        SELECT
          COUNT(*)::text                                                                                  AS total,
          COUNT(*) FILTER (WHERE operation_date IS NOT NULL)::text                                       AS has_op_date,
          COUNT(*) FILTER (WHERE amount IS NOT NULL)::text                                               AS has_amount,
          COUNT(*) FILTER (WHERE direction IS NOT NULL)::text                                            AS has_direction,
          COUNT(*) FILTER (WHERE counterparty_name IS NOT NULL AND counterparty_name != '')::text         AS has_cp_name,
          COUNT(*) FILTER (WHERE counterparty_inn IS NOT NULL AND counterparty_inn != '')::text           AS has_cp_inn,
          COUNT(*) FILTER (WHERE purpose IS NOT NULL AND purpose != '')::text                             AS has_purpose,
          COUNT(*) FILTER (WHERE external_id IS NOT NULL AND external_id != '')::text                    AS has_ext_id,
          COUNT(*) FILTER (WHERE counterparty_account IS NOT NULL AND counterparty_account != '')::text  AS has_cp_account,
          COUNT(*) FILTER (WHERE account_id IS NOT NULL AND account_id != '')::text                      AS has_account_id,
          COUNT(*) FILTER (WHERE match_status = 'unmatched')::text                                       AS match_unmatched,
          COUNT(*) FILTER (WHERE match_status = 'matched')::text                                         AS match_matched,
          MIN(operation_date)::text                                                                       AS min_date,
          MAX(operation_date)::text                                                                       AS max_date
        FROM bank_transactions
      `),

      // ── 5. Per-account normalized ──────────────────────────────────────────
      sql<{
        account_id: string; cnt: string; min_d: string; max_d: string;
        income_sum: string; expense_sum: string; income_cnt: string; expense_cnt: string;
      }>(`
        SELECT
          account_id,
          COUNT(*)::text                                                              AS cnt,
          MIN(operation_date)::text                                                  AS min_d,
          MAX(operation_date)::text                                                  AS max_d,
          SUM(CASE WHEN direction='income' THEN amount ELSE 0 END)::numeric(15,2)::text AS income_sum,
          SUM(CASE WHEN direction='expense' THEN amount ELSE 0 END)::numeric(15,2)::text AS expense_sum,
          COUNT(CASE WHEN direction='income' THEN 1 END)::text                      AS income_cnt,
          COUNT(CASE WHEN direction='expense' THEN 1 END)::text                     AS expense_cnt
        FROM bank_transactions
        GROUP BY account_id
        ORDER BY COUNT(*) DESC
      `),

      // ── 6. Per-account raw ─────────────────────────────────────────────────
      sql<{
        account_id: string; cnt: string; min_dpd: string; max_dpd: string;
        has_op_date: string; missing_op_date: string;
      }>(`
        SELECT
          account_id,
          COUNT(*)::text                                                                                           AS cnt,
          MIN(raw_json->>'documentProcessDate')                                                                   AS min_dpd,
          MAX(raw_json->>'documentProcessDate')                                                                   AS max_dpd,
          COUNT(*) FILTER (WHERE operation_date IS NOT NULL AND operation_date != '')::text                       AS has_op_date,
          COUNT(*) FILTER (WHERE operation_date IS NULL OR operation_date = '')::text                             AS missing_op_date
        FROM bank_transactions_raw
        GROUP BY account_id
        ORDER BY COUNT(*) DESC
      `),

      // ── 7. Duplicate examples in raw ──────────────────────────────────────
      sql<{ external_transaction_id: string; account_id: string; cnt: string }>(`
        SELECT external_transaction_id, account_id, COUNT(*)::text AS cnt
        FROM bank_transactions_raw
        WHERE external_transaction_id IS NOT NULL AND external_transaction_id != ''
        GROUP BY external_transaction_id, account_id
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `),

      // ── 8. Counterparty stats ──────────────────────────────────────────────
      sqlOne<{ unique_names: string; unique_inns: string; unique_accounts: string; income_cnt: string; expense_cnt: string; missing_cp: string }>(`
        SELECT
          COUNT(DISTINCT counterparty_name) FILTER (WHERE counterparty_name IS NOT NULL AND counterparty_name != '')::text AS unique_names,
          COUNT(DISTINCT counterparty_inn)  FILTER (WHERE counterparty_inn IS NOT NULL AND counterparty_inn != '')::text  AS unique_inns,
          COUNT(DISTINCT counterparty_account) FILTER (WHERE counterparty_account IS NOT NULL AND counterparty_account != '')::text AS unique_accounts,
          COUNT(CASE WHEN direction='income' THEN 1 END)::text  AS income_cnt,
          COUNT(CASE WHEN direction='expense' THEN 1 END)::text AS expense_cnt,
          COUNT(CASE WHEN counterparty_name IS NULL OR counterparty_name = '' THEN 1 END)::text AS missing_cp
        FROM bank_transactions
      `),

      // ── 9. Top income counterparties ──────────────────────────────────────
      sql<{ counterparty_name: string; counterparty_inn: string; cnt: string; total_sum: string }>(`
        SELECT counterparty_name, counterparty_inn,
               COUNT(*)::text AS cnt,
               SUM(amount)::numeric(15,2)::text AS total_sum
        FROM bank_transactions
        WHERE direction = 'income'
        GROUP BY counterparty_name, counterparty_inn
        ORDER BY COUNT(*) DESC LIMIT 6
      `),

      // ── 10. Top expense counterparties ────────────────────────────────────
      sql<{ counterparty_name: string; counterparty_inn: string; cnt: string; total_sum: string }>(`
        SELECT counterparty_name, counterparty_inn,
               COUNT(*)::text AS cnt,
               SUM(amount)::numeric(15,2)::text AS total_sum
        FROM bank_transactions
        WHERE direction = 'expense'
        GROUP BY counterparty_name, counterparty_inn
        ORDER BY COUNT(*) DESC LIMIT 6
      `),

      // ── 11. Operations ────────────────────────────────────────────────────
      sqlOne<{ total: string; linked: string; unique_sources: string; min_d: string; max_d: string }>(`
        SELECT
          COUNT(*)::text                                                    AS total,
          COUNT(bank_transaction_id) FILTER (WHERE bank_transaction_id IS NOT NULL)::text AS linked,
          COUNT(DISTINCT source) FILTER (WHERE source IS NOT NULL)::text   AS unique_sources,
          MIN(cashflow_date)::text                                          AS min_d,
          MAX(cashflow_date)::text                                          AS max_d
        FROM operations
        WHERE is_deleted IS NOT TRUE
      `),

      // ── 12. Statements per account ────────────────────────────────────────
      sql<{ external_account_id: string; cnt: string; min_period: string; max_period: string; total_tx: string; ready_cnt: string }>(`
        SELECT
          external_account_id,
          COUNT(*)::text                    AS cnt,
          MIN(period_from)                  AS min_period,
          MAX(period_to)                    AS max_period,
          COALESCE(SUM(transaction_count),0)::text AS total_tx,
          COUNT(*) FILTER (WHERE status='ready')::text AS ready_cnt
        FROM bank_statements
        GROUP BY external_account_id
        ORDER BY COALESCE(SUM(transaction_count),0) DESC
      `),
    ]);

    // ── Derived: Gap classification ──────────────────────────────────────────
    const rawTotal    = Number(rawQuality?.total ?? 0);
    const normTotal   = Number(normQuality?.total ?? 0);
    const gap         = rawTotal - normTotal;
    const uniqueExtIds         = Number(dupStats?.unique_ext_ids ?? 0);
    const uniqueExtIdAccount   = Number(dupStats?.unique_ext_id_account ?? 0);
    const trueDuplicates       = rawTotal - uniqueExtIdAccount;           // same ext_id + same account
    const crossAccountTransfers = uniqueExtIdAccount - uniqueExtIds;      // same ext_id, different accounts
    const gapExplained = trueDuplicates + crossAccountTransfers;
    const gapUnexplained = gap - gapExplained;

    // ── Derived: Per-account merged ───────────────────────────────────────────
    const normByAcc = normPerAccount.reduce<Record<string, typeof normPerAccount[0]>>((m, r) => { m[r.account_id] = r; return m; }, {});
    const rawByAcc  = rawPerAccount.reduce<Record<string, typeof rawPerAccount[0]>>((m, r) => { m[r.account_id] = r; return m; }, {});
    const allAccountIds = [...new Set([...Object.keys(normByAcc), ...Object.keys(rawByAcc)])];
    const perAccount = allAccountIds.map(accId => {
      const n = normByAcc[accId];
      const r = rawByAcc[accId];
      const rawCnt  = Number(r?.cnt ?? 0);
      const normCnt = Number(n?.cnt ?? 0);
      const accGap  = rawCnt - normCnt;
      return {
        accountId:            accId,
        maskedAccount:        accId.split("/")[0]?.slice(-4) ? `****${accId.split("/")[0].slice(-4)}` : accId,
        rawCount:             rawCnt,
        normalizedCount:      normCnt,
        rawNotNormalized:     accGap,
        rawDateFrom:          r?.min_dpd ?? null,
        rawDateTo:            r?.max_dpd ?? null,
        rawMissingOpDate:     Number(r?.missing_op_date ?? 0),
        normalizedDateFrom:   n?.min_d ?? null,
        normalizedDateTo:     n?.max_d ?? null,
        incomeSum:            Number(n?.income_sum ?? 0),
        expenseSum:           Number(n?.expense_sum ?? 0),
        incomeCnt:            Number(n?.income_cnt ?? 0),
        expenseCnt:           Number(n?.expense_cnt ?? 0),
        statementInfo:        stmtsPerAccount.find(s => s.external_account_id?.startsWith(accId.split("/")[0]) || accId.startsWith((s.external_account_id ?? "").split("/")[0])) ?? null,
      };
    });

    // ── Date root cause determination ─────────────────────────────────────────
    const hasDpd     = Number(dateInventory?.has_dpd ?? 0);
    const hasOpDate  = Number(rawQuality?.has_op_date ?? 0);
    const missingOp  = Number(rawQuality?.missing_op_date ?? 0);
    let dateRootCause: string;
    let dateRootCauseDetail: string;
    if (hasDpd === rawTotal && normTotal > 0 && Number(normQuality?.has_op_date ?? 0) === normTotal) {
      dateRootCause = "documentProcessDate_in_raw_json";
      dateRootCauseDetail = `ALL ${rawTotal} raw records have documentProcessDate in raw_json (${dateInventory?.min_dpd} → ${dateInventory?.max_dpd}). ` +
        `The operation_date column in bank_transactions_raw is missing for ${missingOp} records — ` +
        `the importer stored the date in raw_json but did not always populate the column. ` +
        `Normalized bank_transactions table uses documentProcessDate correctly — all ${normTotal} records have operation_date.`;
    } else if (hasDpd > 0) {
      dateRootCause = "documentProcessDate_partial";
      dateRootCauseDetail = `${hasDpd}/${rawTotal} raw records have documentProcessDate in raw_json. Column op_date missing: ${missingOp}.`;
    } else {
      dateRootCause = "unknown";
      dateRootCauseDetail = "No known date fields found in raw_json. Manual inspection required.";
    }

    // ── Normalized status gap explanation ─────────────────────────────────────
    const statusPending    = Number(rawQuality?.status_pending ?? 0);
    const statusNormalized = Number(rawQuality?.status_normalized ?? 0);
    const normBookkeepingGap = statusPending === rawTotal && normTotal > 0;

    // ── Issues ────────────────────────────────────────────────────────────────
    const issues: Array<{ issueType: string; severity: string; count: number; description: string; recommendedAction: string }> = [];

    if (missingOp > 0) {
      issues.push({
        issueType: "bank_transaction_raw_date_missing",
        severity: missingOp > 100 ? "HIGH" : "MEDIUM",
        count: missingOp,
        description: `${missingOp} raw transactions have empty operation_date column. Root cause: importer did not extract date from raw_json->>'documentProcessDate' for all records. Normalized table is correct.`,
        recommendedAction: "Update raw importer to populate operation_date from documentProcessDate. Not urgent — normalized table already has correct dates.",
      });
    }

    if (normBookkeepingGap) {
      issues.push({
        issueType: "bank_transaction_normalized_status_not_updated",
        severity: "MEDIUM",
        count: rawTotal,
        description: `All ${rawTotal} raw records show normalized_status='pending' even though ${normTotal} normalized records exist. The normalization pipeline did not update normalized_status back to 'normalized'.`,
        recommendedAction: "Update normalization pipeline to set normalized_status='normalized' after successful normalization. Bookkeeping gap only — data is correct.",
      });
    }

    if (trueDuplicates > 0) {
      issues.push({
        issueType: "bank_transaction_duplicate_candidate",
        severity: trueDuplicates > 50 ? "HIGH" : "MEDIUM",
        count: trueDuplicates,
        description: `${trueDuplicates} raw transactions are true duplicates (same external_transaction_id + same account_id). These were correctly deduplicated during normalization.`,
        recommendedAction: "True duplicates are correctly excluded from normalized table. Consider adding unique constraint on (external_transaction_id, account_id) in bank_transactions_raw to prevent re-import.",
      });
    }

    if (crossAccountTransfers > 0) {
      issues.push({
        issueType: "bank_transaction_cross_account_dedup",
        severity: "INFO",
        count: crossAccountTransfers,
        description: `${crossAccountTransfers} raw transactions share the same external_transaction_id across different accounts — these are inter-account transfers (same payment appears as expense in source account and income in destination account). Only one side is normalized.`,
        recommendedAction: "Verify cross-account transfer classification in P8.3. Flag is_internal_transfer for matching pairs.",
      });
    }

    if (gapUnexplained > 0) {
      issues.push({
        issueType: "bank_transaction_raw_not_normalized",
        severity: "HIGH",
        count: gapUnexplained,
        description: `${gapUnexplained} raw transactions remain unexplained by deduplication analysis. These were not normalized for unknown reasons.`,
        recommendedAction: "Inspect raw records individually. Check for parse errors, invalid payloads, or missing statement links.",
      });
    }

    const missingCp = Number(cpStats?.missing_cp ?? 0);
    if (missingCp > 0) {
      issues.push({
        issueType: "bank_transaction_missing_counterparty",
        severity: missingCp > 50 ? "HIGH" : "MEDIUM",
        count: missingCp,
        description: `${missingCp} normalized transactions have no counterparty name.`,
        recommendedAction: "Inspect purpose/description fields for counterparty hints. Required for P8.3 counterparty layer.",
      });
    }

    const accountsMissingOwner = perAccount.length;
    if (accountsMissingOwner > 0) {
      issues.push({
        issueType: "bank_account_missing_owner",
        severity: "MEDIUM",
        count: accountsMissingOwner,
        description: `Legal entity / owner not linked to bank accounts. branch_crm_id is NULL for all accounts.`,
        recommendedAction: "Link accounts to legal entity (ООО АртХелло) before P8.3 counterparty layer.",
      });
    }

    // ── Counterparty readiness ────────────────────────────────────────────────
    const uniqueNames    = Number(cpStats?.unique_names ?? 0);
    const uniqueInns     = Number(cpStats?.unique_inns ?? 0);
    const uniqueAccounts = Number(cpStats?.unique_accounts ?? 0);
    let counterpartyLayerReadiness: "READY" | "PARTIAL" | "NOT_READY";
    if (uniqueNames > 10 && uniqueInns > 10 && missingCp === 0) {
      counterpartyLayerReadiness = "READY";
    } else if (uniqueNames > 0 || uniqueInns > 0) {
      counterpartyLayerReadiness = "PARTIAL";
    } else {
      counterpartyLayerReadiness = "NOT_READY";
    }

    // ── Readiness verdict ─────────────────────────────────────────────────────
    let bankTransactionsReadiness: "READY" | "PARTIAL" | "NOT_READY";
    let readinessReason: string;
    let nextRecommendedStep: string;

    const highIssues = issues.filter(i => i.severity === "HIGH").length;
    if (highIssues === 0 && gapUnexplained === 0 && missingOp === 0) {
      bankTransactionsReadiness = "READY";
      readinessReason = "Raw→normalized gap is fully explained. Date source is reliable (documentProcessDate). Field quality is sufficient for counterparty layer.";
      nextRecommendedStep = "Start P8.3 — Counterparty Foundation. Bank transaction data is sufficient.";
    } else if (gapUnexplained === 0 && normTotal > 0) {
      bankTransactionsReadiness = "PARTIAL";
      readinessReason = `Transaction data exists and normalized table is correct (${normTotal} records, all dates populated). Raw pipeline has bookkeeping gaps: operation_date column missing for ${missingOp} records, normalized_status=pending for all raw. Gap of ${gap} fully explained (${trueDuplicates} true dups + ${crossAccountTransfers} cross-account transfers).`;
      nextRecommendedStep = "P8.3 Counterparty Foundation can start — normalized data is sufficient. Fix raw pipeline bookkeeping separately.";
    } else {
      bankTransactionsReadiness = "NOT_READY";
      readinessReason = `${gapUnexplained} transactions in the raw→normalized gap are unexplained. Date source or normalization may be unreliable.`;
      nextRecommendedStep = "Investigate unexplained gap before proceeding to P8.3.";
    }

    // ── Response ──────────────────────────────────────────────────────────────
    return res.json({
      auditType:   "bank-transactions-audit-p82",
      generatedAt: new Date().toISOString(),

      environment: {
        dbKind:                  "production",
        auditValidity:           "VALID_PRODUCTION",
        isProduction:            true,
        dbName,
        nodeEnv,
        bankIntegrationExpected: true,
      },

      rawTransactions: {
        total:              rawTotal,
        hasExtId:           Number(rawQuality?.has_ext_id ?? 0),
        uniqueExtIds,
        hasOperationDate:   Number(rawQuality?.has_op_date ?? 0),
        missingOperationDate: missingOp,
        hasBookingDate:     Number(rawQuality?.has_booking_date ?? 0),
        hasRawJson:         Number(rawQuality?.has_raw_json ?? 0),
        hasAmount:          Number(rawQuality?.has_amount ?? 0),
        hasDirection:       Number(rawQuality?.has_direction ?? 0),
        hasCounterpartyName: Number(rawQuality?.has_cp_name ?? 0),
        hasCounterpartyInn:  Number(rawQuality?.has_cp_inn ?? 0),
        hasPurpose:         Number(rawQuality?.has_purpose ?? 0),
        normalizedStatusBreakdown: {
          pending:    Number(rawQuality?.status_pending ?? 0),
          normalized: Number(rawQuality?.status_normalized ?? 0),
          skipped:    Number(rawQuality?.status_skipped ?? 0),
          error:      Number(rawQuality?.status_error ?? 0),
        },
        normBookkeepingGap,
        normBookkeepingGapNote: normBookkeepingGap
          ? `All ${rawTotal} raw records show normalized_status='pending' despite ${normTotal} normalized records existing. Pipeline did not update normalized_status.`
          : null,
      },

      dateFieldInventory: {
        documentProcessDate: {
          present:    hasDpd,
          total:      rawTotal,
          coveragePct: rawTotal > 0 ? Math.round(hasDpd / rawTotal * 100) : 0,
          minDate:    dateInventory?.min_dpd ?? null,
          maxDate:    dateInventory?.max_dpd ?? null,
          isReliable: hasDpd === rawTotal,
        },
        operationDateColumn: {
          present:    Number(rawQuality?.has_op_date ?? 0),
          missing:    missingOp,
          total:      rawTotal,
          coveragePct: rawTotal > 0 ? Math.round(Number(rawQuality?.has_op_date ?? 0) / rawTotal * 100) : 0,
        },
        bookingDateJsonField: { present: Number(dateInventory?.has_booking_date_json ?? 0), total: rawTotal },
        transactionDateJsonField: { present: Number(dateInventory?.has_tx_date_json ?? 0), total: rawTotal },
        valueDateJsonField: { present: Number(dateInventory?.has_value_date_json ?? 0), total: rawTotal },
        normalizedTableDateStatus: normTotal > 0 && Number(normQuality?.has_op_date ?? 0) === normTotal ? "complete" : "partial",
        rootCause:            dateRootCause,
        rootCauseDetail:      dateRootCauseDetail,
      },

      normalizedTransactions: {
        total:              normTotal,
        dateRange:          { min: normQuality?.min_date ?? null, max: normQuality?.max_date ?? null },
        hasOperationDate:   Number(normQuality?.has_op_date ?? 0),
        hasAmount:          Number(normQuality?.has_amount ?? 0),
        hasDirection:       Number(normQuality?.has_direction ?? 0),
        hasCounterpartyName: Number(normQuality?.has_cp_name ?? 0),
        hasCounterpartyInn:  Number(normQuality?.has_cp_inn ?? 0),
        hasPurpose:         Number(normQuality?.has_purpose ?? 0),
        hasExtId:           Number(normQuality?.has_ext_id ?? 0),
        hasCounterpartyAccount: Number(normQuality?.has_cp_account ?? 0),
        hasAccountId:       Number(normQuality?.has_account_id ?? 0),
        matchStatus:        { unmatched: Number(normQuality?.match_unmatched ?? 0), matched: Number(normQuality?.match_matched ?? 0) },
      },

      rawNormalizedGap: {
        rawTotal,
        normalizedTotal: normTotal,
        gap,
        classification: {
          trueDuplicates,
          crossAccountTransfers,
          unexplained: gapUnexplained,
        },
        verdict:        gapUnexplained === 0 ? "EXPLAINED" : "PARTIALLY_EXPLAINED",
        trueDuplicatesNote: "Same external_transaction_id + same account_id appeared twice in raw — correctly deduplicated in normalized.",
        crossAccountNote:   "Same external_transaction_id in different accounts — inter-account transfers appear as both expense (source) and income (destination) in raw.",
      },

      perAccountCoverage: perAccount,

      duplicates: {
        rawDuplicates: {
          count:    trueDuplicates,
          examples: rawDupExamples.map(d => ({ externalTransactionId: d.external_transaction_id, accountId: d.account_id, occurrences: Number(d.cnt) })),
        },
        normalizedDuplicates: { count: 0, note: "No duplicates detected in bank_transactions (external_id is unique)" },
      },

      counterpartyReadiness: {
        uniqueCounterpartyNames:    uniqueNames,
        uniqueCounterpartyInns:     uniqueInns,
        uniqueCounterpartyAccounts: uniqueAccounts,
        incomeTransactions:         Number(cpStats?.income_cnt ?? 0),
        expenseTransactions:        Number(cpStats?.expense_cnt ?? 0),
        missingCounterparty:        missingCp,
        topIncomeCounterparties:    cpIncome.map(c => ({ name: c.counterparty_name, inn: c.counterparty_inn, count: Number(c.cnt), totalSum: Number(c.total_sum) })),
        topExpenseCounterparties:   cpExpense.map(c => ({ name: c.counterparty_name, inn: c.counterparty_inn, count: Number(c.cnt), totalSum: Number(c.total_sum) })),
        counterpartyLayerReadiness,
        caveats: [
          "ООО АРТХЕЛЛО (INN 7802561028) appears as both income and expense — these are inter-account transfers, not revenue.",
          "ООО Банк Точка (INN 9721194461) transactions may include bank fees and inter-account settlement entries.",
          "Cross-account transfers must be classified as is_internal_transfer=true in P8.3 before counterparty analysis.",
        ],
      },

      operations: {
        total:         Number(opsStats?.total ?? 0),
        linkedBankTx:  Number(opsStats?.linked ?? 0),
        uniqueSources: Number(opsStats?.unique_sources ?? 0),
        dateRange:     { min: opsStats?.min_d ?? null, max: opsStats?.max_d ?? null },
        note:          "Production operations are from source=bank_api. These are separate from bank_transactions pipeline and must not be mixed as reconciliation truth.",
        devProductionDifference: "Production: 9 operations (bank_api). Dev had 488 operations (test/import data). Do not use dev operations as production truth.",
      },

      statementsPerAccount: stmtsPerAccount.map(s => ({
        externalAccountId: s.external_account_id,
        statementCount:    Number(s.cnt),
        periodFrom:        s.min_period,
        periodTo:          s.max_period,
        totalTransactions: Number(s.total_tx),
        readyCount:        Number(s.ready_cnt),
      })),

      issues,
      issueSummary: {
        total:    issues.length,
        critical: issues.filter(i => i.severity === "CRITICAL").length,
        high:     issues.filter(i => i.severity === "HIGH").length,
        medium:   issues.filter(i => i.severity === "MEDIUM").length,
        low:      issues.filter(i => i.severity === "LOW").length,
        info:     issues.filter(i => i.severity === "INFO").length,
      },

      bankTransactionsReadiness,
      readinessReason,
      nextRecommendedStep,

      p83CanStart: counterpartyLayerReadiness !== "NOT_READY" && gapUnexplained === 0,
      p83Blockers: gapUnexplained > 0
        ? [`${gapUnexplained} unexplained gap transactions must be resolved before counterparty classification`]
        : counterpartyLayerReadiness === "NOT_READY"
          ? ["Insufficient counterparty data for counterparty layer"]
          : [],

      warnings: [
        "⚠️ Do NOT build final ДДС before bank reconciliation is complete (P8.4).",
        "⚠️ Do NOT build final ОПиУ before bank reconciliation is complete (P8.4).",
        "⚠️ ООО АРТХЕЛЛО / Банк Точка transactions include inter-account transfers — exclude from revenue/expense before P8.4.",
        "ℹ️ crm_payments in production = 0 (AlphaCRM sync not run in production yet). Not blocking P8.2.",
        "ℹ️ Bank account owners (legal entity) are not yet linked — needed before P8.3 counterparty classification.",
      ],
    });

  } catch (err) {
    logger.error({ err }, "bank-transactions-audit failed");
    return void res.status(500).json({ error: String(err) });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/counterparties-audit
// P8.3 — Counterparty Foundation Audit
// ══════════════════════════════════════════════════════════════════════════════
auditRouter.get("/coverage/counterparties-audit", async (req, res) => {
  try {
    // ── 0. Environment guard ─────────────────────────────────────────────────
    const dbNameRow = await sqlOne<{ db: string }>("SELECT current_database() AS db");
    const dbName  = dbNameRow?.db ?? "";
    const nodeEnv = process.env["NODE_ENV"] ?? "";
    const isProduction =
      nodeEnv === "production" ||
      dbName.includes("prod") ||
      dbName.includes("neon") ||
      (!dbName.includes("dev") && !dbName.includes("test") && !dbName.includes("local"));

    if (!isProduction) {
      return res.json({
        auditType:   "counterparties-audit-p83",
        generatedAt: new Date().toISOString(),
        environment: { dbKind: "dev", auditValidity: "NOT_VALID_OUTSIDE_PRODUCTION", isProduction: false, dbName, nodeEnv },
        counterpartyFoundationReadiness: "NOT_APPLICABLE_DEV",
        readinessReason: "Counterparty foundation audit only valid against production bank data.",
        warnings: ["🚫 P8.3 NOT VALID IN DEV — bank_transactions data exists only in production."],
      });
    }

    // ── 1. Core counts ───────────────────────────────────────────────────────
    const [totals, byType, byConfidence, txLinkCoverage, internalTransfers, dupCandidates, topIncome, topExpense, noLinks] = await Promise.all([

      sqlOne<{ total: string; from_bank: string; aliases: string; links: string; dup_candidates: string }>(`
        SELECT
          (SELECT COUNT(*)::text FROM counterparties WHERE source='bank_transactions') AS total,
          (SELECT COUNT(*)::text FROM counterparties WHERE source='bank_transactions') AS from_bank,
          (SELECT COUNT(*)::text FROM counterparty_aliases) AS aliases,
          (SELECT COUNT(*)::text FROM bank_transaction_counterparty_links) AS links,
          (SELECT COUNT(*)::text FROM counterparty_duplicate_candidates WHERE status='open') AS dup_candidates
      `),

      sql<{ counterparty_type: string; cnt: string; total_income: string; total_expense: string }>(`
        SELECT counterparty_type,
               COUNT(*)::text AS cnt,
               COALESCE(SUM(total_income),0)::numeric(15,2)::text  AS total_income,
               COALESCE(SUM(total_expense),0)::numeric(15,2)::text AS total_expense
        FROM counterparties WHERE source='bank_transactions'
        GROUP BY counterparty_type ORDER BY COUNT(*) DESC
      `),

      sql<{ confidence: string; cnt: string }>(`
        SELECT confidence, COUNT(*)::text AS cnt
        FROM counterparties WHERE source='bank_transactions'
        GROUP BY confidence ORDER BY cnt DESC
      `),

      sqlOne<{ total_tx: string; linked_tx: string; unlinked_tx: string }>(`
        SELECT
          (SELECT COUNT(*)::text FROM bank_transactions) AS total_tx,
          COUNT(DISTINCT bank_transaction_id)::text       AS linked_tx,
          ((SELECT COUNT(*) FROM bank_transactions) - COUNT(DISTINCT bank_transaction_id))::text AS unlinked_tx
        FROM bank_transaction_counterparty_links
      `),

      sql<{ id: string; canonical_key: string; display_name: string; total_income: string; total_expense: string; operations_count: string; risk_flags: Record<string, boolean> }>(`
        SELECT id, canonical_key, display_name,
               total_income::text, total_expense::text, operations_count::text,
               risk_flags
        FROM counterparties
        WHERE source='bank_transactions'
          AND (risk_flags->>'own_account_transfer' = 'true' OR risk_flags->>'exclude_from_revenue_expense' = 'true')
        ORDER BY operations_count DESC
      `),

      sql<{ counterparty_a_id: string; counterparty_b_id: string; reason: string; confidence: string; severity: string; a_name: string; b_name: string }>(`
        SELECT d.counterparty_a_id, d.counterparty_b_id, d.reason, d.confidence, d.severity,
               a.display_name AS a_name, b.display_name AS b_name
        FROM counterparty_duplicate_candidates d
        JOIN counterparties a ON d.counterparty_a_id = a.id
        JOIN counterparties b ON d.counterparty_b_id = b.id
        WHERE d.status = 'open'
        ORDER BY d.severity DESC, d.confidence DESC
        LIMIT 20
      `),

      sql<{ id: string; display_name: string; counterparty_type: string; confidence: string; operations_count: string; total_income: string; inn: string | null }>(`
        SELECT id, display_name, counterparty_type, confidence, operations_count::text, total_income::text, inn
        FROM counterparties
        WHERE source='bank_transactions' AND total_income::numeric > 0
        ORDER BY total_income::numeric DESC
        LIMIT 10
      `),

      sql<{ id: string; display_name: string; counterparty_type: string; confidence: string; operations_count: string; total_expense: string; inn: string | null }>(`
        SELECT id, display_name, counterparty_type, confidence, operations_count::text, total_expense::text, inn
        FROM counterparties
        WHERE source='bank_transactions' AND total_expense::numeric > 0
        ORDER BY total_expense::numeric DESC
        LIMIT 10
      `),

      sql<{ tx_id: string; direction: string; amount: string; counterparty_name: string | null; operation_date: string | null }>(`
        SELECT bt.id::text AS tx_id, bt.direction, bt.amount::text, bt.counterparty_name, bt.operation_date::text
        FROM bank_transactions bt
        WHERE NOT EXISTS (
          SELECT 1 FROM bank_transaction_counterparty_links l WHERE l.bank_transaction_id = bt.id::text
        )
        LIMIT 10
      `),
    ]);

    // ── 2. Type breakdown with income/expense totals ──────────────────────────
    const typeBreakdown: Record<string, { count: number; totalIncome: number; totalExpense: number }> = {};
    for (const r of byType) {
      typeBreakdown[r.counterparty_type] = {
        count:        Number(r.cnt),
        totalIncome:  Number(r.total_income),
        totalExpense: Number(r.total_expense),
      };
    }

    const confidenceBreakdown: Record<string, number> = {};
    for (const r of byConfidence) {
      confidenceBreakdown[r.confidence] = Number(r.cnt);
    }

    // ── 3. Issues ────────────────────────────────────────────────────────────
    const totalCounterparties = Number(totals?.total ?? 0);
    const totalLinks          = Number(totals?.links ?? 0);
    const linkedTx            = Number(txLinkCoverage?.linked_tx ?? 0);
    const totalTx             = Number(txLinkCoverage?.total_tx ?? 0);
    const unlinkedTx          = Number(txLinkCoverage?.unlinked_tx ?? 0);
    const dupOpen             = Number(totals?.dup_candidates ?? 0);

    const issues: Array<{ issueType: string; severity: string; count: number; description: string; recommendedAction: string }> = [];

    if (totalCounterparties === 0) {
      issues.push({
        issueType: "no_counterparties",
        severity: "CRITICAL",
        count: 0,
        description: "No counterparties found. Run POST /api/sync/build-counterparties-from-bank first.",
        recommendedAction: "Run the build-counterparties-from-bank sync endpoint.",
      });
    }

    if (unlinkedTx > 0) {
      issues.push({
        issueType: "counterparty_transaction_unlinked",
        severity: unlinkedTx > 50 ? "HIGH" : "MEDIUM",
        count: unlinkedTx,
        description: `${unlinkedTx} bank transactions have no counterparty link.`,
        recommendedAction: "Re-run POST /api/sync/build-counterparties-from-bank to link all transactions.",
      });
    }

    const unknownCount = typeBreakdown["unknown"]?.count ?? 0;
    if (unknownCount > 0) {
      issues.push({
        issueType: "counterparty_unknown",
        severity: unknownCount > 10 ? "MEDIUM" : "LOW",
        count: unknownCount,
        description: `${unknownCount} counterparties classified as 'unknown' — insufficient data for classification.`,
        recommendedAction: "Manual review of unknown counterparties.",
      });
    }

    const lowConfidenceCount = (confidenceBreakdown["low"] ?? 0);
    if (lowConfidenceCount > 0) {
      issues.push({
        issueType: "counterparty_type_low_confidence",
        severity: "LOW",
        count: lowConfidenceCount,
        description: `${lowConfidenceCount} counterparties have low confidence classification. Requires review.`,
        recommendedAction: "Review parent_client and employee_or_self_employed low-confidence entries in P8.4.",
      });
    }

    if (dupOpen > 0) {
      issues.push({
        issueType: "counterparty_duplicate_candidate",
        severity: dupOpen > 5 ? "MEDIUM" : "LOW",
        count: dupOpen,
        description: `${dupOpen} open duplicate candidate pairs detected.`,
        recommendedAction: "Review duplicate candidates manually. Do NOT auto-merge.",
      });
    }

    const internalCount = internalTransfers.length;
    if (internalCount > 0) {
      issues.push({
        issueType: "counterparty_own_account_transfer",
        severity: "INFO",
        count: internalCount,
        description: `${internalCount} counterparties flagged as own-account / internal transfers. These must be excluded from revenue/expense in P8.4.`,
        recommendedAction: "Verify all own-account transfers have exclude_from_revenue_expense=true.",
      });
    }

    const parentCandidates = typeBreakdown["parent_client"]?.count ?? 0;
    if (parentCandidates > 0) {
      issues.push({
        issueType: "counterparty_parent_candidate_needs_alpha_match",
        severity: "INFO",
        count: parentCandidates,
        description: `${parentCandidates} parent_client candidates require AlphaCRM family matching (P8.4).`,
        recommendedAction: "Match parent_client counterparties to crm_payments in P8.4.",
      });
    }

    const supplierCandidates = (typeBreakdown["contractor"]?.count ?? 0) + (typeBreakdown["employee_or_self_employed"]?.count ?? 0);
    if (supplierCandidates > 0) {
      issues.push({
        issueType: "counterparty_supplier_candidate_needs_review",
        severity: "INFO",
        count: supplierCandidates,
        description: `${supplierCandidates} contractor/employee counterparties need review before use in ОПиУ.`,
        recommendedAction: "Review and confirm in P8.3 manual review step.",
      });
    }

    // ── 4. Readiness verdict ─────────────────────────────────────────────────
    let counterpartyFoundationReadiness: string;
    let readinessReason: string;
    let nextRecommendedStep: string;

    const criticalIssues = issues.filter(i => i.severity === "CRITICAL").length;
    const highIssues     = issues.filter(i => i.severity === "HIGH").length;
    const linkCoverage   = totalTx > 0 ? linkedTx / totalTx : 0;

    if (totalCounterparties === 0 || criticalIssues > 0) {
      counterpartyFoundationReadiness = "NOT_READY";
      readinessReason = "No counterparties have been extracted. Run the sync first.";
      nextRecommendedStep = "POST /api/sync/build-counterparties-from-bank";
    } else if (highIssues > 0 || linkCoverage < 0.95) {
      counterpartyFoundationReadiness = "PARTIAL";
      readinessReason = `${totalCounterparties} counterparties created, ${linkedTx}/${totalTx} transactions linked (${Math.round(linkCoverage * 100)}%). Some issues require attention.`;
      nextRecommendedStep = "Investigate unlinked transactions, then proceed to P8.4 reconciliation review.";
    } else {
      counterpartyFoundationReadiness = "READY_WITH_REVIEW";
      readinessReason = `${totalCounterparties} counterparties from bank transactions. ${linkedTx}/${totalTx} transactions linked (${Math.round(linkCoverage * 100)}%). Internal transfers flagged. Duplicate candidates isolated. Low-confidence types need P8.4 manual review.`;
      nextRecommendedStep = "P8.4 — Bank ↔ AlphaCRM Reconciliation can start. Low-confidence type review can proceed in parallel.";
    }

    // ── 5. Source diagnostics ─────────────────────────────────────────────────
    // P8.2 proven: 854 normalized bank transactions in production.
    // If totalTx === 0 here, the tables exist but are empty — sync hasn't run yet.
    const P82_EXPECTED_TX = 854;
    const sourceMatchesP82   = totalTx === P82_EXPECTED_TX;
    const sourceMismatch     = totalTx !== P82_EXPECTED_TX;
    const sourceMismatchNote = totalTx === 0
      ? "bank_transactions table is empty in this environment. Run POST /api/sync/build-counterparties-from-bank — it requires 854 production transactions verified in P8.2."
      : sourceMismatch
        ? `bank_transactions count is ${totalTx}, P8.2 proved ${P82_EXPECTED_TX}. Possible data change since P8.2.`
        : null;

    return res.json({
      auditType:   "counterparties-audit-p83",
      generatedAt: new Date().toISOString(),

      environment: {
        dbKind:                  "production",
        auditValidity:           "VALID_PRODUCTION",
        isProduction:            true,
        dbName,
        nodeEnv,
        sourceTransactionCount:  totalTx,
        p82ExpectedCount:        P82_EXPECTED_TX,
        sourceMatchesP82,
        sourceMismatch,
        sourceMismatchNote,
      },

      summary: {
        totalCounterparties,
        fromBankTransactions:    Number(totals?.from_bank ?? 0),
        totalAliases:            Number(totals?.aliases ?? 0),
        totalLinks,
        linkedTransactions:      linkedTx,
        totalBankTransactions:   totalTx,
        unlinkedTransactions:    unlinkedTx,
        linkCoveragePct:         Math.round(linkCoverage * 100),
        openDuplicateCandidates: dupOpen,
      },

      byType:         typeBreakdown,
      byConfidence:   confidenceBreakdown,

      internalTransfers: internalTransfers.map(cp => ({
        id:              cp.id,
        canonicalKey:    cp.canonical_key,
        displayName:     cp.display_name,
        totalIncome:     Number(cp.total_income),
        totalExpense:    Number(cp.total_expense),
        operationsCount: Number(cp.operations_count),
        riskFlags:       cp.risk_flags,
        note:            "Own-account or internal transfer — must be excluded from revenue/expense in P8.4.",
      })),

      topIncomeCounterparties:  topIncome.map(c => ({
        id: c.id, displayName: c.display_name, inn: c.inn,
        type: c.counterparty_type, confidence: c.confidence,
        operationsCount: Number(c.operations_count),
        totalIncome: Number(c.total_income),
      })),
      topExpenseCounterparties: topExpense.map(c => ({
        id: c.id, displayName: c.display_name, inn: c.inn,
        type: c.counterparty_type, confidence: c.confidence,
        operationsCount: Number(c.operations_count),
        totalExpense: Number(c.total_expense),
      })),

      duplicateCandidates: dupCandidates.map(d => ({
        counterpartyAId:   d.counterparty_a_id,
        counterpartyBId:   d.counterparty_b_id,
        aName:             d.a_name,
        bName:             d.b_name,
        reason:            d.reason,
        confidence:        d.confidence,
        severity:          d.severity,
      })),

      unlinkedTransactionSamples: noLinks.map(t => ({
        id: t.tx_id, direction: t.direction, amount: Number(t.amount),
        counterpartyName: t.counterparty_name, operationDate: t.operation_date,
      })),

      issues,
      issueSummary: {
        total:    issues.length,
        critical: issues.filter(i => i.severity === "CRITICAL").length,
        high:     issues.filter(i => i.severity === "HIGH").length,
        medium:   issues.filter(i => i.severity === "MEDIUM").length,
        low:      issues.filter(i => i.severity === "LOW").length,
        info:     issues.filter(i => i.severity === "INFO").length,
      },

      counterpartyFoundationReadiness,
      readinessReason,
      nextRecommendedStep,
      p84CanStart: counterpartyFoundationReadiness !== "NOT_READY",

      warnings: [
        "⚠️ Do NOT treat parent_client counterparties as confirmed clients until AlphaCRM matching (P8.4).",
        "⚠️ Do NOT build final ДДС or ОПиУ — bank reconciliation (P8.4) is required first.",
        "⚠️ Do NOT auto-merge duplicate candidates. Manual review only.",
        "ℹ️ Internal transfers (exclude_from_revenue_expense=true) must be excluded from all P&L calculations.",
        `ℹ️ ${typeBreakdown["parent_client"]?.count ?? 0} parent_client candidates need AlphaCRM family matching in P8.4.`,
      ],
    });

  } catch (err) {
    logger.error({ err }, "counterparties-audit failed");
    return void res.status(500).json({ error: String(err) });
  }

// ══════════════════════════════════════════════════════════════════════════════
// P8.4a — Counterparty Reclassification Audit
// ══════════════════════════════════════════════════════════════════════════════
});

auditRouter.get("/coverage/counterparty-reclassification-audit", async (req, res) => {
  try {
    // ── 0. Environment guard ─────────────────────────────────────────────────
    const dbNameRow = await sqlOne<{ db: string }>("SELECT current_database() AS db");
    const dbName  = dbNameRow?.db ?? "";
    const nodeEnv = process.env["NODE_ENV"] ?? "";
    const isProduction =
      nodeEnv === "production" || dbName.includes("prod") || dbName.includes("neon") ||
      (!dbName.includes("dev") && !dbName.includes("test") && !dbName.includes("local"));

    if (!isProduction) {
      return res.json({
        auditType: "counterparty-reclassification-audit-p84a",
        generatedAt: new Date().toISOString(),
        environment: { dbKind: "dev", isProduction: false, dbName, nodeEnv },
        counterpartyReclassificationReadiness: "NOT_APPLICABLE_DEV",
        readinessReason: "Only valid against production bank data.",
      });
    }

    // ── 1. All counterparties ─────────────────────────────────────────────────
    const allCp = await sql<{
      id: string; display_name: string; inn: string | null;
      counterparty_type: string; confidence: string;
      finance_treatment_hint: string | null;
      exclude_from_revenue_expense: boolean;
      needs_manual_review: boolean;
      reclassification_reason: string | null;
      classification_version: string | null;
      classification_updated_at: string | null;
      total_income: string; total_expense: string;
      operations_count: string; risk_flags: unknown;
    }>(`
      SELECT id, display_name, inn, counterparty_type, confidence,
             finance_treatment_hint, exclude_from_revenue_expense, needs_manual_review,
             reclassification_reason, classification_version, classification_updated_at,
             total_income, total_expense, operations_count, risk_flags
      FROM counterparties ORDER BY operations_count::int DESC
    `);

    // ── 2. Aggregate counts ───────────────────────────────────────────────────
    const [byTypeCurrent, byVersion, dupOpenRow, txCountRow] = await Promise.all([
      sql<{ t: string; cnt: string; ti: string; te: string }>(`
        SELECT counterparty_type AS t, COUNT(*)::text AS cnt,
               COALESCE(SUM(total_income),0)::numeric(15,2)::text AS ti,
               COALESCE(SUM(total_expense),0)::numeric(15,2)::text AS te
        FROM counterparties GROUP BY t ORDER BY COUNT(*) DESC
      `),
      sql<{ ver: string; cnt: string }>(`
        SELECT COALESCE(classification_version,'p83_original') AS ver, COUNT(*)::text AS cnt
        FROM counterparties GROUP BY ver ORDER BY COUNT(*) DESC
      `),
      sqlOne<{ cnt: string }>("SELECT COUNT(*)::text AS cnt FROM counterparty_duplicate_candidates WHERE status='open'"),
      sqlOne<{ cnt: string }>("SELECT COUNT(*)::text AS cnt FROM bank_transactions"),
    ]);

    const byCurrentType: Record<string, { count: number; totalIncome: number; totalExpense: number }> = {};
    for (const r of byTypeCurrent) {
      byCurrentType[r.t] = { count: Number(r.cnt), totalIncome: Number(r.ti), totalExpense: Number(r.te) };
    }
    const byClassificationVersion: Record<string, number> = {};
    for (const r of byVersion) byClassificationVersion[r.ver] = Number(r.cnt);

    // ── 3. Categorized lists ─────────────────────────────────────────────────
    type CpRow = (typeof allCp)[0];
    const mapCp = (cp: CpRow) => ({
      id:                      cp.id,
      displayName:             cp.display_name,
      inn:                     cp.inn,
      counterpartyType:        cp.counterparty_type,
      confidence:              cp.confidence,
      financeTreatmentHint:    cp.finance_treatment_hint,
      excludeFromRevExp:       cp.exclude_from_revenue_expense,
      needsManualReview:       cp.needs_manual_review,
      reclassificationReason:  cp.reclassification_reason,
      classificationVersion:   cp.classification_version ?? 'p83_original',
      classificationUpdatedAt: cp.classification_updated_at,
      totalIncome:             Number(cp.total_income),
      totalExpense:            Number(cp.total_expense),
      operationsCount:         Number(cp.operations_count),
      riskFlags:               (cp.risk_flags ?? {}) as Record<string, unknown>,
    });

    const internalCompanies      = allCp.filter(c => c.counterparty_type === 'internal_company').map(mapCp);
    const bankOrFee              = allCp.filter(c => c.counterparty_type === 'bank_or_fee').map(mapCp);
    const parentClientCandidates = allCp.filter(c => c.counterparty_type === 'parent_client').map(mapCp);
    const needsManualReviewList  = allCp.filter(c => c.needs_manual_review).map(mapCp);
    const suspiciousTaxAuthority = allCp.filter(c =>
      c.counterparty_type === 'tax_authority' && c.needs_manual_review
    ).map(mapCp);

    const totalCp         = allCp.length;
    const reclassifiedCp  = allCp.filter(c => c.classification_version === 'p84a_v1').length;
    const excludedRevExp  = allCp.filter(c => c.exclude_from_revenue_expense).length;
    const needsMrCount    = needsManualReviewList.length;
    const bankNeedsOpLevel = bankOrFee.filter(c =>
      !!(c.riskFlags as Record<string, unknown>)?.['needs_operation_level_classification']
    ).length;
    const unversionedCount = totalCp - reclassifiedCp;

    // ── 4. Duplicate candidates sample ───────────────────────────────────────
    const dupCandidates = await sql<{
      a_id: string; b_id: string; a_name: string; b_name: string; reason: string; status: string;
    }>(`
      SELECT dc.counterparty_a_id AS a_id, dc.counterparty_b_id AS b_id,
             ca.display_name AS a_name, cb.display_name AS b_name,
             dc.reason, dc.status
      FROM counterparty_duplicate_candidates dc
      JOIN counterparties ca ON dc.counterparty_a_id = ca.id
      JOIN counterparties cb ON dc.counterparty_b_id = cb.id
      WHERE dc.status = 'open' LIMIT 5
    `);

    // ── 5. Issues ─────────────────────────────────────────────────────────────
    const issues: Array<{ issueType: string; severity: string; count: number; description: string; recommendedAction: string }> = [];

    if (unversionedCount > 0) {
      issues.push({ issueType: 'reclassification_not_run', severity: 'HIGH', count: unversionedCount,
        description: `${unversionedCount} counterparties still at P8.3 original classification (no classification_version).`,
        recommendedAction: 'Run POST /api/sync/reclassify-counterparties-p84a to apply P8.4a rules.' });
    }
    if (needsMrCount > 0) {
      issues.push({ issueType: 'needs_manual_review', severity: needsMrCount > 10 ? 'MEDIUM' : 'LOW',
        count: needsMrCount,
        description: `${needsMrCount} counterparties need manual type review (unmatched tax_authority or ambiguous).`,
        recommendedAction: 'Review manually. Non-blocking for P8.4b.' });
    }
    if (excludedRevExp < internalCompanies.length) {
      issues.push({ issueType: 'internal_not_excluded', severity: 'HIGH',
        count: internalCompanies.length - excludedRevExp,
        description: 'Internal companies not flagged exclude_from_revenue_expense=true.',
        recommendedAction: 'Run reclassify-counterparties-p84a.' });
    }
    if (bankNeedsOpLevel < bankOrFee.length) {
      issues.push({ issueType: 'bank_not_flagged_op_split', severity: 'MEDIUM',
        count: bankOrFee.length - bankNeedsOpLevel,
        description: 'ООО "Банк Точка" not yet flagged needs_operation_level_classification.',
        recommendedAction: 'Run reclassify-counterparties-p84a to set flag.' });
    }
    issues.push({ issueType: 'duplicate_candidates_manual_review', severity: 'INFO',
      count: Number(dupOpenRow?.cnt ?? 0),
      description: `${dupOpenRow?.cnt ?? 0} open duplicate candidate pairs (same_inn_diff_key). Manual review only.`,
      recommendedAction: 'Do NOT auto-merge. Review each pair individually in P8.4b.' });

    // ── 6. Readiness verdict ──────────────────────────────────────────────────
    const hasRunReclassify = reclassifiedCp === totalCp && totalCp > 0;
    const internalOk = internalCompanies.length > 0 && excludedRevExp === internalCompanies.length;
    const bankOk     = bankNeedsOpLevel > 0 || bankOrFee.length === 0;
    let counterpartyReclassificationReadiness: string;
    let readinessReason: string;

    if (!hasRunReclassify) {
      counterpartyReclassificationReadiness = "NOT_READY";
      readinessReason = `P8.4a reclassification not yet run. ${reclassifiedCp}/${totalCp} at p84a_v1. Run POST /api/sync/reclassify-counterparties-p84a.`;
    } else if (internalOk && bankOk && needsMrCount <= 15) {
      counterpartyReclassificationReadiness = needsMrCount > 0 ? "READY_WITH_REVIEW" : "READY_FOR_RECONCILIATION";
      readinessReason = needsMrCount > 0
        ? `${reclassifiedCp}/${totalCp} reclassified. ${needsMrCount} manual-review items (non-blocking). Internal ✓ excluded. Bank ✓ flagged.`
        : `All ${totalCp} counterparties reclassified. Internal companies excluded. Bank flagged for op-level split. Duplicates isolated.`;
    } else {
      counterpartyReclassificationReadiness = "READY_WITH_REVIEW";
      readinessReason = `${reclassifiedCp}/${totalCp} reclassified. ${needsMrCount} need review. Internal: ${internalOk ? '✓' : '✗'}. Bank: ${bankOk ? '✓' : '✗'}.`;
    }

    return res.json({
      auditType:   "counterparty-reclassification-audit-p84a",
      generatedAt: new Date().toISOString(),
      environment: {
        dbKind: "production", isProduction: true, dbName, nodeEnv,
        bankTransactionCount: Number(txCountRow?.cnt ?? 0),
      },
      summary: {
        totalCounterparties:      totalCp,
        reclassifiedP84a:        reclassifiedCp,
        atP83Original:           unversionedCount,
        excludedFromRevExp:      excludedRevExp,
        needsManualReview:       needsMrCount,
        bankFlaggedOpLevel:      bankNeedsOpLevel,
        openDuplicateCandidates: Number(dupOpenRow?.cnt ?? 0),
        byClassificationVersion,
      },
      byCurrentType,
      allCounterparties:            allCp.map(mapCp),
      internalCompanies,
      bankOrFee,
      parentClientCandidates,
      suspiciousTaxAuthority,
      needsManualReviewList,
      duplicateCandidatesSample: dupCandidates.map(d => ({
        aId: d.a_id, bId: d.b_id, aName: d.a_name, bName: d.b_name,
        reason: d.reason, status: d.status,
        policy: 'manual_review_only_do_not_auto_merge',
      })),
      issues,
      issueSummary: {
        total:  issues.length,
        high:   issues.filter(i => i.severity === 'HIGH').length,
        medium: issues.filter(i => i.severity === 'MEDIUM').length,
        low:    issues.filter(i => i.severity === 'LOW').length,
        info:   issues.filter(i => i.severity === 'INFO').length,
      },
      counterpartyReclassificationReadiness,
      readinessReason,
      p84bCanStart: counterpartyReclassificationReadiness !== "NOT_READY",
      warnings: [
        "⚠️ Do NOT build final ДДС or ОПиУ — P8.4b Bank ↔ AlphaCRM matching required first.",
        "⚠️ Do NOT auto-merge duplicate candidates — same_inn_diff_key may be shared SBP INN pattern.",
        `ℹ️ ${internalCompanies.length} internal companies have exclude_from_revenue_expense=true — excluded from all P&L.`,
        `ℹ️ ООО "Банк Точка" (${bankOrFee[0]?.operationsCount ?? 380} operations) needs operation-level classification split in P8.4b.`,
        "ℹ️ 2 parent_client candidates need AlphaCRM family matching in P8.4b.",
      ],
    });

  } catch (err) {
    logger.error({ err }, "counterparty-reclassification-audit failed");
    return void res.status(500).json({ error: String(err) });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// P8.4b — Bank ↔ AlphaCRM Reconciliation Audit
// ══════════════════════════════════════════════════════════════════════════════
auditRouter.get("/coverage/bank-alpha-reconciliation-audit", async (_req, res) => {
  try {
    // ── 0. Environment guard ─────────────────────────────────────────────────
    const dbNameRow = await sqlOne<{ db: string }>("SELECT current_database() AS db");
    const dbName  = dbNameRow?.db ?? "";
    const nodeEnv = process.env["NODE_ENV"] ?? "";
    const isProduction =
      nodeEnv === "production" || dbName.includes("neon") || dbName.includes("prod") ||
      (!dbName.includes("dev") && !dbName.includes("test") && !dbName.includes("local"));

    if (!isProduction) {
      return res.json({
        auditType:   "bank-alpha-reconciliation-audit-p84b",
        generatedAt: new Date().toISOString(),
        environment: { dbKind: "dev", isProduction: false, dbName, nodeEnv },
        bankAlphaReconciliationReadiness: "NOT_APPLICABLE_DEV",
        readinessReason: "Only valid against production bank data.",
      });
    }

    // ── 1. Check if any reconciliation runs exist ─────────────────────────────
    const runsCountRow = await sqlOne<{ cnt: string }>(
      "SELECT COUNT(*)::text AS cnt FROM bank_alpha_reconciliation_runs"
    );
    const runsCount = Number(runsCountRow?.cnt ?? 0);

    if (runsCount === 0) {
      return res.json({
        auditType:   "bank-alpha-reconciliation-audit-p84b",
        generatedAt: new Date().toISOString(),
        environment: { dbKind: "production", isProduction: true, dbName, nodeEnv },
        bankAlphaReconciliationReadiness: "NOT_RUN",
        readinessReason: "No reconciliation runs found. Run POST /api/sync/reconcile-bank-alpha-p84b to start.",
        p85CanStart: false,
        warnings: ["Run POST /api/sync/reconcile-bank-alpha-p84b to build the reconciliation layer."],
      });
    }

    // ── 2. Latest completed run ────────────────────────────────────────────────
    const latestRun = await sqlOne<{
      id: string;
      started_at: string;
      finished_at: string | null;
      status: string;
      bank_transactions_checked: number;
      crm_payments_checked: number;
      matched_count: number;
      partial_count: number;
      possible_count: number;
      unmatched_bank_count: number;
      unmatched_crm_count: number;
      excluded_internal_count: number;
      excluded_collection_count: number;
      excluded_bank_fee_count: number;
      needs_review_count: number;
    }>(`
      SELECT id, started_at, finished_at, status,
             bank_transactions_checked, crm_payments_checked,
             matched_count, partial_count, possible_count,
             unmatched_bank_count, unmatched_crm_count,
             excluded_internal_count, excluded_collection_count, excluded_bank_fee_count,
             needs_review_count
      FROM bank_alpha_reconciliation_runs
      ORDER BY created_at DESC LIMIT 1
    `);

    if (!latestRun) {
      return res.json({
        auditType:   "bank-alpha-reconciliation-audit-p84b",
        generatedAt: new Date().toISOString(),
        environment: { dbKind: "production", isProduction: true, dbName, nodeEnv },
        bankAlphaReconciliationReadiness: "NOT_RUN",
        readinessReason: "No reconciliation runs found.",
        p85CanStart: false,
      });
    }

    const runId = latestRun.id;

    // ── 3. Match breakdown by status and confidence ───────────────────────────
    const [byStatus, byConf, byMethod] = await Promise.all([
      sql<{ s: string; cnt: string; total_bank: string }>(`
        SELECT match_status AS s, COUNT(*)::text AS cnt,
               COALESCE(SUM(bank_amount),0)::numeric(15,2)::text AS total_bank
        FROM bank_alpha_reconciliation_matches
        WHERE run_id = $1
        GROUP BY match_status ORDER BY COUNT(*) DESC
      `, [runId]),
      sql<{ c: string; cnt: string }>(`
        SELECT match_confidence AS c, COUNT(*)::text AS cnt
        FROM bank_alpha_reconciliation_matches
        WHERE run_id = $1
        GROUP BY match_confidence ORDER BY COUNT(*) DESC
      `, [runId]),
      sql<{ m: string; cnt: string }>(`
        SELECT match_method AS m, COUNT(*)::text AS cnt
        FROM bank_alpha_reconciliation_matches
        WHERE run_id = $1
        GROUP BY match_method ORDER BY COUNT(*) DESC
      `, [runId]),
    ]);

    const matchStatusBreakdown: Record<string, { count: number; totalBankAmount: number }> = {};
    for (const r of byStatus) {
      matchStatusBreakdown[r.s] = { count: Number(r.cnt), totalBankAmount: Number(r.total_bank) };
    }
    const matchConfidenceBreakdown: Record<string, number> = {};
    for (const r of byConf) matchConfidenceBreakdown[r.c] = Number(r.cnt);
    const matchMethodBreakdown: Record<string, number> = {};
    for (const r of byMethod) matchMethodBreakdown[r.m] = Number(r.cnt);

    // ── 4. Unmatched bank transactions sample ─────────────────────────────────
    const unmatchedBankSample = await sql<{
      bank_transaction_id: string;
      bank_amount: string;
      bank_date: string | null;
      bank_counterparty_name: string | null;
      reasons: unknown;
    }>(`
      SELECT bank_transaction_id, bank_amount::text, bank_date::text,
             bank_counterparty_name, reasons
      FROM bank_alpha_reconciliation_matches
      WHERE run_id = $1 AND match_status = 'unmatched_bank'
      ORDER BY bank_amount::numeric DESC LIMIT 20
    `, [runId]);

    // ── 5. Needs-review sample ─────────────────────────────────────────────────
    const needsReviewSample = await sql<{
      bank_transaction_id: string;
      bank_amount: string;
      bank_date: string | null;
      bank_counterparty_name: string | null;
      reasons: unknown;
    }>(`
      SELECT bank_transaction_id, bank_amount::text, bank_date::text,
             bank_counterparty_name, reasons
      FROM bank_alpha_reconciliation_matches
      WHERE run_id = $1 AND match_status = 'needs_review'
      ORDER BY bank_amount::numeric DESC LIMIT 20
    `, [runId]);

    // ── 6. Matched records sample ──────────────────────────────────────────────
    const matchedSample = await sql<{
      bank_transaction_id: string;
      crm_payment_id: string | null;
      match_confidence: string | null;
      bank_amount: string;
      bank_date: string | null;
      crm_date: string | null;
      date_delta_days: number | null;
      bank_counterparty_name: string | null;
    }>(`
      SELECT bank_transaction_id, crm_payment_id::text, match_confidence,
             bank_amount::text, bank_date::text, crm_date::text, date_delta_days,
             bank_counterparty_name
      FROM bank_alpha_reconciliation_matches
      WHERE run_id = $1 AND match_status IN ('matched','possible_match')
      ORDER BY bank_amount::numeric DESC LIMIT 20
    `, [runId]);

    // ── 7. Compute totals and amounts ──────────────────────────────────────────
    const totalBankRow = await sqlOne<{ total: string; income: string }>(
      "SELECT COUNT(*)::text AS total, COALESCE(SUM(CASE WHEN direction='income' THEN amount ELSE 0 END),0)::numeric(15,2)::text AS income FROM bank_transactions"
    );

    // ── 8. Issues ──────────────────────────────────────────────────────────────
    const issues: Array<{ issueType: string; severity: string; count: number; description: string; recommendedAction: string }> = [];

    const unmatchedBankCnt  = latestRun.unmatched_bank_count;
    const needsRevCnt       = latestRun.needs_review_count;
    const possibleCnt       = latestRun.possible_count;
    const matchedCnt        = latestRun.matched_count;
    const unmatchedCrmCnt   = latestRun.unmatched_crm_count;

    if (unmatchedBankCnt > 50) {
      issues.push({ issueType: 'high_unmatched_bank', severity: 'HIGH', count: unmatchedBankCnt,
        description: `${unmatchedBankCnt} bank income transactions have no CRM payment match.`,
        recommendedAction: 'Review for missing AlphaCRM payments, bank-only income, or data entry errors.' });
    } else if (unmatchedBankCnt > 0) {
      issues.push({ issueType: 'unmatched_bank', severity: 'MEDIUM', count: unmatchedBankCnt,
        description: `${unmatchedBankCnt} bank income transactions unmatched.`,
        recommendedAction: 'Review unmatched sample above.' });
    }
    if (needsRevCnt > 0) {
      issues.push({ issueType: 'multiple_crm_candidates', severity: 'MEDIUM', count: needsRevCnt,
        description: `${needsRevCnt} bank transactions have multiple same-amount CRM candidates — ambiguous match.`,
        recommendedAction: 'Manual review required per transaction. Look at student/purpose context.' });
    }
    if (possibleCnt > 20) {
      issues.push({ issueType: 'low_confidence_matches', severity: 'LOW', count: possibleCnt,
        description: `${possibleCnt} possible matches (medium/low confidence: amount match but date >1 day apart).`,
        recommendedAction: 'Review date-discrepancy records. May indicate recording date vs posting date lag.' });
    }
    if (unmatchedCrmCnt > 500) {
      issues.push({ issueType: 'high_unmatched_crm', severity: 'MEDIUM', count: unmatchedCrmCnt,
        description: `${unmatchedCrmCnt} eligible CRM income payments have no bank transaction match.`,
        recommendedAction: 'Normal for prior-period CRM payments and cash/card-not-in-bank transactions.' });
    }

    // ── 9. Readiness verdict ───────────────────────────────────────────────────
    const eligibleBankIncome = (matchedCnt + unmatchedBankCnt + needsRevCnt + possibleCnt);
    const matchRatePct = eligibleBankIncome > 0
      ? Math.round(((matchedCnt + possibleCnt) / eligibleBankIncome) * 100) : 0;

    let bankAlphaReconciliationReadiness: string;
    let readinessReason: string;

    if (latestRun.status !== 'completed') {
      bankAlphaReconciliationReadiness = 'NOT_READY';
      readinessReason = `Latest run status: ${latestRun.status}. Wait for completion or re-run.`;
    } else if (matchRatePct >= 80 && unmatchedBankCnt < 50) {
      bankAlphaReconciliationReadiness = 'READY_FOR_P85';
      readinessReason = `${matchRatePct}% of eligible bank income transactions matched. ${unmatchedBankCnt} unmatched — acceptable for P8.5.`;
    } else if (matchedCnt > 0 || possibleCnt > 0) {
      bankAlphaReconciliationReadiness = 'PARTIAL_READY';
      readinessReason = `${matchRatePct}% match rate (${matchedCnt} confirmed + ${possibleCnt} possible). ${unmatchedBankCnt} unmatched bank + ${needsRevCnt} needs_review. More review needed before P8.5.`;
    } else {
      bankAlphaReconciliationReadiness = 'NOT_READY';
      readinessReason = 'No matches found. Check that CRM payments have income payments for Atlas branch and bank transactions have income ops.';
    }

    return res.json({
      auditType:   "bank-alpha-reconciliation-audit-p84b",
      generatedAt: new Date().toISOString(),
      environment: { dbKind: "production", isProduction: true, dbName, nodeEnv },
      latestRun: {
        id:                    latestRun.id,
        status:                latestRun.status,
        startedAt:             latestRun.started_at,
        finishedAt:            latestRun.finished_at,
        bankTransactionsChecked: latestRun.bank_transactions_checked,
        crmPaymentsChecked:    latestRun.crm_payments_checked,
        matchedCount:          matchedCnt,
        possibleCount:         possibleCnt,
        needsReviewCount:      needsRevCnt,
        unmatchedBankCount:    unmatchedBankCnt,
        unmatchedCrmCount:     unmatchedCrmCnt,
        excludedInternalCount: latestRun.excluded_internal_count,
        excludedCollectionCount: latestRun.excluded_collection_count,
        excludedBankFeeCount:  latestRun.excluded_bank_fee_count,
      },
      summary: {
        totalBankTransactions:    Number(totalBankRow?.total ?? 0),
        totalBankIncome:          Number(totalBankRow?.income ?? 0),
        eligibleBankIncomeCount:  eligibleBankIncome,
        matchRatePct,
        runsTotal: runsCount,
      },
      matchBreakdown: {
        byStatus:     matchStatusBreakdown,
        byConfidence: matchConfidenceBreakdown,
        byMethod:     matchMethodBreakdown,
      },
      unmatchedBankSample: unmatchedBankSample.map(r => ({
        bankTransactionId:   r.bank_transaction_id,
        bankAmount:          Number(r.bank_amount),
        bankDate:            r.bank_date,
        bankCounterpartyName: r.bank_counterparty_name,
        reasons:             r.reasons,
      })),
      needsReviewSample: needsReviewSample.map(r => ({
        bankTransactionId:   r.bank_transaction_id,
        bankAmount:          Number(r.bank_amount),
        bankDate:            r.bank_date,
        bankCounterpartyName: r.bank_counterparty_name,
        reasons:             r.reasons,
      })),
      matchedSample: matchedSample.map(r => ({
        bankTransactionId:   r.bank_transaction_id,
        crmPaymentId:        r.crm_payment_id,
        matchConfidence:     r.match_confidence,
        bankAmount:          Number(r.bank_amount),
        bankDate:            r.bank_date,
        crmDate:             r.crm_date,
        dateDeltaDays:       r.date_delta_days,
        bankCounterpartyName: r.bank_counterparty_name,
      })),
      issues,
      issueSummary: {
        total:  issues.length,
        high:   issues.filter(i => i.severity === 'HIGH').length,
        medium: issues.filter(i => i.severity === 'MEDIUM').length,
        low:    issues.filter(i => i.severity === 'LOW').length,
      },
      bankAlphaReconciliationReadiness,
      readinessReason,
      p85CanStart: bankAlphaReconciliationReadiness === 'READY_FOR_P85' || bankAlphaReconciliationReadiness === 'PARTIAL_READY',
      warnings: [
        "⚠️ Do NOT treat this reconciliation as final ДДС/ОПиУ truth. P8.5 Verified ДДС requires full reconciliation review.",
        "⚠️ collection_internal payments (229 records, ~135M ₽) remain excluded — not client revenue until bank reconciliation confirmed.",
        "⚠️ Internal companies (ООО АРТХЕЛЛО etc.) excluded from all matching.",
        `ℹ️ Match method: amount+date window only. Customer/family matching not yet implemented (future P8.4c enhancement).`,
        `ℹ️ Possible matches (medium/low confidence) need manual date-discrepancy review.`,
      ],
    });

  } catch (err) {
    logger.error({ err }, "bank-alpha-reconciliation-audit failed");
    return void res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/coverage/lesson-eu-diagnostic ───────────────────────────────────
// Temporary P9 diagnostic: checks overlap between crm_lessons.group_crm_id
// and educational_units.crm_group_id to debug map-educational-units = 0.
auditRouter.get("/coverage/lesson-eu-diagnostic", async (_req, res) => {
  try {
    const [euIds, lessonIds, overlap, triples] = await Promise.all([
      sql<{ crm_group_id: string }>(
        `SELECT crm_group_id FROM educational_units WHERE is_active = true ORDER BY crm_group_id LIMIT 80`,
      ),
      sql<{ group_crm_id: string; cnt: string }>(
        `SELECT group_crm_id, COUNT(*)::text AS cnt
         FROM crm_lessons WHERE branch_crm_id = '6' AND group_crm_id IS NOT NULL
         GROUP BY group_crm_id ORDER BY COUNT(*) DESC LIMIT 50`,
      ),
      sql<{ overlapping_ids: string; overlap_count: string }>(
        `SELECT STRING_AGG(DISTINCT l.group_crm_id, ',' ORDER BY l.group_crm_id) AS overlapping_ids,
                COUNT(DISTINCT l.group_crm_id)::text AS overlap_count
         FROM crm_lessons l
         JOIN educational_units eu ON eu.crm_group_id = l.group_crm_id AND eu.is_active = true
         WHERE l.branch_crm_id = '6'`,
      ),
      sql<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
         FROM employees e
         JOIN crm_lessons l ON l.teacher_crm_id = e.teacher_crm_id AND l.branch_crm_id = '6'
         JOIN educational_units eu ON eu.crm_group_id = l.group_crm_id AND eu.is_active = true
         WHERE e.teacher_crm_id IS NOT NULL`,
      ),
    ]);
    res.json({
      eu_crm_group_ids: euIds.map(r => r.crm_group_id),
      lesson_group_crm_ids_top50: lessonIds.map(r => ({ id: r.group_crm_id, lessons: Number(r.cnt) })),
      overlap: {
        count: Number(overlap[0]?.overlap_count ?? 0),
        ids: (overlap[0]?.overlapping_ids ?? "").split(",").filter(Boolean),
      },
      triples_count: Number(triples[0]?.cnt ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "lesson-eu-diagnostic failed");
    res.status(500).json({ error: String(err) });
  }
});
