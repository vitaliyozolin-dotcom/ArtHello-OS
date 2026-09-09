import { Router } from "express";
import { db, pool } from "@workspace/db";
import {
  directionsTable,
  programsTable,
  classGroupsTable,
  enrollmentsTable,
  educationalUnitsTable,
  type Direction,
  type ClassGroup,
} from "@workspace/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { logger } from "../../lib/logger.js";

export const educationalModuleRouter = Router();

// ══════════════════════════════════════════════════════════════════════════════
// DIRECTIONS
// ══════════════════════════════════════════════════════════════════════════════

educationalModuleRouter.get("/educational/directions", async (_req, res) => {
  const rows = await db
    .select()
    .from(directionsTable)
    .orderBy(directionsTable.sortOrder);
  res.json(rows);
});

educationalModuleRouter.post("/educational/directions", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    code: z.string().optional(),
    color: z.string().optional(),
    description: z.string().optional(),
    sortOrder: z.number().optional(),
  });
  const data = schema.parse(req.body);
  const [row] = await db.insert(directionsTable).values(data).returning();
  res.status(201).json(row);
});

educationalModuleRouter.patch(
  "/educational/directions/:id",
  async (req, res) => {
    const { id } = req.params;
    const schema = z.object({
      name: z.string().optional(),
      code: z.string().optional(),
      color: z.string().optional(),
      description: z.string().optional(),
      sortOrder: z.number().optional(),
      isActive: z.boolean().optional(),
    });
    const data = schema.parse(req.body);
    const [row] = await db
      .update(directionsTable)
      .set(data)
      .where(
        eq(
          directionsTable.id,
          id as `${string}-${string}-${string}-${string}-${string}`,
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  },
);

educationalModuleRouter.delete(
  "/educational/directions/:id",
  async (req, res) => {
    await db
      .delete(directionsTable)
      .where(
        eq(
          directionsTable.id,
          req.params.id as `${string}-${string}-${string}-${string}-${string}`,
        ),
      );
    res.json({ ok: true });
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// PROGRAMS
// ══════════════════════════════════════════════════════════════════════════════

educationalModuleRouter.get("/educational/programs", async (req, res) => {
  const { directionId } = req.query as Record<string, string>;
  const rows = await db
    .select()
    .from(programsTable)
    .where(
      directionId
        ? eq(
            programsTable.directionId,
            directionId as `${string}-${string}-${string}-${string}-${string}`,
          )
        : undefined,
    )
    .orderBy(programsTable.name);
  res.json(rows);
});

educationalModuleRouter.post("/educational/programs", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    directionId: z.string().uuid().optional(),
    description: z.string().optional(),
    durationMonths: z.number().optional(),
    ageFrom: z.number().optional(),
    ageTo: z.number().optional(),
    pricePerMonth: z.string().optional(),
    pricePerLesson: z.string().optional(),
    lessonsPerWeek: z.number().optional(),
  });
  const data = schema.parse(req.body);
  const [row] = await db
    .insert(programsTable)
    .values(data as typeof programsTable.$inferInsert)
    .returning();
  res.status(201).json(row);
});

educationalModuleRouter.delete(
  "/educational/programs/:id",
  async (req, res) => {
    await db
      .delete(programsTable)
      .where(
        eq(
          programsTable.id,
          req.params.id as `${string}-${string}-${string}-${string}-${string}`,
        ),
      );
    res.json({ ok: true });
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// CLASS GROUPS
// ══════════════════════════════════════════════════════════════════════════════

educationalModuleRouter.get("/educational/groups", async (req, res) => {
  const { directionId, active } = req.query as Record<string, string>;
  const where = [];
  if (directionId)
    where.push(
      eq(
        classGroupsTable.directionId,
        directionId as `${string}-${string}-${string}-${string}-${string}`,
      ),
    );
  if (active === "true") where.push(eq(classGroupsTable.isActive, true));

  const groups = await db
    .select()
    .from(classGroupsTable)
    .where(where.length ? and(...where) : undefined)
    .orderBy(classGroupsTable.name);

  const dirs = await db.select().from(directionsTable);
  const dirMap = Object.fromEntries(dirs.map((d: Direction) => [d.id, d]));

  const result = groups.map((g: ClassGroup) => ({
    ...g,
    directionName: g.directionId ? (dirMap[g.directionId]?.name ?? null) : null,
    directionColor: g.directionId
      ? (dirMap[g.directionId]?.color ?? null)
      : null,
  }));

  res.json(result);
});

educationalModuleRouter.post("/educational/groups", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    directionId: z.string().uuid().optional(),
    programId: z.string().uuid().optional(),
    branchCrmId: z.string().optional(),
    teacherCrmId: z.string().optional(),
    level: z.string().optional(),
    maxStudents: z.number().optional(),
    scheduleInfo: z.string().optional(),
    monthlyRevenue: z.string().optional(),
    isTestData: z.boolean().optional(),
  });
  const data = schema.parse(req.body);
  const [row] = await db
    .insert(classGroupsTable)
    .values(data as typeof classGroupsTable.$inferInsert)
    .returning();
  res.status(201).json(row);
});

