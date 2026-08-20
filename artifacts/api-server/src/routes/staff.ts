import { Router } from "express";
import { z } from "zod/v4";
import { and, desc, eq, gte, lte, sql, count } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  crmTeachersTable,
  crmLessonsTable,
  crmAttendanceTable,
  staffRatesTable,
  staffPayoutsTable,
} from "@workspace/db";

export const staffRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${lastDay}`;
  return { from, to };
}

// ─── GET /staff/teachers ──────────────────────────────────────────────────────

staffRouter.get("/staff/teachers", async (req, res) => {
  try {
    const { month } = req.query as { month?: string };

    // Get all teachers
    const teachers = await db.select().from(crmTeachersTable).orderBy(crmTeachersTable.fullName);

    if (teachers.length === 0) {
      res.json({ teachers: [], month: month ?? null });
      return;
    }

    // Build per-teacher workload stats
    type LessonRow = { teacherCrmId: string | null; cnt: number };
    let lessonRows: LessonRow[] = [];

    if (month) {
      const { from, to } = monthRange(month);
      lessonRows = await db
        .select({
          teacherCrmId: crmLessonsTable.teacherCrmId,
          cnt: count(crmLessonsTable.id),
        })
        .from(crmLessonsTable)
        .where(
          and(
            gte(sql`date(lesson_date)`, from),
            lte(sql`date(lesson_date)`, to),
          ),
        )
        .groupBy(crmLessonsTable.teacherCrmId) as LessonRow[];
    } else {
      lessonRows = await db
        .select({
          teacherCrmId: crmLessonsTable.teacherCrmId,
          cnt: count(crmLessonsTable.id),
        })
        .from(crmLessonsTable)
        .groupBy(crmLessonsTable.teacherCrmId) as LessonRow[];
    }

    const lessonMap = new Map(lessonRows.map((r) => [r.teacherCrmId, r.cnt]));

    // Get active rates per teacher
    const today = new Date().toISOString().slice(0, 10);
    const activeRates = await db
      .select()
      .from(staffRatesTable)
      .where(
        and(
          lte(staffRatesTable.effectiveFrom, today),
          sql`(effective_to IS NULL OR effective_to >= ${today})`,
        ),
      );

    const rateMap = new Map<string, typeof activeRates[0]>();
    for (const r of activeRates) {
      if (!rateMap.has(r.teacherCrmId)) rateMap.set(r.teacherCrmId, r);
    }

    // Get payouts for selected month
    const payoutMap = new Map<string, typeof staffPayoutsTable.$inferSelect>();
    if (month) {
      const payouts = await db
        .select()
        .from(staffPayoutsTable)
        .where(eq(staffPayoutsTable.periodMonth, month));
      for (const p of payouts) payoutMap.set(p.teacherCrmId, p);
    }

    const result = teachers.map((t) => {
      const lessons = lessonMap.get(t.crmId) ?? 0;
      const rate = rateMap.get(t.crmId) ?? null;
      const payout = payoutMap.get(t.crmId) ?? null;

      let calculatedPay: number | null = null;
      if (rate && lessons > 0) {
        const rateAmt = parseFloat(rate.rateAmount);
        if (rate.rateType === "per_lesson") calculatedPay = rateAmt * lessons;
        else if (rate.rateType === "fixed_monthly") calculatedPay = rateAmt;
        else calculatedPay = null;
      }

      return {
        ...t,
        lessonsCount: lessons,
        rate,
        payout,
        calculatedPay,
      };
    });

    res.json({ teachers: result, month: month ?? null });
  } catch (err) {
    req.log.error({ err }, "GET /staff/teachers failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /staff/stats ─────────────────────────────────────────────────────────

staffRouter.get("/staff/stats", async (req, res) => {
  try {
    const { month } = req.query as { month?: string };

    const [{ total }] = await db
      .select({ total: count(crmTeachersTable.id) })
      .from(crmTeachersTable);

    let lessonsThisMonth = 0;
    let activeTeachers = 0;

    if (month) {
      const { from, to } = monthRange(month);
      const rows = await db
        .select({
          teacherCrmId: crmLessonsTable.teacherCrmId,
          cnt: count(crmLessonsTable.id),
        })
        .from(crmLessonsTable)
        .where(
          and(
            gte(sql`date(lesson_date)`, from),
            lte(sql`date(lesson_date)`, to),
          ),
        )
        .groupBy(crmLessonsTable.teacherCrmId);

      lessonsThisMonth = rows.reduce((s, r) => s + Number(r.cnt), 0);
      activeTeachers = rows.filter((r) => Number(r.cnt) > 0).length;
    }

    // Total payout estimate for the month
    const today = new Date().toISOString().slice(0, 10);
    const activeRates = await db
      .select()
      .from(staffRatesTable)
      .where(
        and(
          lte(staffRatesTable.effectiveFrom, today),
          sql`(effective_to IS NULL OR effective_to >= ${today})`,
        ),
      );

    const rateMap = new Map<string, typeof activeRates[0]>();
    for (const r of activeRates) {
      if (!rateMap.has(r.teacherCrmId)) rateMap.set(r.teacherCrmId, r);
    }

    let payrollEstimate = 0;
    if (month) {
      const lessonCounts = await db
        .select({
          teacherCrmId: crmLessonsTable.teacherCrmId,
          cnt: count(crmLessonsTable.id),
        })
        .from(crmLessonsTable)
        .where(
          and(
            gte(sql`date(lesson_date)`, monthRange(month).from),
            lte(sql`date(lesson_date)`, monthRange(month).to),
          ),
        )
        .groupBy(crmLessonsTable.teacherCrmId);

      for (const row of lessonCounts) {
        if (!row.teacherCrmId) continue;
        const rate = rateMap.get(row.teacherCrmId);
        if (!rate) continue;
        const amt = parseFloat(rate.rateAmount);
        if (rate.rateType === "per_lesson") payrollEstimate += amt * Number(row.cnt);
        else if (rate.rateType === "fixed_monthly") payrollEstimate += amt;
      }
    }

    res.json({
      totalTeachers: Number(total),
      activeTeachers,
      lessonsThisMonth,
      avgLessonsPerTeacher: activeTeachers > 0 ? Math.round(lessonsThisMonth / activeTeachers) : 0,
      payrollEstimate,
      ratesConfigured: rateMap.size,
    });
  } catch (err) {
    req.log.error({ err }, "GET /staff/stats failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /staff/months ────────────────────────────────────────────────────────

staffRouter.get("/staff/months", async (req, res) => {
  try {
    const rows = await db
      .selectDistinct({ month: sql<string>`to_char(lesson_date, 'YYYY-MM')` })
      .from(crmLessonsTable)
      .where(sql`lesson_date is not null`)
      .orderBy(sql`1 desc`);
    res.json(rows.map((r) => r.month).filter(Boolean));
  } catch (err) {
    req.log.error({ err }, "GET /staff/months failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /staff/teachers/:crmId/lessons ──────────────────────────────────────

staffRouter.get("/staff/teachers/:crmId/lessons", async (req, res) => {
  try {
    const { crmId } = req.params;
    const { month } = req.query as { month?: string };

    const conditions = [eq(crmLessonsTable.teacherCrmId, crmId)];

    if (month) {
      const { from, to } = monthRange(month);
      conditions.push(gte(sql`date(lesson_date)`, from));
      conditions.push(lte(sql`date(lesson_date)`, to));
    }

    const lessons = await db
      .select()
      .from(crmLessonsTable)
      .where(and(...conditions))
      .orderBy(desc(crmLessonsTable.lessonDate))
      .limit(100);

    // Count attendance per lesson
    type AttRow = { lessonCrmId: string | null; cnt: number };
    const lessonIds = lessons.map((l) => l.crmId);
    let attRows: AttRow[] = [];
    if (lessonIds.length > 0) {
      attRows = await db
        .select({
          lessonCrmId: crmAttendanceTable.lessonCrmId,
          cnt: count(crmAttendanceTable.id),
        })
        .from(crmAttendanceTable)
        .where(sql`lesson_crm_id = ANY(ARRAY[${sql.join(lessonIds.map((id) => sql`${id}`), sql`, `)}])`)
        .groupBy(crmAttendanceTable.lessonCrmId) as AttRow[];
    }

    const attMap = new Map(attRows.map((r) => [r.lessonCrmId, r.cnt]));
    const enriched = lessons.map((l) => ({ ...l, studentsCount: attMap.get(l.crmId) ?? 0 }));

    res.json({ lessons: enriched, total: lessons.length });
  } catch (err) {
    req.log.error({ err }, "GET /staff/teachers/:crmId/lessons failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /staff/rates ────────────────────────────────────────────────────────

const rateBodySchema = z.object({
  teacherCrmId: z.string().min(1),
  rateType: z.enum(["per_lesson", "fixed_monthly", "per_hour"]),
  rateAmount: z.number().positive(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
});

staffRouter.post("/staff/rates", async (req, res) => {
  const parsed = rateBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: z.prettifyError(parsed.error) }); return; }

  try {
    const [rate] = await db
      .insert(staffRatesTable)
      .values({
        teacherCrmId: parsed.data.teacherCrmId,
        rateType: parsed.data.rateType,
        rateAmount: String(parsed.data.rateAmount),
        effectiveFrom: parsed.data.effectiveFrom,
        effectiveTo: parsed.data.effectiveTo ?? null,
        notes: parsed.data.notes ?? null,
      })
      .returning();

    res.json(rate);
  } catch (err) {
    req.log.error({ err }, "POST /staff/rates failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── DELETE /staff/rates/:id ──────────────────────────────────────────────────

staffRouter.delete("/staff/rates/:id", async (req, res) => {
  try {
    await db.delete(staffRatesTable).where(eq(staffRatesTable.id, req.params.id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /staff/rates/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /staff/payouts/recalc ───────────────────────────────────────────────

staffRouter.post("/staff/payouts/recalc", async (req, res) => {
  const { month } = req.body as { month?: string };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month required (YYYY-MM)" });
    return;
  }

  try {
    const { from, to } = monthRange(month);
    const today = new Date().toISOString().slice(0, 10);

    // Lesson counts per teacher for the month
    const lessonCounts = await db
      .select({
        teacherCrmId: crmLessonsTable.teacherCrmId,
        cnt: count(crmLessonsTable.id),
      })
      .from(crmLessonsTable)
      .where(
        and(
          gte(sql`date(lesson_date)`, from),
          lte(sql`date(lesson_date)`, to),
        ),
      )
      .groupBy(crmLessonsTable.teacherCrmId);

    // Active rates
    const activeRates = await db
      .select()
      .from(staffRatesTable)
      .where(
        and(
          lte(staffRatesTable.effectiveFrom, today),
          sql`(effective_to IS NULL OR effective_to >= ${today})`,
        ),
      );

    const rateMap = new Map<string, typeof activeRates[0]>();
    for (const r of activeRates) {
      if (!rateMap.has(r.teacherCrmId)) rateMap.set(r.teacherCrmId, r);
    }

    let upserted = 0;
    for (const row of lessonCounts) {
      if (!row.teacherCrmId) continue;
      const rate = rateMap.get(row.teacherCrmId);
      let calcAmount: string | null = null;
      if (rate) {
        const amt = parseFloat(rate.rateAmount);
        if (rate.rateType === "per_lesson") calcAmount = String(amt * Number(row.cnt));
        else if (rate.rateType === "fixed_monthly") calcAmount = String(amt);
      }

      await db
        .insert(staffPayoutsTable)
        .values({
          teacherCrmId: row.teacherCrmId,
          periodMonth: month,
          lessonsCount: Number(row.cnt),
          calculatedAmount: calcAmount,
          status: "draft",
        })
        .onConflictDoNothing();

      // Update lesson/calc fields even if row exists
      await db
        .update(staffPayoutsTable)
        .set({ lessonsCount: Number(row.cnt), calculatedAmount: calcAmount, updatedAt: new Date() })
        .where(
          and(
            eq(staffPayoutsTable.teacherCrmId, row.teacherCrmId),
            eq(staffPayoutsTable.periodMonth, month),
          ),
        );

      upserted++;
    }

    res.json({ ok: true, recalculated: upserted, month });
  } catch (err) {
    req.log.error({ err }, "POST /staff/payouts/recalc failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── PATCH /staff/payouts/:id ─────────────────────────────────────────────────

staffRouter.patch("/staff/payouts/:id", async (req, res) => {
  const { confirmedAmount, status, notes } = req.body as {
    confirmedAmount?: number;
    status?: string;
    notes?: string;
  };

  try {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (confirmedAmount !== undefined) set["confirmedAmount"] = String(confirmedAmount);
    if (status !== undefined) set["status"] = status;
    if (notes !== undefined) set["notes"] = notes;
    if (status === "paid") set["paidAt"] = new Date();

    const [updated] = await db
      .update(staffPayoutsTable)
      .set(set)
      .where(eq(staffPayoutsTable.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH /staff/payouts/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});
