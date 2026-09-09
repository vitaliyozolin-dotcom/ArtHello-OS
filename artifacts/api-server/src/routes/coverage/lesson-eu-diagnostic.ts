import { Router } from "express";
import { branchId, logger, pool, sql, sqlOne } from "./shared.js";

export const lessonEuDiagnosticRouter = Router();

lessonEuDiagnosticRouter.get(
  "/coverage/lesson-eu-diagnostic",
  async (_req, res) => {
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
        eu_crm_group_ids: euIds.map((r) => r.crm_group_id),
        lesson_group_crm_ids_top50: lessonIds.map((r) => ({
          id: r.group_crm_id,
          lessons: Number(r.cnt),
        })),
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
  },
);
