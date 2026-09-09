import { Router } from "express";
import { and, desc, eq, gte, lte, sql, sum, count } from "drizzle-orm";
import { db } from "@workspace/db";
import { operations, articles } from "@workspace/db";

export const pnlRouter = Router();

// ─── GET /pnl/months ──────────────────────────────────────────────────────────

pnlRouter.get("/pnl/months", async (req, res) => {
  try {
    const rows = await db
      .selectDistinct({ month: operations.plMonth })
      .from(operations)
      .where(sql`pl_month is not null and pl_month != ''`)
      .orderBy(desc(operations.plMonth));
    res.json(rows.map((r) => r.month).filter(Boolean));
  } catch (err) {
    req.log.error({ err }, "GET /pnl/months failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /pnl/summary ─────────────────────────────────────────────────────────
// Summary KPIs for a given plMonth

pnlRouter.get("/pnl/summary", async (req, res) => {
  try {
    const { month, branch } = req.query as { month?: string; branch?: string };

    const conditions = [];
    if (month) conditions.push(eq(operations.plMonth, month));
    if (branch) conditions.push(eq(operations.location, branch));
    // Only income/expense/payroll/tax affect P&L
    conditions.push(sql`${operations.direction} IN ('in', 'out')`);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        direction: operations.direction,
        affectsEbitda: articles.affectsEbitda,
        total: sum(operations.amount),
      })
      .from(operations)
      .leftJoin(articles, eq(operations.articleId, articles.id))
      .where(where)
      .groupBy(operations.direction, articles.affectsEbitda);

    let revenue = 0;
    let expenses = 0;
    let ebitdaRevenue = 0;
    let ebitdaExpenses = 0;

    for (const r of rows) {
      const amt = parseFloat(String(r.total ?? "0"));
      if (r.direction === "in") {
        revenue += amt;
        if (r.affectsEbitda) ebitdaRevenue += amt;
      } else if (r.direction === "out") {
        expenses += amt;
        if (r.affectsEbitda) ebitdaExpenses += amt;
      }
    }

    const grossProfit = revenue - expenses;
    const ebitda = ebitdaRevenue - ebitdaExpenses;
    const margin = revenue > 0 ? grossProfit / revenue : 0;

    // Count operations for trust score
    const [{ total: totalOps }] = await db
      .select({ total: count(operations.id) })
      .from(operations)
      .where(where);

    const noArticleConditions = [
      ...conditions,
      sql`${operations.articleId} IS NULL`,
    ];
    const [{ withoutArticle }] = await db
      .select({ withoutArticle: count(operations.id) })
      .from(operations)
      .where(and(...noArticleConditions));

    const trustScore =
      totalOps > 0
        ? Math.round(100 - (Number(withoutArticle) / Number(totalOps)) * 100)
        : 100;

    res.json({
      month: month ?? null,
      revenue,
      expenses,
      grossProfit,
      ebitda,
      margin,
      trustScore,
      totalOps: Number(totalOps),
      withoutArticle: Number(withoutArticle),
    });
  } catch (err) {
    req.log.error({ err }, "GET /pnl/summary failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /pnl/breakdown ───────────────────────────────────────────────────────
// Breakdown by article group

pnlRouter.get("/pnl/breakdown", async (req, res) => {
  try {
    const { month, branch } = req.query as { month?: string; branch?: string };

    const conditions = [];
    if (month) conditions.push(eq(operations.plMonth, month));
    if (branch) conditions.push(eq(operations.location, branch));
    conditions.push(sql`${operations.direction} IN ('in', 'out')`);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Get article group info via join
    const enriched = await db
      .select({
        direction: operations.direction,
        groupName: articles.groupName,
        articleCode: operations.articleCode,
        articleName: operations.articleName,
        total: sum(operations.amount),
        cnt: count(operations.id),
      })
      .from(operations)
      .leftJoin(articles, eq(operations.articleId, articles.id))
      .where(where)
      .groupBy(
        operations.direction,
        articles.groupName,
        operations.articleCode,
        operations.articleName,
      )
      .orderBy(
        operations.direction,
        articles.groupName,
        operations.articleName,
      );

    // (unused rows variable removed)

    // Group by direction → groupName → articles
    type ArticleRow = {
      code: string;
      name: string;
      amount: number;
      count: number;
    };
    type Group = { groupName: string; total: number; articles: ArticleRow[] };

    const income: Record<string, Group> = {};
    const expense: Record<string, Group> = {};

    for (const r of enriched) {
      const groupKey = r.groupName ?? "Без категории";
      const amt = parseFloat(String(r.total ?? "0"));
      const target = r.direction === "in" ? income : expense;

      if (!target[groupKey])
        target[groupKey] = { groupName: groupKey, total: 0, articles: [] };
      target[groupKey].total += amt;
      target[groupKey].articles.push({
        code: r.articleCode ?? "",
        name: r.articleName ?? "Без статьи",
        amount: amt,
        count: Number(r.cnt),
      });
    }

    res.json({
      income: Object.values(income).sort((a, b) => b.total - a.total),
      expense: Object.values(expense).sort((a, b) => b.total - a.total),
    });
  } catch (err) {
    req.log.error({ err }, "GET /pnl/breakdown failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /pnl/trend ───────────────────────────────────────────────────────────
// Monthly trend for last N months

pnlRouter.get("/pnl/trend", async (req, res) => {
  try {
    const { months = "6" } = req.query as { months?: string };
    const n = Math.min(Number(months), 24);

    const rows = await db
      .select({
        month: operations.plMonth,
        direction: operations.direction,
        total: sum(operations.amount),
      })
      .from(operations)
      .where(
        sql`${operations.direction} IN ('in','out') AND pl_month IS NOT NULL AND pl_month != ''`,
      )
      .groupBy(operations.plMonth, operations.direction)
      .orderBy(desc(operations.plMonth));

    const byMonth: Record<
      string,
      { month: string; revenue: number; expenses: number }
    > = {};
    for (const r of rows) {
      const m = r.month ?? "";
      if (!byMonth[m]) byMonth[m] = { month: m, revenue: 0, expenses: 0 };
      const amt = parseFloat(String(r.total ?? "0"));
      if (r.direction === "in") byMonth[m].revenue += amt;
      else if (r.direction === "out") byMonth[m].expenses += amt;
    }

    const trend = Object.values(byMonth)
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-n)
      .map((m) => ({
        ...m,
        grossProfit: m.revenue - m.expenses,
        margin: m.revenue > 0 ? (m.revenue - m.expenses) / m.revenue : 0,
      }));

    res.json(trend);
  } catch (err) {
    req.log.error({ err }, "GET /pnl/trend failed");
    res.status(500).json({ error: "Internal error" });
  }
});
