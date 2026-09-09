import { Router } from "express";
import { z } from "zod/v4";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  or,
  sql,
  inArray,
} from "drizzle-orm";
import { db } from "@workspace/db";
import {
  bankTransactionsTable,
  bankImportBatchesTable,
  operations,
  articles,
} from "@workspace/db";

export const reconciliationRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMonth(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function hashRow(row: Record<string, unknown>): string {
  const key = `${row.operationDate}|${row.amount}|${row.direction}|${row.counterpartyName ?? ""}|${row.purpose ?? ""}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

// ─── CSV Parsers ──────────────────────────────────────────────────────────────

type ParsedRow = {
  operationDate: string;
  amount: number;
  direction: "income" | "expense";
  counterpartyName?: string;
  purpose?: string;
  accountNumber?: string;
  accountName?: string;
  categoryRaw?: string;
};

function parseTinkoff(lines: string[]): ParsedRow[] {
  // Tinkoff: tab-separated
  // Дата операции\tДата платежа\tКарта\tСтатус\tСумма операции\tВалюта операции\tСумма платежа\tВалюта платежа\tКэшбэк\tКатегория\tMCC\tОписание\tБонусы\tЗакруглённое...
  const rows: ParsedRow[] = [];
  const header = lines[0].split("\t").map((h) => h.trim().replace(/"/g, ""));
  const dateIdx = header.findIndex(
    (h) => h.includes("Дата операции") || h.includes("Дата платежа"),
  );
  const amtIdx = header.findIndex(
    (h) => h.includes("Сумма платежа") || h.includes("Сумма операции"),
  );
  const descIdx = header.findIndex(
    (h) => h.includes("Описание") || h.includes("Категория"),
  );
  const catIdx = header.findIndex((h) => h.includes("Категория"));

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t").map((c) => c.trim().replace(/"/g, ""));
    if (cols.length < 3) continue;
    const rawDate = cols[dateIdx] ?? cols[0];
    const rawAmt = cols[amtIdx] ?? cols[amtIdx];
    if (!rawDate || !rawAmt) continue;
    const amt = parseFloat(rawAmt.replace(",", ".").replace(/\s/g, ""));
    if (isNaN(amt)) continue;
    const dateStr = rawDate.replace(/(\d{2})\.(\d{2})\.(\d{4})/, "$3-$2-$1");
    rows.push({
      operationDate: dateStr,
      amount: Math.abs(amt),
      direction: amt < 0 ? "expense" : "income",
      purpose: cols[descIdx] ?? undefined,
      categoryRaw: catIdx >= 0 ? cols[catIdx] : undefined,
    });
  }
  return rows;
}

function parseSberbank(lines: string[]): ParsedRow[] {
  // Sberbank: semicolon-separated
  // Дата;Описание;Категория;Сумма;Валюта;Счёт
  const rows: ParsedRow[] = [];
  const sep = ";";
  const header = lines[0].split(sep).map((h) => h.trim().replace(/"/g, ""));
  const dateIdx = header.findIndex((h) => h.includes("Дата"));
  const descIdx = header.findIndex(
    (h) => h.includes("Описание") || h.includes("Назначение"),
  );
  const amtIdx = header.findIndex((h) => h.includes("Сумма"));
  const accIdx = header.findIndex(
    (h) => h.includes("Счёт") || h.includes("Счет"),
  );

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.trim().replace(/"/g, ""));
    if (cols.length < 3) continue;
    const rawDate = cols[dateIdx] ?? cols[0];
    const rawAmt = cols[amtIdx] ?? "";
    const amt = parseFloat(rawAmt.replace(",", ".").replace(/\s/g, ""));
    if (isNaN(amt) || !rawDate) continue;
    const dateStr = rawDate.replace(/(\d{2})\.(\d{2})\.(\d{4})/, "$3-$2-$1");
    rows.push({
      operationDate: dateStr,
      amount: Math.abs(amt),
      direction: amt < 0 ? "expense" : "income",
      purpose: cols[descIdx] ?? undefined,
      accountNumber: accIdx >= 0 ? cols[accIdx] : undefined,
    });
  }
  return rows;
}

function parseGenericCsv(lines: string[]): ParsedRow[] {
  // Generic: try comma or semicolon
  const sep = lines[0].includes(";") ? ";" : ",";
  const rows: ParsedRow[] = [];
  const header = lines[0]
    .split(sep)
    .map((h) => h.trim().toLowerCase().replace(/"/g, ""));

  const find = (...keys: string[]) =>
    header.findIndex((h) => keys.some((k) => h.includes(k)));

  const dateIdx = find("дата", "date");
  const amtIdx = find("сумма", "amount", "sum");
  const dirIdx = find("тип", "direction", "приход", "расход", "type");
  const descIdx = find(
    "описание",
    "назначение",
    "description",
    "purpose",
    "комментарий",
  );
  const counterpartyIdx = find(
    "контрагент",
    "counterparty",
    "получатель",
    "плательщик",
  );

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.trim().replace(/"/g, ""));
    if (cols.length < 2) continue;
    const rawAmt = (amtIdx >= 0 ? cols[amtIdx] : cols[1]) ?? "";
    const amt = parseFloat(rawAmt.replace(",", ".").replace(/\s/g, ""));
    if (isNaN(amt)) continue;
    const rawDate = dateIdx >= 0 ? cols[dateIdx] : cols[0];
    if (!rawDate) continue;
    const dateStr = rawDate.replace(/(\d{2})\.(\d{2})\.(\d{4})/, "$3-$2-$1");

    let direction: "income" | "expense" = amt >= 0 ? "income" : "expense";
    if (dirIdx >= 0) {
      const d = (cols[dirIdx] ?? "").toLowerCase();
      if (d.includes("расход") || d.includes("out") || d.includes("expense"))
        direction = "expense";
      if (d.includes("приход") || d.includes("in") || d.includes("income"))
        direction = "income";
    }

    rows.push({
      operationDate: dateStr,
      amount: Math.abs(amt),
      direction,
      purpose: descIdx >= 0 ? cols[descIdx] : undefined,
      counterpartyName:
        counterpartyIdx >= 0 ? cols[counterpartyIdx] : undefined,
    });
  }
  return rows;
}

function detectFormat(text: string): "tinkoff" | "sberbank" | "generic" {
  const firstLine = text.split("\n")[0].toLowerCase();
  if (
    firstLine.includes("кэшбэк") ||
    firstLine.includes("mcc") ||
    firstLine.includes("бонус")
  )
    return "tinkoff";
  if (firstLine.includes("счёт") || firstLine.includes("счет"))
    return "sberbank";
  return "generic";
}

function parseStatement(
  rawText: string,
  bankName: string,
): { rows: ParsedRow[]; format: string } {
  const lines = rawText
    .trim()
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], format: "generic" };

  const hint = bankName.toLowerCase();
  let format: "tinkoff" | "sberbank" | "generic";

  if (
    hint.includes("tinkoff") ||
    hint.includes("тинькофф") ||
    hint.includes("тинк")
  ) {
    format = "tinkoff";
  } else if (
    hint.includes("sberbank") ||
    hint.includes("сбер") ||
    hint.includes("sbr")
  ) {
    format = "sberbank";
  } else {
    format = detectFormat(rawText);
  }

  const rows =
    format === "tinkoff"
      ? parseTinkoff(lines)
      : format === "sberbank"
        ? parseSberbank(lines)
        : parseGenericCsv(lines);

  return { rows, format };
}

// ─── POST /reconciliation/import ─────────────────────────────────────────────

const ImportSchema = z.object({
  bankName: z.string(),
  fileName: z.string().optional(),
  rawText: z.string(),
  notes: z.string().optional(),
});

reconciliationRouter.post("/reconciliation/import", async (req, res) => {
  const parsed = ImportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  const { bankName, fileName, rawText, notes } = parsed.data;
  const { rows, format } = parseStatement(rawText, bankName);

  if (rows.length === 0) {
    res.status(400).json({ error: "No rows parsed — check format or data" });
    return;
  }

  try {
    // Create batch
    const [batch] = await db
      .insert(bankImportBatchesTable)
      .values({
        bankName,
        fileName: fileName ?? null,
        format,
        transactionCount: rows.length,
        notes: notes ?? null,
      })
      .returning({ id: bankImportBatchesTable.id });

    // Compute date range
    const dates = rows
      .map((r) => r.operationDate)
      .filter(Boolean)
      .sort();
    if (dates.length > 0) {
      await db
        .update(bankImportBatchesTable)
        .set({
          dateFrom: dates[0]!,
          dateTo: dates[dates.length - 1]!,
        })
        .where(eq(bankImportBatchesTable.id, batch.id));
    }

    // Insert transactions with dedup by hash
    let inserted = 0;
    let duplicates = 0;
    let errors = 0;

    for (const row of rows) {
      const hash = hashRow(row as Record<string, unknown>);
      try {
        // Check existing hash
        const existing = await db
          .select({ id: bankTransactionsTable.id })
          .from(bankTransactionsTable)
          .where(eq(bankTransactionsTable.hash, hash))
          .limit(1);

        if (existing.length > 0) {
          duplicates++;
          continue;
        }

        await db.insert(bankTransactionsTable).values({
          importBatchId: batch.id,
          hash,
          sourceType: "csv_import",
          bankName,
          operationDate: row.operationDate,
          amount: String(row.amount),
          direction: row.direction,
          counterpartyName: row.counterpartyName ?? null,
          purpose: row.purpose ?? null,
          accountName: row.accountName ?? null,
          accountNumber: row.accountNumber ?? null,
          categoryRaw: row.categoryRaw ?? null,
          matchStatus: "unmatched",
          matchConfidence: 0,
        });
        inserted++;
      } catch {
        errors++;
      }
    }

    res.status(201).json({ batchId: batch.id, inserted, duplicates, errors });
  } catch (err) {
    req.log.error({ err }, "POST /reconciliation/import failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /reconciliation/batches ─────────────────────────────────────────────

reconciliationRouter.get("/reconciliation/batches", async (req, res) => {
  try {
    const batches = await db
      .select()
      .from(bankImportBatchesTable)
      .orderBy(desc(bankImportBatchesTable.importedAt));
    res.json(batches);
  } catch (err) {
    req.log.error({ err }, "GET /reconciliation/batches failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── DELETE /reconciliation/batches/:id ──────────────────────────────────────

reconciliationRouter.delete("/reconciliation/batches/:id", async (req, res) => {
  try {
    const txs = await db
      .select({ id: bankTransactionsTable.id })
      .from(bankTransactionsTable)
      .where(eq(bankTransactionsTable.importBatchId, req.params.id));

    const txIds = txs.map((t) => t.id);
    let deleted = 0;

    if (txIds.length > 0) {
      const result = await db
        .delete(bankTransactionsTable)
        .where(inArray(bankTransactionsTable.id, txIds))
        .returning({ id: bankTransactionsTable.id });
      deleted = result.length;
    }

    await db
      .delete(bankImportBatchesTable)
      .where(eq(bankImportBatchesTable.id, req.params.id));
    res.json({ deleted });
  } catch (err) {
    req.log.error({ err }, "DELETE /reconciliation/batches/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /reconciliation/transactions ────────────────────────────────────────

const ListTxSchema = z.object({
  month: z.string().optional(),
  matchStatus: z.string().optional(),
  direction: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

reconciliationRouter.get("/reconciliation/transactions", async (req, res) => {
  const parsed = ListTxSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  const { month, matchStatus, direction, search, page, limit } = parsed.data;

  try {
    const conditions = [sql`1=1`];

    if (month) {
      const [y, m] = month.split("-").map(Number);
      const from = `${y}-${String(m).padStart(2, "0")}-01`;
      const to = `${y}-${String(m).padStart(2, "0")}-31`;
      conditions.push(gte(bankTransactionsTable.operationDate, from));
      conditions.push(lte(bankTransactionsTable.operationDate, to));
    }

    if (matchStatus && matchStatus !== "all") {
      conditions.push(eq(bankTransactionsTable.matchStatus, matchStatus));
    }

    if (direction) {
      conditions.push(eq(bankTransactionsTable.direction, direction));
    }

    if (search) {
      const searchCond = or(
        ilike(bankTransactionsTable.counterpartyName, `%${search}%`),
        ilike(bankTransactionsTable.purpose, `%${search}%`),
      );
      if (searchCond) conditions.push(searchCond);
    }

    const where = and(...conditions);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(bankTransactionsTable)
      .where(where);

    const txs = await db
      .select()
      .from(bankTransactionsTable)
      .where(where)
      .orderBy(
        desc(bankTransactionsTable.operationDate),
        desc(bankTransactionsTable.createdAt),
      )
      .limit(limit)
      .offset((page - 1) * limit);

    // Enrich with matched operation data
    const matchedIds = txs
      .filter((t) => t.matchedOperationId)
      .map((t) => t.matchedOperationId!);

    const matchedOps =
      matchedIds.length > 0
        ? await db
            .select({
              id: operations.id,
              description: operations.description,
              amount: operations.amount,
              articleName: operations.articleName,
              articleCode: operations.articleCode,
              cashflowDate: operations.cashflowDate,
              verificationStatus: operations.verificationStatus,
            })
            .from(operations)
            .where(inArray(operations.id, matchedIds))
        : [];

    const opMap = new Map(matchedOps.map((o) => [o.id, o]));

    const enriched = txs.map((t) => ({
      ...t,
      matchedOperation: t.matchedOperationId
        ? (opMap.get(t.matchedOperationId) ?? null)
        : null,
    }));

    res.json({
      transactions: enriched,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    req.log.error({ err }, "GET /reconciliation/transactions failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /reconciliation/stats ────────────────────────────────────────────────

reconciliationRouter.get("/reconciliation/stats", async (req, res) => {
  const { month } = req.query as { month?: string };

  try {
    const conditions = [sql`1=1`];

    if (month) {
      const [y, m] = month.split("-").map(Number);
      const from = `${y}-${String(m).padStart(2, "0")}-01`;
      const to = `${y}-${String(m).padStart(2, "0")}-31`;
      conditions.push(gte(bankTransactionsTable.operationDate, from));
      conditions.push(lte(bankTransactionsTable.operationDate, to));
    }

    const where = and(...conditions);

    const [totals] = await db
      .select({
        total: sql<number>`count(*)::int`,
        matched: sql<number>`count(*) filter (where match_status = 'matched')::int`,
        ignored: sql<number>`count(*) filter (where match_status = 'ignored' or is_ignored = true)::int`,
        totalAmtIn: sql<number>`coalesce(sum(amount::numeric) filter (where direction = 'income'), 0)`,
        totalAmtOut: sql<number>`coalesce(sum(amount::numeric) filter (where direction = 'expense'), 0)`,
        unmatchedAmtIn: sql<number>`coalesce(sum(amount::numeric) filter (where direction = 'income' and match_status = 'unmatched'), 0)`,
        unmatchedAmtOut: sql<number>`coalesce(sum(amount::numeric) filter (where direction = 'expense' and match_status = 'unmatched'), 0)`,
      })
      .from(bankTransactionsTable)
      .where(where);

    const total = totals?.total ?? 0;
    const matched = totals?.matched ?? 0;
    const ignored = totals?.ignored ?? 0;
    const unmatched = total - matched - ignored;

    res.json({
      total,
      matched,
      unmatched: Math.max(0, unmatched),
      ignored,
      matchedPct: total > 0 ? Math.round((matched / total) * 100) : 0,
      totalAmountIn: Number(totals?.totalAmtIn ?? 0),
      totalAmountOut: Number(totals?.totalAmtOut ?? 0),
      unmatchedAmountIn: Number(totals?.unmatchedAmtIn ?? 0),
      unmatchedAmountOut: Number(totals?.unmatchedAmtOut ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "GET /reconciliation/stats failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /reconciliation/months ───────────────────────────────────────────────

reconciliationRouter.get("/reconciliation/months", async (req, res) => {
  try {
    const rows = await db
      .selectDistinct({
        month: sql<string>`to_char(operation_date, 'YYYY-MM')`,
      })
      .from(bankTransactionsTable)
      .where(sql`operation_date is not null`)
      .orderBy(sql`1 desc`);

    res.json(rows.map((r) => r.month).filter(Boolean));
  } catch (err) {
    req.log.error({ err }, "GET /reconciliation/months failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /reconciliation/auto-match ─────────────────────────────────────────

reconciliationRouter.post("/reconciliation/auto-match", async (req, res) => {
  const { month } = req.body as { month?: string };

  try {
    const conditions = [
      eq(bankTransactionsTable.matchStatus, "unmatched"),
      sql`${bankTransactionsTable.isIgnored} = false`,
    ];

    if (month) {
      const [y, m] = month.split("-").map(Number);
      conditions.push(
        gte(
          bankTransactionsTable.operationDate,
          `${y}-${String(m).padStart(2, "0")}-01`,
        ),
      );
      conditions.push(
        lte(
          bankTransactionsTable.operationDate,
          `${y}-${String(m).padStart(2, "0")}-31`,
        ),
      );
    }

    const unmatchedTxs = await db
      .select()
      .from(bankTransactionsTable)
      .where(and(...conditions));

    let matched = 0;
    let alreadyMatched = 0;
    let noMatch = 0;

    for (const tx of unmatchedTxs) {
      if (tx.matchStatus === "matched") {
        alreadyMatched++;
        continue;
      }
      if (!tx.operationDate || !tx.amount) {
        noMatch++;
        continue;
      }

      const txAmt = parseFloat(String(tx.amount));
      const txDir = tx.direction === "income" ? "in" : "out";
      const txDate = tx.operationDate;

      // Find ops with matching amount + direction within ±3 days and source != bank_import already linked
      const candidates = await db
        .select({
          id: operations.id,
          amount: operations.amount,
          cashflowDate: operations.cashflowDate,
          counterpartyName: operations.counterpartyName,
          bankTransactionId: operations.bankTransactionId,
        })
        .from(operations)
        .where(
          and(
            eq(operations.direction, txDir),
            sql`abs(${operations.amount}::numeric - ${txAmt}) < 0.01`,
            sql`abs(${operations.cashflowDate}::date - ${txDate}::date) <= 3`,
            sql`${operations.isDeleted} = false`,
            isNull(operations.bankTransactionId),
          ),
        );

      if (candidates.length === 0) {
        noMatch++;
        continue;
      }

      // Pick best candidate (closest date, then closest counterparty name)
      let best = candidates[0];
      let bestScore = 50;

      for (const c of candidates) {
        let score = 50;
        if (tx.counterpartyName && c.counterpartyName) {
          const txN = tx.counterpartyName.toLowerCase();
          const cN = c.counterpartyName.toLowerCase();
          if (txN === cN) score += 40;
          else if (txN.includes(cN) || cN.includes(txN)) score += 20;
        }
        if (score > bestScore) {
          best = c;
          bestScore = score;
        }
      }

      // Link
      await db
        .update(bankTransactionsTable)
        .set({
          matchedOperationId: best.id,
          matchStatus: "matched",
          matchType: "auto",
          matchConfidence: bestScore,
          matchedAt: new Date(),
        })
        .where(eq(bankTransactionsTable.id, tx.id));

      await db
        .update(operations)
        .set({
          bankTransactionId: tx.id,
          verificationStatus: bestScore >= 80 ? "verified" : "pending_review",
          trustScore: Math.min(100, bestScore),
        })
        .where(eq(operations.id, best.id));

      matched++;
    }

    res.json({ matched, alreadyMatched, noMatch });
  } catch (err) {
    req.log.error({ err }, "POST /reconciliation/auto-match failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /reconciliation/match ───────────────────────────────────────────────

reconciliationRouter.post("/reconciliation/match", async (req, res) => {
  const { bankTxId, operationId } = req.body as {
    bankTxId: string;
    operationId: string;
  };
  if (!bankTxId || !operationId) {
    res.status(400).json({ error: "bankTxId and operationId required" });
    return;
  }

  try {
    await db
      .update(bankTransactionsTable)
      .set({
        matchedOperationId: operationId,
        matchStatus: "matched",
        matchType: "manual",
        matchConfidence: 100,
        matchedAt: new Date(),
      })
      .where(eq(bankTransactionsTable.id, bankTxId));

    await db
      .update(operations)
      .set({
        bankTransactionId: bankTxId,
        verificationStatus: "verified",
        trustScore: 100,
      })
      .where(eq(operations.id, operationId));

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /reconciliation/match failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── DELETE /reconciliation/match/:bankTxId ───────────────────────────────────

reconciliationRouter.delete(
  "/reconciliation/match/:bankTxId",
  async (req, res) => {
    try {
      const [tx] = await db
        .select()
        .from(bankTransactionsTable)
        .where(eq(bankTransactionsTable.id, req.params.bankTxId));

      if (!tx) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      if (tx.matchedOperationId) {
        await db
          .update(operations)
          .set({
            bankTransactionId: null,
            verificationStatus: "unverified",
          })
          .where(eq(operations.id, tx.matchedOperationId));
      }

      await db
        .update(bankTransactionsTable)
        .set({
          matchedOperationId: null,
          matchStatus: "unmatched",
          matchType: null,
          matchConfidence: 0,
          matchedAt: null,
        })
        .where(eq(bankTransactionsTable.id, req.params.bankTxId));

      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "DELETE /reconciliation/match/:bankTxId failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ─── POST /reconciliation/ignore/:bankTxId ────────────────────────────────────

reconciliationRouter.post(
  "/reconciliation/ignore/:bankTxId",
  async (req, res) => {
    try {
      await db
        .update(bankTransactionsTable)
        .set({
          isIgnored: true,
          matchStatus: "ignored",
        })
        .where(eq(bankTransactionsTable.id, req.params.bankTxId));
      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "POST /reconciliation/ignore failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ─── POST /reconciliation/create-operation/:bankTxId ─────────────────────────

reconciliationRouter.post(
  "/reconciliation/create-operation/:bankTxId",
  async (req, res) => {
    const { articleId, notes } = req.body as {
      articleId?: string;
      notes?: string;
    };

    try {
      const [tx] = await db
        .select()
        .from(bankTransactionsTable)
        .where(eq(bankTransactionsTable.id, req.params.bankTxId));
      if (!tx) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const cashflowDate = tx.operationDate
        ? new Date(tx.operationDate)
        : new Date();
      const cashflowMonth = toMonth(cashflowDate);

      // Lookup article name if provided
      let articleName: string | null = null;
      let articleCode: string | null = null;
      if (articleId) {
        const [art] = await db
          .select({ name: articles.name, code: articles.code })
          .from(articles)
          .where(eq(articles.id, articleId));
        if (art) {
          articleName = art.name;
          articleCode = art.code;
        }
      }

      const direction = tx.direction === "income" ? "in" : "out";

      const [op] = await db
        .insert(operations)
        .values({
          operationType: tx.direction === "income" ? "income" : "expense",
          source: "bank_import",
          direction,
          amount: tx.amount ?? "0",
          currency: tx.currency ?? "RUB",
          description: tx.purpose ?? tx.counterpartyName ?? undefined,
          cashflowDate,
          accrualDate: cashflowDate,
          cashflowMonth,
          plMonth: cashflowMonth,
          articleId: articleId ?? null,
          articleName: articleName ?? null,
          articleCode: articleCode ?? null,
          counterpartyName: tx.counterpartyName ?? null,
          bankTransactionId: tx.id,
          notes: notes ?? null,
          verificationStatus: "verified",
          trustScore: 90,
          createdBy: "bank_import",
        })
        .returning();

      // Link bank tx
      await db
        .update(bankTransactionsTable)
        .set({
          matchedOperationId: op.id,
          matchStatus: "matched",
          matchType: "manual",
          matchConfidence: 100,
          matchedAt: new Date(),
        })
        .where(eq(bankTransactionsTable.id, tx.id));

      res.status(201).json(op);
    } catch (err) {
      req.log.error({ err }, "POST /reconciliation/create-operation failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);