educationalModuleRouter.patch("/educational/groups/:id", async (req, res) => {
  const { id } = req.params;
  const schema = z.object({
    name: z.string().optional(),
    directionId: z.string().uuid().optional(),
    programId: z.string().uuid().optional(),
    branchCrmId: z.string().optional(),
    teacherCrmId: z.string().optional(),
    level: z.string().optional(),
    maxStudents: z.number().optional(),
    currentStudents: z.number().optional(),
    scheduleInfo: z.string().optional(),
    monthlyRevenue: z.string().optional(),
    isActive: z.boolean().optional(),
  });
  const data = schema.parse(req.body);
  const [row] = await db
    .update(classGroupsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(
      eq(
        classGroupsTable.id,
        id as `${string}-${string}-${string}-${string}-${string}`,
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

educationalModuleRouter.delete("/educational/groups/:id", async (req, res) => {
  await db
    .delete(classGroupsTable)
    .where(
      eq(
        classGroupsTable.id,
        req.params.id as `${string}-${string}-${string}-${string}-${string}`,
      ),
    );
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// ENROLLMENTS
// ══════════════════════════════════════════════════════════════════════════════

educationalModuleRouter.get("/educational/enrollments", async (req, res) => {
  const { groupId, studentCrmId } = req.query as Record<string, string>;
  const where = [];
  if (groupId)
    where.push(
      eq(
        enrollmentsTable.classGroupId,
        groupId as `${string}-${string}-${string}-${string}-${string}`,
      ),
    );
  if (studentCrmId) where.push(eq(enrollmentsTable.studentCrmId, studentCrmId));

  const rows = await db
    .select()
    .from(enrollmentsTable)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(enrollmentsTable.enrolledAt));
  res.json(rows);
});

educationalModuleRouter.post("/educational/enrollments", async (req, res) => {
  const schema = z.object({
    studentCrmId: z.string(),
    classGroupId: z.string().uuid(),
    enrolledAt: z.string(),
    contractId: z.string().uuid().optional(),
    notes: z.string().optional(),
  });
  const data = schema.parse(req.body);
  const [row] = await db
    .insert(enrollmentsTable)
    .values(data as typeof enrollmentsTable.$inferInsert)
    .returning();
  await db.execute(sql`
    UPDATE class_groups SET current_students = (
      SELECT count(*) FROM enrollments
      WHERE class_group_id = ${data.classGroupId} AND status = 'active'
    ) WHERE id = ${data.classGroupId}
  `);
  res.status(201).json(row);
});

// ══════════════════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════════════════

educationalModuleRouter.get("/educational/stats", async (_req, res) => {
  const [dirs, groups, enrollments] = await Promise.all([
    db.select().from(directionsTable),
    db.select().from(classGroupsTable),
    db
      .select()
      .from(enrollmentsTable)
      .where(eq(enrollmentsTable.status, "active")),
  ]);

  const activeGroups = groups.filter((g: ClassGroup) => g.isActive);
  const totalRevenue = activeGroups.reduce(
    (s: number, g: ClassGroup) => s + parseFloat(g.monthlyRevenue ?? "0"),
    0,
  );

  res.json({
    totalDirections: dirs.length,
    activeDirections: dirs.filter((d: Direction) => d.isActive).length,
    totalGroups: groups.length,
    activeGroups: activeGroups.length,
    totalEnrollments: enrollments.length,
    totalMonthlyRevenue: totalRevenue,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P9.4.1 — EDUCATIONAL UNITS CLASSIFICATION
// ══════════════════════════════════════════════════════════════════════════════

// ── Classification rules (P9.4.1A — corrected) ───────────────────────────────
//
// KINDERGARTEN: name must start with one or more Atlas country-names, followed
//   only by an optional season/year suffix.  Substring matching caused false
//   positives ("Китайский язык", "Английский 5-6").
//
// SCHOOL: name must START WITH the class designation ("1-й класс …").
//   "Лёгкая атлетика 1-2 класс" begins with a subject word → club.
//
// All other "ЛЕТО/лагерь" groups that did not match kindergarten → summer_group.

const KINDERGARTEN_COUNTRIES =
  "Германия|Италия|Бразилия|Англия|Китай|Испания|Франция";

// Matches: "Германия 2025-2026", "Китай ЛЕТО", "Испания+Германия ЛЕТО",
//          "Бразилия 20256-2026" (typo), "Англия  2025-2026" (extra space)
const KINDERGARTEN_REGEX = new RegExp(
  `^(${KINDERGARTEN_COUNTRIES})` +
    `(\\s*\\+\\s*(${KINDERGARTEN_COUNTRIES}))*` +
    `\\s*(ЛЕТО|\\d{4,5}[-–]\\d{4})?\\s*$`,
  "i",
);

// School: name starts with ordinal-class token followed by space or end-of-string.
// NOTE: \b does NOT work with Cyrillic — use (?=\s|$) instead.
const SCHOOL_REGEX = /^(\d-й класс|\d класс)(?=\s|$)/i;

function classifyGroup(name: string): {
  educationalUnitType: string;
  department: string;
  attributionModel: string;
  revenueModel: string;
  classificationStatus: string;
  classificationReason: string;
} {
  const trimmed = name.trim();
  const lo = trimmed.toLowerCase();

  // ── 1. Детский сад (exact country-name pattern) ───────────────────────────
  if (KINDERGARTEN_REGEX.test(trimmed)) {
    return {
      educationalUnitType: "kindergarten_group",
      department: "Детский сад",
      attributionModel: "group_based",
      revenueModel: "monthly_contract",
      classificationStatus: "classified",
      classificationReason:
        "Kindergarten group — name matches Atlas country-group pattern",
    };
  }

  // ── 2. Школа (name STARTS WITH class token) ───────────────────────────────
  if (SCHOOL_REGEX.test(trimmed)) {
    return {
      educationalUnitType: "school_class",
      department: "Школа",
      attributionModel: "group_based",
      revenueModel: "monthly_contract",
      classificationStatus: "classified",
      classificationReason: "School class — name begins with class designation",
    };
  }

  // ── 3. ЛЕТО / Лагерь (after kindergarten check so country+ЛЕТО → kindergarten) ──
  if (
    lo.includes("лагерь") ||
    (lo.includes("лето") && !KINDERGARTEN_REGEX.test(trimmed))
  ) {
    return {
      educationalUnitType: "summer_group",
      department: "Дополнительные услуги",
      attributionModel: "mixed",
      revenueModel: "monthly_contract",
      classificationStatus: "needs_review",
      classificationReason: "Summer/camp group requires manual review",
    };
  }

  // ── 4. Служебные группы ───────────────────────────────────────────────────
  const serviceKeywords = ["взнос", "экипировк", "спочан"];
  if (serviceKeywords.some((k) => lo.includes(k))) {
    return {
      educationalUnitType: "service_group",
      department: "Дополнительные услуги",
      attributionModel: "none",
      revenueModel: "one_time",
      classificationStatus: "classified",
      classificationReason:
        "Service/fee group (membership fee, equipment, etc.)",
    };
  }

  // ── 5. Мастер-классы ──────────────────────────────────────────────────────
  if (
    lo.includes("мастер") ||
    lo.includes("workshop") ||
    lo.includes("разовое")
  ) {
    return {
      educationalUnitType: "master_class_group",
      department: "Дополнительные услуги",
      attributionModel: "lesson_based",
      revenueModel: "one_time",
      classificationStatus: "classified",
      classificationReason: "Master class / one-time group",
    };
  }

  // ── 6. Клубные занятия (default) ──────────────────────────────────────────
  return {
    educationalUnitType: "club_subscription_group",
    department: "Клубные занятия",
    attributionModel: "lesson_based",
    revenueModel: "subscription",
    classificationStatus: "classified",
    classificationReason: "Regular club group (default classification)",
  };
}

// ─── POST /api/educational-units/classify-from-crm-groups ────────────────────
// Idempotent: upserts educational_units from crm_groups.
// Also auto-updates employees.attribution_model based on employee_type.

educationalModuleRouter.post(
  "/educational-units/classify-from-crm-groups",
  async (req, res): Promise<void> => {
    try {
      const BRANCH_ID = "6";

      // 1. Load all Atlas groups from crm_groups
      const groupsResult = await pool.query<{
        crm_id: string;
        name: string;
        lifecycle_status: string;
      }>(
        `SELECT crm_id, name, lifecycle_status FROM crm_groups WHERE branch_crm_id = $1 ORDER BY crm_id`,
        [BRANCH_ID],
      );
      const groups = groupsResult.rows;

      let created = 0;
      let updated = 0;
      let errors = 0;
      const counts: Record<string, number> = {
        kindergarten_group: 0,
        school_class: 0,
        club_subscription_group: 0,
        summer_group: 0,
        master_class_group: 0,
        service_group: 0,
        unknown: 0,
      };
      let needsReview = 0;
      const examples: Array<{
        crm_id: string;
        name: string;
        educational_unit_type: string;
        department: string;
        attribution_model: string;
      }> = [];

      for (const g of groups) {
        try {
          const cls = g.name
            ? classifyGroup(g.name)
            : {
                educationalUnitType: "unknown",
                department: "Не определено",
                attributionModel: "none",
                revenueModel: "unknown",
                classificationStatus: "needs_review",
                classificationReason: "Group has no name",
              };

          const isActive = g.lifecycle_status !== "archived";

          const r = await pool.query<{ inserted: boolean }>(
            `INSERT INTO educational_units
               (crm_group_id, name, educational_unit_type, department, attribution_model,
                revenue_model, is_active, classification_status, classification_reason,
                created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
             ON CONFLICT (crm_group_id) DO UPDATE SET
               name                  = EXCLUDED.name,
               educational_unit_type = EXCLUDED.educational_unit_type,
               department            = EXCLUDED.department,
               attribution_model     = EXCLUDED.attribution_model,
               revenue_model         = EXCLUDED.revenue_model,
               is_active             = EXCLUDED.is_active,
               classification_status = EXCLUDED.classification_status,
               classification_reason = EXCLUDED.classification_reason,
               updated_at            = NOW()
             WHERE educational_units.classification_status != 'manual_override'
             RETURNING (xmax = 0) AS inserted`,
            [
              g.crm_id,
              g.name,
              cls.educationalUnitType,
              cls.department,
              cls.attributionModel,
              cls.revenueModel,
              isActive,
              cls.classificationStatus,
              cls.classificationReason,
            ],
          );

          if (r.rows[0]?.inserted) created++;
          else updated++;
          counts[cls.educationalUnitType] =
            (counts[cls.educationalUnitType] ?? 0) + 1;
          if (cls.classificationStatus === "needs_review") needsReview++;
          if (examples.length < 10) {
            examples.push({
              crm_id: g.crm_id,
              name: g.name,
              educational_unit_type: cls.educationalUnitType,
              department: cls.department,
              attribution_model: cls.attributionModel,
            });
          }
        } catch (rowErr) {
          errors++;
          logger.error(
            { rowErr, crm_id: g.crm_id },
            "educational-units: classify row failed",
          );
        }
      }

      // 2. Auto-update employees.attribution_model based on employee_type
      // Rule: only update if attribution_model IS NULL (don't overwrite manual choices)
      await pool.query(`
        UPDATE employees SET
          attribution_model = CASE
            WHEN employee_type IN ('educator', 'assistant_educator', 'curator')
              THEN 'group_based'
            WHEN employee_type = 'teacher'
              THEN 'lesson_based'
            ELSE 'unknown'
          END,
          updated_at = NOW()
        WHERE attribution_model IS NULL
          AND employee_type IS NOT NULL
          AND employee_type NOT IN ('administrator', 'sales_manager', 'manager',
                                    'kitchen', 'cleaner', 'methodologist', 'contractor', 'other')
      `);

      const msg = `P9.4.1: Classified ${groups.length} groups → educational_units (${created} created, ${updated} updated, ${errors} errors)`;
      logger.info({ ...counts, needsReview }, msg);

      res.json({
        success: true,
        message: msg,
        processed: groups.length,
        created,
        updated,
        errors,
        kindergarten_groups: counts.kindergarten_group,
        school_classes: counts.school_class,
        club_subscription_groups: counts.club_subscription_group,
        summer_groups: counts.summer_group,
        master_class_groups: counts.master_class_group,
        service_groups: counts.service_group,
        unknown: counts.unknown,
        needs_review: needsReview,
        examples,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { err },
        "educational-units/classify-from-crm-groups: failed",
      );
      res.status(500).json({ success: false, message });
    }
  },
);

// ─── GET /api/educational-units/group-based-metrics ──────────────────────────
// Returns group_based educational units with attendance + student metrics.
// month=YYYY-MM (optional — filters crm_lessons by lesson_date)

educationalModuleRouter.get(
  "/educational-units/group-based-metrics",
  async (req, res): Promise<void> => {
    try {
      const { month } = req.query as Record<string, string>;

      const monthFilter = month
        ? `AND DATE_TRUNC('month', l.lesson_date) = DATE_TRUNC('month', $2::date)`
        : "";
      const params: string[] = ["group_based"];
      if (month) params.push(`${month}-01`);

      const rows = await pool.query<{
        eu_id: string;
        crm_group_id: string;
        name: string;
        educational_unit_type: string;
        department: string;
        revenue_model: string;
        classification_status: string;
        teacher_crm_ids: unknown;
        lessons_count: string;
        attendance_present: string;
        attendance_excused: string;
        attendance_unexcused: string;
        attendance_total: string;
        active_children: string;
      }>(
        `
        SELECT
          eu.id                                                   AS eu_id,
          eu.crm_group_id,
          eu.name,
          eu.educational_unit_type,
          eu.department,
          eu.revenue_model,
          eu.classification_status,
          g.teacher_crm_ids,
          COUNT(DISTINCT l.crm_id)                               AS lessons_count,
          COUNT(a.id) FILTER (WHERE a.status = '1')              AS attendance_present,
          COUNT(a.id) FILTER (WHERE a.status = '2')              AS attendance_excused,
          COUNT(a.id) FILTER (WHERE a.status = '3')              AS attendance_unexcused,
          COUNT(a.id)                                            AS attendance_total,
          COUNT(DISTINCT a.student_crm_id)                       AS active_children
        FROM educational_units eu
        JOIN crm_groups g ON g.crm_id = eu.crm_group_id
        LEFT JOIN crm_lessons l
          ON l.group_crm_id = eu.crm_group_id
          AND l.branch_crm_id = '6'
          ${monthFilter}
        LEFT JOIN crm_attendance a ON a.lesson_crm_id = l.crm_id
        WHERE eu.attribution_model = $1
          AND eu.is_active = true
        GROUP BY eu.id, eu.crm_group_id, eu.name, eu.educational_unit_type,
                 eu.department, eu.revenue_model, eu.classification_status, g.teacher_crm_ids
        ORDER BY eu.educational_unit_type, lessons_count DESC
        `,
        params,
      );

      const result = rows.rows.map((r) => ({
        educational_unit_id: r.eu_id,
        crm_group_id: r.crm_group_id,
        name: r.name,
        educational_unit_type: r.educational_unit_type,
        department: r.department,
        revenue_model: r.revenue_model,
        classification_status: r.classification_status,
        teacher_crm_ids: r.teacher_crm_ids ?? [],
        plan_children: null, // placeholder — contract data not yet available
        active_children_count: Number(r.active_children),
        attendance_present_count: Number(r.attendance_present),
        attendance_excused_count: Number(r.attendance_excused),
        attendance_unexcused_count: Number(r.attendance_unexcused),
        attendance_total_count: Number(r.attendance_total),
        lessons_count: Number(r.lessons_count),
        revenue_sum: null, // placeholder — P8.5 reconciliation not complete
        revenue_status: "unavailable" as const,
        warnings: [
          r.educational_unit_type === "kindergarten_group" ||
          r.educational_unit_type === "school_class"
            ? "⚠️ Уважительный пропуск НЕ уменьшает monthly_contract revenue автоматически"
            : null,
          "ℹ️ revenue_sum недоступна до P8.5 (bank reconciliation not complete)",
        ].filter(Boolean),
      }));

      res.json({
        month: month ?? "all",
        total: result.length,
        attribution_model: "group_based",
        units: result,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "educational-units/group-based-metrics: failed");
      res.status(500).json({ success: false, message });
    }
  },
);

// ─── GET /api/educational-units/lesson-based-metrics ─────────────────────────
// Returns lesson_based educational units + individual lesson metrics.
// month=YYYY-MM (optional)

educationalModuleRouter.get(
  "/educational-units/lesson-based-metrics",
  async (req, res): Promise<void> => {
    try {
      const { month } = req.query as Record<string, string>;

      const monthFilter = month
        ? `AND DATE_TRUNC('month', l.lesson_date) = DATE_TRUNC('month', $1::date)`
        : "";
      const params: string[] = [];
      if (month) params.push(`${month}-01`);

      // ── Group-based lesson metrics (club groups etc.) ─────────────────────
      const groupRows = await pool.query<{
        eu_id: string;
        crm_group_id: string;
        name: string;
        educational_unit_type: string;
        department: string;
        revenue_model: string;
        lessons_count: string;
        attendance_count: string;
        unique_students: string;
        teacher_crm_ids: unknown;
      }>(
        `
        SELECT
          eu.id                                 AS eu_id,
          eu.crm_group_id,
          eu.name,
          eu.educational_unit_type,
          eu.department,
          eu.revenue_model,
          COUNT(DISTINCT l.crm_id)              AS lessons_count,
          COUNT(a.id) FILTER (WHERE a.status = '1') AS attendance_count,
          COUNT(DISTINCT a.student_crm_id)      AS unique_students,
          g.teacher_crm_ids
        FROM educational_units eu
        JOIN crm_groups g ON g.crm_id = eu.crm_group_id
        LEFT JOIN crm_lessons l
          ON l.group_crm_id = eu.crm_group_id
          AND l.branch_crm_id = '6'
          ${monthFilter}
        LEFT JOIN crm_attendance a ON a.lesson_crm_id = l.crm_id
        WHERE eu.attribution_model IN ('lesson_based', 'mixed')
          AND eu.is_active = true
        GROUP BY eu.id, eu.crm_group_id, eu.name, eu.educational_unit_type,
                 eu.department, eu.revenue_model, g.teacher_crm_ids
        ORDER BY eu.educational_unit_type, lessons_count DESC
        `,
        params,
      );

      // ── Individual / one-time lesson metrics (no group_crm_id) ───────────
      const individualFilter = month
        ? `AND DATE_TRUNC('month', l.lesson_date) = DATE_TRUNC('month', $1::date)`
        : "";
      const indivRows = await pool.query<{
        lesson_type_name: string;
        lessons_count: string;
        attendance_count: string;
        unique_students: string;
        teacher_count: string;
      }>(
        `
        SELECT
          COALESCE(l.lesson_type_name, 'Индивидуальный') AS lesson_type_name,
          COUNT(DISTINCT l.crm_id)              AS lessons_count,
          COUNT(a.id) FILTER (WHERE a.status = '1') AS attendance_count,
          COUNT(DISTINCT a.student_crm_id)      AS unique_students,
          COUNT(DISTINCT l.teacher_crm_id)      AS teacher_count
        FROM crm_lessons l
        LEFT JOIN crm_attendance a ON a.lesson_crm_id = l.crm_id
        WHERE l.branch_crm_id = '6'
          AND l.group_crm_id IS NULL
          ${individualFilter}
        GROUP BY COALESCE(l.lesson_type_name, 'Индивидуальный')
        ORDER BY lessons_count DESC
        `,
        params,
      );

      res.json({
        month: month ?? "all",
        attribution_model: "lesson_based",
        groups: {
          total: groupRows.rows.length,
          units: groupRows.rows.map((r) => ({
            educational_unit_id: r.eu_id,
            crm_group_id: r.crm_group_id,
            name: r.name,
            educational_unit_type: r.educational_unit_type,
            department: r.department,
            revenue_model: r.revenue_model,
            lessons_count: Number(r.lessons_count),
            attendance_count: Number(r.attendance_count),
            unique_students_count: Number(r.unique_students),
            teacher_crm_ids: r.teacher_crm_ids ?? [],
            revenue_sum: null,
            realization_status: "unavailable",
            warnings: ["ℹ️ revenue_sum недоступна до P8.5"],
          })),
        },
        individual: {
          total_ungrouped_lessons: indivRows.rows.reduce(
            (s, r) => s + Number(r.lessons_count),
            0,
          ),
          by_type: indivRows.rows.map((r) => ({
            lesson_type_name: r.lesson_type_name,
            lessons_count: Number(r.lessons_count),
            attendance_count: Number(r.attendance_count),
            unique_students_count: Number(r.unique_students),
            teacher_count: Number(r.teacher_count),
            revenue_sum: null,
            realization_status: "unavailable",
          })),
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "educational-units/lesson-based-metrics: failed");
      res.status(500).json({ success: false, message });
    }
  },
);

// ─── POST /api/educational-units/reclassify ───────────────────────────────────
// Safe re-classification: applies updated classifyGroup() rules to all records
// EXCEPT those with classification_status = 'manual_override'.

educationalModuleRouter.post(
  "/educational-units/reclassify",
  async (req, res): Promise<void> => {
    try {
      const existing = await pool.query<{
        id: string;
        crm_group_id: string;
        name: string;
        classification_status: string;
      }>(
        `SELECT id, crm_group_id, name, classification_status
         FROM educational_units
         ORDER BY crm_group_id`,
      );

      let updated = 0;
      let skipped_manual = 0;
      let errors = 0;
      const counts: Record<string, number> = {};
      const changed: Array<{
        crm_group_id: string;
        name: string;
        old_type: string;
        new_type: string;
      }> = [];

      // Pre-load current types so we can detect changes without a double query
      const currentTypes = await pool.query<{
        id: string;
        educational_unit_type: string;
      }>(`SELECT id, educational_unit_type FROM educational_units`);
      const typeByIdMap = new Map(
        currentTypes.rows.map((r) => [r.id, r.educational_unit_type]),
      );

      for (const row of existing.rows) {
        if (row.classification_status === "manual_override") {
          skipped_manual++;
          continue;
        }

        try {
          const cls = row.name
            ? classifyGroup(row.name)
            : {
                educationalUnitType: "unknown",
                department: "Не определено",
                attributionModel: "none",
                revenueModel: "unknown",
                classificationStatus: "needs_review",
                classificationReason: "Group has no name",
              };

          await pool.query(
            `UPDATE educational_units
             SET educational_unit_type = $1,
                 department            = $2,
                 attribution_model     = $3,
                 revenue_model         = $4,
                 classification_status = $5,
                 classification_reason = $6,
                 updated_at            = NOW()
             WHERE id = $7`,
            [
              cls.educationalUnitType,
              cls.department,
              cls.attributionModel,
              cls.revenueModel,
              cls.classificationStatus,
              cls.classificationReason,
              row.id,
            ],
          );

          updated++;
          counts[cls.educationalUnitType] =
            (counts[cls.educationalUnitType] ?? 0) + 1;

          const oldType = typeByIdMap.get(row.id);
          if (oldType && oldType !== cls.educationalUnitType) {
            changed.push({
              crm_group_id: row.crm_group_id,
              name: row.name,
              old_type: oldType,
              new_type: cls.educationalUnitType,
            });
          }
        } catch (rowErr) {
          errors++;
          logger.error({ rowErr, id: row.id }, "reclassify: row failed");
        }
      }

      // Pull final state for audit
      const auditResult = await pool.query<{
        educational_unit_type: string;
        crm_group_id: string;
        name: string;
        classification_status: string;
      }>(
        `SELECT educational_unit_type, crm_group_id, name, classification_status
         FROM educational_units
         ORDER BY educational_unit_type, name`,
      );

      const byType: Record<
        string,
        Array<{
          crm_group_id: string;
          name: string;
          classification_status: string;
        }>
      > = {};
      for (const r of auditResult.rows) {
        if (!byType[r.educational_unit_type])
          byType[r.educational_unit_type] = [];
        byType[r.educational_unit_type]!.push({
          crm_group_id: r.crm_group_id,
          name: r.name,
          classification_status: r.classification_status,
        });
      }

      const verifyNames = [
        "Китайский язык",
        "Английский 5-6",
        "Легкая атлетика 1-2 класс",
        "Лёгкая атлетика 1-2 класс",
      ];
      const verification = await pool.query<{
        crm_group_id: string;
        name: string;
        educational_unit_type: string;
        classification_status: string;
      }>(
        `SELECT crm_group_id, name, educational_unit_type, classification_status
         FROM educational_units
         WHERE name = ANY($1)`,
        [verifyNames],
      );

      const msg = `P9.4.1A: Reclassified ${updated} units (${skipped_manual} manual overrides preserved, ${errors} errors)`;
      logger.info({ counts, changed: changed.length }, msg);

      res.json({
        success: true,
        message: msg,
        updated,
        skipped_manual_overrides: skipped_manual,
        errors,
        type_counts: counts,
        changed_classifications: changed,
        audit: {
          kindergarten_count: (byType["kindergarten_group"] ?? []).length,
          school_class_count: (byType["school_class"] ?? []).length,
          club_count: (byType["club_subscription_group"] ?? []).length,
          summer_count: (byType["summer_group"] ?? []).length,
          service_count: (byType["service_group"] ?? []).length,
          master_class_count: (byType["master_class_group"] ?? []).length,
          kindergarten_groups: byType["kindergarten_group"] ?? [],
          school_classes: byType["school_class"] ?? [],
        },
        verification: verification.rows,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "educational-units/reclassify: failed");
      res.status(500).json({ success: false, message });
    }
  },
);

// ─── PATCH /api/educational-units/:id ────────────────────────────────────────
// Manual override — sets classification_status = 'manual_override' so that
// subsequent calls to classify-from-crm-groups or reclassify will skip this record.

const PatchEducationalUnitSchema = z.object({
  educational_unit_type: z.string().optional(),
  department: z.string().optional(),
  attribution_model: z.string().optional(),
  revenue_model: z.string().optional(),
  classification_reason: z.string().optional(),
});

educationalModuleRouter.patch(
  "/educational-units/:id",
  async (req, res): Promise<void> => {
    try {
      const { id } = req.params;
      const body = PatchEducationalUnitSchema.parse(req.body);

      if (Object.keys(body).length === 0) {
        res
          .status(400)
          .json({ success: false, message: "No fields to update" });
        return;
      }

      const setClauses: string[] = [
        "classification_status = 'manual_override'",
        "updated_at = NOW()",
      ];
      const values: unknown[] = [];

      if (body.educational_unit_type !== undefined) {
        values.push(body.educational_unit_type);
        setClauses.push(`educational_unit_type = $${values.length}`);
      }
      if (body.department !== undefined) {
        values.push(body.department);
        setClauses.push(`department = $${values.length}`);
      }
      if (body.attribution_model !== undefined) {
        values.push(body.attribution_model);
        setClauses.push(`attribution_model = $${values.length}`);
      }
      if (body.revenue_model !== undefined) {
        values.push(body.revenue_model);
        setClauses.push(`revenue_model = $${values.length}`);
      }
      if (body.classification_reason !== undefined) {
        values.push(body.classification_reason);
        setClauses.push(`classification_reason = $${values.length}`);
      }

      values.push(id);
      const idParam = `$${values.length}`;

      const result = await pool.query<{
        id: string;
        crm_group_id: string;
        name: string;
        educational_unit_type: string;
        department: string;
        attribution_model: string;
        revenue_model: string;
        classification_status: string;
        classification_reason: string;
      }>(
        `UPDATE educational_units
         SET ${setClauses.join(", ")}
         WHERE id = ${idParam}
         RETURNING id, crm_group_id, name, educational_unit_type, department,
                   attribution_model, revenue_model, classification_status, classification_reason`,
        values,
      );

      if (result.rows.length === 0) {
        res
          .status(404)
          .json({ success: false, message: "Educational unit not found" });
        return;
      }

      const updated = result.rows[0]!;
      logger.info(
        { id, changes: body },
        "educational-unit: manual override applied",
      );

      res.json({
        success: true,
        message: `Manual override applied — this record will be preserved through future reclassifications`,
        unit: updated,
      });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          errors: err.issues,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "educational-units PATCH: failed");
      res.status(500).json({ success: false, message });
    }
  },
);

// ─── GET /educational-units/responsibility-audit ──────────────────────────────
// P9.4.3 — Read-only audit: who is responsible for each educational unit?
// Derives primary candidate from lesson coverage over the last 12 months.
// No financial data is computed here.

educationalModuleRouter.get(
  "/educational-units/responsibility-audit",
  async (req, res) => {
    try {
      const BRANCH_ID = "6";
      const LOOKBACK = "12 months";
      // Threshold for "close second" → needs_review
      const REVIEW_GAP_PCT = 15;

      // ── 1. All active educational units ────────────────────────────────────────
      const allUnitsResult = await pool.query<{
        id: string;
        crm_group_id: string | null;
        name: string;
        educational_unit_type: string;
        department: string | null;
        attribution_model: string | null;
      }>(
        `SELECT id, crm_group_id, name, educational_unit_type, department, attribution_model
       FROM educational_units
       WHERE is_active = true
       ORDER BY educational_unit_type, name`,
      );

      // ── 2. Per-employee × per-group lesson + attendance counts (last 12 months) ─
      type CandidateRow = {
        educational_unit_id: string;
        employee_id: string;
        full_name: string;
        employee_type: string | null;
        teacher_crm_id: string;
        lessons_taught: string;
        attendance_count: string;
        total_group_lessons: string;
        coverage_pct: string;
      };

      const statsResult = await pool.query<CandidateRow>(
        `WITH lesson_cte AS (
         SELECT crm_id, group_crm_id, teacher_crm_id
         FROM crm_lessons
         WHERE branch_crm_id = $1
           AND lesson_date >= NOW() - INTERVAL '${LOOKBACK}'
       ),
       lesson_stats AS (
         SELECT
           eu.id                              AS educational_unit_id,
           e.id                               AS employee_id,
           e.full_name,
           e.employee_type,
           e.teacher_crm_id,
           COUNT(DISTINCT lc.crm_id)          AS lessons_taught,
           COUNT(ca.id)                       AS attendance_count
         FROM educational_units eu
         JOIN lesson_cte lc ON lc.group_crm_id = eu.crm_group_id
         JOIN employees e ON e.teacher_crm_id = lc.teacher_crm_id
         LEFT JOIN crm_attendance ca ON ca.lesson_crm_id = lc.crm_id
         WHERE eu.is_active = true AND eu.crm_group_id IS NOT NULL
           AND e.exclude_from_staff_analytics = false
         GROUP BY eu.id, e.id, e.full_name, e.employee_type, e.teacher_crm_id
       ),
       group_totals AS (
         SELECT educational_unit_id, SUM(lessons_taught) AS total_lessons
         FROM lesson_stats GROUP BY educational_unit_id
       )
       SELECT
         ls.*,
         gt.total_lessons::text                                    AS total_group_lessons,
         ROUND(ls.lessons_taught * 100.0 / NULLIF(gt.total_lessons, 0), 1)::text AS coverage_pct
       FROM lesson_stats ls
       JOIN group_totals gt ON gt.educational_unit_id = ls.educational_unit_id
       ORDER BY ls.educational_unit_id, ls.lessons_taught DESC`,
        [BRANCH_ID],
      );

      // ── 3. Group candidates by unit ────────────────────────────────────────────
      type Candidate = {
        employee_id: string;
        full_name: string;
        employee_type: string | null;
        lessons_taught: number;
        attendance_count: number;
        coverage_pct: number;
      };

      const byUnit = new Map<string, Candidate[]>();
      for (const r of statsResult.rows) {
        if (!byUnit.has(r.educational_unit_id))
          byUnit.set(r.educational_unit_id, []);
        byUnit.get(r.educational_unit_id)!.push({
          employee_id: r.employee_id,
          full_name: r.full_name,
          employee_type: r.employee_type,
          lessons_taught: Number(r.lessons_taught),
          attendance_count: Number(r.attendance_count),
          coverage_pct: Number(r.coverage_pct),
        });
      }

      // ── 4. Build per-unit responsibility result ────────────────────────────────
      type UnitResult = {
        educational_unit_id: string;
        crm_group_id: string | null;
        name: string;
        educational_unit_type: string;
        department: string | null;
        linked_employees_count: number;
        primary_responsible_employee: string | null;
        primary_responsible_employee_id: string | null;
        responsibility_confidence: string;
        needs_review: boolean;
        primary_lessons_count: number;
        primary_coverage_pct: number;
        total_group_lessons: number;
        primary_attendance_count: number;
        all_candidates: Candidate[];
      };

      const results: UnitResult[] = [];

      for (const unit of allUnitsResult.rows) {
        const candidates = byUnit.get(unit.id) ?? [];
        const primary = candidates[0];
        const second = candidates[1];

        let confidence: string;
        let needsReview = false;

        if (!primary) {
          confidence = "no_data";
        } else {
          const cov = primary.coverage_pct;
          if (cov >= 60) confidence = "high";
          else if (cov >= 30) confidence = "medium";
          else confidence = "low";

          if (second) {
            const gap = primary.coverage_pct - second.coverage_pct;
            if (gap <= REVIEW_GAP_PCT && second.coverage_pct >= 20)
              needsReview = true;
          }
        }

        const totalLessons = candidates.reduce(
          (s, c) => s + c.lessons_taught,
          0,
        );

        results.push({
          educational_unit_id: unit.id,
          crm_group_id: unit.crm_group_id,
          name: unit.name,
          educational_unit_type: unit.educational_unit_type,
          department: unit.department,
          linked_employees_count: candidates.length,
          primary_responsible_employee: primary?.full_name ?? null,
          primary_responsible_employee_id: primary?.employee_id ?? null,
          responsibility_confidence: confidence,
          needs_review: needsReview,
          primary_lessons_count: primary?.lessons_taught ?? 0,
          primary_coverage_pct: primary?.coverage_pct ?? 0,
          total_group_lessons: totalLessons,
          primary_attendance_count: primary?.attendance_count ?? 0,
          all_candidates: candidates,
        });
      }

      // ── 5. Summary counts ──────────────────────────────────────────────────────
      const summary = {
        total_units: results.length,
        kindergarten: results.filter(
          (u) => u.educational_unit_type === "kindergarten_group",
        ).length,
        school: results.filter(
          (u) => u.educational_unit_type === "school_class",
        ).length,
        club: results.filter((u) => u.educational_unit_type.startsWith("club"))
          .length,
        other: results.filter(
          (u) =>
            u.educational_unit_type !== "kindergarten_group" &&
            u.educational_unit_type !== "school_class" &&
            !u.educational_unit_type.startsWith("club"),
        ).length,
        with_high_confidence: results.filter(
          (u) => u.responsibility_confidence === "high",
        ).length,
        with_medium_confidence: results.filter(
          (u) => u.responsibility_confidence === "medium",
        ).length,
        with_low_confidence: results.filter(
          (u) => u.responsibility_confidence === "low",
        ).length,
        needs_review: results.filter((u) => u.needs_review).length,
        no_data: results.filter(
          (u) => u.responsibility_confidence === "no_data",
        ).length,
      };

      // ── 6. Sub-sections ────────────────────────────────────────────────────────
      const kindergarten = results
        .filter((u) => u.educational_unit_type === "kindergarten_group")
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));

      const school = results
        .filter((u) => u.educational_unit_type === "school_class")
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));

      const clubTop30 = results
        .filter((u) => u.educational_unit_type.startsWith("club"))
        .sort((a, b) => b.total_group_lessons - a.total_group_lessons)
        .slice(0, 30);

      // Top 20 responsibility assignments (by primary lessons count)
      const top20 = results
        .filter((u) => u.primary_responsible_employee)
        .sort((a, b) => b.primary_lessons_count - a.primary_lessons_count)
        .slice(0, 20)
        .map((u) => ({
          name: u.name,
          type: u.educational_unit_type,
          responsible: u.primary_responsible_employee,
          lessons: u.primary_lessons_count,
          coverage: u.primary_coverage_pct,
          confidence: u.responsibility_confidence,
          review: u.needs_review,
        }));

      // ── 7. Employee responsibility summary ─────────────────────────────────────
      // Fetch attribution_model for employees
      const empAttrResult = await pool.query<{
        id: string;
        attribution_model: string | null;
      }>(
        `SELECT id, attribution_model FROM employees WHERE exclude_from_staff_analytics = false`,
      );
      const empAttrMap = new Map(
        empAttrResult.rows.map((r) => [r.id, r.attribution_model]),
      );

      type EmpSummary = {
        employee_id: string;
        full_name: string;
        employee_type: string | null;
        attribution_model: string | null;
        primary_units_count: number;
        secondary_units_count: number;
        primary_units: {
          id: string;
          name: string;
          type: string;
          confidence: string;
        }[];
        secondary_units: { id: string; name: string; type: string }[];
      };

      const empSummaryMap = new Map<string, EmpSummary>();

      for (const unit of results) {
        // Primary employee
        if (unit.primary_responsible_employee_id) {
          const eid = unit.primary_responsible_employee_id;
          if (!empSummaryMap.has(eid)) {
            empSummaryMap.set(eid, {
              employee_id: eid,
              full_name: unit.primary_responsible_employee!,
              employee_type: unit.all_candidates[0]?.employee_type ?? null,
              attribution_model: empAttrMap.get(eid) ?? null,
              primary_units_count: 0,
              secondary_units_count: 0,
              primary_units: [],
              secondary_units: [],
            });
          }
          const es = empSummaryMap.get(eid)!;
          es.primary_units_count++;
          es.primary_units.push({
            id: unit.educational_unit_id,
            name: unit.name,
            type: unit.educational_unit_type,
            confidence: unit.responsibility_confidence,
          });
        }

        // Secondary employees (candidates beyond rank 1)
        for (const cand of unit.all_candidates.slice(1)) {
          const eid = cand.employee_id;
          if (!empSummaryMap.has(eid)) {
            empSummaryMap.set(eid, {
              employee_id: eid,
              full_name: cand.full_name,
              employee_type: cand.employee_type,
              attribution_model: empAttrMap.get(eid) ?? null,
              primary_units_count: 0,
              secondary_units_count: 0,
              primary_units: [],
              secondary_units: [],
            });
          }
          const es = empSummaryMap.get(eid)!;
          // Only add as secondary if not already a primary for this unit
          if (unit.primary_responsible_employee_id !== eid) {
            es.secondary_units_count++;
            es.secondary_units.push({
              id: unit.educational_unit_id,
              name: unit.name,
              type: unit.educational_unit_type,
            });
          }
        }
      }

      const employeeSummary = Array.from(empSummaryMap.values()).sort(
        (a, b) => b.primary_units_count - a.primary_units_count,
      );

      logger.info({ summary }, "GET /educational-units/responsibility-audit");

      res.json({
        generated_at: new Date().toISOString(),
        branch_id: BRANCH_ID,
        lookback_months: 12,
        summary,
        top_20: top20,
        kindergarten,
        school,
        club_top30: clubTop30,
        all_units: results,
        employee_summary: employeeSummary,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { err },
        "GET /educational-units/responsibility-audit failed",
      );
      res.status(500).json({ success: false, message });
    }
  },
);
