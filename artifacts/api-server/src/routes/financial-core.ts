import { Router } from "express";
import { db } from "@workspace/db";
import {
  operations,
  articles,
  ddsCategoriesTable,
  opiuCategoriesTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, count, asc } from "drizzle-orm";

export const financialCoreRouter = Router();

// ─── GET /ledger/cashflow-report ──────────────────────────────────────────────
// DDS from ledger (operations table) grouped by cashflowMonth + direction + article.
// This is the SINGLE SOURCE OF TRUTH for DDS — never from bank_transactions directly.

financialCoreRouter.get("/ledger/cashflow-report", async (req, res) => {
  try {
    const { from, to } = req.query as Record<string, string | undefined>;
    const conditions = [eq(operations.isDeleted, false)];
    if (from) conditions.push(gte(operations.cashflowMonth, from));
    if (to)   conditions.push(lte(operations.cashflowMonth, to));

    // By article
    const byArticle = await db
      .select({
        cashflowMonth: operations.cashflowMonth,
        direction: operations.direction,
        articleId: operations.articleId,
        articleName: operations.articleName,
        articleCode: operations.articleCode,
        total:  sql<string>`SUM(${operations.amount})`,
        txCount: sql<string>`COUNT(*)`,
      })
      .from(operations)
      .where(and(...conditions))
      .groupBy(
        operations.cashflowMonth,
        operations.direction,
        operations.articleId,
        operations.articleName,
        operations.articleCode,
      )
      .orderBy(operations.cashflowMonth, operations.direction);

    // Monthly totals
    const monthly = await db
      .select({
        cashflowMonth: operations.cashflowMonth,
        direction: operations.direction,
        total:  sql<string>`SUM(${operations.amount})`,
        txCount: sql<string>`COUNT(*)`,
      })
      .from(operations)
      .where(and(...conditions))
      .groupBy(operations.cashflowMonth, operations.direction)
      .orderBy(operations.cashflowMonth);

    res.json({ byArticle, monthly });
  } catch (err) {
    req.log.error({ err }, "GET /ledger/cashflow-report failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /ledger/dds-categories ───────────────────────────────────────────────

financialCoreRouter.get("/ledger/dds-categories", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(ddsCategoriesTable)
      .where(eq(ddsCategoriesTable.isActive, true))
      .orderBy(ddsCategoriesTable.direction, ddsCategoriesTable.groupName, ddsCategoriesTable.category);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /ledger/pl-categories ────────────────────────────────────────────────

financialCoreRouter.get("/ledger/pl-categories", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(opiuCategoriesTable)
      .where(eq(opiuCategoriesTable.isActive, true))
      .orderBy(opiuCategoriesTable.type, opiuCategoriesTable.groupName, opiuCategoriesTable.category);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /ledger/articles-list ────────────────────────────────────────────────

financialCoreRouter.get("/ledger/articles-list", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(articles)
      .where(eq(articles.isActive, true))
      .orderBy(asc(articles.sortOrder), asc(articles.code));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /ledger/financial-stats ─────────────────────────────────────────────

financialCoreRouter.get("/ledger/financial-stats", async (req, res) => {
  try {
    const { month } = req.query as Record<string, string | undefined>;
    const conditions = [eq(operations.isDeleted, false)];
    if (month) conditions.push(eq(operations.cashflowMonth, month));

    const [totals] = await db
      .select({
        totalIncome:   sql<string>`COALESCE(SUM(CASE WHEN ${operations.direction} = 'in'  THEN ${operations.amount} ELSE 0 END), 0)`,
        totalExpense:  sql<string>`COALESCE(SUM(CASE WHEN ${operations.direction} = 'out' THEN ${operations.amount} ELSE 0 END), 0)`,
        totalCount:    count(),
        verifiedCount: sql<string>`COALESCE(SUM(CASE WHEN ${operations.verificationStatus} = 'verified' THEN 1 ELSE 0 END), 0)`,
        unmatchedCount: sql<string>`COALESCE(SUM(CASE WHEN ${operations.source} = 'bank_api' AND ${operations.verificationStatus} = 'unverified' THEN 1 ELSE 0 END), 0)`,
      })
      .from(operations)
      .where(and(...conditions));

    res.json({
      totalIncome:    parseFloat(totals?.totalIncome   ?? "0"),
      totalExpense:   parseFloat(totals?.totalExpense  ?? "0"),
      netCashflow:    parseFloat(totals?.totalIncome   ?? "0") - parseFloat(totals?.totalExpense ?? "0"),
      totalCount:     Number(totals?.totalCount ?? 0),
      verifiedCount:  parseInt(String(totals?.verifiedCount   ?? "0"), 10),
      unmatchedCount: parseInt(String(totals?.unmatchedCount  ?? "0"), 10),
    });
  } catch (err) {
    req.log.error({ err }, "GET /ledger/financial-stats failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /ledger/project-from-bank/:txId ────────────────────────────────────
// Manually project a bank_transaction into the ledger (operations).
// Also called automatically when a match action is applied.

financialCoreRouter.post("/ledger/project-from-bank/:txId", async (req, res) => {
  try {
    const { txId } = req.params;
    const result = await db.execute(
      sql`SELECT * FROM bank_transactions WHERE id = ${txId}::uuid LIMIT 1`
    );
    const tx = result.rows[0] as Record<string, unknown> | undefined;
    if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }

    const existing = await db.execute(
      sql`SELECT id FROM operations WHERE bank_transaction_id = ${txId} LIMIT 1`
    );

    const direction = tx.direction === "income" ? "in" : tx.direction === "expense" ? "out" : "internal";
    const opDate = tx.operation_date ? new Date(tx.operation_date as string) : new Date();
    const cashflowMonth = `${opDate.getFullYear()}-${String(opDate.getMonth() + 1).padStart(2, "0")}`;

    if ((existing.rows?.length ?? 0) > 0) {
      const opId = (existing.rows[0] as Record<string, unknown>)?.id;
      await db.execute(sql`
        UPDATE operations SET
          amount           = ${String(tx.amount ?? "0")},
          direction        = ${direction},
          cashflow_date    = ${opDate.toISOString()},
          cashflow_month   = ${cashflowMonth},
          counterparty_name = ${(tx.counterparty_name as string | null) ?? null},
          description      = ${(tx.purpose as string | null) ?? null},
          updated_at       = NOW()
        WHERE id = ${opId}::uuid
      `);
      res.json({ action: "updated", id: opId });
    } else {
      const insertResult = await db.execute(sql`
        INSERT INTO operations (
          id, operation_type, source, direction, amount, currency,
          description, cashflow_date, cashflow_month, pl_month,
          counterparty_name, bank_transaction_id,
          created_by, created_at, updated_at,
          is_deleted, payment_status, verification_status, trust_score
        ) VALUES (
          gen_random_uuid(), ${direction === "in" ? "income" : direction === "out" ? "expense" : "transfer"},
          'bank_api', ${direction}, ${String(tx.amount ?? "0")}, ${(tx.currency as string | null) ?? "RUB"},
          ${(tx.purpose as string | null) ?? null}, ${opDate.toISOString()}, ${cashflowMonth}, ${cashflowMonth},
          ${(tx.counterparty_name as string | null) ?? null}, ${txId},
          'system', NOW(), NOW(),
          false, 'paid', 'unverified', 50
        )
        RETURNING id
      `);
      const newId = (insertResult.rows?.[0] as Record<string, unknown>)?.id;
      res.json({ action: "created", id: newId });
    }
  } catch (err) {
    req.log.error({ err }, "POST /ledger/project-from-bank failed");
    res.status(500).json({ error: String(err) });
  }
});
