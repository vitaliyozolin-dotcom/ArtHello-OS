import { Router } from "express";
import { branchId, logger, pool, sql, sqlOne } from "./shared.js";

export const duplicatesRouter = Router();

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
    const result = await pool.query(
      `
      INSERT INTO alpha_duplicate_candidates
        (branch_id, entity_type, candidate_type, entity_a_id, entity_b_id, confidence, reason, source_fields, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'open')
      ON CONFLICT (entity_type, entity_a_id, entity_b_id, candidate_type) DO NOTHING
      RETURNING id
    `,
      [
        bid,
        entityType,
        candidateType,
        a,
        b,
        confidence,
        reason,
        JSON.stringify(sourceFields),
      ],
    );
    inserted += result.rowCount ?? 0;
  };

  // ── 1. Students: same phone ───────────────────────────────────────────────
  const samePhone = await pool.query(
    `
    SELECT source_payload->>'phone' AS phone,
           array_agg(alpha_id ORDER BY alpha_id) AS ids,
           array_agg(source_payload->>'full_name' ORDER BY alpha_id) AS names
    FROM alpha_raw_records
    WHERE entity_type='students' AND branch_id=$1
      AND source_payload->>'phone' IS NOT NULL
      AND source_payload->>'phone' != ''
    GROUP BY 1
    HAVING COUNT(*) > 1
  `,
    [bid],
  );

  for (const row of samePhone.rows as Array<{
    phone: string;
    ids: string[];
    names: string[];
  }>) {
    const ids = row.ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertDup(
          "students",
          "same_phone",
          ids[i]!,
          ids[j]!,
          0.85,
          `Same guardian phone: ${row.phone}`,
          { phone: row.phone, nameA: row.names[i], nameB: row.names[j] },
        );
      }
    }
  }

  // ── 2. Students: same name ────────────────────────────────────────────────
  const sameName = await pool.query(
    `
    SELECT lower(trim(source_payload->>'full_name')) AS norm_name,
           array_agg(alpha_id ORDER BY alpha_id) AS ids
    FROM alpha_raw_records
    WHERE entity_type='students' AND branch_id=$1
      AND source_payload->>'full_name' IS NOT NULL
    GROUP BY 1
    HAVING COUNT(*) > 1
  `,
    [bid],
  );

  for (const row of sameName.rows as Array<{
    norm_name: string;
    ids: string[];
  }>) {
    const ids = row.ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertDup(
          "students",
          "same_name",
          ids[i]!,
          ids[j]!,
          0.7,
          `Same student name: ${row.norm_name}`,
          { name: row.norm_name },
        );
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

  for (const row of sameFamilyPhone.rows as Array<{
    primary_phone: string;
    ids: string[];
  }>) {
    const ids = row.ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertDup(
          "families",
          "same_phone",
          ids[i]!,
          ids[j]!,
          0.95,
          `Same family primary phone: ${row.primary_phone}`,
          { phone: row.primary_phone },
        );
      }
    }
  }

  // ── 4. Students: same name + same guardian phone ─────────────────────────
  const sameNamePhone = await pool.query(
    `
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
  `,
    [bid],
  );

  for (const row of sameNamePhone.rows as Array<{
    norm_name: string;
    phone: string;
    ids: string[];
  }>) {
    const ids = row.ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertDup(
          "students",
          "same_name_and_phone",
          ids[i]!,
          ids[j]!,
          0.98,
          `Same name + same phone: ${row.norm_name} / ${row.phone}`,
          { name: row.norm_name, phone: row.phone },
        );
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

  for (const row of multiFamily.rows as Array<{
    student_crm_id: string;
    family_ids: string[];
  }>) {
    const ids = row.family_ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertDup(
          "families",
          "child_in_multiple_families",
          ids[i]!,
          ids[j]!,
          0.9,
          `Child ${row.student_crm_id} linked to multiple families`,
          { studentCrmId: row.student_crm_id },
        );
      }
    }
  }

  // ── 6. Same teacher full_name ─────────────────────────────────────────────
  const sameTeacher = await pool.query(
    `
    SELECT lower(trim(source_payload->>'full_name')) AS norm_name,
           array_agg(alpha_id ORDER BY alpha_id) AS ids
    FROM alpha_raw_records
    WHERE entity_type='teachers' AND branch_id=$1
      AND source_payload->>'full_name' IS NOT NULL
    GROUP BY 1
    HAVING COUNT(*) > 1
  `,
    [bid],
  );

  for (const row of sameTeacher.rows as Array<{
    norm_name: string;
    ids: string[];
  }>) {
    const ids = row.ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertDup(
          "teachers",
          "same_name",
          ids[i]!,
          ids[j]!,
          0.75,
          `Same teacher name: ${row.norm_name}`,
          { name: row.norm_name },
        );
      }
    }
  }

  return inserted;
}

// ─── P7.7 — Final AlphaCRM Audit Report ───────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/duplicates
// Also triggers detection and seeds alpha_duplicate_candidates
// ══════════════════════════════════════════════════════════════════════════════
duplicatesRouter.get("/coverage/duplicates", async (req, res) => {
  const bid = branchId(req);
  const runDetection = req.query["detect"] === "true";

  try {
    if (runDetection) {
      await runDuplicateDetection(bid);
    }

    const candidates = await sql(
      `
      SELECT id, branch_id, entity_type, candidate_type, entity_a_id, entity_b_id,
             confidence, reason, source_fields, status, created_at, resolved_at
      FROM alpha_duplicate_candidates
      WHERE branch_id = $1
      ORDER BY confidence DESC, created_at DESC
    `,
      [bid],
    );

    const summary = await sql(
      `
      SELECT entity_type, candidate_type, status, COUNT(*) AS cnt
      FROM alpha_duplicate_candidates
      WHERE branch_id = $1
      GROUP BY 1,2,3
      ORDER BY 1,2,3
    `,
      [bid],
    );

    const openByType = await sql(
      `
      SELECT entity_type, candidate_type, COUNT(*) AS cnt
      FROM alpha_duplicate_candidates
      WHERE branch_id = $1 AND status = 'open'
      GROUP BY 1,2
      ORDER BY 3 DESC
    `,
      [bid],
    );

    res.json({
      branchId: bid,
      auditType: "duplicates",
      generatedAt: new Date().toISOString(),
      detectionRun: runDetection,
      totalCandidates: candidates.length,
      openCandidates: candidates.filter(
        (c: Record<string, unknown>) => c["status"] === "open",
      ).length,
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
duplicatesRouter.post("/coverage/duplicates/detect", async (req, res) => {
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
