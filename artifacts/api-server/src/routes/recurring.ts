import { Router } from "express";
import { eq, and, lte, gte, sql as drizzleSql } from "drizzle-orm";
import { db, recurringObligationsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const recurringRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectType(c: string, p: string): string {
  c = c.toLowerCase(); p = p.toLowerCase();
  if (c.includes("тюрин") || p.includes("аренду части здания")) return "rent";
  if (c.includes("ер груп") && p.includes("аренд"))             return "rent";
  if (c.includes("тэк спб") || c.includes("петербургская сбытовая")) return "utilities";
  if (c.includes("газпромбанк автолизинг") || p.includes("финансовой аренды")) return "leasing";
  if (c.includes("казначейства") || p.includes("единый налоговый платеж")) return "taxes";
  if (c.includes("осфр") || p.includes("обязательное страхован"))           return "taxes";
  if (p.includes("реестру зачислений") || p.includes("зарплат") || p.includes("аванс по трудовому")) return "payroll";
  if (p.includes("самозанят"))           return "payroll";
  if (c.includes("весна") || c.includes("исмоилов") || p.includes("продукт") || p.includes("питани") || p.includes("мяс")) return "food";
  if (c.includes("манго телеком"))       return "telecom";
  if (c.includes("1с") || c.includes("рарус")) return "software";
  if (c.includes("охранная") || c.includes("секьюрити") || c.includes("безопасност") || c.includes("дезин")) return "security";
  if (c.includes("энет") || c.includes("вертикальный транспорт")) return "infrastructure";
  if (c.includes("инфотех") || c.includes("мальцев") || c.includes("технотек") || c.includes("смб-сервис") || c.includes("восток инновации")) return "infrastructure";
  if (c.includes("хэдхантер") || c.includes("агеева") || c.includes("демакин") || c.includes("лащ") || p.includes("реклам") || p.includes("таргет") || p.includes("контекст")) return "marketing";
  return "custom";
}

function shouldExclude(c: string, p: string): boolean {
  c = c.toLowerCase(); p = p.toLowerCase();
  if (c.includes("артхелло"))                return true; // own entity (main)
  if (c.includes("артхеллоостров"))          return true; // own entity (island branch)
  if (c.includes("детское образование"))     return true; // intercompany management co
  if (c.includes("ук детское"))              return true; // intercompany management co alt spelling
  if (c.includes("банк точка") || c.includes("банк \"точка\"")) return true; // own bank — mixed fee/transfer noise
  if (p.includes("фонд налоги"))             return true; // auto 6% tax fund micro-transfers
  if (p.includes("между своими счетами"))    return true; // own-account sweep
  if (p.includes("подотчет") || p.includes("подотчёт")) return true;
  if (p.includes("возмещени") && p.includes("лицу"))    return true; // petty cash reimbursements
  if (p.includes("покупка товара"))          return true; // card POS
  if (p.includes("спектакл") || p.includes("театр") || p.includes("гелий")) return true;
  return false;
}

function computeConfidence(months: number, avg: number, min: number, max: number): number {
  const variance = avg > 0 ? Math.abs(max - min) / avg : 0;
  if (months >= 3 && variance < 0.05) return 97;
  if (months >= 3 && variance < 0.20) return 88;
  if (months >= 3)                    return 75;
  if (months >= 2 && variance < 0.05) return 85;
  if (months >= 2 && variance < 0.20) return 72;
  return 65;
}

function shiftMonth(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function nextExpected(lastPaid: string | null, freq: string): string | null {
  if (!lastPaid) return null;
  const step = freq === "quarterly" ? 3 : freq === "yearly" ? 12 : 1;
  const today = new Date().toISOString().slice(0, 10);
  let next = shiftMonth(lastPaid, step);
  // Roll forward until the date is in the future (handles stale detection data)
  while (next < today) next = shiftMonth(next, step);
  return next;
}

// ─── GET /api/banking/recurring ───────────────────────────────────────────────

recurringRouter.get("/banking/recurring", async (req, res) => {
  try {
    const { status } = req.query as { status?: string };
    const rows = await db
      .select()
      .from(recurringObligationsTable)
      .where(
        status
          ? eq(recurringObligationsTable.status, status)
          : undefined
      )
      .orderBy(recurringObligationsTable.confidenceScore);

    res.json({ obligations: rows.reverse() });
  } catch (err) {
    req.log.error(err, "recurring list error");
    res.status(500).json({ error: "internal error" });
  }
});

// ─── GET /api/banking/recurring/upcoming ─────────────────────────────────────

recurringRouter.get("/banking/recurring/upcoming", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const inThirty = shiftMonth(today, 1);

    const rows = await db
      .select()
      .from(recurringObligationsTable)
      .where(
        and(
          eq(recurringObligationsTable.isActive, true),
          lte(recurringObligationsTable.nextExpectedDate, inThirty),
          gte(recurringObligationsTable.nextExpectedDate, today)
        )
      )
      .orderBy(recurringObligationsTable.nextExpectedDate);

    const totalExpected = rows.reduce(
      (sum, r) => sum + parseFloat(r.expectedAmount ?? "0"),
      0
    );

    res.json({ upcoming: rows, totalExpected: totalExpected.toFixed(2), asOf: today });
  } catch (err) {
    req.log.error(err, "recurring upcoming error");
    res.status(500).json({ error: "internal error" });
  }
});

// ─── POST /api/banking/recurring/detect ──────────────────────────────────────

