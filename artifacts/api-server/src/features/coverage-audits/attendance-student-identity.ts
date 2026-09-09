import { Router } from "express";
import {
  branchId,
  logger,
  pool,
  sql,
  sqlOne,
} from "../../routes/coverage/shared.js";

export const attendanceStudentIdentityRouter = Router();

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/attendance-student-identity
// P7.4.1 — Diagnostic report: which AlphaCRM customer_ids in Atlas attendance
//           are linked to internal students, and why others are missing.
// ══════════════════════════════════════════════════════════════════════════════
attendanceStudentIdentityRouter.get(
  "/coverage/attendance-student-identity",
  async (req, res) => {
    const bid = branchId(req);
    try {
      // ── 1. Top-level counts ─────────────────────────────────────────────────
      const totals = await sqlOne<{
        total_att: string;
        with_cid: string;
        unique_cids: string;
        linked_records: string;
        linked_cids: string;
        unlinked_cids: string;
        inactive_linked_cids: string;
        historical_identity_cids: string;
        still_unresolved_cids: string;
        historical_identity_records: string;
        still_unresolved_records: string;
      }>(
        `
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
    `,
        [bid],
      );

      const totalAtt = Number(totals?.total_att ?? 0);
      const uniqueCids = Number(totals?.unique_cids ?? 0);
      const linkedRecords = Number(totals?.linked_records ?? 0);
      const linkedCids = Number(totals?.linked_cids ?? 0);
      const unlinkedCids = Number(totals?.unlinked_cids ?? 0);
      const inactiveLinkedCids = Number(totals?.inactive_linked_cids ?? 0);
      const historicalIdentityCids = Number(
        totals?.historical_identity_cids ?? 0,
      );
      const stillUnresolvedCids = Number(totals?.still_unresolved_cids ?? 0);
      const historicalIdentityRecords = Number(
        totals?.historical_identity_records ?? 0,
      );
      const stillUnresolvedRecords = Number(
        totals?.still_unresolved_records ?? 0,
      );
      const unlinkedRecords = totalAtt - linkedRecords;

      // ── 2. Per-customer detail for unlinked ids ──────────────────────────────
      const unlinkedRows = await sql<{
        customer_id: string;
        attendance_count: string;
        lesson_count: string;
        first_lesson_date: string;
        last_lesson_date: string;
        group_ids: string[];
        subject_ids: string[];
        teacher_ids: string;
        sample_lesson_alpha_ids: string[];
      }>(
        `
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
    `,
        [bid],
      );

      // ── 3. Search unlinked customer_ids in alpha_raw_records (all branches) ─
      //       Also check customers_archived entity type (set by resolve-ghost-customers)
      const rawLookup = await sql<{
        alpha_id: string;
        branch_id: string;
        entity_type: string;
      }>(
        `
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
    `,
        [bid],
      );

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
      const archivedHints = await sql<{
        alpha_id: string;
        lifecycle_hint: string;
      }>(
        `
      SELECT DISTINCT alpha_id,
        source_payload->'_ghost_resolution'->>'lifecycleHint' AS lifecycle_hint
      FROM alpha_raw_records
      WHERE entity_type='customers_archived' AND branch_id=$1
        AND alpha_id = ANY(
          SELECT DISTINCT student_alpha_id FROM crm_attendance
          WHERE branch_id=$1 AND student_alpha_id IS NOT NULL
            AND student_alpha_id NOT IN (SELECT crm_id FROM crm_students WHERE branch_crm_id=$1)
        )
    `,
        [bid],
      );
      const archivedHintMap = new Map(
        archivedHints.map((r) => [r.alpha_id, r.lifecycle_hint ?? "unknown"]),
      );

      // ── 4. Classify each unlinked customer_id ───────────────────────────────
      type Classification =
        | "ATLAS_RAW_EXISTS_NOT_NORMALIZED"
        | "OTHER_BRANCH_RAW_EXISTS"
        | "MULTI_BRANCH_CUSTOMER"
        | "RAW_CUSTOMER_NOT_FOUND"
        | "ARCHIVED_CUSTOMER_FOUND"
        | "INACTIVE_CUSTOMER_FOUND"
        | "MISSING_CUSTOMER_ID_IN_VISIT";

      const classified = unlinkedRows.map((row) => {
        const branches = rawByCustomer.get(row.customer_id);
        const isArchived = archivedCustomerIds.has(row.customer_id);
        const hint = archivedHintMap.get(row.customer_id);
        let classification: Classification;
        if (!row.customer_id) {
          classification = "MISSING_CUSTOMER_ID_IN_VISIT";
        } else if (isArchived) {
          // Found via ghost resolution — sub-classify by lifecycle hint
          classification =
            hint === "inactive"
              ? "INACTIVE_CUSTOMER_FOUND"
              : "ARCHIVED_CUSTOMER_FOUND";
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
          customer_id: row.customer_id,
          attendance_count: Number(row.attendance_count),
          lesson_count: Number(row.lesson_count),
          first_lesson_date: row.first_lesson_date,
          last_lesson_date: row.last_lesson_date,
          group_ids: row.group_ids ?? [],
          subject_ids: row.subject_ids ?? [],
          teacher_ids: row.teacher_ids ?? null,
          sample_lesson_alpha_ids: row.sample_lesson_alpha_ids ?? [],
          raw_found_in_branches: branches ?? [],
          classification,
        };
      });

      // ── 5. Classification summary ────────────────────────────────────────────
      const classSummary: Record<
        string,
        { customer_count: number; attendance_count: number; examples: string[] }
      > = {};
      for (const c of classified) {
        const bucket = classSummary[c.classification] ?? {
          customer_count: 0,
          attendance_count: 0,
          examples: [],
        };
        bucket.customer_count++;
        bucket.attendance_count += c.attendance_count;
        if (bucket.examples.length < 5) bucket.examples.push(c.customer_id);
        classSummary[c.classification] = bucket;
      }

      // ── 6. Raw coverage summary + dynamic branch counts ─────────────────────
      const foundInAtlasRaw = classified.filter(
        (c) => c.classification === "ATLAS_RAW_EXISTS_NOT_NORMALIZED",
      ).length;
      const foundInOtherBranch = classified.filter(
        (c) => c.classification === "OTHER_BRANCH_RAW_EXISTS",
      ).length;
      const foundInMultiBranch = classified.filter(
        (c) => c.classification === "MULTI_BRANCH_CUSTOMER",
      ).length;
      const notFoundInRaw = classified.filter(
        (c) => c.classification === "RAW_CUSTOMER_NOT_FOUND",
      ).length;

      // Dynamic: query actual alpha_raw_records.students coverage per branch
      const rawStudentCountRows = await sql<{
        branch_id: string;
        unique_ids: string;
        record_count: string;
      }>(`
      SELECT branch_id,
             COUNT(DISTINCT alpha_id)::text AS unique_ids,
             COUNT(*)::text                AS record_count
      FROM alpha_raw_records
      WHERE entity_type = 'students'
      GROUP BY branch_id
      ORDER BY branch_id
    `);
      const rawBranchesAvailable = rawStudentCountRows.map((r) => r.branch_id);
      const atlasRawStudentCount = Number(
        rawStudentCountRows.find((r) => r.branch_id === bid)?.unique_ids ?? 0,
      );
      const totalRawStudentRecords = rawStudentCountRows.reduce(
        (a, r) => a + Number(r.record_count),
        0,
      );
      const rawBranchCounts = Object.fromEntries(
        rawStudentCountRows.map((r) => [r.branch_id, Number(r.unique_ids)]),
      );

      // ── 7. Recommendation ────────────────────────────────────────────────────
      let recommendation: "A" | "B" | "C";
      let recommendationReason: string;
      if (unlinkedCids === 0) {
        recommendation = "A";
        recommendationReason =
          "All attendance customer_ids are linked to Atlas students. Atlas student scope is sufficient.";
      } else if (notFoundInRaw === unlinkedCids && notFoundInRaw > 0) {
        recommendation = "C";
        recommendationReason = `All ${unlinkedCids} unlinked customer_ids are absent from alpha_raw_records entirely. Raw data for other branches has not been pulled. A targeted raw pull of students from all branches is required before determining scope.`;
      } else if (foundInOtherBranch + foundInMultiBranch > unlinkedCids * 0.5) {
        recommendation = "B";
        recommendationReason = `${foundInOtherBranch + foundInMultiBranch} unlinked customer_ids confirmed in other branches. 'Atlas-related students' scope (all customers appearing in Atlas lessons) is needed.`;
      } else {
        recommendation = "C";
        recommendationReason =
          "Insufficient raw data to classify all unlinked customers. Targeted raw pull needed.";
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
        await pool.query(
          `
        DELETE FROM alpha_linking_issues WHERE issue_type=$1
          AND issue_message LIKE $2
      `,
          [it, `%branchId=${bid}%`],
        );
      }

      const issueMap: Record<
        Classification,
        {
          issue_type: string;
          severity: string;
          suggested_action: string;
        }
      > = {
        ATLAS_RAW_EXISTS_NOT_NORMALIZED: {
          issue_type: "attendance_customer_not_normalized",
          severity: "warning",
          suggested_action:
            "Re-run normalize-students-from-raw for Atlas branch; customer exists in raw but was not promoted to crm_students.",
        },
        OTHER_BRANCH_RAW_EXISTS: {
          issue_type: "attendance_customer_in_other_branch",
          severity: "warning",
          suggested_action:
            "Customer belongs to another AlphaCRM branch. Consider 'Atlas-related students' scope (Option B) to normalize cross-branch students attending Atlas lessons.",
        },
        MULTI_BRANCH_CUSTOMER: {
          issue_type: "attendance_customer_multi_branch",
          severity: "info",
          suggested_action:
            "Customer appears in multiple branches. Normalize from authoritative branch and link attendance cross-branch.",
        },
        RAW_CUSTOMER_NOT_FOUND: {
          issue_type: "attendance_customer_raw_not_found",
          severity: "warning",
          suggested_action:
            "Customer absent from all 8 branch raw pulls. Run POST /api/coverage/resolve-ghost-customers to query AlphaCRM archived/inactive endpoints.",
        },
        ARCHIVED_CUSTOMER_FOUND: {
          issue_type: "attendance_customer_archived_found",
          severity: "info",
          suggested_action:
            "Customer found via ghost resolution (archived in AlphaCRM). Run P7.4.3c to normalize with lifecycleStatus=archived.",
        },
        INACTIVE_CUSTOMER_FOUND: {
          issue_type: "attendance_customer_inactive_found",
          severity: "warning",
          suggested_action:
            "Customer found via ghost resolution (inactive in AlphaCRM). Run P7.4.3c to normalize with lifecycleStatus=inactive.",
        },
        MISSING_CUSTOMER_ID_IN_VISIT: {
          issue_type: "attendance_missing_customer_id",
          severity: "info",
          suggested_action:
            "Attendance record has no customer_id in the visits_raw payload. Cannot link to any student.",
        },
      };

      let issuesInserted = 0;
      for (const c of classified) {
        const meta = issueMap[c.classification];
        const sampleLessons = c.sample_lesson_alpha_ids.slice(0, 3).join(",");
        const result = await pool.query(
          `
        INSERT INTO alpha_linking_issues
          (entity_type, alpha_id, issue_type, issue_message, missing_reference_type,
           missing_reference_id, severity, suggested_action)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `,
          [
            "attendance",
            c.customer_id,
            meta.issue_type,
            `branchId=${bid} customer_id=${c.customer_id} att_count=${c.attendance_count} lessons=${c.lesson_count} sample=${sampleLessons}`,
            "crm_students",
            c.customer_id,
            meta.severity,
            meta.suggested_action,
          ],
        );
        issuesInserted += result.rowCount ?? 0;
      }

      // ── 9. Ghost resolution summary (from customers_archived raw records) ─────
      const archivedFoundCount = classified.filter(
        (c) => c.classification === "ARCHIVED_CUSTOMER_FOUND",
      ).length;
      const inactiveFoundCount = classified.filter(
        (c) => c.classification === "INACTIVE_CUSTOMER_FOUND",
      ).length;
      const stillNotFoundCount = classified.filter(
        (c) => c.classification === "RAW_CUSTOMER_NOT_FOUND",
      ).length;
      const ghostResolutionRan = archivedCustomerIds.size > 0;

      const ghostResolution = {
        resolutionRan: ghostResolutionRan,
        ghostsBefore: unlinkedCids,
        foundArchived: archivedFoundCount,
        foundInactive: inactiveFoundCount,
        foundTotal: archivedFoundCount + inactiveFoundCount,
        stillNotFound: stillNotFoundCount,
        note: ghostResolutionRan
          ? `Ghost resolution has run. ${archivedFoundCount + inactiveFoundCount} customers found (${archivedFoundCount} archived, ${inactiveFoundCount} inactive). ${stillNotFoundCount} still unresolved.`
          : `Ghost resolution not yet run. Run POST /api/coverage/resolve-ghost-customers to query AlphaCRM archived/inactive endpoints.`,
        recommendedAction:
          archivedFoundCount + inactiveFoundCount > 0
            ? "Run P7.4.3c (approved offline or scoped workflow) to normalize found customers with lifecycleStatus=archived/inactive."
            : stillNotFoundCount > 0 && !ghostResolutionRan
              ? "Run POST /api/coverage/resolve-ghost-customers first."
              : stillNotFoundCount > 0
                ? "Remaining customers are hard-deleted from AlphaCRM or require privileged access. Accept as historical attendance references."
                : "All unlinked customers resolved.",
      };

      // ── 10. Identity breakdown summary ───────────────────────────────────────
      const activeLinkedCids = linkedCids - inactiveLinkedCids;
      const activePct =
        uniqueCids > 0 ? Math.round((activeLinkedCids / uniqueCids) * 100) : 0;
      const inactivePct =
        uniqueCids > 0
          ? Math.round((inactiveLinkedCids / uniqueCids) * 100)
          : 0;
      const historicalPct =
        uniqueCids > 0
          ? Math.round((historicalIdentityCids / uniqueCids) * 100)
          : 0;
      const unresolvedPct =
        uniqueCids > 0
          ? Math.round((stillUnresolvedCids / uniqueCids) * 100)
          : 0;

      // ── 11. Response ──────────────────────────────────────────────────────────
      res.json({
        branchId: bid,
        auditType: "attendance-student-identity",
        generatedAt: new Date().toISOString(),

        // Coverage counts
        totalAttendanceRecords: totalAtt,
        withCustomerId: Number(totals?.with_cid ?? 0),
        withoutCustomerId: totalAtt - Number(totals?.with_cid ?? 0),
        uniqueCustomerIds: uniqueCids,
        linkedCustomerIds: linkedCids,
        unlinkedCustomerIds: unlinkedCids,
        linkedAttendanceRecords: linkedRecords,
        unlinkedAttendanceRecords: unlinkedRecords,
        linkedPctByRecord:
          totalAtt > 0 ? Math.round((linkedRecords / totalAtt) * 100) : 0,
        linkedPctByCustomer:
          uniqueCids > 0 ? Math.round((linkedCids / uniqueCids) * 100) : 0,

        // P7.4.3c identity breakdown
        identityBreakdown: {
          activeStudentLinked: activeLinkedCids,
          inactiveStudentLinked: inactiveLinkedCids,
          historicalIdentityCreated: historicalIdentityCids,
          stillUnresolved: stillUnresolvedCids,
          activePct,
          inactivePct,
          historicalPct,
          unresolvedPct,
          // Attendance record coverage
          attendanceWithStudentId: linkedRecords,
          attendanceWithIdentityOnly: historicalIdentityRecords,
          attendanceStillUnresolved: stillUnresolvedRecords,
          note:
            historicalIdentityCids > 0
              ? `Historical-only identities are not full student profiles. They exist only to preserve attendance history for ${historicalIdentityCids} customers no longer exposed by AlphaCRM API.`
              : stillUnresolvedCids > 0
                ? `${stillUnresolvedCids} customer_ids still unresolved. Run approved offline or scoped workflow to create identity placeholders.`
                : "All customer_ids have been resolved (active, inactive, or historical identity).",
        },

        // Raw lookup results (dynamic — based on actual alpha_raw_records contents)
        rawLookup: {
          foundInAtlasRaw,
          foundInOtherBranch,
          foundInMultiBranch,
          notFoundInAnyRaw: notFoundInRaw,
          atlasRawStudentCount,
          rawBranchesAvailable,
          rawBranchCounts,
          totalRawStudentRecords,
          note:
            rawBranchesAvailable.length <= 1
              ? `alpha_raw_records.students data exists only for branchId=${rawBranchesAvailable[0] ?? "none"} (${atlasRawStudentCount} unique ids, ${totalRawStudentRecords} records). Run approved offline or scoped workflow to pull all 8 branches.`
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
      res
        .status(500)
        .json({ error: "attendance-student-identity audit failed" });
    }
  },
);
