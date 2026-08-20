import { Router } from "express";
import { sql, desc, sum, count, and, gte, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { bankAccountsTable, bankTransactionsTable } from "@workspace/db";

export const bankingAnalyticsRouter = Router();

// ─── GET /banking/analytics ───────────────────────────────────────────────────
// Burn rate, runway, safe balance, cashflow trend — only from real bank_transactions.
// Returns null for burn rate / runway when no transaction data exists.

bankingAnalyticsRouter.get("/banking/analytics", async (req, res) => {
  try {
    // Total bank balance across all accounts
    const [balanceRow] = await db
      .select({ total: sql<string>`coalesce(sum(current_balance::numeric), 0)` })
      .from(bankAccountsTable);
    const bankBalance = parseFloat(String(balanceRow?.total ?? "0"));

    // Check if we have any transactions at all
    const [txCountRow] = await db
      .select({ cnt: count() })
      .from(bankTransactionsTable);
    const hasTransactionData = Number(txCountRow?.cnt ?? 0) > 0;

    if (!hasTransactionData) {
      res.json({
        bankBalance,
        avgBurnRate: null,
        avgIncome: null,
        runway: null,
        runwayMonths: null,
        safeBalance: null,
        isBelowSafe: null,
        safeBalanceGap: null,
        trend: [],
        hasTransactionData: false,
      });
      return;
    }

    // 3-month lookback for burn rate calculation
    const threeMonthsAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 7); // YYYY-MM

    // Monthly expenses from bank_transactions (last 3 months)
    const expenseRows = await db
      .select({
        month: sql<string>`to_char(${bankTransactionsTable.operationDate}, 'YYYY-MM')`,
        expenses: sum(bankTransactionsTable.amount),
      })
      .from(bankTransactionsTable)
      .where(and(
        eq(bankTransactionsTable.direction, "expense"),
        sql`${bankTransactionsTable.operationDate} IS NOT NULL`,
        gte(sql<string>`to_char(${bankTransactionsTable.operationDate}, 'YYYY-MM')`, threeMonthsAgo),
      ))
      .groupBy(sql`to_char(${bankTransactionsTable.operationDate}, 'YYYY-MM')`)
      .orderBy(desc(sql`to_char(${bankTransactionsTable.operationDate}, 'YYYY-MM')`))
      .limit(6);

    const recentExpenseMonths = expenseRows.slice(0, 3);
    const avgBurnRate = recentExpenseMonths.length > 0
      ? recentExpenseMonths.reduce((s, r) => s + parseFloat(String(r.expenses ?? "0")), 0) / recentExpenseMonths.length
      : null;

    // Monthly income (last 3 months)
    const incomeRows = await db
      .select({
        month: sql<string>`to_char(${bankTransactionsTable.operationDate}, 'YYYY-MM')`,
        income: sum(bankTransactionsTable.amount),
      })
      .from(bankTransactionsTable)
      .where(and(
        eq(bankTransactionsTable.direction, "income"),
        sql`${bankTransactionsTable.operationDate} IS NOT NULL`,
        gte(sql<string>`to_char(${bankTransactionsTable.operationDate}, 'YYYY-MM')`, threeMonthsAgo),
      ))
      .groupBy(sql`to_char(${bankTransactionsTable.operationDate}, 'YYYY-MM')`)
      .orderBy(desc(sql`to_char(${bankTransactionsTable.operationDate}, 'YYYY-MM')`))
      .limit(3);

    const avgIncome = incomeRows.length > 0
      ? incomeRows.reduce((s, r) => s + parseFloat(String(r.income ?? "0")), 0) / incomeRows.length
      : null;

    // Runway = balance / avg monthly burn rate
    const runway = avgBurnRate != null && avgBurnRate > 0 ? bankBalance / avgBurnRate : null;
    const safeBalance = avgBurnRate != null ? avgBurnRate * 2 : null;
    const isBelowSafe = safeBalance != null ? bankBalance < safeBalance : null;
    const safeBalanceGap = safeBalance != null ? Math.max(0, safeBalance - bankBalance) : null;

    // Cashflow trend (last 6 months)
    const trendMap: Record<string, { month: string; income: number; expense: number }> = {};
    for (const r of expenseRows) {
      if (!r.month) continue;
      if (!trendMap[r.month]) trendMap[r.month] = { month: r.month, income: 0, expense: 0 };
      trendMap[r.month].expense += parseFloat(String(r.expenses ?? "0"));
    }
    for (const r of incomeRows) {
      if (!r.month) continue;
      if (!trendMap[r.month]) trendMap[r.month] = { month: r.month, income: 0, expense: 0 };
      trendMap[r.month].income += parseFloat(String(r.income ?? "0"));
    }

    const trend = Object.values(trendMap)
      .map(d => ({ ...d, netCashflow: d.income - d.expense }))
      .sort((a, b) => a.month.localeCompare(b.month));

    res.json({
      bankBalance,
      avgBurnRate,
      avgIncome,
      runway,
      runwayMonths: runway != null ? Math.round(runway * 10) / 10 : null,
      safeBalance,
      isBelowSafe,
      safeBalanceGap,
      trend,
      hasTransactionData: true,
    });
  } catch (err) {
    req.log.error({ err }, "GET /banking/analytics failed");
    res.status(500).json({ error: "Internal error" });
  }
});