recurringRouter.post("/banking/recurring/detect", async (req, res) => {
  try {
    // Query recurring candidates from bank_transactions
    type CandidateRow = {
      counterparty_name: string;
      direction: string;
      months_active: string;
      txn_count: string;
      avg_amount: string;
      min_amount: string;
      max_amount: string;
      sample_purpose: string;
      last_paid_date: string;
    };

    const candidates = await db.execute<CandidateRow>(drizzleSql`
      SELECT
        counterparty_name,
        direction,
        COUNT(DISTINCT TO_CHAR(operation_date, 'YYYY-MM'))::text AS months_active,
        COUNT(*)::text                                            AS txn_count,
        ROUND(AVG(amount::numeric), 2)::text                     AS avg_amount,
        MIN(amount::numeric)::text                               AS min_amount,
        MAX(amount::numeric)::text                               AS max_amount,
        MAX(purpose)                                             AS sample_purpose,
        MAX(operation_date)::text                                AS last_paid_date
      FROM bank_transactions
      WHERE (match_status IS NULL OR match_status != 'ignored')
        AND counterparty_name IS NOT NULL
        AND amount::numeric > 0
        AND direction = 'expense'
      GROUP BY counterparty_name, direction
      HAVING COUNT(DISTINCT TO_CHAR(operation_date, 'YYYY-MM')) >= 2
      ORDER BY COUNT(DISTINCT TO_CHAR(operation_date, 'YYYY-MM')) DESC, AVG(amount::numeric) DESC
    `);

    let inserted = 0;
    let updated  = 0;
    let skipped  = 0;

    for (const row of candidates.rows) {
      const cName   = row.counterparty_name ?? "";
      const purpose = row.sample_purpose   ?? "";
      const dir     = row.direction        ?? "expense";

      // Skip income (QR noise) unless it looks like a real B2B client
      if (dir === "income" && !purpose.toLowerCase().includes("оплата") && !cName.toLowerCase().includes("управляющая")) {
        skipped++;
        continue;
      }

      if (shouldExclude(cName, purpose)) { skipped++; continue; }

      const months  = parseInt(row.months_active, 10);
      const avg     = parseFloat(row.avg_amount);
      const min     = parseFloat(row.min_amount);
      const max     = parseFloat(row.max_amount);

      const confidence = computeConfidence(months, avg, min, max);
      if (confidence < 60) { skipped++; continue; }

      const type       = detectType(cName, purpose);
      const frequency  = "monthly";
      const lastPaid   = row.last_paid_date;
      const nextDate   = nextExpected(lastPaid, frequency);
      const title      = cName.replace(/^(ООО|ИП|АО|ОАО|ПАО|АНО|ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ|ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ)\s*"?/i, "").replace(/"/g, "").trim().slice(0, 80) || cName.slice(0, 80);

      // Upsert: match on counterparty_name + direction
      const existing = await db
        .select({ id: recurringObligationsTable.id, status: recurringObligationsTable.status })
        .from(recurringObligationsTable)
        .where(
          and(
            eq(recurringObligationsTable.counterpartyName, cName),
            eq(recurringObligationsTable.frequency, frequency)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        const ex = existing[0]!;
        // Don't overwrite user-approved/rejected
        if (ex.status === "approved" || ex.status === "rejected") { skipped++; continue; }
        await db
          .update(recurringObligationsTable)
          .set({
            expectedAmount:  avg.toFixed(2),
            minAmount:       min.toFixed(2),
            maxAmount:       max.toFixed(2),
            confidenceScore: confidence,
            lastPaidAt:      lastPaid,
            nextExpectedDate: nextDate,
            lastDetectedAt:  new Date(),
            updatedAt:       new Date(),
          })
          .where(eq(recurringObligationsTable.id, ex.id));
        updated++;
      } else {
        await db.insert(recurringObligationsTable).values({
          title,
          counterpartyName: cName,
          type,
          frequency,
          expectedAmount:   avg.toFixed(2),
          minAmount:        min.toFixed(2),
          maxAmount:        max.toFixed(2),
          currency:         "RUB",
          confidenceScore:  confidence,
          status:           "suggested",
          detectionSource:  "ai_pattern",
          lastPaidAt:       lastPaid,
          nextExpectedDate: nextDate,
          lastDetectedAt:   new Date(),
          isActive:         true,
          relatedParty:     false,
        });
        inserted++;
      }
    }

    logger.info({ inserted, updated, skipped }, "recurring detection complete");
    res.json({ ok: true, inserted, updated, skipped, total: inserted + updated });
  } catch (err) {
    req.log.error(err, "recurring detect error");
    res.status(500).json({ error: "internal error" });
  }
});

// ─── PATCH /api/banking/recurring/:id ────────────────────────────────────────

recurringRouter.patch("/banking/recurring/:id", async (req, res) => {
  const { id } = req.params;
  const { status, notes, expectedAmount, dayOfMonth, isActive } = req.body as {
    status?: string;
    notes?: string;
    expectedAmount?: string;
    dayOfMonth?: number;
    isActive?: boolean;
  };

  try {
    const allowed = ["suggested", "approved", "rejected"];
    if (status && !allowed.includes(status)) {
      res.status(400).json({ error: "invalid status" });
      return;
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (status        !== undefined) patch.status        = status;
    if (notes         !== undefined) patch.notes         = notes;
    if (expectedAmount !== undefined) patch.expectedAmount = expectedAmount;
    if (dayOfMonth    !== undefined) patch.dayOfMonth    = dayOfMonth;
    if (isActive      !== undefined) patch.isActive      = isActive;

    const rows = await db
      .update(recurringObligationsTable)
      .set(patch)
      .where(eq(recurringObligationsTable.id, id))
      .returning();

    if (rows.length === 0) {
      res.status(404).json({ error: "not found" });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    req.log.error(err, "recurring patch error");
    res.status(500).json({ error: "internal error" });
  }
});
