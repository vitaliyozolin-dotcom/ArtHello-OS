import { Router } from "express";
import { eq, and, sql, count, gte, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  bankTransactionsTable,
  familiesTable,
  personsTable,
  guardianStudentLinksTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";

// ─── Helper: project a bank transaction into the operations ledger ─────────────
// Throws on failure — callers must handle errors explicitly (no silent catch).

async function projectToLedger(
  txId: string,
  matchData: {
    familyId?: string;
    contractorId?: string;
    employeeId?: string;
    articleId?: string;
  }
): Promise<{ action: "created" | "updated"; operationId: string }> {
  const result = await db.execute(
    sql`SELECT * FROM bank_transactions WHERE id = ${txId}::uuid LIMIT 1`
  );
  const tx = result.rows[0] as Record<string, unknown> | undefined;
  if (!tx) throw new Error(`Transaction ${txId} not found`);

  const direction = tx.direction === "income" ? "in" : tx.direction === "expense" ? "out" : "internal";
  const opDate = tx.operation_date ? new Date(tx.operation_date as string) : new Date();
  const cashflowMonth = `${opDate.getFullYear()}-${String(opDate.getMonth() + 1).padStart(2, "0")}`;
  const operationType = direction === "in" ? "income" : direction === "out" ? "expense" : "transfer";
  const counterpartyType = matchData.familyId ? "family"
    : matchData.contractorId ? "contractor"
    : matchData.employeeId  ? "employee"
    : null;

  // Resolve article name/code if articleId provided
  let articleName: string | null = null;
  let articleCode: string | null = null;
  if (matchData.articleId) {
    const artRows = await db.execute(
      sql`SELECT name, code FROM articles WHERE id = ${matchData.articleId}::uuid AND is_active = true LIMIT 1`
    );
    const art = artRows.rows[0] as Record<string, unknown> | undefined;
    articleName = (art?.name as string | null) ?? null;
    articleCode = (art?.code as string | null) ?? null;
  }

  // Check for existing non-deleted operation linked to this transaction
  const existing = await db.execute(
    sql`SELECT id FROM operations WHERE bank_transaction_id = ${txId} AND is_deleted = false LIMIT 1`
  );

  if ((existing.rows?.length ?? 0) > 0) {
    const opId = (existing.rows[0] as Record<string, unknown>)?.id as string;
    // Full refresh: update all projectable fields so re-matching is idempotent
    await db.execute(sql`
      UPDATE operations SET
        operation_type    = ${operationType},
        source            = 'bank_api',
        direction         = ${direction},
        amount            = ${String(tx.amount ?? "0")},
        cashflow_date     = ${opDate.toISOString()},
        cashflow_month    = ${cashflowMonth},
        pl_month          = ${cashflowMonth},
        description       = COALESCE(NULLIF(description, ''), ${(tx.purpose as string | null) ?? null}),
        counterparty_name = ${(tx.counterparty_name as string | null) ?? null},
        counterparty_type = ${counterpartyType},
        article_id        = ${matchData.articleId   ?? null},
        article_name      = ${articleName},
        article_code      = ${articleCode},
        family_id         = ${matchData.familyId     ?? null},
        contractor_id     = ${matchData.contractorId ?? null},
        employee_id       = ${matchData.employeeId   ?? null},
        updated_at        = NOW()
      WHERE id = ${opId}::uuid
    `);
    await db.execute(sql`
      UPDATE bank_transactions SET matched_operation_id = ${opId} WHERE id = ${txId}::uuid
    `);
    return { action: "updated", operationId: opId };
  } else {
    const insertResult = await db.execute(sql`
      INSERT INTO operations (
        id, operation_type, source, direction, amount, currency,
        description, cashflow_date, cashflow_month, pl_month,
        counterparty_name, counterparty_type, bank_transaction_id,
        article_id, article_name, article_code,
        family_id, contractor_id, employee_id,
        created_by, created_at, updated_at,
        is_deleted, payment_status, verification_status, trust_score
      ) VALUES (
        gen_random_uuid(),
        ${operationType}, 'bank_api', ${direction},
        ${String(tx.amount ?? "0")}, ${(tx.currency as string | null) ?? "RUB"},
        ${(tx.purpose as string | null) ?? null},
        ${opDate.toISOString()}, ${cashflowMonth}, ${cashflowMonth},
        ${(tx.counterparty_name as string | null) ?? null}, ${counterpartyType},
        ${txId},
        ${matchData.articleId   ?? null}, ${articleName}, ${articleCode},
        ${matchData.familyId     ?? null},
        ${matchData.contractorId ?? null},
        ${matchData.employeeId   ?? null},
        'system', NOW(), NOW(),
        false, 'paid', 'unverified', 50
      )
      RETURNING id
    `);
    const newId = (insertResult.rows?.[0] as Record<string, unknown>)?.id as string;
    if (!newId) throw new Error("INSERT into operations returned no id");
    await db.execute(sql`
      UPDATE bank_transactions SET matched_operation_id = ${newId} WHERE id = ${txId}::uuid
    `);
    return { action: "created", operationId: newId };
  }
}

export const bankingMatchRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function last10digits(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\D/g, "").slice(-10);
}

