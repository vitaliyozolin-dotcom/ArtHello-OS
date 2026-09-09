import { Router } from "express";
import { desc, eq, sql, count, and, sum } from "drizzle-orm";
import { db } from "@workspace/db";
import { operations } from "@workspace/db";

export const trustScoreRouter = Router();

// ─── GET /trust-score/monthly ─────────────────────────────────────────────────
// Trust score per month (last N months)

trustScoreRouter.get("/trust-score/monthly", async (req, res) => {
  try {
    const { months = "12" } = req.query as { months?: string };
    const n = Math.min(Number(months), 24);

    // Get distinct months
    const monthRows = await db
      .selectDistinct({ month: operations.plMonth })
      .from(operations)
      .where(sql`pl_month IS NOT NULL AND pl_month != ''`)
      .orderBy(desc(operations.plMonth))
      .limit(n);

    const result = await Promise.all(
      monthRows.map(async ({ month }) => {
        if (!month) return null;

        const [total] = await db
          .select({
            cnt: count(operations.id),
            revenue: sum(operations.amount),
          })
          .from(operations)
          .where(
            and(eq(operations.plMonth, month), sql`direction IN ('in','out')`),
          );

        const [noArticle] = await db
          .select({ cnt: count(operations.id) })
          .from(operations)
          .where(
            and(
              eq(operations.plMonth, month),
              sql`article_id IS NULL AND direction IN ('in','out')`,
            ),
          );

        const [unverified] = await db
          .select({ cnt: count(operations.id) })
          .from(operations)
          .where(
            and(
              eq(operations.plMonth, month),
              eq(operations.verificationStatus, "unverified"),
            ),
          );

        const [highAmount] = await db
          .select({ cnt: count(operations.id) })
          .from(operations)
          .where(
            and(eq(operations.plMonth, month), sql`amount::numeric > 500000`),
          );

        const totalOps = Number(total?.cnt ?? 0);
        const noArticleCnt = Number(noArticle?.cnt ?? 0);
        const unverifiedCnt = Number(unverified?.cnt ?? 0);
        const highAmtCnt = Number(highAmount?.cnt ?? 0);

        // Score = 100 - penalties
        const noArticlePenalty =
          totalOps > 0 ? (noArticleCnt / totalOps) * 40 : 0;
        const unverifiedPenalty =
          totalOps > 0 ? (unverifiedCnt / totalOps) * 40 : 0;
        const highAmtPenalty = highAmtCnt * 5;
        const score = Math.max(
          0,
          Math.round(
            100 -
              noArticlePenalty -
              unverifiedPenalty -
              Math.min(highAmtPenalty, 20),
          ),
        );

        return {
          month,
          score,
          totalOps,
          issues: {
            noArticle: noArticleCnt,
            unverified: unverifiedCnt,
            highAmount: highAmtCnt,
          },
        };
      }),
    );

    res.json(
      result.filter(Boolean).sort((a, b) => a!.month.localeCompare(b!.month)),
    );
  } catch (err) {
    req.log.error({ err }, "GET /trust-score/monthly failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /trust-score/issues ──────────────────────────────────────────────────
// List of concrete problematic operations for a given month

trustScoreRouter.get("/trust-score/issues", async (req, res) => {
  try {
    const { month } = req.query as { month?: string };

    const baseCondition = month
      ? and(eq(operations.plMonth, month))
      : undefined;

    // No article
    const noArticle = await db
      .select({
        id: operations.id,
        description: operations.description,
        amount: operations.amount,
        direction: operations.direction,
        cashflowDate: operations.cashflowDate,
        plMonth: operations.plMonth,
        issue: sql<string>`'no_article'`,
      })
      .from(operations)
      .where(
        and(
          baseCondition,
          sql`article_id IS NULL AND direction IN ('in','out')`,
        ),
      )
      .orderBy(desc(operations.amount))
      .limit(50);

    // Unverified
    const unverified = await db
      .select({
        id: operations.id,
        description: operations.description,
        amount: operations.amount,
        direction: operations.direction,
        cashflowDate: operations.cashflowDate,
        plMonth: operations.plMonth,
        issue: sql<string>`'unverified'`,
      })
      .from(operations)
      .where(
        and(
          baseCondition,
          eq(operations.verificationStatus, "unverified"),
          sql`direction IN ('in','out')`,
        ),
      )
      .orderBy(desc(operations.amount))
      .limit(50);

    // High amount without description
    const highAmount = await db
      .select({
        id: operations.id,
        description: operations.description,
        amount: operations.amount,
        direction: operations.direction,
        cashflowDate: operations.cashflowDate,
        plMonth: operations.plMonth,
        issue: sql<string>`'high_amount'`,
      })
      .from(operations)
      .where(
        and(
          baseCondition,
          sql`amount::numeric > 500000 AND direction IN ('in','out')`,
        ),
      )
      .orderBy(desc(operations.amount))
      .limit(20);

    const all = [...noArticle, ...unverified, ...highAmount].sort(
      (a, b) => parseFloat(String(b.amount)) - parseFloat(String(a.amount)),
    );

    res.json({
      month: month ?? null,
      total: all.length,
      issues: all,
    });
  } catch (err) {
    req.log.error({ err }, "GET /trust-score/issues failed");
    res.status(500).json({ error: "Internal error" });
  }
});
