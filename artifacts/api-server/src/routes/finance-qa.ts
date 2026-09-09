import { Router } from "express";
import { db } from "@workspace/db";
import { operations } from "@workspace/db";
import { sql, eq, ne, and, isNull } from "drizzle-orm";

export const financeQaRouter = Router();

// GET /qa/summary — full Finance QA snapshot
financeQaRouter.get("/qa/summary", async (req, res) => {
  try {
    const base = and(eq(operations.isDeleted, false));

    const [
      [total],
      monthRows,
      [noArt],
      [noDocs],
      [split],
      [unver],
      trustRows,
      typeRows,
      dirRows,
    ] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(operations)
        .where(base),

      db
        .selectDistinct({ month: operations.cashflowMonth })
        .from(operations)
        .where(base)
        .orderBy(operations.cashflowMonth),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(operations)
        .where(and(base, isNull(operations.articleId))),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(operations)
        .where(
          and(
            base,
            sql`(${operations.documentRefs} IS NULL OR ${operations.documentRefs}::text IN ('','[]'))`,
          ),
        ),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(operations)
        .where(and(base, ne(operations.cashflowMonth, operations.plMonth))),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(operations)
        .where(and(base, eq(operations.verificationStatus, "unverified"))),

      db
        .select({
          month: operations.cashflowMonth,
          avgTrust: sql<number>`round(avg(${operations.trustScore}))::int`,
          count: sql<number>`count(*)::int`,
          noArt: sql<number>`count(*) filter (where ${operations.articleId} is null)::int`,
          noDocs: sql<number>`count(*) filter (where ${operations.documentRefs} is null or ${operations.documentRefs}::text in ('','[]'))::int`,
          split: sql<number>`count(*) filter (where ${operations.cashflowMonth} <> ${operations.plMonth})::int`,
        })
        .from(operations)
        .where(base)
        .groupBy(operations.cashflowMonth)
        .orderBy(operations.cashflowMonth),

      db
        .select({
          type: operations.operationType,
          count: sql<number>`count(*)::int`,
          total: sql<number>`sum(${operations.amount}::numeric)::float`,
        })
        .from(operations)
        .where(base)
        .groupBy(operations.operationType),

      db
        .select({
          month: operations.cashflowMonth,
          direction: operations.direction,
          total: sql<number>`sum(${operations.amount}::numeric)::float`,
        })
        .from(operations)
        .where(base)
        .groupBy(operations.cashflowMonth, operations.direction)
        .orderBy(operations.cashflowMonth),
    ]);

    res.json({
      totalOperations: Number(total.count),
      monthsWithData: monthRows.map((r) => r.month),
      issues: {
        noArticle: Number(noArt.count),
        noDocuments: Number(noDocs.count),
        splitPeriod: Number(split.count),
        unverified: Number(unver.count),
      },
      trustByMonth: trustRows.map((r) => ({
        month: r.month,
        avgTrust: Number(r.avgTrust),
        count: Number(r.count),
        issues: Number(r.noArt) + Number(r.noDocs) + Number(r.split),
      })),
      byType: typeRows.map((r) => ({
        type: r.type,
        count: Number(r.count),
        total: Number(r.total ?? 0),
      })),
      cashflowByMonth: dirRows.reduce<
        Record<string, { in: number; out: number }>
      >((acc, r) => {
        if (!acc[r.month]) acc[r.month] = { in: 0, out: 0 };
        if (r.direction === "in") acc[r.month].in = Number(r.total ?? 0);
        if (r.direction === "out") acc[r.month].out = Number(r.total ?? 0);
        return acc;
      }, {}),
    });
  } catch (err) {
    req.log.error({ err }, "GET /qa/summary failed");
    res.status(500).json({ error: "Internal error" });
  }
});
