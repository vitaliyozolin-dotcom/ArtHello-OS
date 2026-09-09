import { Router } from "express";
import { z } from "zod/v4";
import { and, desc, eq, sum, count, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  crmTeachersTable,
  staffRatesTable,
  staffPayoutsTable,
  staffProfilesTable,
  staffBonusesTable,
} from "@workspace/db";

export const staffCompleteRouter = Router();

// ─── GET /staff/profiles ──────────────────────────────────────────────────────

staffCompleteRouter.get("/staff/profiles", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(staffProfilesTable)
      .orderBy(staffProfilesTable.teacherCrmId);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /staff/profiles failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST/PATCH /staff/profiles/:teacherCrmId ─────────────────────────────────

const profileSchema = z.object({
  position: z.string().optional(),
  department: z.string().optional(),
  hireDate: z.string().optional(),
  ndflRate: z.number().min(0).max(1).optional(),
  pfrRate: z.number().min(0).max(1).optional(),
  fssRate: z.number().min(0).max(1).optional(),
  kpiTarget: z.number().optional(),
  notes: z.string().optional(),
});

staffCompleteRouter.post("/staff/profiles/:teacherCrmId", async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  try {
    const data = {
      teacherCrmId: req.params.teacherCrmId,
      ...parsed.data,
      ndflRate:
        parsed.data.ndflRate != null ? String(parsed.data.ndflRate) : undefined,
      pfrRate:
        parsed.data.pfrRate != null ? String(parsed.data.pfrRate) : undefined,
      fssRate:
        parsed.data.fssRate != null ? String(parsed.data.fssRate) : undefined,
      kpiTarget:
        parsed.data.kpiTarget != null
          ? String(parsed.data.kpiTarget)
          : undefined,
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(staffProfilesTable)
      .values(data)
      .onConflictDoUpdate({
        target: staffProfilesTable.teacherCrmId,
        set: data,
      })
      .returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "POST /staff/profiles/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /staff/fot-dashboard ─────────────────────────────────────────────────
// Full FOT (ФОТ) dashboard for a given month

staffCompleteRouter.get("/staff/fot-dashboard", async (req, res) => {
  try {
    const { month } = req.query as { month?: string };

    const teachers = await db
      .select()
      .from(crmTeachersTable)
      .orderBy(crmTeachersTable.fullName);
    const profiles = await db.select().from(staffProfilesTable);
    const profileMap = new Map(profiles.map((p) => [p.teacherCrmId, p]));

    let payouts: (typeof staffPayoutsTable.$inferSelect)[] = [];
    if (month) {
      payouts = await db
        .select()
        .from(staffPayoutsTable)
        .where(eq(staffPayoutsTable.periodMonth, month));
    } else {
      payouts = await db
        .select()
        .from(staffPayoutsTable)
        .orderBy(desc(staffPayoutsTable.periodMonth))
        .limit(100);
    }
    const payoutMap = new Map(
      payouts.map((p) => [`${p.teacherCrmId}_${p.periodMonth}`, p]),
    );

    let bonuses: (typeof staffBonusesTable.$inferSelect)[] = [];
    if (month) {
      bonuses = await db
        .select()
        .from(staffBonusesTable)
        .where(eq(staffBonusesTable.periodMonth, month));
    }
    const bonusMap: Record<string, number> = {};
    for (const b of bonuses) {
      bonusMap[b.teacherCrmId] =
        (bonusMap[b.teacherCrmId] ?? 0) + parseFloat(String(b.amount));
    }

    const result = teachers.map((t) => {
      const profile = profileMap.get(t.crmId ?? "");
      const payout = month ? payoutMap.get(`${t.crmId}_${month}`) : undefined;
      const gross = parseFloat(
        String(payout?.confirmedAmount ?? payout?.calculatedAmount ?? "0"),
      );
      const bonus = bonusMap[t.crmId ?? ""] ?? 0;
      const totalGross = gross + bonus;

      const ndfl = parseFloat(String(profile?.ndflRate ?? "0.13"));
      const pfr = parseFloat(String(profile?.pfrRate ?? "0.22"));
      const fss = parseFloat(String(profile?.fssRate ?? "0.029"));

      // НДФЛ — удерживается из зарплаты сотрудника
      const ndflAmount = Math.round(totalGross * ndfl);
      // ПФР + ФСС — начисляются сверху (работодатель)
      const pfrAmount = Math.round(totalGross * pfr);
      const fssAmount = Math.round(totalGross * fss);
      const employerCost = totalGross + pfrAmount + fssAmount; // total cost for employer

      return {
        teacher: t,
        profile: profile ?? null,
        payout: payout ?? null,
        month: month ?? null,
        gross,
        bonus,
        totalGross,
        ndflAmount,
        netTakeHome: totalGross - ndflAmount,
        pfrAmount,
        fssAmount,
        employerCost,
        kpiActual: payout?.lessonsCount ?? 0,
        kpiTarget: profile?.kpiTarget
          ? parseFloat(String(profile.kpiTarget))
          : null,
        status: payout?.status ?? "draft",
      };
    });

    const totals = result.reduce(
      (acc, r) => ({
        totalGross: acc.totalGross + r.totalGross,
        totalNdfl: acc.totalNdfl + r.ndflAmount,
        totalPfr: acc.totalPfr + r.pfrAmount,
        totalFss: acc.totalFss + r.fssAmount,
        totalEmployerCost: acc.totalEmployerCost + r.employerCost,
      }),
      {
        totalGross: 0,
        totalNdfl: 0,
        totalPfr: 0,
        totalFss: 0,
        totalEmployerCost: 0,
      },
    );

    res.json({ month: month ?? null, teachers: result, totals });
  } catch (err) {
    req.log.error({ err }, "GET /staff/fot-dashboard failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /staff/bonuses ───────────────────────────────────────────────────────

staffCompleteRouter.get("/staff/bonuses", async (req, res) => {
  try {
    const { month, teacherCrmId } = req.query as {
      month?: string;
      teacherCrmId?: string;
    };
    const conditions = [];
    if (month) conditions.push(eq(staffBonusesTable.periodMonth, month));
    if (teacherCrmId)
      conditions.push(eq(staffBonusesTable.teacherCrmId, teacherCrmId));

    const rows = await db
      .select()
      .from(staffBonusesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(staffBonusesTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /staff/bonuses failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /staff/bonuses ──────────────────────────────────────────────────────

const bonusSchema = z.object({
  teacherCrmId: z.string(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number().positive(),
  reason: z.string().optional(),
});

staffCompleteRouter.post("/staff/bonuses", async (req, res) => {
  const parsed = bonusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  try {
    const [row] = await db
      .insert(staffBonusesTable)
      .values({ ...parsed.data, amount: String(parsed.data.amount) })
      .returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "POST /staff/bonuses failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /staff/fot-trend ─────────────────────────────────────────────────────

staffCompleteRouter.get("/staff/fot-trend", async (req, res) => {
  try {
    const rows = await db
      .select({
        month: staffPayoutsTable.periodMonth,
        total: sum(staffPayoutsTable.confirmedAmount),
        calc: sum(staffPayoutsTable.calculatedAmount),
        cnt: count(staffPayoutsTable.id),
      })
      .from(staffPayoutsTable)
      .groupBy(staffPayoutsTable.periodMonth)
      .orderBy(staffPayoutsTable.periodMonth);

    res.json(
      rows.map((r) => ({
        month: r.month,
        total: parseFloat(String(r.total ?? r.calc ?? "0")),
        headcount: Number(r.cnt),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "GET /staff/fot-trend failed");
    res.status(500).json({ error: "Internal error" });
  }
});
