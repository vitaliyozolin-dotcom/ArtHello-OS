import { Router } from "express";
import { z } from "zod/v4";
import { and, desc, eq, gte, lte, sql, sum, count } from "drizzle-orm";
import { db } from "@workspace/db";
import { taxObligationsTable, taxReserveTable } from "@workspace/db";

export const taxesModuleRouter = Router();

// ─── GET /taxes/obligations ───────────────────────────────────────────────────

taxesModuleRouter.get("/taxes/obligations", async (req, res) => {
  try {
    const { month, status, taxType } = req.query as Record<string, string | undefined>;

    const conditions = [];
    if (month) conditions.push(eq(taxObligationsTable.periodMonth, month));
    if (status) conditions.push(eq(taxObligationsTable.status, status));
    if (taxType) conditions.push(eq(taxObligationsTable.taxType, taxType));

    const rows = await db
      .select()
      .from(taxObligationsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(taxObligationsTable.periodMonth), taxObligationsTable.dueDate);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /taxes/obligations failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /taxes/summary ───────────────────────────────────────────────────────

taxesModuleRouter.get("/taxes/summary", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [totals] = await db
      .select({
        totalAccrued: sum(taxObligationsTable.accruedAmount),
        totalPaid: sum(taxObligationsTable.paidAmount),
      })
      .from(taxObligationsTable);

    const [overdue] = await db
      .select({ cnt: count(taxObligationsTable.id), amount: sum(taxObligationsTable.accruedAmount) })
      .from(taxObligationsTable)
      .where(and(
        sql`status != 'paid' AND status != 'cancelled'`,
        lte(taxObligationsTable.dueDate, today),
      ));

    const upcoming = await db
      .select()
      .from(taxObligationsTable)
      .where(and(
        sql`status != 'paid' AND status != 'cancelled'`,
        gte(taxObligationsTable.dueDate, today),
      ))
      .orderBy(taxObligationsTable.dueDate)
      .limit(5);

    const reserve = await db
      .select()
      .from(taxReserveTable)
      .orderBy(desc(taxReserveTable.periodMonth))
      .limit(1);

    const totalAccrued = parseFloat(String(totals?.totalAccrued ?? "0"));
    const totalPaid = parseFloat(String(totals?.totalPaid ?? "0"));

    res.json({
      totalAccrued,
      totalPaid,
      remaining: totalAccrued - totalPaid,
      overdueCount: Number(overdue?.cnt ?? 0),
      overdueAmount: parseFloat(String(overdue?.amount ?? "0")),
      upcoming,
      reserveBalance: parseFloat(String(reserve[0]?.reserveAmount ?? "0")),
      currentReserveMonth: reserve[0]?.periodMonth ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "GET /taxes/summary failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /taxes/months ────────────────────────────────────────────────────────

taxesModuleRouter.get("/taxes/months", async (req, res) => {
  try {
    const rows = await db
      .selectDistinct({ month: taxObligationsTable.periodMonth })
      .from(taxObligationsTable)
      .orderBy(desc(taxObligationsTable.periodMonth));
    res.json(rows.map((r) => r.month));
  } catch (err) {
    req.log.error({ err }, "GET /taxes/months failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /taxes/obligations ──────────────────────────────────────────────────

const obligationSchema = z.object({
  taxType: z.enum(["usn", "ndfl", "nds", "pfr", "fss", "other"]),
  taxName: z.string().optional(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  taxBase: z.number().optional(),
  taxRate: z.number().optional(),
  accruedAmount: z.number().positive(),
  notes: z.string().optional(),
});

taxesModuleRouter.post("/taxes/obligations", async (req, res) => {
  const parsed = obligationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: z.prettifyError(parsed.error) }); return; }

  try {
    const [row] = await db
      .insert(taxObligationsTable)
      .values({
        ...parsed.data,
        accruedAmount: String(parsed.data.accruedAmount),
        taxBase: parsed.data.taxBase != null ? String(parsed.data.taxBase) : null,
        taxRate: parsed.data.taxRate != null ? String(parsed.data.taxRate) : null,
      })
      .returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "POST /taxes/obligations failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── PATCH /taxes/obligations/:id ─────────────────────────────────────────────

taxesModuleRouter.patch("/taxes/obligations/:id", async (req, res) => {
  try {
    const { paidAmount, status, notes, operationId } = req.body as {
      paidAmount?: number; status?: string; notes?: string; operationId?: string;
    };

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (paidAmount !== undefined) {
      set["paidAmount"] = String(paidAmount);
      // Auto-update status
      const [cur] = await db.select().from(taxObligationsTable).where(eq(taxObligationsTable.id, req.params.id));
      if (cur) {
        const accrued = parseFloat(String(cur.accruedAmount));
        if (paidAmount >= accrued) set["status"] = "paid";
        else if (paidAmount > 0) set["status"] = "partial";
      }
    }
    if (status !== undefined) set["status"] = status;
    if (notes !== undefined) set["notes"] = notes;
    if (operationId !== undefined) set["operationId"] = operationId;

    const [updated] = await db
      .update(taxObligationsTable)
      .set(set)
      .where(eq(taxObligationsTable.id, req.params.id))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH /taxes/obligations/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /taxes/calendar ─────────────────────────────────────────────────────
// Returns a pivot: month × taxType with status + amounts

taxesModuleRouter.get("/taxes/calendar", async (req, res) => {
  try {
    const rows = await db.select({
      periodMonth: taxObligationsTable.periodMonth,
      taxType: taxObligationsTable.taxType,
      taxName: taxObligationsTable.taxName,
      status: taxObligationsTable.status,
      accrued: taxObligationsTable.accruedAmount,
      paid: taxObligationsTable.paidAmount,
      dueDate: taxObligationsTable.dueDate,
    }).from(taxObligationsTable).orderBy(desc(taxObligationsTable.periodMonth));

    // Group by month
    const byMonth: Record<string, {
      month: string;
      taxes: Array<{ taxType: string; taxName: string | null; status: string | null; accrued: string | null; paid: string | null; dueDate: string | null }>;
      totalAccrued: number;
      totalPaid: number;
      hasOverdue: boolean;
      allPaid: boolean;
    }> = {};

    for (const r of rows) {
      const m = r.periodMonth ?? "unknown";
      if (!byMonth[m]) byMonth[m] = { month: m, taxes: [], totalAccrued: 0, totalPaid: 0, hasOverdue: false, allPaid: false };
      byMonth[m].taxes.push({ taxType: r.taxType, taxName: r.taxName, status: r.status, accrued: r.accrued, paid: r.paid, dueDate: r.dueDate });
      byMonth[m].totalAccrued += parseFloat(String(r.accrued ?? 0));
      byMonth[m].totalPaid += parseFloat(String(r.paid ?? 0));
      if (r.status === "overdue") byMonth[m].hasOverdue = true;
    }

    for (const m of Object.values(byMonth)) {
      m.allPaid = m.taxes.length > 0 && m.taxes.every((t) => t.status === "paid" || t.status === "cancelled");
    }

    res.json(Object.values(byMonth).sort((a, b) => b.month.localeCompare(a.month)));
  } catch (err) {
    req.log.error({ err }, "GET /taxes/calendar failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /taxes/advisor ───────────────────────────────────────────────────────
// Rule-based AI recommendations

taxesModuleRouter.get("/taxes/advisor", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);
    const lastMonth = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();

    const obligations = await db.select().from(taxObligationsTable);
    const reserve = await db.select().from(taxReserveTable).orderBy(desc(taxReserveTable.periodMonth)).limit(3);

    const recommendations: Array<{ type: "danger" | "warning" | "info" | "ok"; title: string; body: string; action?: string }> = [];

    // 1. Overdue taxes
    const overdue = obligations.filter((o) => o.status === "overdue" || (o.dueDate && o.dueDate < today && o.status !== "paid" && o.status !== "cancelled"));
    if (overdue.length > 0) {
      recommendations.push({
        type: "danger",
        title: `⚠️ Просрочено: ${overdue.length} налог${overdue.length === 1 ? "" : "а/ов"}`,
        body: `Штраф за просрочку — 1/300 ставки ЦБ за каждый день. Суммарно просрочено: ${new Intl.NumberFormat("ru-RU").format(overdue.reduce((s, o) => s + parseFloat(String(o.accruedAmount ?? 0)), 0))} ₽.`,
        action: "Оплатить просроченные",
      });
    }

    // 2. Upcoming in 7 days
    const soon = obligations.filter((o) => {
      if (o.status === "paid" || o.status === "cancelled") return false;
      if (!o.dueDate) return false;
      const days = (new Date(o.dueDate).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
      return days >= 0 && days <= 7;
    });
    if (soon.length > 0) {
      recommendations.push({
        type: "warning",
        title: `⏰ Платежи на этой неделе: ${soon.length}`,
        body: `Ближайшие: ${soon.map((o) => `${o.taxName ?? o.taxType} — ${new Intl.NumberFormat("ru-RU").format(parseFloat(String(o.accruedAmount ?? 0)))} ₽`).join("; ")}.`,
        action: "Запланировать платёж",
      });
    }

    // 3. Missing reserve
    const latestReserve = reserve[0];
    if (!latestReserve) {
      recommendations.push({
        type: "warning",
        title: "💰 Налоговый резерв не заведён",
        body: "Рекомендуется откладывать резерв ежемесячно. Это защитит от неожиданных налоговых выплат.",
        action: "Завести резерв",
      });
    } else {
      const reserveAmount = parseFloat(String(latestReserve.reserveAmount ?? 0));
      const totalAccrued = obligations.filter((o) => o.periodMonth === thisMonth).reduce((s, o) => s + parseFloat(String(o.accruedAmount ?? 0)), 0);
      if (reserveAmount < totalAccrued * 0.5) {
        recommendations.push({
          type: "warning",
          title: "📉 Резерв ниже 50% налоговой нагрузки",
          body: `Резерв ${new Intl.NumberFormat("ru-RU").format(reserveAmount)} ₽ покрывает менее 50% текущих начислений (${new Intl.NumberFormat("ru-RU").format(totalAccrued)} ₽).`,
        });
      }
    }

    // 4. USN income limit warning (assuming 60M per year limit simplified)
    const thisYearTotal = obligations.filter((o) => o.periodMonth?.startsWith(thisMonth.slice(0, 4))).reduce((s, o) => s + parseFloat(String(o.accruedAmount ?? 0)), 0);
    if (thisYearTotal > 1_500_000) {
      recommendations.push({
        type: "warning",
        title: "📊 Высокая налоговая нагрузка за год",
        body: `Начислено ${new Intl.NumberFormat("ru-RU").format(thisYearTotal)} ₽ за год. Убедитесь, что доходы остаются в пределах порога УСН.`,
      });
    }

    // 5. No taxes for current month
    const thisMoObligations = obligations.filter((o) => o.periodMonth === thisMonth);
    if (thisMoObligations.length === 0) {
      recommendations.push({
        type: "info",
        title: `📋 Нет начислений за ${thisMonth}`,
        body: "Налоговые обязательства за текущий месяц не заведены. Убедитесь, что все начисления внесены.",
        action: "Добавить налог",
      });
    }

    // 6. All good
    if (overdue.length === 0 && soon.length === 0) {
      recommendations.push({
        type: "ok",
        title: "✅ Просроченных налогов нет",
        body: "Все налоговые обязательства в статусе «уплачен» или срок ещё не наступил.",
      });
    }

    // Summary stats
    const paidCount = obligations.filter((o) => o.status === "paid").length;
    const compliance = obligations.length > 0 ? Math.round((paidCount / obligations.length) * 100) : 100;

    res.json({
      recommendations,
      stats: {
        total: obligations.length,
        paid: paidCount,
        overdue: overdue.length,
        upcoming: soon.length,
        compliance,
        totalReserve: latestReserve ? parseFloat(String(latestReserve.reserveAmount)) : 0,
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET /taxes/advisor failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /taxes/reserve ──────────────────────────────────────────────────────

taxesModuleRouter.post("/taxes/reserve", async (req, res) => {
  const { periodMonth, reserveAmount, notes } = req.body as {
    periodMonth: string; reserveAmount: number; notes?: string;
  };

  if (!periodMonth || !reserveAmount) { res.status(400).json({ error: "periodMonth and reserveAmount required" }); return; }

  try {
    const [row] = await db
      .insert(taxReserveTable)
      .values({ periodMonth, reserveAmount: String(reserveAmount), notes: notes ?? null })
      .onConflictDoUpdate({
        target: taxReserveTable.periodMonth,
        set: { reserveAmount: String(reserveAmount), notes: notes ?? null, updatedAt: new Date() },
      })
      .returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "POST /taxes/reserve failed");
    res.status(500).json({ error: "Internal error" });
  }
});
