import { Router } from "express";
import { branchId, logger, pool, sql, sqlOne } from "./shared.js";

export const familyTruthAuditRouter = Router();

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/family-truth-audit
// ══════════════════════════════════════════════════════════════════════════════
familyTruthAuditRouter.get("/coverage/family-truth-audit", async (req, res) => {
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
      return res
        .status(500)
        .json({ error: "family-truth-audit summary failed" });
    }
  }

  try {
    // Full truth audit for a single family
    const family = await sqlOne(
      `
      SELECT f.*, p.full_name AS guardian_name, p.primary_phone AS guardian_phone
      FROM families f
      LEFT JOIN persons p ON p.id = f.primary_guardian_person_id
      WHERE f.id = $1
    `,
      [familyId],
    );

    if (!family) {
      return res.status(404).json({ error: "Family not found" });
    }

    // Children (student profiles)
    const children = await sql(
      `
      SELECT sp.*, per.full_name AS person_name
      FROM student_profiles sp
      LEFT JOIN persons per ON per.id = sp.student_person_id
      WHERE sp.family_id = $1
    `,
      [familyId],
    );

    const studentCrmIds = children
      .map((c: Record<string, unknown>) => c["student_crm_id"] as string)
      .filter(Boolean);

    // Raw records for each child
    let rawStudentRecords: Record<string, unknown>[] = [];
    if (studentCrmIds.length > 0) {
      rawStudentRecords = await sql(
        `
        SELECT alpha_id, source_payload, synced_at
        FROM alpha_raw_records
        WHERE entity_type='students' AND branch_id=$1 AND alpha_id = ANY($2::text[])
      `,
        [bid, studentCrmIds],
      );
    }

    // Payments from raw for these student CRM IDs
    let rawPayments: Record<string, unknown>[] = [];
    if (studentCrmIds.length > 0) {
      rawPayments = await sql(
        `
        SELECT alpha_id, source_payload->>'income' AS income,
               source_payload->>'document_date' AS document_date,
               source_payload->>'customer_id' AS customer_id,
               source_payload->>'comment' AS comment
        FROM alpha_raw_records
        WHERE entity_type='payments' AND branch_id=$1
          AND source_payload->>'customer_id' = ANY($2::text[])
        ORDER BY source_payload->>'document_date' DESC
        LIMIT 50
      `,
        [bid, studentCrmIds],
      );
    }

    // Also check payments matched by family phone
    const phonePayments = family["primary_phone"]
      ? await sql(
          `
          SELECT alpha_id, source_payload->>'income' AS income,
                 source_payload->>'document_date' AS document_date,
                 source_payload->>'comment' AS comment
          FROM alpha_raw_records
          WHERE entity_type='payments' AND branch_id=$1
            AND source_payload->>'payer_phone' = $2
          LIMIT 20
        `,
          [bid, family["primary_phone"]],
        )
      : [];

    // Lessons for these student CRM IDs (via customer_id in lessons)
    let rawLessons: Record<string, unknown>[] = [];
    if (studentCrmIds.length > 0) {
      rawLessons = await sql(
        `
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
      `,
        [bid, studentCrmIds],
      );
    }

    // Guardian links
    const guardianLinks = await sql(
      `
      SELECT gsl.*, per.full_name
      FROM guardian_student_links gsl
      LEFT JOIN persons per ON per.id = gsl.guardian_person_id
      WHERE gsl.family_id = $1
    `,
      [familyId],
    );

    // Mismatch checks
    const mismatches: string[] = [];

    // Phone mismatch: DB family phone vs raw guardian phone
    for (const rawStu of rawStudentRecords as Array<{
      source_payload: Record<string, unknown>;
    }>) {
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
      rawStudentRecords: rawStudentRecords.map(
        (r: Record<string, unknown>) => ({
          alphaId: r["alpha_id"],
          syncedAt: r["synced_at"],
          payload: r["source_payload"],
        }),
      ),
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
        lastSync:
          rawStudentRecords.length > 0
            ? (rawStudentRecords as Array<Record<string, unknown>>)
                .map((r) => r["synced_at"] as string)
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