function scorePhoneInText(phone: string | null, text: string): number {
  if (!phone || !text) return 0;
  const digits = last10digits(phone);
  if (digits.length < 7) return 0;
  if (text.replace(/\D/g, "").includes(digits.slice(-7))) return 40;
  return 0;
}

function scoreNameInText(name: string | null, text: string): number {
  if (!name || !text) return 0;
  const ltext = text.toLowerCase();
  const words = name
    .toLowerCase()
    .split(/[\s,.]+/)
    .filter((w) => w.length >= 4);
  if (words.length === 0) return 0;
  const matched = words.filter((w) => ltext.includes(w));
  if (matched.length === 0) return 0;
  return Math.round((matched.length / Math.max(words.length, 1)) * 35);
}

// ─── Family match target ───────────────────────────────────────────────────────

interface FamilyTarget {
  familyId: string;
  familyName: string | null;
  primaryPhone: string | null;
  guardianName: string | null;
  studentNames: string[];
}

async function loadFamilyTargets(): Promise<FamilyTarget[]> {
  const rows = await db
    .select({
      familyId: familiesTable.id,
      familyName: familiesTable.familyName,
      primaryPhone: familiesTable.primaryPhone,
      guardianName: personsTable.fullName,
    })
    .from(familiesTable)
    .leftJoin(personsTable, eq(personsTable.id, familiesTable.primaryGuardianPersonId));

  const targets: FamilyTarget[] = [];
  for (const row of rows) {
    const links = await db
      .select({ studentCrmId: guardianStudentLinksTable.studentCrmId })
      .from(guardianStudentLinksTable)
      .where(eq(guardianStudentLinksTable.guardianPersonId, row.familyId));

    let studentNames: string[] = [];
    if (links.length > 0) {
      const ids = links.map((l) => l.studentCrmId).filter(Boolean);
      if (ids.length > 0) {
        try {
          const students = await db.execute(
            sql`SELECT name FROM crm_students WHERE crm_id = ANY(${ids}::text[])`
          );
          studentNames = (students.rows as Array<{ name: string | null }>)
            .map((s) => s.name ?? "")
            .filter(Boolean);
        } catch {
          // crm_students may not exist yet — non-fatal
        }
      }
    }

    targets.push({
      familyId: row.familyId,
      familyName: row.familyName,
      primaryPhone: row.primaryPhone,
      guardianName: row.guardianName,
      studentNames,
    });
  }
  return targets;
}

function scoreTransaction(
  purpose: string | null,
  counterparty: string | null,
  families: FamilyTarget[],
): { familyId: string; confidence: number } | null {
  const text = [purpose, counterparty].filter(Boolean).join(" ");
  if (!text.trim()) return null;

  let best: { familyId: string; score: number } | null = null;

  for (const fam of families) {
    let score = 0;
    score += scorePhoneInText(fam.primaryPhone, text);
    score += scoreNameInText(fam.guardianName, text);
    score += scoreNameInText(fam.familyName, text);
    for (const sn of fam.studentNames) {
      score += scoreNameInText(sn, text);
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { familyId: fam.familyId, score };
    }
  }

  if (!best || best.score < 15) return null;
  const confidence = Math.min(100, Math.round(best.score));
  return { familyId: best.familyId, confidence };
}

