import { Router } from "express";
import { branchId, logger, pool, sql, sqlOne } from "./shared.js";

export const normalizationAuditRouter = Router();

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/normalization-audit
// ══════════════════════════════════════════════════════════════════════════════
normalizationAuditRouter.get(
  "/coverage/normalization-audit",
  async (req, res) => {
    const bid = branchId(req);
    try {
      // ── 1. Raw counts by entity type ─────────────────────────────────────────
      const rawCounts = await sql(
        `
      SELECT entity_type, COUNT(*) AS raw_count
      FROM alpha_raw_records
      WHERE branch_id = $1
      GROUP BY entity_type
      ORDER BY raw_count DESC
    `,
        [bid],
      );

      // ── 2. Normalized entity counts ─────────────────────────────────────────
      const [
        normStudents,
        normLessons,
        normPayments,
        normTeachers,
        normAttendance,
      ] = await Promise.all([
        sqlOne<{ cnt: string }>(
          `SELECT COUNT(*) AS cnt FROM crm_students WHERE branch_crm_id = $1 AND lifecycle_status != 'legacy_pre_p7'`,
          [bid],
        ),
        sqlOne<{ cnt: string }>(
          `SELECT COUNT(*) AS cnt FROM crm_lessons WHERE branch_crm_id = $1`,
          [bid],
        ),
        sqlOne<{ cnt: string }>(
          `SELECT COUNT(*) AS cnt FROM crm_payments WHERE branch_crm_id = $1`,
          [bid],
        ),
        sqlOne<{ cnt: string }>(
          `SELECT COUNT(*) AS cnt FROM crm_teachers WHERE branch_crm_id = $1`,
          [bid],
        ),
        sqlOne<{ cnt: string }>(
          `SELECT COUNT(*) AS cnt FROM crm_attendance`,
          [],
        ),
      ]);

      // ── 3. Identity layer counts ─────────────────────────────────────────────
      const [
        identStudentProfiles,
        identFamilies,
        identPersons,
        identGuardianLinks,
      ] = await Promise.all([
        sqlOne<{ cnt: string }>(
          `SELECT COUNT(*) AS cnt FROM student_profiles WHERE branch_crm_id = $1`,
          [bid],
        ),
        sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM families`, []),
        sqlOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM persons`, []),
        sqlOne<{ cnt: string }>(
          `SELECT COUNT(*) AS cnt FROM guardian_student_links`,
          [],
        ),
      ]);

      // ── 4. Raw records NOT normalized (no matching crm_* record) ─────────────
      const rawStudentsNotNorm = await sql(
        `
      SELECT r.alpha_id, r.source_payload->>'full_name' AS name, r.source_payload->>'phone' AS phone
      FROM alpha_raw_records r
      LEFT JOIN crm_students s ON s.crm_id = r.alpha_id
      WHERE r.entity_type = 'students' AND r.branch_id = $1 AND s.id IS NULL
    `,
        [bid],
      );

      const rawLessonsNotNormCount = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records r
      LEFT JOIN crm_lessons l ON l.crm_id = r.alpha_id
      WHERE r.entity_type = 'lessons' AND r.branch_id = $1 AND l.id IS NULL
    `,
        [bid],
      );

      const rawPaymentsNotNormCount = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records r
      LEFT JOIN crm_payments p ON p.crm_id = r.alpha_id
      WHERE r.entity_type = 'payments' AND r.branch_id = $1 AND p.id IS NULL
    `,
        [bid],
      );

      // ── 5. Normalized records without raw source ─────────────────────────────
      const normStudentsNoRaw = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM crm_students s
      LEFT JOIN alpha_raw_records r ON r.alpha_id = s.crm_id AND r.entity_type = 'students' AND r.branch_id = $1
      WHERE s.branch_crm_id = $1 AND r.id IS NULL
    `,
        [bid],
      );

      const normLessonsNoRaw = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM crm_lessons l
      LEFT JOIN alpha_raw_records r ON r.alpha_id = l.crm_id AND r.entity_type = 'lessons' AND r.branch_id = $1
      WHERE l.branch_crm_id = $1 AND r.id IS NULL
    `,
        [bid],
      );

      const normPaymentsNoRaw = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM crm_payments p
      LEFT JOIN alpha_raw_records r ON r.alpha_id = p.crm_id AND r.entity_type = 'payments' AND r.branch_id = $1
      WHERE p.branch_crm_id = $1 AND r.id IS NULL
    `,
        [bid],
      );

      // ── 6. Student status breakdown from raw payloads ────────────────────────
      const studentStatusRaw = await sql(
        `
      SELECT
        COUNT(*) FILTER (WHERE (source_payload->>'is_study')::int = 1) AS is_study_yes,
        COUNT(*) FILTER (WHERE (source_payload->>'is_study')::int = 0) AS is_study_no,
        COUNT(*) FILTER (WHERE source_payload->>'is_study' IS NULL)    AS is_study_null,
        COUNT(*) FILTER (WHERE (source_payload->>'is_archive')::int = 1) AS is_archived,
        COUNT(*) FILTER (WHERE COALESCE((source_payload->>'is_archive')::int, 0) = 0) AS not_archived,
        COUNT(*) AS total
      FROM alpha_raw_records
      WHERE entity_type = 'students' AND branch_id = $1
    `,
        [bid],
      );

      const studentStatusById = await sql(
        `
      SELECT source_payload->>'study_status_id' AS study_status_id, COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type = 'students' AND branch_id = $1
      GROUP BY 1
      ORDER BY 2 DESC
    `,
        [bid],
      );

      // ── 7. Study statuses lookup from raw ────────────────────────────────────
      const studyStatuses = await sql(
        `
      SELECT alpha_id, source_payload->>'name' AS name
      FROM alpha_raw_records
      WHERE entity_type = 'study_statuses' AND branch_id = $1
    `,
        [bid],
      );

      // ── 8. Records with missing critical links ────────────────────────────────
      const studentsWithoutFamily = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM student_profiles sp
      WHERE sp.family_id IS NULL AND sp.branch_crm_id = $1
    `,
        [bid],
      );

      const studentsWithoutPerson = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM student_profiles sp
      WHERE sp.student_person_id IS NULL AND sp.branch_crm_id = $1
    `,
        [bid],
      );

      const rawLessonsWithoutGroup = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type = 'lessons' AND branch_id = $1
        AND (source_payload->'group_ids' = '[]'::jsonb OR source_payload->'group_ids' IS NULL)
    `,
        [bid],
      );

      const rawLessonsWithoutSubject = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type = 'lessons' AND branch_id = $1
        AND (source_payload->>'subject_id' IS NULL OR source_payload->>'subject_id' = '')
    `,
        [bid],
      );

      const rawLessonsWithoutTeacher = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type = 'lessons' AND branch_id = $1
        AND (source_payload->'teacher_ids' = '[]'::jsonb OR source_payload->'teacher_ids' IS NULL)
    `,
        [bid],
      );

      const rawPaymentsWithoutCustomer = await sqlOne<{ cnt: string }>(
        `
      SELECT COUNT(*) AS cnt
      FROM alpha_raw_records
      WHERE entity_type = 'payments' AND branch_id = $1
        AND (source_payload->>'customer_id' IS NULL OR source_payload->>'customer_id' = '')
    `,
        [bid],
      );

      // ── 9. Normalization gap per entity ──────────────────────────────────────
      const rawMap: Record<string, number> = {};
      for (const r of rawCounts as Array<{
        entity_type: string;
        raw_count: string;
      }>) {
        rawMap[r.entity_type] = Number(r.raw_count);
      }

      const normGroups = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM crm_groups WHERE branch_crm_id=$1`,
        [bid],
      );

      const normMap: Record<string, number> = {
        students: Number(normStudents?.cnt ?? 0),
        lessons: Number(normLessons?.cnt ?? 0),
        payments: Number(normPayments?.cnt ?? 0),
        teachers: Number(normTeachers?.cnt ?? 0),
        groups: Number(normGroups?.cnt ?? 0),
      };

      const normalizationGap = Object.entries(rawMap).map(([et, raw]) => ({
        entityType: et,
        rawCount: raw,
        normalizedCount: normMap[et] ?? null,
        notNormalized: normMap[et] != null ? raw - normMap[et] : null,
        normalizationRate:
          normMap[et] != null ? Math.round((normMap[et] / raw) * 100) : null,
      }));

      const legacyStudents = await sqlOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM crm_students WHERE branch_crm_id=$1 AND lifecycle_status='legacy_pre_p7'`,
        [bid],
      );

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
          normalizedStudentsWithoutRawSource: Number(
            normStudentsNoRaw?.cnt ?? 0,
          ),
          normalizedLessonsWithoutRawSource: Number(normLessonsNoRaw?.cnt ?? 0),
          normalizedPaymentsWithoutRawSource: Number(
            normPaymentsNoRaw?.cnt ?? 0,
          ),
          studentsWithoutFamily: Number(studentsWithoutFamily?.cnt ?? 0),
          studentsWithoutPerson: Number(studentsWithoutPerson?.cnt ?? 0),
          rawLessonsWithoutGroup: Number(rawLessonsWithoutGroup?.cnt ?? 0),
          rawLessonsWithoutSubject: Number(rawLessonsWithoutSubject?.cnt ?? 0),
          rawLessonsWithoutTeacher: Number(rawLessonsWithoutTeacher?.cnt ?? 0),
          rawPaymentsWithoutCustomer: Number(
            rawPaymentsWithoutCustomer?.cnt ?? 0,
          ),
        },
        studentStatusAudit: {
          fromRaw: (studentStatusRaw[0] as Record<string, string>) ?? {},
          byStudyStatusId: studentStatusById,
          studyStatusesLookup: studyStatuses,
        },
        verdict: {
          critical: normalizationGap
            .filter(
              (g) => g.normalizationRate !== null && g.normalizationRate < 10,
            )
            .map(
              (g) =>
                `${g.entityType}: only ${g.normalizationRate}% normalized (${g.normalizedCount} of ${g.rawCount})`,
            ),
          warning: normalizationGap
            .filter(
              (g) =>
                g.normalizationRate !== null &&
                g.normalizationRate >= 10 &&
                g.normalizationRate < 80,
            )
            .map(
              (g) =>
                `${g.entityType}: partial normalization ${g.normalizationRate}%`,
            ),
        },
      });
    } catch (err) {
      logger.error({ err }, "normalization-audit failed");
      res.status(500).json({ error: "normalization-audit query failed" });
    }
  },
);
