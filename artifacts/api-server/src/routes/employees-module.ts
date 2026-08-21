import { Router } from "express";
import { z } from "zod/v4";
import { and, asc, desc, eq, ilike, or, sql, inArray } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  employeesTable,
  employeeRolesTable,
  payrollRulesTable,
  departmentsTable,
  employeeEducationalUnitLinksTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";

export const employeesModuleRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// Synthetic / shared teacher CRM IDs — aggregated identities, not a single real person
const SYNTHETIC_TEACHER_IDS = new Set(["321"]);

interface TopGroup {
  groupCrmId: string;
  groupName: string | null;
  subjectName: string | null;
  lessonsCount: number;
  uniqueStudentsCount: number;
  attendanceCount: number;
}

interface AttributionRow {
  lessonsCount: number;
  groupsCount: number;
  studentsCount: number;
  attendanceCount: number;
  revenueRub: number;
  topGroups: TopGroup[];
  attributionStatus: "ready" | "partial" | "missing_data";
  warnings: string[];
}

interface DirectionEntry {
  name: string;
  source: string;
  lessons_count: number;
  groups_count: number;
}

async function getFullAttribution(
  teacherCrmIds: string[],
  month: string,
): Promise<Map<string, AttributionRow>> {
  if (teacherCrmIds.length === 0) return new Map();
  const monthStart = `${month}-01`;
  const client = await pool.connect();
  try {
    // 1. Lessons + attendance aggregates per teacher
    const aggRes = await client.query<{
      teacher_crm_id: string;
      lessons_count: string;
      groups_count: string;
      unique_students: string;
      attendance_count: string;
    }>(
      `SELECT
         cl.teacher_crm_id,
         COUNT(DISTINCT cl.crm_id)                                                      AS lessons_count,
         COUNT(DISTINCT cl.group_crm_id) FILTER (WHERE cl.group_crm_id IS NOT NULL)    AS groups_count,
         COUNT(DISTINCT ca.student_crm_id) FILTER (WHERE ca.student_crm_id IS NOT NULL) AS unique_students,
         COUNT(ca.id)                                                                    AS attendance_count
       FROM crm_lessons cl
       LEFT JOIN crm_attendance ca ON ca.lesson_crm_id = cl.crm_id
       WHERE cl.teacher_crm_id = ANY($1)
         AND cl.lesson_date >= $2::date
         AND cl.lesson_date <  ($2::date + INTERVAL '1 month')
       GROUP BY cl.teacher_crm_id`,
      [teacherCrmIds, monthStart],
    );

    // 2. Revenue attribution: income payments from students who attended this teacher's lessons
    //    NOTE: management approximation — student may attend multiple teachers.
    //    Only type='income' payments are counted.
    const revenueRes = await client.query<{
      teacher_crm_id: string;
      revenue_rub: string;
    }>(
      `WITH teacher_students AS (
         SELECT DISTINCT cl.teacher_crm_id, ca.student_crm_id
         FROM crm_lessons cl
         JOIN crm_attendance ca ON ca.lesson_crm_id = cl.crm_id
         WHERE cl.teacher_crm_id = ANY($1)
           AND cl.lesson_date >= $2::date
           AND cl.lesson_date <  ($2::date + INTERVAL '1 month')
       )
       SELECT
         ts.teacher_crm_id,
         COALESCE(SUM(p.amount::numeric), 0) AS revenue_rub
       FROM teacher_students ts
       JOIN crm_payments p ON p.student_crm_id = ts.student_crm_id
       WHERE p.payment_date >= $2::date
         AND p.payment_date <  ($2::date + INTERVAL '1 month')
         AND p.type = 'income'
       GROUP BY ts.teacher_crm_id`,
      [teacherCrmIds, monthStart],
    );

    // 3. Count lessons with NULL group_crm_id per teacher (for warnings)
    const nullGroupRes = await client.query<{
      teacher_crm_id: string;
      null_group_lessons: string;
    }>(
      `SELECT teacher_crm_id, COUNT(*) AS null_group_lessons
       FROM crm_lessons
       WHERE teacher_crm_id = ANY($1)
         AND lesson_date >= $2::date
         AND lesson_date <  ($2::date + INTERVAL '1 month')
         AND group_crm_id IS NULL
       GROUP BY teacher_crm_id`,
      [teacherCrmIds, monthStart],
    );

    // 4. Top groups per teacher (with group metadata, max 10 per teacher)
    const topGroupsRes = await client.query<{
      teacher_crm_id: string;
      group_crm_id: string;
      group_name: string | null;
      inferred_subject_name: string | null;
      lessons_count: string;
      unique_students: string;
      attendance_count: string;
    }>(
      `SELECT
         cl.teacher_crm_id,
         cl.group_crm_id,
         cg.name                  AS group_name,
         cg.inferred_subject_name,
         COUNT(DISTINCT cl.crm_id) AS lessons_count,
         COUNT(DISTINCT ca.student_crm_id) FILTER (WHERE ca.student_crm_id IS NOT NULL) AS unique_students,
         COUNT(ca.id)             AS attendance_count
       FROM crm_lessons cl
       LEFT JOIN crm_groups cg ON cg.crm_id = cl.group_crm_id
       LEFT JOIN crm_attendance ca ON ca.lesson_crm_id = cl.crm_id
       WHERE cl.teacher_crm_id = ANY($1)
         AND cl.lesson_date >= $2::date
         AND cl.lesson_date <  ($2::date + INTERVAL '1 month')
         AND cl.group_crm_id IS NOT NULL
       GROUP BY cl.teacher_crm_id, cl.group_crm_id, cg.name, cg.inferred_subject_name
       ORDER BY cl.teacher_crm_id, COUNT(DISTINCT cl.crm_id) DESC`,
      [teacherCrmIds, monthStart],
    );

    // ── Build helper maps ────────────────────────────────────────────────────

    const nullGroupMap = new Map<string, number>();
    for (const r of nullGroupRes.rows) {
      nullGroupMap.set(r.teacher_crm_id, parseInt(r.null_group_lessons, 10));
    }

    const revenueMap = new Map<string, number>();
    for (const r of revenueRes.rows) {
      revenueMap.set(r.teacher_crm_id, parseFloat(r.revenue_rub));
    }

    // Group topGroups by teacher_crm_id (keep top 10)
    const topGroupsMap = new Map<string, TopGroup[]>();
    for (const r of topGroupsRes.rows) {
      if (!topGroupsMap.has(r.teacher_crm_id)) topGroupsMap.set(r.teacher_crm_id, []);
      const arr = topGroupsMap.get(r.teacher_crm_id)!;
      if (arr.length < 10) {
        arr.push({
          groupCrmId: r.group_crm_id,
          groupName: r.group_name,
          subjectName: r.inferred_subject_name,
          lessonsCount: parseInt(r.lessons_count, 10),
          uniqueStudentsCount: parseInt(r.unique_students, 10),
          attendanceCount: parseInt(r.attendance_count, 10),
        });
      }
    }

    // ── Assemble result ──────────────────────────────────────────────────────

    const result = new Map<string, AttributionRow>();

    // Initialise all with missing_data defaults
    for (const id of teacherCrmIds) {
      const warnings: string[] = [];
      if (SYNTHETIC_TEACHER_IDS.has(id)) warnings.push("synthetic_or_shared_teacher");
      result.set(id, {
        lessonsCount:    0,
        groupsCount:     0,
        studentsCount:   0,
        attendanceCount: 0,
        revenueRub:      0,
        topGroups:       [],
        attributionStatus: "missing_data",
        warnings,
      });
    }

    // Fill from aggregates
    for (const r of aggRes.rows) {
      const row = result.get(r.teacher_crm_id);
      if (!row) continue;

      row.lessonsCount    = parseInt(r.lessons_count, 10);
      row.groupsCount     = parseInt(r.groups_count, 10);
      row.studentsCount   = parseInt(r.unique_students, 10);
      row.attendanceCount = parseInt(r.attendance_count, 10);
      row.revenueRub      = revenueMap.get(r.teacher_crm_id) ?? 0;
      row.topGroups       = topGroupsMap.get(r.teacher_crm_id) ?? [];

      // Warnings
      const nullGroupLessons = nullGroupMap.get(r.teacher_crm_id) ?? 0;
      if (nullGroupLessons > 0) row.warnings.push("no_group_id_on_lessons");
      if (row.lessonsCount > 0 && row.attendanceCount === 0) row.warnings.push("no_attendance_data");
      if (row.topGroups.some((g) => !g.groupName)) row.warnings.push("historical_group_id");

      // Attribution status
      if (row.lessonsCount > 0 && row.groupsCount > 0 && row.attendanceCount > 0) {
        row.attributionStatus = "ready";
      } else if (row.lessonsCount > 0) {
        row.attributionStatus = "partial";
      }
      // else: stays "missing_data" (no lessons this period)
    }

    return result;
  } finally {
    client.release();
  }
}

