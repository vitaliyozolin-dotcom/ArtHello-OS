import { Router } from "express";
import { eq, sql, count, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  monthClosingsTable,
  operations,
  taxObligationsTable,
  staffPayoutsTable,
} from "@workspace/db";

export const monthClosingRouter = Router();

// ─── GET /months/:month/status ────────────────────────────────────────────────

monthClosingRouter.get("/months/:month/status", async (req, res) => {
  try {
    const { month } = req.params;

    const [closing] = await db
      .select()
      .from(monthClosingsTable)
      .where(eq(monthClosingsTable.periodMonth, month));

    // Build checklist in real-time
    const [opsTotal] = await db
      .select({ cnt: count(operations.id) })
      .from(operations)
      .where(
        and(eq(operations.plMonth, month), sql`direction IN ('in','out')`),
      );

    const [opsUnverified] = await db
      .select({ cnt: count(operations.id) })
      .from(operations)
      .where(
        and(
          eq(operations.plMonth, month),
          eq(operations.verificationStatus, "unverified"),
          sql`direction IN ('in','out')`,
        ),
      );

    const [opsNoArticle] = await db
      .select({ cnt: count(operations.id) })
      .from(operations)
      .where(
        and(
          eq(operations.plMonth, month),
          sql`article_id IS NULL AND direction IN ('in','out')`,
        ),
      );

    const [taxCount] = await db
      .select({ cnt: count(taxObligationsTable.id) })
      .from(taxObligationsTable)
      .where(eq(taxObligationsTable.periodMonth, month));

    const [payrollCount] = await db
      .select({ cnt: count(staffPayoutsTable.id) })
      .from(staffPayoutsTable)
      .where(eq(staffPayoutsTable.periodMonth, month));

    const totalOps = Number(opsTotal?.cnt ?? 0);
    const unverified = Number(opsUnverified?.cnt ?? 0);
    const noArticle = Number(opsNoArticle?.cnt ?? 0);

    const checklist = {
      allOpsVerified: {
        ok: unverified === 0,
        count: totalOps,
        issues: unverified,
      },
      articlesCovered: {
        ok: noArticle === 0,
        count: totalOps,
        issues: noArticle,
      },
      taxesAccrued: {
        ok: Number(taxCount?.cnt ?? 0) > 0,
        count: Number(taxCount?.cnt ?? 0),
      },
      payrollPaid: {
        ok: Number(payrollCount?.cnt ?? 0) > 0,
        count: Number(payrollCount?.cnt ?? 0),
      },
    };

    const canClose =
      checklist.allOpsVerified.ok && checklist.articlesCovered.ok;

    res.json({
      month,
      status: closing?.status ?? "open",
      closing: closing ?? null,
      checklist,
      canClose,
      operationsCount: totalOps,
    });
  } catch (err) {
    req.log.error({ err }, "GET /months/:month/status failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /months ──────────────────────────────────────────────────────────────

monthClosingRouter.get("/months", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(monthClosingsTable)
      .orderBy(monthClosingsTable.periodMonth);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /months failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /months/:month/close ────────────────────────────────────────────────

monthClosingRouter.post("/months/:month/close", async (req, res) => {
  try {
    const { month } = req.params;
    const {
      closedBy = "owner",
      notes,
      force = false,
    } = req.body as {
      closedBy?: string;
      notes?: string;
      force?: boolean;
    };

    // Snapshot P&L values at close time
    const [incomeRow] = await db
      .select({ total: sql<string>`coalesce(sum(amount::numeric), 0)` })
      .from(operations)
      .where(
        and(eq(operations.plMonth, month), eq(operations.direction, "in")),
      );

    const [expenseRow] = await db
      .select({ total: sql<string>`coalesce(sum(amount::numeric), 0)` })
      .from(operations)
      .where(
        and(eq(operations.plMonth, month), eq(operations.direction, "out")),
      );

    const [totalOpsRow] = await db
      .select({ cnt: count(operations.id) })
      .from(operations)
      .where(
        and(eq(operations.plMonth, month), sql`direction IN ('in','out')`),
      );

    const [unverifiedRow] = await db
      .select({ cnt: count(operations.id) })
      .from(operations)
      .where(
        and(
          eq(operations.plMonth, month),
          eq(operations.verificationStatus, "unverified"),
        ),
      );

    const [noArticleRow] = await db
      .select({ cnt: count(operations.id) })
      .from(operations)
      .where(
        and(
          eq(operations.plMonth, month),
          sql`article_id IS NULL AND direction IN ('in','out')`,
        ),
      );

    const revenue = parseFloat(String(incomeRow?.total ?? "0"));
    const expenses = parseFloat(String(expenseRow?.total ?? "0"));
    const grossProfit = revenue - expenses;
    const margin = revenue > 0 ? grossProfit / revenue : 0;
    const totalOps = Number(totalOpsRow?.cnt ?? 0);
    const unverified = Number(unverifiedRow?.cnt ?? 0);
    const noArticle = Number(noArticleRow?.cnt ?? 0);
    const trustScore =
      totalOps > 0
        ? Math.max(
            0,
            Math.round(
              100 - (unverified / totalOps) * 40 - (noArticle / totalOps) * 40,
            ),
          )
        : 100;

    const data = {
      periodMonth: month,
      status: "closed",
      snapshotRevenue: String(revenue),
      snapshotExpenses: String(expenses),
      snapshotGrossProfit: String(grossProfit),
      snapshotMargin: String(margin),
      snapshotOperationsCount: totalOps,
      snapshotTrustScore: trustScore,
      checkAllOpsVerified: unverified === 0,
      checkArticlesCovered: noArticle === 0,
      closedBy,
      closedAt: new Date(),
      notes: notes ?? null,
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(monthClosingsTable)
      .values(data)
      .onConflictDoUpdate({ target: monthClosingsTable.periodMonth, set: data })
      .returning();

    res.json(row);
  } catch (err) {
    req.log.error({ err }, "POST /months/:month/close failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /months/:month/reopen ───────────────────────────────────────────────

monthClosingRouter.post("/months/:month/reopen", async (req, res) => {
  try {
    const { month } = req.params;
    const { reopenedBy = "owner" } = req.body as { reopenedBy?: string };

    const [row] = await db
      .update(monthClosingsTable)
      .set({
        status: "open",
        reopenedBy,
        reopenedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(monthClosingsTable.periodMonth, month))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Month record not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "POST /months/:month/reopen failed");
    res.status(500).json({ error: "Internal error" });
  }
});