// ─── POST /banking/run-matching ───────────────────────────────────────────────

bankingMatchRouter.post("/banking/run-matching", async (req, res) => {
  try {
    const { connectorId } = req.body as { connectorId?: string };

    const unmatchedQuery = db
      .select({
        id: bankTransactionsTable.id,
        purpose: bankTransactionsTable.purpose,
        counterpartyName: bankTransactionsTable.counterpartyName,
        amount: bankTransactionsTable.amount,
        operationDate: bankTransactionsTable.operationDate,
      })
      .from(bankTransactionsTable)
      .where(
        and(
          eq(bankTransactionsTable.matchStatus, "unmatched"),
          eq(bankTransactionsTable.direction, "income"),
          ...(connectorId ? [eq(bankTransactionsTable.bankConnectorId, connectorId)] : []),
        )
      )
      .limit(500);

    const txns = await unmatchedQuery;

    if (txns.length === 0) {
      res.json({ matched: 0, suggested: 0, skipped: 0, total: 0, message: "Нет несопоставленных поступлений" });
      return;
    }

    const families = await loadFamilyTargets();

    if (families.length === 0) {
      res.json({ matched: 0, suggested: 0, skipped: txns.length, total: txns.length, message: "Нет семей для сопоставления. Запустите «Построить семьи» сначала." });
      return;
    }

    let matched = 0;
    let suggested = 0;
    let skipped = 0;

    for (const txn of txns) {
      const result = scoreTransaction(txn.purpose, txn.counterpartyName, families);

      if (!result) {
        skipped++;
        continue;
      }

      const { familyId, confidence } = result;
      const matchStatus = confidence >= 85 ? "matched" : confidence >= 50 ? "suggested" : null;

      if (!matchStatus) {
        skipped++;
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.update(bankTransactionsTable) as any)
        .set({
          matchStatus,
          matchType: "auto",
          matchConfidence: confidence,
          matchedFamilyId: familyId,
          matchedAt: new Date(),
        })
        .where(eq(bankTransactionsTable.id, txn.id));

      if (matchStatus === "matched") {
        matched++;
        // Project matched transaction into operations ledger.
        // article_id is unknown at auto-match time — operation is created without it
        // so it appears in DDS; article can be assigned later via manual re-match.
        try {
          await projectToLedger(txn.id, { familyId });
        } catch (projErr) {
          req.log.warn(
            { txId: txn.id, err: projErr },
            "run-matching: projectToLedger failed — match status kept, operation skipped"
          );
        }
      } else {
        suggested++;
      }
    }

    req.log.info({ total: txns.length, matched, suggested, skipped }, "Banking: run-matching complete");
    res.json({ matched, suggested, skipped, total: txns.length });
  } catch (err) {
    req.log.error({ err }, "POST /banking/run-matching failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /banking/transactions ────────────────────────────────────────────────

bankingMatchRouter.get("/banking/transactions", async (req, res) => {
  try {
    const {
      matchStatus,
      direction,
      connectorId,
      limit: limitStr = "200",
      offset: offsetStr = "0",
    } = req.query as Record<string, string | undefined>;

    const conditions = [];
    if (matchStatus) conditions.push(eq(bankTransactionsTable.matchStatus, matchStatus));
    if (direction)   conditions.push(eq(bankTransactionsTable.direction, direction));
    if (connectorId) conditions.push(eq(bankTransactionsTable.bankConnectorId, connectorId));

    const limit  = Math.min(500, parseInt(limitStr  ?? "200", 10));
    const offset = parseInt(offsetStr ?? "0", 10);

    const [rows, [{ total }]] = await Promise.all([
      db.select()
        .from(bankTransactionsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(sql`${bankTransactionsTable.operationDate} DESC NULLS LAST`)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() })
        .from(bankTransactionsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined),
    ]);

    res.json({ transactions: rows, total: Number(total), limit, offset });
  } catch (err) {
    req.log.error({ err }, "GET /banking/transactions failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /banking/match-stats ─────────────────────────────────────────────────

bankingMatchRouter.get("/banking/match-stats", async (req, res) => {
  try {
    const { from, to } = req.query as Record<string, string | undefined>;
    const conditions = [];
    if (from) conditions.push(gte(bankTransactionsTable.operationDate, from as string));
    if (to)   conditions.push(lte(bankTransactionsTable.operationDate, to as string));

    const rows = await db
      .select({ matchStatus: bankTransactionsTable.matchStatus, cnt: count() })
      .from(bankTransactionsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(bankTransactionsTable.matchStatus);

    const map: Record<string, number> = {};
    for (const r of rows) { map[r.matchStatus ?? "null"] = Number(r.cnt); }

    res.json({
      unmatched:        map["unmatched"]         ?? 0,
      matched:          map["matched"]           ?? 0,
      suggested:        map["suggested"]         ?? 0,
      ignored:          map["ignored"]           ?? 0,
      internalTransfer: map["internal_transfer"] ?? 0,
      total: Object.values(map).reduce((a, b) => a + b, 0),
    });
  } catch (err) {
    req.log.error({ err }, "GET /banking/match-stats failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── PATCH /banking/transactions/:id/match ────────────────────────────────────
// Apply a manual match action to a transaction.
// - match_* actions: project into operations with articleId; set matched_operation_id
// - ignore: set matchStatus=ignored; do NOT create/update an operation
// - internal_transfer: set matchStatus=internal_transfer; do NOT create operation
//   (internal transfers are excluded from DDS by convention)
// - unmatch: soft-delete linked operation; clear matched_operation_id

bankingMatchRouter.patch("/banking/transactions/:id/match", async (req, res) => {
  try {
    const { id } = req.params;
    const { action, familyId, contractorId, employeeId, articleId, reason } = req.body as {
      action: string;
      familyId?: string;
      contractorId?: string;
      employeeId?: string;
      articleId?: string;
      reason?: string;
    };

    const base = { matchSource: "manual", matchedAt: new Date(), matchedByUserId: "owner" };

    let update: Record<string, unknown>;
    switch (action) {
      case "match_family":
        update = { ...base, matchedFamilyId: familyId, matchStatus: "matched" };
        break;
      case "match_contractor":
        update = { ...base, matchedContractorId: contractorId, matchStatus: "matched" };
        break;
      case "match_employee":
        update = { ...base, matchedEmployeeId: employeeId, matchStatus: "matched" };
        break;
      case "ignore":
        update = { ...base, matchStatus: "ignored", isIgnored: true, ignoredAt: new Date(), ignoredReason: reason ?? null };
        break;
      case "internal_transfer":
        update = { ...base, matchStatus: "internal_transfer", isInternalTransfer: true };
        break;
      case "unmatch": {
        // Prefer matched_operation_id (direct pointer); fall back to bank_transaction_id scan.
        // Both paths soft-delete the same operation — the two-step approach avoids
        // leaving orphan operations when matched_operation_id was never backfilled.
        const txRow = await db.execute(
          sql`SELECT matched_operation_id FROM bank_transactions WHERE id = ${id}::uuid LIMIT 1`
        );
        const linkedOpId = (txRow.rows[0] as Record<string, unknown> | undefined)
          ?.matched_operation_id as string | null | undefined;

        if (linkedOpId) {
          // Fast path: we have the exact operation id
          await db.execute(sql`
            UPDATE operations
            SET is_deleted = true, updated_at = NOW()
            WHERE id = ${linkedOpId}::uuid AND is_deleted = false
          `);
        } else {
          // Fallback: scan by bank_transaction_id (pre-fix data without matched_operation_id)
          await db.execute(sql`
            UPDATE operations
            SET is_deleted = true, updated_at = NOW()
            WHERE bank_transaction_id = ${id} AND is_deleted = false
          `);
        }
        update = {
          matchStatus: "unmatched",
          matchedFamilyId: null,
          matchedContractorId: null,
          matchedEmployeeId: null,
          matchedOperationId: null,
          isIgnored: false,
          isInternalTransfer: false,
          matchedAt: null,
          matchSource: null,
          ignoredAt: null,
          ignoredReason: null,
        };
        break;
      }
      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.update(bankTransactionsTable) as any).set(update).where(eq(bankTransactionsTable.id, id));

    const [updated] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
    if (!updated) { res.status(404).json({ error: "Transaction not found" }); return; }

    // Project to ledger for all match actions (not ignore / unmatch / internal_transfer)
    if (!["ignore", "unmatch", "internal_transfer"].includes(action)) {
      const projected = await projectToLedger(id, { familyId, contractorId, employeeId, articleId });
      req.log.info({ txId: id, matchAction: action, ledgerAction: projected.action, operationId: projected.operationId }, "PATCH match: projected to ledger");
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH /banking/transactions/:id/match failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /banking/repair-matched-links ───────────────────────────────────────
// Backfill matched_operation_id for matched bank_transactions that have an active
// operation linked by bank_transaction_id but no matched_operation_id pointer.
// Safe to run multiple times (idempotent). Never creates operations.
// Returns a diagnostic count object.

bankingMatchRouter.post("/banking/repair-matched-links", async (req, res) => {
  try {
    // All matched transactions
    const matchedRows = await db.execute(sql`
      SELECT id::text, matched_operation_id, match_status
      FROM bank_transactions
      WHERE match_status = 'matched'
    `);

    let scannedMatched = 0;
    let repairedLinks = 0;
    let missingOperation = 0;
    let duplicateOperationConflicts = 0;
    const skippedIgnored = 0;
    const skippedInternalTransfer = 0;

    for (const row of matchedRows.rows as Array<Record<string, unknown>>) {
      scannedMatched++;
      const txId = row.id as string;
      const existingOpId = row.matched_operation_id as string | null;

      // Already has matched_operation_id — skip
      if (existingOpId) continue;

      // Find active operations for this transaction
      const ops = await db.execute(sql`
        SELECT id::text
        FROM operations
        WHERE bank_transaction_id = ${txId}
          AND COALESCE(is_deleted, false) = false
      `);

      if (ops.rows.length === 0) {
        missingOperation++;
        continue;
      }

      if (ops.rows.length > 1) {
        // More than one active operation — conflict, log and skip
        duplicateOperationConflicts++;
        req.log.warn(
          { txId, opCount: ops.rows.length },
          "repair-matched-links: multiple active operations for transaction — skipping"
        );
        continue;
      }

      const opId = (ops.rows[0] as Record<string, unknown>).id as string;
      await db.execute(sql`
        UPDATE bank_transactions
        SET matched_operation_id = ${opId}
        WHERE id = ${txId}::uuid AND matched_operation_id IS NULL
      `);
      repairedLinks++;
    }

    req.log.info(
      { scannedMatched, repairedLinks, missingOperation, duplicateOperationConflicts },
      "repair-matched-links complete"
    );

    res.json({
      scannedMatched,
      repairedLinks,
      missingOperation,
      duplicateOperationConflicts,
      skippedIgnored,
      skippedInternalTransfer,
    });
  } catch (err) {
    req.log.error({ err }, "POST /banking/repair-matched-links failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /banking/transactions/by-family/:familyId ────────────────────────────

bankingMatchRouter.get("/banking/transactions/by-family/:familyId", async (req, res) => {
  try {
    const { familyId } = req.params;
    const rows = await db
      .select({
        id: bankTransactionsTable.id,
        operationDate: bankTransactionsTable.operationDate,
        amount: bankTransactionsTable.amount,
        currency: bankTransactionsTable.currency,
        direction: bankTransactionsTable.direction,
        counterpartyName: bankTransactionsTable.counterpartyName,
        purpose: bankTransactionsTable.purpose,
        matchStatus: bankTransactionsTable.matchStatus,
        matchConfidence: bankTransactionsTable.matchConfidence,
        accountId: bankTransactionsTable.accountId,
        bankName: bankTransactionsTable.bankName,
      })
      .from(bankTransactionsTable)
      .where(
        and(
          eq(bankTransactionsTable.matchedFamilyId, familyId),
          eq(bankTransactionsTable.direction, "income"),
        )
      )
      .orderBy(sql`${bankTransactionsTable.operationDate} DESC NULLS LAST`)
      .limit(100);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /banking/transactions/by-family failed");
    res.status(500).json({ error: String(err) });
  }
});