// ─── GET /departments ─────────────────────────────────────────────────────────

employeesModuleRouter.get("/departments", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(departmentsTable)
      .where(eq(departmentsTable.isActive, true))
      .orderBy(asc(departmentsTable.sortOrder), asc(departmentsTable.name));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /departments failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /departments ────────────────────────────────────────────────────────

const createDeptSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

employeesModuleRouter.post("/departments", async (req, res) => {
  try {
    const body = createDeptSchema.parse(req.body);
    const [row] = await db.insert(departmentsTable).values(body).returning();
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues });
    req.log.error({ err }, "POST /departments failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /employees ───────────────────────────────────────────────────────────

employeesModuleRouter.get("/employees", async (req, res) => {
  try {
    const {
      month,
      department,
      status,
      employment_type,
      search,
      branch,
      employee_kind,
      classification_status,
      employee_type,
      show_excluded,
    } = req.query as Record<string, string | undefined>;

    const targetMonth = month ?? currentMonth();
    const conditions = [];

    // By default hide records excluded from staff analytics, unless show_excluded=true
    if (show_excluded !== "true") {
      conditions.push(
        or(
          eq(employeesTable.excludeFromStaffAnalytics, false),
          sql`${employeesTable.excludeFromStaffAnalytics} IS NULL`,
        )!,
      );
    }

    if (status) conditions.push(eq(employeesTable.status, status));
    if (employment_type) conditions.push(eq(employeesTable.employmentType, employment_type));
    if (department) conditions.push(eq(employeesTable.primaryDepartment, department));
    if (branch) conditions.push(eq(employeesTable.branchCrmId, branch));
    if (employee_kind) conditions.push(eq(employeesTable.employeeKind, employee_kind));
    if (classification_status) conditions.push(eq(employeesTable.classificationStatus, classification_status));
    if (employee_type) conditions.push(eq(employeesTable.employeeType, employee_type));
    if (search) {
      const s = or(
        ilike(employeesTable.fullName, `%${search}%`),
        ilike(employeesTable.primaryRole, `%${search}%`),
        ilike(employeesTable.phone, `%${search}%`),
      );
      if (s) conditions.push(s);
    }

    const employees = await db
      .select()
      .from(employeesTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(employeesTable.fullName));

    // Full attribution for linked teachers
    const teacherIds = employees
      .filter((e) => e.teacherCrmId)
      .map((e) => e.teacherCrmId as string);

    const attrMap = await getFullAttribution(teacherIds, targetMonth);

    const result = employees.map((e) => {
      const attr = e.teacherCrmId ? attrMap.get(e.teacherCrmId) : undefined;
      return {
        ...e,
        month: targetMonth,
        lessonsCount:     attr?.lessonsCount     ?? null,
        groupsCount:      attr?.groupsCount      ?? null,
        studentsCount:    attr?.studentsCount    ?? null,
        attendanceCount:  attr?.attendanceCount  ?? null,
        revenueRub:       attr?.revenueRub       ?? null,
        attributionStatus: attr?.attributionStatus ?? (e.teacherCrmId ? "missing_data" : null),
        accrualsRub: null,
        marginRub:   null,
        marginPct:   null,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "GET /employees failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /employees ──────────────────────────────────────────────────────────

const createEmployeeSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
  employmentType: z.enum(["employee", "self_employed", "contractor", "sole_proprietor"]).default("employee"),
  status: z.enum(["active", "paused", "dismissed"]).default("active"),
  primaryRole: z.string().optional(),
  primaryDepartment: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  inn: z.string().optional(),
  bankDetails: z.string().optional(),
  notes: z.string().optional(),
  teacherCrmId: z.string().optional(),
  branchCrmId: z.string().optional(),
});

employeesModuleRouter.post("/employees", async (req, res) => {
  try {
    const body = createEmployeeSchema.parse(req.body);
    const [row] = await db.insert(employeesTable).values(body).returning();
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues });
    req.log.error({ err }, "POST /employees failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /employees/stats ─────────────────────────────────────────────────────
// MUST be registered before /employees/:id to prevent Express matching "stats" as :id

employeesModuleRouter.get("/employees/stats", async (req, res) => {
  const client = await pool.connect();
  try {
    const [emp] = (await client.query(`
      SELECT
        COUNT(*)                                                                        AS employees_total,
        COUNT(*) FILTER (WHERE status = 'active')                                      AS employees_active,
        COUNT(*) FILTER (WHERE status = 'paused')                                      AS employees_paused,
        COUNT(*) FILTER (WHERE status = 'dismissed')                                   AS employees_dismissed,
        COUNT(*) FILTER (WHERE teacher_crm_id IS NOT NULL)                             AS with_teacher,
        COUNT(*) FILTER (WHERE teacher_crm_id IS NULL)                                 AS without_teacher,
        COUNT(*) FILTER (WHERE person_id IS NOT NULL)                                  AS with_person,
        COUNT(*) FILTER (WHERE person_id IS NULL)                                      AS without_person,
        COUNT(*) FILTER (WHERE exclude_from_staff_analytics = false OR exclude_from_staff_analytics IS NULL) AS employees_visible,
        COUNT(*) FILTER (WHERE exclude_from_staff_analytics = true)                    AS employees_excluded,
        COUNT(*) FILTER (WHERE employee_kind = 'real_employee')                        AS real_employees,
        COUNT(*) FILTER (WHERE employee_kind = 'former_employee')                      AS former_employees,
        COUNT(*) FILTER (WHERE employee_kind = 'technical_record')                     AS technical_records,
        COUNT(*) FILTER (WHERE employee_kind = 'synthetic_shared_teacher')             AS synthetic_shared_teachers,
        COUNT(*) FILTER (WHERE classification_status = 'needs_review')                 AS needs_review,
        COUNT(*) FILTER (WHERE classification_status = 'classified')                   AS classified,
        COUNT(*) FILTER (WHERE classification_status IS NULL)                          AS not_classified
      FROM employees
    `)).rows as Record<string, string>[];

    const [crm] = (await client.query(`SELECT COUNT(*) AS total FROM crm_teachers`)).rows as Record<string, string>[];

    const [linked] = (await client.query(`
      SELECT COUNT(DISTINCT teacher_crm_id) AS cnt
      FROM employees WHERE teacher_crm_id IS NOT NULL
    `)).rows as Record<string, string>[];

    const empTotal   = Number(emp.employees_total);
    const crmTotal   = Number(crm.total);
    const withTeacher = Number(emp.with_teacher);
    const withPerson  = Number(emp.with_person);

    res.json({
      employees_total:                  empTotal,
      employees_active:                 Number(emp.employees_active),
      employees_paused:                 Number(emp.employees_paused),
      employees_dismissed:              Number(emp.employees_dismissed),
      employees_with_teacher_crm_id:    withTeacher,
      employees_without_teacher_crm_id: Number(emp.without_teacher),
      employees_with_person_id:         withPerson,
      employees_without_person_id:      Number(emp.without_person),
      // P9.3.1 classification stats
      employees_visible:                Number(emp.employees_visible),
      employees_excluded_from_analytics: Number(emp.employees_excluded),
      real_employees:                   Number(emp.real_employees),
      former_employees:                 Number(emp.former_employees),
      technical_records:                Number(emp.technical_records),
      synthetic_shared_teachers:        Number(emp.synthetic_shared_teachers),
      needs_review:                     Number(emp.needs_review),
      classified:                       Number(emp.classified),
      not_classified:                   Number(emp.not_classified),
      crm_teachers_total:               crmTotal,
      crm_teachers_with_employee:       Number(linked.cnt),
      crm_teachers_without_employee:    crmTotal - Number(linked.cnt),
      teacher_link_coverage_percent:    empTotal > 0 ? Math.round(withTeacher / empTotal * 100) : 0,
      person_link_coverage_percent:     empTotal > 0 ? Math.round(withPerson  / empTotal * 100) : 0,
      // legacy aliases kept for UI compatibility
      total:      empTotal,
      active:     Number(emp.employees_active),
      paused:     Number(emp.employees_paused),
      dismissed:  Number(emp.employees_dismissed),
      linkedToCrm: withTeacher,
    });
  } catch (err) {
    req.log.error({ err }, "GET /employees/stats failed");
    res.status(500).json({ error: "Internal error" });
  } finally {
    client.release();
  }
});

// ─── POST /employees/classify ─────────────────────────────────────────────────
// Idempotent: safe to run multiple times — re-classifies all employees.
// MUST be registered before /employees/:id

const TECHNICAL_PATTERNS = [
  "прочие доходы", "прочие", "доходы", "технический", "тест",
  "служебный", "не использовать",
];

function isTechnicalRecord(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return TECHNICAL_PATTERNS.some((p) => lower.includes(p));
}

function isSyntheticTeacher(name: string, teacherCrmId: string | null): boolean {
  return teacherCrmId === "321" || name.toLowerCase().includes("приходящий педагог");
}

employeesModuleRouter.post("/employees/classify", async (req, res) => {
  const client = await pool.connect();
  try {
    // 1. All employees
    const empRes = await client.query<{
      id: string;
      full_name: string;
      teacher_crm_id: string | null;
      status: string;
      exclude_from_staff_analytics: boolean;
      classification_status: string | null;
    }>(`SELECT id, full_name, teacher_crm_id, status, exclude_from_staff_analytics, classification_status FROM employees ORDER BY id`);

    const teacherIds = empRes.rows
      .filter((r) => r.teacher_crm_id)
      .map((r) => r.teacher_crm_id as string);

    // 2. Lesson counts per teacher_crm_id (last 12 months vs historical)
    const lessonsLast12 = new Map<string, number>();
    const lessonsHistorical = new Map<string, number>();

    if (teacherIds.length > 0) {
      const last12Res = await client.query<{ teacher_crm_id: string; cnt: string }>(
        `SELECT teacher_crm_id, COUNT(*) AS cnt
         FROM crm_lessons
         WHERE teacher_crm_id = ANY($1)
           AND lesson_date >= NOW() - INTERVAL '12 months'
         GROUP BY teacher_crm_id`,
        [teacherIds],
      );
      for (const r of last12Res.rows) {
        lessonsLast12.set(r.teacher_crm_id, parseInt(r.cnt, 10));
      }

      const histRes = await client.query<{ teacher_crm_id: string; cnt: string }>(
        `SELECT teacher_crm_id, COUNT(*) AS cnt
         FROM crm_lessons
         WHERE teacher_crm_id = ANY($1)
           AND lesson_date < NOW() - INTERVAL '12 months'
         GROUP BY teacher_crm_id`,
        [teacherIds],
      );
      for (const r of histRes.rows) {
        lessonsHistorical.set(r.teacher_crm_id, parseInt(r.cnt, 10));
      }
    }

    // 3. Directions per teacher_crm_id (all-time, grouped by inferred subject)
    const directionsMap = new Map<string, DirectionEntry[]>();
    if (teacherIds.length > 0) {
      const dirRes = await client.query<{
        teacher_crm_id: string;
        name: string;
        lessons_count: string;
        groups_count: string;
      }>(
        `SELECT
           cl.teacher_crm_id,
           COALESCE(cg.inferred_subject_name, cg.name, 'Не определено') AS name,
           COUNT(DISTINCT cl.crm_id)::text      AS lessons_count,
           COUNT(DISTINCT cl.group_crm_id)::text AS groups_count
         FROM crm_lessons cl
         LEFT JOIN crm_groups cg ON cg.crm_id = cl.group_crm_id
         WHERE cl.teacher_crm_id = ANY($1)
           AND cl.group_crm_id IS NOT NULL
         GROUP BY cl.teacher_crm_id, COALESCE(cg.inferred_subject_name, cg.name, 'Не определено')
         ORDER BY cl.teacher_crm_id, COUNT(DISTINCT cl.crm_id) DESC`,
        [teacherIds],
      );

      for (const r of dirRes.rows) {
        if (!directionsMap.has(r.teacher_crm_id)) directionsMap.set(r.teacher_crm_id, []);
        const arr = directionsMap.get(r.teacher_crm_id)!;
        if (arr.length < 20) {
          arr.push({
            name: r.name,
            source: "crm_lessons",
            lessons_count: parseInt(r.lessons_count, 10),
            groups_count: parseInt(r.groups_count, 10),
          });
        }
      }
    }

    // 4. Classify each employee
    let processed = 0;
    let classified = 0;
    let needsReview = 0;
    let excluded = 0;
    let technicalRecords = 0;
    let formerEmployees = 0;
    let syntheticRecords = 0;
    const errors: string[] = [];
    const examples: Array<{ id: string; name: string; kind: string; reason: string }> = [];

    for (const emp of empRes.rows) {
      try {
        processed++;

        let kind: string;
        let empType: string | null = null;
        let classStatus: string;
        let reason: string;
        let exclude: boolean;

        if (isTechnicalRecord(emp.full_name)) {
          // Rule 1: Technical / non-person record
          kind = "technical_record";
          empType = null;
          classStatus = "excluded_from_staff_analytics";
          exclude = true;
          reason = "Technical/non-person CRM teacher record";
          technicalRecords++;
          excluded++;

        } else if (isSyntheticTeacher(emp.full_name, emp.teacher_crm_id)) {
          // Rule 2: Synthetic/shared teacher (e.g. "Приходящий педагог", id=321)
          kind = "synthetic_shared_teacher";
          empType = "contractor";
          classStatus = "needs_review";
          exclude = true;
          reason = "Shared/synthetic teacher record — not a single person";
          syntheticRecords++;
          excluded++;
          needsReview++;

        } else if (emp.teacher_crm_id) {
          const last12Count = lessonsLast12.get(emp.teacher_crm_id) ?? 0;
          const histCount   = lessonsHistorical.get(emp.teacher_crm_id) ?? 0;

          if (last12Count > 0) {
            // Rule 3: Active teacher
            kind = "real_employee";
            empType = "teacher";
            classStatus = "classified";
            exclude = false;
            reason = `Активный педагог: ${last12Count} занятий за последние 12 месяцев`;
            classified++;
          } else if (histCount > 0) {
            // Rule 4: Former employee (had lessons but not in last 12 months)
            // IMPORTANT: do NOT change status field
            kind = "former_employee";
            empType = "teacher";
            classStatus = "classified";
            exclude = true;
            reason = "Нет занятий за последние 12 месяцев";
            formerEmployees++;
            excluded++;
            classified++;
          } else {
            // CRM teacher linked but no lessons found at all
            kind = "unknown";
            empType = null;
            // Preserve explicitly excluded status (e.g. bootstrap exclusions from non-Atlas branch)
            if (emp.exclude_from_staff_analytics && emp.classification_status === "excluded_from_staff_analytics") {
              classStatus = "excluded_from_staff_analytics";
              exclude = true;
              reason = "Ранее исключён (bootstrap или ручное исключение); уроки не найдены";
              excluded++;
            } else {
              classStatus = "needs_review";
              exclude = false;
              reason = "Привязан к CRM-учителю, но уроки не найдены — нужна проверка";
              needsReview++;
            }
          }
        } else {
          // No CRM link — manual classification required
          kind = "unknown";
          empType = null;
          // Preserve explicitly excluded status (e.g. bootstrap exclusions from non-Atlas branch)
          if (emp.exclude_from_staff_analytics && emp.classification_status === "excluded_from_staff_analytics") {
            classStatus = "excluded_from_staff_analytics";
            exclude = true;
            reason = "Ранее исключён (bootstrap или ручное исключение); нет привязки к CRM";
            excluded++;
          } else {
            classStatus = "needs_review";
            exclude = false;
            reason = "Нет привязки к CRM-учителю — требуется ручная классификация";
            needsReview++;
          }
        }

        const dirs = emp.teacher_crm_id
          ? (directionsMap.get(emp.teacher_crm_id) ?? [])
          : [];

        await client.query(
          `UPDATE employees SET
             employee_kind             = $2,
             employee_type             = COALESCE($3, employee_type),
             classification_status     = $4,
             classification_reason     = $5,
             directions                = $6::jsonb,
             exclude_from_staff_analytics = $7,
             updated_at                = NOW()
           WHERE id = $1`,
          [emp.id, kind, empType, classStatus, reason, JSON.stringify(dirs), exclude],
        );

        if (examples.length < 20) {
          examples.push({ id: emp.id, name: emp.full_name, kind, reason });
        }
      } catch (rowErr) {
        req.log.error({ rowErr, employee_id: emp.id }, "classify: row error");
        errors.push(`${emp.full_name}: ${String(rowErr)}`);
      }
    }

    req.log.info(
      { processed, classified, needs_review: needsReview, excluded, errors: errors.length },
      "POST /employees/classify completed",
    );

    res.json({
      processed,
      classified,
      needs_review: needsReview,
      excluded,
      technical_records: technicalRecords,
      former_employees: formerEmployees,
      synthetic_records: syntheticRecords,
      errors: errors.slice(0, 20),
      examples: examples.slice(0, 20),
    });
  } catch (err) {
    req.log.error({ err }, "POST /employees/classify failed");
    res.status(500).json({ error: "Internal error" });
  } finally {
    client.release();
  }
});

// ─── POST /employees/populate-from-crm-teachers ───────────────────────────────
// Idempotent: safe to run multiple times — creates only missing employees.

employeesModuleRouter.post("/employees/populate-from-crm-teachers", async (req, res) => {
  const client = await pool.connect();
  try {
    // 1. All CRM teachers
    const teachersRes = await client.query<{
      crm_id: number;
      full_name: string;
      phone: string | null;
      email: string | null;
    }>(`SELECT crm_id, full_name, phone, email FROM crm_teachers ORDER BY crm_id`);

    // 2. Existing employee teacher_crm_ids (for skip detection)
    const existingRes = await client.query<{ teacher_crm_id: string }>(
      `SELECT teacher_crm_id FROM employees WHERE teacher_crm_id IS NOT NULL`,
    );
    const existingIds = new Set(existingRes.rows.map((r) => r.teacher_crm_id));

    // 3. Default department: Клубные занятия
    const deptRes = await client.query<{ id: string }>(
      `SELECT id FROM departments WHERE name = 'Клубные занятия' LIMIT 1`,
    );
    const defaultDeptId = deptRes.rows[0]?.id ?? null;

    const toCreate = teachersRes.rows.filter((t) => !existingIds.has(String(t.crm_id)));

    let created = 0;
    let errors  = 0;
    let personLinksCreated   = 0;
    let personLinksAmbiguous = 0;
    let personLinksMissing   = 0;
    const examplesCreated: string[] = [];

    for (const teacher of toCreate) {
      try {
        // Person linking by exact full_name match (case-insensitive, trimmed)
        const personRes = await client.query<{ id: string }>(
          `SELECT id FROM persons WHERE LOWER(TRIM(full_name)) = LOWER(TRIM($1))`,
          [teacher.full_name],
        );
        let personId: string | null = null;
        if (personRes.rows.length === 1) {
          personId = personRes.rows[0].id;
          personLinksCreated++;
        } else if (personRes.rows.length > 1) {
          personLinksAmbiguous++;
        } else {
          personLinksMissing++;
        }

        const insRes = await client.query<{ id: string; full_name: string }>(
          `INSERT INTO employees
             (full_name, phone, email, employment_type, status,
              primary_role, primary_department, department_id,
              teacher_crm_id, person_id)
           VALUES ($1, $2, $3, 'employee', 'active',
                   'Педагог', 'Клубные занятия', $4, $5, $6)
           ON CONFLICT (teacher_crm_id) DO NOTHING
           RETURNING id, full_name`,
          [
            teacher.full_name,
            teacher.phone ?? null,
            teacher.email ?? null,
            defaultDeptId,
            String(teacher.crm_id),
            personId,
          ],
        );

        if (insRes.rows.length > 0) {
          created++;
          if (examplesCreated.length < 10) {
            examplesCreated.push(insRes.rows[0].full_name);
          }
        }
      } catch (rowErr) {
        req.log.error({ rowErr, teacher_crm_id: teacher.crm_id }, "populate: row error");
        errors++;
      }
    }

    req.log.info(
      { processed: teachersRes.rows.length, created, skipped: existingIds.size, errors },
      "POST /employees/populate-from-crm-teachers completed",
    );

    res.json({
      processed:          teachersRes.rows.length,
      created,
      skipped_existing:   existingIds.size,
      errors,
      examples_created:   examplesCreated,
      person_links_created:    personLinksCreated,
      person_links_ambiguous:  personLinksAmbiguous,
      person_links_missing:    personLinksMissing,
    });
  } catch (err) {
    req.log.error({ err }, "POST /employees/populate-from-crm-teachers failed");
    res.status(500).json({ error: "Internal error" });
  } finally {
    client.release();
  }
});

// ─── GET /employees/attribution ───────────────────────────────────────────────
// MUST be registered before /employees/:id to prevent Express matching "attribution" as :id

employeesModuleRouter.get("/employees/attribution", async (req, res) => {
  try {
    const month = (req.query.month as string | undefined) ?? currentMonth();

    const employees = await db
      .select()
      .from(employeesTable)
      .orderBy(asc(employeesTable.fullName));

    const teacherIds = employees
      .filter((e) => e.teacherCrmId)
      .map((e) => e.teacherCrmId as string);

    const attrMap = await getFullAttribution(teacherIds, month);

    const rows = employees.map((e) => {
      const attr = e.teacherCrmId ? attrMap.get(e.teacherCrmId) : undefined;
      return {
        employeeId:             e.id,
        employeeName:           e.fullName,
        teacherCrmId:           e.teacherCrmId,
        status:                 e.status,
        employeeKind:           e.employeeKind,
        excludeFromStaffAnalytics: e.excludeFromStaffAnalytics,
        lessonsCount:           attr?.lessonsCount     ?? 0,
        groupsCount:            attr?.groupsCount      ?? 0,
        studentsCount:          attr?.studentsCount    ?? 0,
        attendanceCount:        attr?.attendanceCount  ?? 0,
        crmIncomeAttributed:    attr?.revenueRub       ?? 0,
        topGroups:              attr?.topGroups        ?? [],
        attributionStatus:      attr?.attributionStatus ?? (e.teacherCrmId ? "missing_data" : null),
        warnings:               attr?.warnings         ?? [],
      };
    });

    // Sort by lessons DESC
    rows.sort((a, b) => b.lessonsCount - a.lessonsCount);

    const withLessons = rows.filter((r) => r.lessonsCount > 0);
    const summary = {
      month,
      employees_total:               employees.length,
      employees_with_teacher_crm_id: teacherIds.length,
      employees_with_lessons:        withLessons.length,
      employees_without_lessons:     employees.length - withLessons.length,
      total_lessons_attributed:      rows.reduce((s, r) => s + r.lessonsCount, 0),
      total_attendance_attributed:   rows.reduce((s, r) => s + r.attendanceCount, 0),
      total_unique_students_attributed: rows.reduce((s, r) => s + r.studentsCount, 0),
      total_crm_income_attributed:   rows.reduce((s, r) => s + r.crmIncomeAttributed, 0),
      attribution_status_counts: {
        ready:        rows.filter((r) => r.attributionStatus === "ready").length,
        partial:      rows.filter((r) => r.attributionStatus === "partial").length,
        missing_data: rows.filter((r) => r.attributionStatus === "missing_data").length,
        unlinked:     rows.filter((r) => !r.attributionStatus).length,
      },
      warnings_total: rows.reduce((s, r) => s + r.warnings.length, 0),
      note: "Revenue is management attribution via attendance → payments (type=income). Not bank reconciliation.",
    };

    res.json({ month, summary, employees: rows });
  } catch (err) {
    req.log.error({ err }, "GET /employees/attribution failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /employees/:id ───────────────────────────────────────────────────────

employeesModuleRouter.get("/employees/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const month = (req.query.month as string | undefined) ?? currentMonth();

    const [employee] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, id));

    if (!employee) return void res.status(404).json({ error: "Not found" });

    const roles = await db
      .select()
      .from(employeeRolesTable)
      .where(eq(employeeRolesTable.employeeId, id))
      .orderBy(desc(employeeRolesTable.isPrimary), asc(employeeRolesTable.validFrom));

    const rules = await db
      .select()
      .from(payrollRulesTable)
      .where(and(eq(payrollRulesTable.employeeId, id), eq(payrollRulesTable.isActive, true)))
      .orderBy(asc(payrollRulesTable.ruleType));

    let attribution: AttributionRow | null = null;
    if (employee.teacherCrmId) {
      const attrMap = await getFullAttribution([employee.teacherCrmId], month);
      attribution = attrMap.get(employee.teacherCrmId) ?? null;
    }

    // Educational unit links
    const eduLinksResult = await pool.query<{
      link_id: string;
      educational_unit_id: string;
      unit_name: string;
      educational_unit_type: string;
      department: string | null;
      crm_group_id: string | null;
      role_in_unit: string | null;
      attribution_model: string | null;
      is_primary: boolean;
      source: string | null;
      confidence: string | null;
      valid_from: string | null;
      valid_to: string | null;
      notes: string | null;
    }>(
      `SELECT lnk.id AS link_id, eu.id AS educational_unit_id,
              eu.name AS unit_name, eu.educational_unit_type, eu.department,
              lnk.crm_group_id, lnk.role_in_unit, lnk.attribution_model,
              lnk.is_primary, lnk.source, lnk.confidence,
              lnk.valid_from, lnk.valid_to, lnk.notes
       FROM employee_educational_unit_links lnk
       JOIN educational_units eu ON eu.id = lnk.educational_unit_id
       WHERE lnk.employee_id = $1 AND lnk.valid_to IS NULL
       ORDER BY lnk.is_primary DESC, lnk.confidence DESC, eu.name`,
      [id],
    );

    res.json({
      employee,
      roles,
      rules,
      month,
      educationalUnitLinks: eduLinksResult.rows,
      revenue: attribution
        ? {
            lessonsCount:      attribution.lessonsCount,
            groupsCount:       attribution.groupsCount,
            studentsCount:     attribution.studentsCount,
            attendanceCount:   attribution.attendanceCount,
            revenueRub:        attribution.revenueRub,
            topGroups:         attribution.topGroups,
            attributionStatus: attribution.attributionStatus,
            warnings:          attribution.warnings,
          }
        : null,
      finance: {
        revenueRub:  attribution?.revenueRub ?? null,
        accrualsRub: null,
        marginRub:   null,
        marginPct:   null,
        note: "Начисления: расчёт будет добавлен в Payroll Engine (этап 2)",
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET /employees/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── PATCH /employees/:id ─────────────────────────────────────────────────────

const updateEmployeeSchema = createEmployeeSchema.partial();

employeesModuleRouter.patch("/employees/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = updateEmployeeSchema.parse(req.body);
    const [row] = await db
      .update(employeesTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(employeesTable.id, id))
      .returning();
    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err) {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues });
    req.log.error({ err }, "PATCH /employees/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── PATCH /employees/:id/classification ─────────────────────────────────────
// Manual override for classification fields.

const classificationPatchSchema = z.object({
  employeeKind: z.string().optional(),
  employeeType: z.string().optional(),
  primaryDepartment: z.string().optional(),
  directions: z.array(z.object({
    name: z.string(),
    source: z.string().optional(),
    lessons_count: z.number().optional(),
    groups_count: z.number().optional(),
  })).optional(),
  classificationStatus: z.string().optional(),
  excludeFromStaffAnalytics: z.boolean().optional(),
  classificationReason: z.string().optional(),
});

employeesModuleRouter.patch("/employees/:id/classification", async (req, res) => {
  try {
    const { id } = req.params;
    const body = classificationPatchSchema.parse(req.body);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.employeeKind !== undefined) updates.employeeKind = body.employeeKind;
    if (body.employeeType !== undefined) updates.employeeType = body.employeeType;
    if (body.primaryDepartment !== undefined) updates.primaryDepartment = body.primaryDepartment;
    if (body.directions !== undefined) updates.directions = body.directions;
    if (body.classificationStatus !== undefined) updates.classificationStatus = body.classificationStatus;
    if (body.excludeFromStaffAnalytics !== undefined) updates.excludeFromStaffAnalytics = body.excludeFromStaffAnalytics;
    if (body.classificationReason !== undefined) updates.classificationReason = body.classificationReason;

    const [row] = await db
      .update(employeesTable)
      .set(updates)
      .where(eq(employeesTable.id, id))
      .returning();

    if (!row) return void res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err) {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues });
    req.log.error({ err }, "PATCH /employees/:id/classification failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /employees/:id/payroll-rules ─────────────────────────────────────────

employeesModuleRouter.get("/employees/:id/payroll-rules", async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await db
      .select()
      .from(payrollRulesTable)
      .where(eq(payrollRulesTable.employeeId, id))
      .orderBy(desc(payrollRulesTable.isActive), asc(payrollRulesTable.ruleType));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /employees/:id/payroll-rules failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /employees/payroll-rules ────────────────────────────────────────────

const createRuleSchema = z.object({
  employeeId: z.string().uuid(),
  ruleType: z.enum([
    "fixed_salary",
    "per_child",
    "per_lesson",
    "per_hour",
    "per_shift",
    "percent_of_revenue",
    "manual_bonus",
    "manual_penalty",
  ]).default("per_lesson"),
  amount: z.string().optional(),
  serviceId: z.string().uuid().optional(),
  groupId: z.string().optional(),
  department: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  notes: z.string().optional(),
});

employeesModuleRouter.post("/employees/payroll-rules", async (req, res) => {
  try {
    const body = createRuleSchema.parse(req.body);
    const [row] = await db.insert(payrollRulesTable).values(body).returning();
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues });
    req.log.error({ err }, "POST /employees/payroll-rules failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /employees/:id/roles ─────────────────────────────────────────────────

employeesModuleRouter.get("/employees/:id/roles", async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await db
      .select()
      .from(employeeRolesTable)
      .where(eq(employeeRolesTable.employeeId, id))
      .orderBy(desc(employeeRolesTable.isPrimary), asc(employeeRolesTable.validFrom));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /employees/:id/roles failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /employees/roles ────────────────────────────────────────────────────

const createRoleSchema = z.object({
  employeeId: z.string().uuid(),
  roleName: z.string().min(1),
  department: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  branchId: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  isPrimary: z.boolean().default(false),
});

employeesModuleRouter.post("/employees/roles", async (req, res) => {
  try {
    const body = createRoleSchema.parse(req.body);
    const [row] = await db.insert(employeeRolesTable).values(body).returning();
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues });
    req.log.error({ err }, "POST /employees/roles failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /employees/map-educational-units ────────────────────────────────────
// P9.4.2 — Auto-maps employees → educational_units from crm_lessons data.
// Idempotent: skips manual links; updates existing auto links on re-run.
// Uses shared SYNTHETIC_TEACHER_IDS (defined at top of file).

employeesModuleRouter.post("/employees/map-educational-units", async (req, res) => {
  try {
    const BRANCH_ID = "6";

    // 1. Find all employee-group associations from lesson data
    const assocResult = await pool.query<{
      employee_id: string;
      teacher_crm_id: string;
      employee_kind: string | null;
      educational_unit_id: string;
      crm_group_id: string;
      unit_name: string;
      educational_unit_type: string;
      unit_attribution_model: string | null;
      lessons_taught: string;
      total_group_lessons: string;
    }>(
      `SELECT
         e.id                        AS employee_id,
         e.teacher_crm_id,
         e.employee_kind,
         eu.id                       AS educational_unit_id,
         eu.crm_group_id,
         eu.name                     AS unit_name,
         eu.educational_unit_type,
         eu.attribution_model        AS unit_attribution_model,
         COUNT(l.crm_id)::text       AS lessons_taught,
         tot.total_group_lessons::text
       FROM employees e
       JOIN crm_lessons l
         ON l.teacher_crm_id = e.teacher_crm_id
        AND l.branch_crm_id = $1
       JOIN educational_units eu
         ON eu.crm_group_id = l.group_crm_id
        AND eu.is_active = true
       JOIN LATERAL (
         SELECT COUNT(*) AS total_group_lessons
         FROM crm_lessons
         WHERE group_crm_id = eu.crm_group_id AND branch_crm_id = $1
       ) tot ON true
       WHERE e.teacher_crm_id IS NOT NULL
         AND eu.crm_group_id IS NOT NULL
       GROUP BY e.id, e.teacher_crm_id, e.employee_kind,
                eu.id, eu.crm_group_id, eu.name,
                eu.educational_unit_type, eu.attribution_model, tot.total_group_lessons
       HAVING COUNT(l.crm_id) >= 3`,
      [BRANCH_ID],
    );

    let created = 0;
    let updated = 0;
    let skippedManual = 0;
    let errors = 0;

    // Counters for audit
    const groupBasedLinks: string[] = [];
    const lessonBasedLinks: string[] = [];

    for (const row of assocResult.rows) {
      try {
        const isSynthetic = SYNTHETIC_TEACHER_IDS.has(row.teacher_crm_id) ||
          row.employee_kind === "synthetic_shared_teacher";

        const lessonsTaught = Number(row.lessons_taught);
        const totalLessons  = Number(row.total_group_lessons);
        const coverage = totalLessons > 0 ? lessonsTaught / totalLessons : 0;

        // Confidence
        let confidence: string;
        if (isSynthetic) {
          confidence = "low";
        } else if (coverage >= 0.3) {
          confidence = "high";
        } else if (coverage >= 0.1) {
          confidence = "medium";
        } else {
          confidence = "low";
        }

        // Role in unit
        let roleInUnit: string;
        switch (row.educational_unit_type) {
          case "kindergarten_group": roleInUnit = "educator";       break;
          case "school_class":       roleInUnit = "class_teacher";  break;
          default:                   roleInUnit = "teacher";        break;
        }

        // Attribution model follows the educational unit type
        const attrModel = row.unit_attribution_model ??
          (row.educational_unit_type === "kindergarten_group" || row.educational_unit_type === "school_class"
            ? "group_based" : "lesson_based");

        const source = isSynthetic ? "inferred" : "alpha_crm";
        const notes  = isSynthetic
          ? "Synthetic/shared teacher record; requires manual review"
          : null;

        // Idempotent upsert: skip if a manual link already exists for this pair
        // Insert or update non-manual link
        const existsResult = await pool.query<{ id: string; source: string }>(
          `SELECT id, source FROM employee_educational_unit_links
           WHERE employee_id = $1 AND educational_unit_id = $2 AND role_in_unit = $3
             AND valid_from IS NULL
           LIMIT 1`,
          [row.employee_id, row.educational_unit_id, roleInUnit],
        );

        const existing = existsResult.rows[0];

        if (existing) {
          if (existing.source === "manual") {
            skippedManual++;
            continue;
          }
          // Update existing auto/inferred link
          await pool.query(
            `UPDATE employee_educational_unit_links
             SET confidence = $1, attribution_model = $2, crm_group_id = $3,
                 teacher_crm_id = $4, source = $5, notes = $6, updated_at = NOW()
             WHERE id = $7`,
            [confidence, attrModel, row.crm_group_id, row.teacher_crm_id, source, notes, existing.id],
          );
          updated++;
        } else {
          // Insert new link
          await pool.query(
            `INSERT INTO employee_educational_unit_links
               (employee_id, educational_unit_id, crm_group_id, teacher_crm_id,
                role_in_unit, attribution_model, is_primary, source, confidence, notes,
                created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, $9, NOW(), NOW())`,
            [row.employee_id, row.educational_unit_id, row.crm_group_id, row.teacher_crm_id,
              roleInUnit, attrModel, source, confidence, notes],
          );
          created++;
        }

        if (attrModel === "group_based") groupBasedLinks.push(row.employee_id);
        else lessonBasedLinks.push(row.employee_id);

      } catch (rowErr) {
        errors++;
        logger.error({ rowErr, employee_id: row.employee_id }, "map-educational-units: row failed");
      }
    }

    // 2. Check for individual lessons (no group_crm_id) per employee
    const individualResult = await pool.query<{
      employee_id: string;
      individual_lessons: string;
    }>(
      `SELECT e.id AS employee_id, COUNT(l.crm_id)::text AS individual_lessons
       FROM employees e
       JOIN crm_lessons l ON l.teacher_crm_id = e.teacher_crm_id
         AND l.branch_crm_id = $1
         AND l.group_crm_id IS NULL
       WHERE e.teacher_crm_id IS NOT NULL
       GROUP BY e.id
       HAVING COUNT(l.crm_id) >= 1`,
      [BRANCH_ID],
    );
    const individualEmployeeIds = new Set(individualResult.rows.map(r => r.employee_id));

    // 3. Update employees.attribution_model from their links
    await pool.query(`
      UPDATE employees e SET
        attribution_model = sub.computed_model,
        updated_at = NOW()
      FROM (
        SELECT
          employee_id,
          CASE
            WHEN COUNT(*) FILTER (WHERE attribution_model = 'group_based')  > 0
             AND COUNT(*) FILTER (WHERE attribution_model = 'lesson_based') > 0
              THEN 'mixed'
            WHEN COUNT(*) FILTER (WHERE attribution_model = 'group_based')  > 0
              THEN 'group_based'
            WHEN COUNT(*) FILTER (WHERE attribution_model = 'lesson_based') > 0
              THEN 'lesson_based'
            ELSE 'unknown'
          END AS computed_model
        FROM employee_educational_unit_links
        WHERE valid_to IS NULL
        GROUP BY employee_id
      ) sub
      WHERE e.id = sub.employee_id
        AND e.attribution_model IS DISTINCT FROM sub.computed_model
    `);

    // 4. Build audit summary
    const auditResult = await pool.query<{
      total_links: string;
      group_based: string;
      lesson_based: string;
      manual: string;
    }>(
      `SELECT
         COUNT(*)::text                                                        AS total_links,
         COUNT(*) FILTER (WHERE attribution_model = 'group_based')::text       AS group_based,
         COUNT(*) FILTER (WHERE attribution_model = 'lesson_based')::text      AS lesson_based,
         COUNT(*) FILTER (WHERE source = 'manual')::text                       AS manual
       FROM employee_educational_unit_links`,
    );

    const empAttrResult = await pool.query<{
      attribution_model: string;
      cnt: string;
    }>(
      `SELECT attribution_model, COUNT(*)::text AS cnt
       FROM employees
       WHERE attribution_model IS NOT NULL
         AND exclude_from_staff_analytics = false
       GROUP BY attribution_model`,
    );

    // Top 20 employees by link count
    const top20Result = await pool.query<{
      employee_id: string;
      full_name: string;
      employee_type: string | null;
      attribution_model: string | null;
      linked_units_count: string;
      group_based_links: string;
      lesson_based_links: string;
    }>(
      `SELECT
         e.id          AS employee_id,
         e.full_name,
         e.employee_type,
         e.attribution_model,
         COUNT(lnk.id)::text                                                   AS linked_units_count,
         COUNT(lnk.id) FILTER (WHERE lnk.attribution_model = 'group_based')::text AS group_based_links,
         COUNT(lnk.id) FILTER (WHERE lnk.attribution_model = 'lesson_based')::text AS lesson_based_links
       FROM employees e
       JOIN employee_educational_unit_links lnk ON lnk.employee_id = e.id
       WHERE lnk.valid_to IS NULL
       GROUP BY e.id, e.full_name, e.employee_type, e.attribution_model
       ORDER BY COUNT(lnk.id) DESC
       LIMIT 20`,
    );

    const a = auditResult.rows[0]!;
    const msg = `P9.4.2: Mapped ${created} new links, ${updated} updated, ${skippedManual} manual preserved, ${errors} errors`;
    logger.info({ created, updated, skippedManual, errors }, msg);

    res.json({
      success: true,
      message: msg,
      created,
      updated,
      skipped_manual: skippedManual,
      errors,
      individual_employees: individualEmployeeIds.size,
      audit: {
        total_links:          Number(a.total_links),
        group_based_links:    Number(a.group_based),
        lesson_based_links:   Number(a.lesson_based),
        manual_links:         Number(a.manual),
        employees_by_model:   Object.fromEntries(empAttrResult.rows.map(r => [r.attribution_model, Number(r.cnt)])),
      },
      top_20_employees: top20Result.rows.map(r => ({
        employee_id:       r.employee_id,
        full_name:         r.full_name,
        employee_type:     r.employee_type,
        attribution_model: r.attribution_model,
        linked_units_count: Number(r.linked_units_count),
        group_based_links:  Number(r.group_based_links),
        lesson_based_links: Number(r.lesson_based_links),
      })),
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "POST /employees/map-educational-units failed");
    res.status(500).json({ success: false, message });
  }
});

// ─── GET /employees/:id/educational-unit-links ────────────────────────────────

employeesModuleRouter.get("/employees/:id/educational-unit-links", async (req, res) => {
  try {
    const { id } = req.params;
    const links = await pool.query<{
      link_id: string;
      educational_unit_id: string;
      unit_name: string;
      educational_unit_type: string;
      department: string | null;
      crm_group_id: string | null;
      teacher_crm_id: string | null;
      role_in_unit: string | null;
      attribution_model: string | null;
      is_primary: boolean;
      source: string | null;
      confidence: string | null;
      valid_from: string | null;
      valid_to: string | null;
      notes: string | null;
    }>(
      `SELECT
         lnk.id          AS link_id,
         eu.id           AS educational_unit_id,
         eu.name         AS unit_name,
         eu.educational_unit_type,
         eu.department,
         lnk.crm_group_id,
         lnk.teacher_crm_id,
         lnk.role_in_unit,
         lnk.attribution_model,
         lnk.is_primary,
         lnk.source,
         lnk.confidence,
         lnk.valid_from,
         lnk.valid_to,
         lnk.notes
       FROM employee_educational_unit_links lnk
       JOIN educational_units eu ON eu.id = lnk.educational_unit_id
       WHERE lnk.employee_id = $1
       ORDER BY lnk.is_primary DESC, lnk.confidence DESC, eu.name`,
      [id],
    );
    res.json({ links: links.rows });
  } catch (err) {
    req.log.error({ err }, "GET /employees/:id/educational-unit-links failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── PATCH /employees/:id/educational-unit-links ──────────────────────────────
// Manual override: create or update an employee ↔ educational unit link.
// manual links are never overwritten by auto-mapping.

const eduLinkPatchSchema = z.object({
  educational_unit_id: z.string().uuid(),
  role_in_unit:       z.string().optional(),
  attribution_model:  z.string().optional(),
  is_primary:         z.boolean().optional(),
  valid_to:           z.string().nullable().optional(),
  notes:              z.string().nullable().optional(),
});

employeesModuleRouter.patch("/employees/:id/educational-unit-links", async (req, res) => {
  try {
    const { id } = req.params;
    const body = eduLinkPatchSchema.parse(req.body);

    // Resolve educational_unit info
    const euResult = await pool.query<{
      id: string; name: string; educational_unit_type: string;
      department: string | null; crm_group_id: string | null;
      attribution_model: string | null;
    }>(
      `SELECT id, name, educational_unit_type, department, crm_group_id, attribution_model
       FROM educational_units WHERE id = $1`,
      [body.educational_unit_id],
    );
    if (!euResult.rows[0]) {
      res.status(404).json({ error: "Educational unit not found" });
      return;
    }
    const eu = euResult.rows[0]!;

    // Resolve employee's teacher_crm_id
    const empResult = await pool.query<{ teacher_crm_id: string | null }>(
      `SELECT teacher_crm_id FROM employees WHERE id = $1`,
      [id],
    );
    if (!empResult.rows[0]) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    const teacherCrmId = empResult.rows[0]!.teacher_crm_id;

    const roleInUnit     = body.role_in_unit     ?? "teacher";
    const attrModel      = body.attribution_model ?? eu.attribution_model ?? "lesson_based";

    // Check for existing link (any source)
    const existsResult = await pool.query<{ id: string }>(
      `SELECT id FROM employee_educational_unit_links
       WHERE employee_id = $1 AND educational_unit_id = $2 AND role_in_unit = $3
         AND valid_from IS NULL LIMIT 1`,
      [id, body.educational_unit_id, roleInUnit],
    );
    const existing = existsResult.rows[0];

    let link;
    if (existing) {
      const r = await pool.query(
        `UPDATE employee_educational_unit_links
         SET attribution_model = $1, is_primary = $2, valid_to = $3,
             notes = $4, source = 'manual', confidence = 'high', updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [attrModel, body.is_primary ?? false, body.valid_to ?? null, body.notes ?? null, existing.id],
      );
      link = r.rows[0];
    } else {
      const r = await pool.query(
        `INSERT INTO employee_educational_unit_links
           (employee_id, educational_unit_id, crm_group_id, teacher_crm_id,
            role_in_unit, attribution_model, is_primary, source, confidence, notes,
            valid_to, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', 'high', $8, $9, NOW(), NOW())
         RETURNING *`,
        [id, body.educational_unit_id, eu.crm_group_id, teacherCrmId,
          roleInUnit, attrModel, body.is_primary ?? false,
          body.notes ?? null, body.valid_to ?? null],
      );
      link = r.rows[0];
    }

    req.log.info({ employee_id: id, educational_unit_id: body.educational_unit_id }, "manual edu-unit link saved");
    res.json({ success: true, link, unit: eu });
  } catch (err) {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues });
    req.log.error({ err }, "PATCH /employees/:id/educational-unit-links failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /employees/exclude-non-atlas-bootstrap ──────────────────────────────
// P9.3.2: Marks employees whose teacher_crm_id does NOT exist in Atlas
// crm_teachers (branch_crm_id='6') as excluded from analytics.
// Safe: no rows deleted. Idempotent.

employeesModuleRouter.post("/employees/exclude-non-atlas-bootstrap", async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      // Employees linked to a CRM teacher that is NOT in Atlas (branch_crm_id='6')
      const updateRes = await client.query<{ id: string; full_name: string }>(
        `UPDATE employees
         SET employee_kind             = 'technical_record',
             classification_status     = 'excluded_from_staff_analytics',
             exclude_from_staff_analytics = true,
             classification_reason     = 'Imported from non-Atlas branch during bootstrap; excluded before Atlas teacher sync'
         WHERE teacher_crm_id IS NOT NULL
           AND teacher_crm_id NOT IN (
             SELECT crm_id::text FROM crm_teachers WHERE branch_crm_id = '6'
           )
         RETURNING id, full_name`,
      );

      const marked = updateRes.rows.length;
      const examples = updateRes.rows.slice(0, 10).map((r) => r.full_name);

      req.log.info({ marked, examples }, "POST /employees/exclude-non-atlas-bootstrap: marked non-Atlas employees");

      res.json({
        success: true,
        message: `Marked ${marked} non-Atlas bootstrap employees as excluded from analytics`,
        marked,
        examples,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    req.log.error({ err }, "POST /employees/exclude-non-atlas-bootstrap failed");
    res.status(500).json({ error: "Internal error" });
  }
});
