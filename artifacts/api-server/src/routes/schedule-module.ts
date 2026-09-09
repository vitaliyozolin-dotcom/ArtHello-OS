import { Router } from "express";
import { db } from "@workspace/db";
import {
  scheduleAssignmentsTable,
  directionsTable,
  classGroupsTable,
  type Direction,
} from "@workspace/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod/v4";

export const scheduleModuleRouter = Router();

const assignmentSchema = z.object({
  teacherCrmId: z.string(),
  classGroupId: z.string().uuid().optional(),
  lessonDate: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  durationHours: z.string().optional(),
  lessonType: z.string().default("regular"),
  rateType: z.string().default("per_lesson"),
  rateAmount: z.string().optional(),
  totalAmount: z.string().optional(),
  directionId: z.string().uuid().optional(),
  branchCrmId: z.string().optional(),
  periodMonth: z.string().optional(),
  studentsCount: z.number().optional(),
  status: z.string().default("scheduled"),
  notes: z.string().optional(),
  isTestData: z.boolean().default(false),
});

// ─── GET /api/schedule/assignments ───────────────────────────────────────────

scheduleModuleRouter.get("/schedule/assignments", async (req, res) => {
  const { teacherCrmId, periodMonth, directionId, status } =
    req.query as Record<string, string>;
  const where = [];
  if (teacherCrmId)
    where.push(eq(scheduleAssignmentsTable.teacherCrmId, teacherCrmId));
  if (periodMonth)
    where.push(eq(scheduleAssignmentsTable.periodMonth, periodMonth));
  if (directionId)
    where.push(
      eq(
        scheduleAssignmentsTable.directionId,
        directionId as `${string}-${string}-${string}-${string}-${string}`,
      ),
    );
  if (status) where.push(eq(scheduleAssignmentsTable.status, status));

  const rows = await db
    .select()
    .from(scheduleAssignmentsTable)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(scheduleAssignmentsTable.lessonDate))
    .limit(500);

  res.json(rows);
});

// ─── GET /api/schedule/pl-by-direction ───────────────────────────────────────
// P&L breakdown: per direction, per month — teacher accrual costs

