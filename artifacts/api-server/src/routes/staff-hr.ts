import { Router } from "express";
import { z } from "zod/v4";
import { and, desc, eq, sql, sum, count } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  staffVacationsTable, staffDeductionsTable,
  staffProfilesTable, staffPayoutsTable, staffBonusesTable,
} from "@workspace/db";

export const staffHrRouter = Router();

// ─── GET /staff/vacations ─────────────────────────────────────────────────────

staffHrRouter.get("/staff/vacations", async (req, res) => {
  try {
    const { teacherCrmId, vacationType, status } = req.query as Record<string, string | undefined>;

    const conds = [];
    if (teacherCrmId) conds.push(eq(staffVacationsTable.teacherCrmId, teacherCrmId));
    if (vacationType) conds.push(eq(staffVacationsTable.vacationType, vacationType));
    if (status) conds.push(eq(staffVacationsTable.status, status));

    const rows = await db.select().from(staffVacationsTable)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(staffVacationsTable.startDate));

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /staff/vacations failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /staff/vacations ────────────────────────────────────────────────────

staffHrRouter.post("/staff/vacations", async (req, res) => {
  try {
    const schema = z.object({
      teacherCrmId: z.string(),
      vacationType: z.string().default("annual"),
      startDate: z.string(),
      endDate: z.string(),
      daysCount: z.number().int().optional(),
      accruedAmount: z.string().optional(),
      paidAmount: z.string().optional(),
      status: z.string().default("approved"),
      notes: z.string().optional(),
    });
    const body = schema.parse(req.body);

    // Auto-calculate days if not provided
    if (!body.daysCount) {
      const start = new Date(body.startDate);
      const end = new Date(body.endDate);
      const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      (body as Record<string, unknown>).daysCount = days;
    }

    const [row] = await db.insert(staffVacationsTable).values(body).returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "POST /staff/vacations failed");
    res.status(400).json({ error: String(err) });
  }
});

// ─── PATCH /staff/vacations/:id ───────────────────────────────────────────────

staffHrRouter.patch("/staff/vacations/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const schema = z.object({
      status: z.string().optional(),
      paidAmount: z.string().optional(),
      notes: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const [updated] = await db.update(staffVacationsTable).set(body)
      .where(eq(staffVacationsTable.id, id as `${string}-${string}-${string}-${string}-${string}`))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH /staff/vacations/:id failed");
    res.status(400).json({ error: String(err) });
  }
});

// ─── GET /staff/deductions ────────────────────────────────────────────────────

staffHrRouter.get("/staff/deductions", async (req, res) => {
  try {
    const { teacherCrmId, periodMonth, status } = req.query as Record<string, string | undefined>;

    const conds = [];
    if (teacherCrmId) conds.push(eq(staffDeductionsTable.teacherCrmId, teacherCrmId));
    if (periodMonth) conds.push(eq(staffDeductionsTable.periodMonth, periodMonth));
    if (status) conds.push(eq(staffDeductionsTable.status, status));

    const rows = await db.select().from(staffDeductionsTable)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(staffDeductionsTable.createdAt));

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /staff/deductions failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /staff/deductions ───────────────────────────────────────────────────

staffHrRouter.post("/staff/deductions", async (req, res) => {
  try {
    const schema = z.object({
      teacherCrmId: z.string(),
      periodMonth: z.string(),
      deductionType: z.string().default("other"),
      amount: z.string(),
      reason: z.string().optional(),
      status: z.string().default("applied"),
    });
    const body = schema.parse(req.body);
    const [row] = await db.insert(staffDeductionsTable).values(body).returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "POST /staff/deductions failed");
    res.status(400).json({ error: String(err) });
  }
});

// ─── PATCH /staff/deductions/:id ──────────────────────────────────────────────

staffHrRouter.patch("/staff/deductions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const schema = z.object({ status: z.string().optional(), reason: z.string().optional() });
    const body = schema.parse(req.body);
    const [updated] = await db.update(staffDeductionsTable).set(body)
      .where(eq(staffDeductionsTable.id, id as `${string}-${string}-${string}-${string}-${string}`))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH /staff/deductions/:id failed");
    res.status(400).json({ error: String(err) });
  }
});

// ─── GET /staff/payroll-reserve ───────────────────────────────────────────────
// Calculates expected payroll reserve: sum of gross payouts over last 3 months / 3

staffHrRouter.get("/staff/payroll-reserve", async (req, res) => {
  try {
    const now = new Date();
    const months: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const [avgPayout] = await db.select({
      avg: sql<number>`round(avg(confirmed_amount::numeric))::int`,
      total: sql<number>`round(sum(confirmed_amount::numeric))::int`,
    }).from(staffPayoutsTable)
      .where(sql`period_month = ANY(ARRAY[${sql.raw(months.map((m) => `'${m}'`).join(","))}])`);

    const [bonusTotal] = await db.select({
      avg: sql<number>`round(avg(amount::numeric))::int`,
    }).from(staffBonusesTable)
      .where(sql`period_month = ANY(ARRAY[${sql.raw(months.map((m) => `'${m}'`).join(","))}])`);

    const [vacationTotal] = await db.select({
      total: sql<number>`round(sum(accrued_amount::numeric))::int`,
    }).from(staffVacationsTable)
      .where(sql`created_at >= now() - interval '3 months'`);

    const avgPayroll = Number(avgPayout?.avg ?? 0);
    const avgBonus = Number(bonusTotal?.avg ?? 0);
    const vacationReserve = Number(vacationTotal?.total ?? 0);

    // Payroll reserve = 2 months of expected payroll + vacation reserve
    const reserveAmount = avgPayroll * 2 + vacationReserve;

    res.json({
      avgMonthlyPayroll: avgPayroll,
      avgMonthlyBonus: avgBonus,
      vacationReserve,
      reserveAmount,
      months,
      note: "Резерв = 2 мес. ФОТ + резерв отпускных",
    });
  } catch (err) {
    req.log.error({ err }, "GET /staff/payroll-reserve failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /staff/hr-summary ────────────────────────────────────────────────────

staffHrRouter.get("/staff/hr-summary", async (req, res) => {
  try {
    const [vacStats] = await db.select({
      total: count(staffVacationsTable.id),
      onVacation: sql<number>`count(*) filter (where status = 'approved' and start_date <= current_date and end_date >= current_date)::int`,
      planned: sql<number>`count(*) filter (where status = 'planned')::int`,
      totalDays: sql<number>`coalesce(sum(days_count), 0)::int`,
    }).from(staffVacationsTable);

    const [dedStats] = await db.select({
      total: count(staffDeductionsTable.id),
      totalAmount: sql<number>`coalesce(sum(amount::numeric), 0)::float`,
      pending: sql<number>`count(*) filter (where status = 'pending')::int`,
    }).from(staffDeductionsTable);

    res.json({
      vacations: {
        total: Number(vacStats?.total ?? 0),
        onVacation: Number(vacStats?.onVacation ?? 0),
        planned: Number(vacStats?.planned ?? 0),
        totalDays: Number(vacStats?.totalDays ?? 0),
      },
      deductions: {
        total: Number(dedStats?.total ?? 0),
        totalAmount: Number(dedStats?.totalAmount ?? 0),
        pending: Number(dedStats?.pending ?? 0),
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET /staff/hr-summary failed");
    res.status(500).json({ error: "Internal error" });
  }
});