scheduleModuleRouter.get("/schedule/pl-by-direction", async (req, res) => {
  const { periodMonth } = req.query as Record<string, string>;

  const where = periodMonth
    ? eq(scheduleAssignmentsTable.periodMonth, periodMonth)
    : undefined;

  const rows = await db
    .select()
    .from(scheduleAssignmentsTable)
    .where(where)
    .orderBy(scheduleAssignmentsTable.directionId);

  const dirs = await db.select().from(directionsTable);
  const dirMap = Object.fromEntries(dirs.map((d: Direction) => [d.id, d]));

  // Group by direction
  const byDirection: Record<
    string,
    {
      directionId: string | null;
      directionName: string;
      color: string;
      totalAmount: number;
      lessonsCount: number;
      teacherSet: Set<string>;
    }
  > = {};

  for (const r of rows) {
    const key = r.directionId ?? "__unassigned__";
    if (!byDirection[key]) {
      byDirection[key] = {
        directionId: r.directionId,
        directionName: r.directionId
          ? (dirMap[r.directionId]?.name ?? "Без направления")
          : "Без направления",
        color: r.directionId
          ? (dirMap[r.directionId]?.color ?? "#6b7280")
          : "#6b7280",
        totalAmount: 0,
        lessonsCount: 0,
        teacherSet: new Set(),
      };
    }
    const entry = byDirection[key];
    entry.totalAmount += parseFloat(r.totalAmount ?? "0");
    entry.lessonsCount += 1;
    entry.teacherSet.add(r.teacherCrmId);
  }

  const result = Object.values(byDirection)
    .map((e) => ({
      directionId: e.directionId,
      directionName: e.directionName,
      color: e.color,
      totalAmount: e.totalAmount,
      lessonsCount: e.lessonsCount,
      teachersCount: e.teacherSet.size,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  res.json({
    periodMonth: periodMonth ?? "all",
    totalAmount: result.reduce((s, r) => s + r.totalAmount, 0),
    totalLessons: result.reduce((s, r) => s + r.lessonsCount, 0),
    byDirection: result,
  });
});

// ─── GET /api/schedule/teacher-workload ──────────────────────────────────────

scheduleModuleRouter.get("/schedule/teacher-workload", async (req, res) => {
  const { periodMonth } = req.query as Record<string, string>;
  const where = periodMonth
    ? eq(scheduleAssignmentsTable.periodMonth, periodMonth)
    : undefined;

  const rows = await db.select().from(scheduleAssignmentsTable).where(where);

  const byTeacher: Record<
    string,
    {
      teacherCrmId: string;
      totalAmount: number;
      lessonsCount: number;
      hoursTotal: number;
      directions: Set<string>;
      statusCounts: Record<string, number>;
    }
  > = {};

  for (const r of rows) {
    const key = r.teacherCrmId;
    if (!byTeacher[key]) {
      byTeacher[key] = {
        teacherCrmId: key,
        totalAmount: 0,
        lessonsCount: 0,
        hoursTotal: 0,
        directions: new Set(),
        statusCounts: {},
      };
    }
    const e = byTeacher[key];
    e.totalAmount += parseFloat(r.totalAmount ?? "0");
    e.lessonsCount += 1;
    e.hoursTotal += parseFloat(r.durationHours ?? "1");
    if (r.directionId) e.directions.add(r.directionId);
    e.statusCounts[r.status ?? "scheduled"] =
      (e.statusCounts[r.status ?? "scheduled"] || 0) + 1;
  }

  const result = Object.values(byTeacher)
    .map((e) => ({
      ...e,
      directions: e.directions.size,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  res.json(result);
});

// ─── POST /api/schedule/assignments ──────────────────────────────────────────

scheduleModuleRouter.post("/schedule/assignments", async (req, res) => {
  const data = assignmentSchema.parse(req.body);

  // Auto-compute totalAmount if not provided
  let total = data.totalAmount ? parseFloat(data.totalAmount) : 0;
  if (!total && data.rateAmount) {
    const rate = parseFloat(data.rateAmount);
    const hours = parseFloat(data.durationHours ?? "1");
    total = data.rateType === "per_hour" ? rate * hours : rate;
  }

  // Auto-set periodMonth from lessonDate if not provided
  const periodMonth = data.periodMonth ?? data.lessonDate.slice(0, 7);

  const [row] = await db
    .insert(scheduleAssignmentsTable)
    .values({
      ...(data as typeof scheduleAssignmentsTable.$inferInsert),
      totalAmount: String(total),
      periodMonth,
    })
    .returning();
  res.status(201).json(row);
});

// ─── PATCH /api/schedule/assignments/:id ─────────────────────────────────────

scheduleModuleRouter.patch("/schedule/assignments/:id", async (req, res) => {
  const { id } = req.params;
  const data = assignmentSchema.partial().parse(req.body);
  const [row] = await db
    .update(scheduleAssignmentsTable)
    .set(data as typeof scheduleAssignmentsTable.$inferInsert)
    .where(
      eq(
        scheduleAssignmentsTable.id,
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

// ─── DELETE /api/schedule/assignments/:id ────────────────────────────────────

scheduleModuleRouter.delete("/schedule/assignments/:id", async (req, res) => {
  await db
    .delete(scheduleAssignmentsTable)
    .where(
      eq(
        scheduleAssignmentsTable.id,
        req.params.id as `${string}-${string}-${string}-${string}-${string}`,
      ),
    );
  res.json({ ok: true });
});

// ─── GET /api/schedule/months ─────────────────────────────────────────────────

scheduleModuleRouter.get("/schedule/months", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT period_month, COUNT(*)::int as lessons_count,
           SUM(total_amount::numeric)::text as total_amount
    FROM schedule_assignments
    WHERE period_month IS NOT NULL
    GROUP BY period_month
    ORDER BY period_month DESC
    LIMIT 24
  `);
  res.json(rows.rows);
});
