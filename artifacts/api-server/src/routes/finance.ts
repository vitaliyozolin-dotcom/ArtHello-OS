import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db } from "@workspace/db";
import {
  bankTransactionsTable,
  bankImportBatchesTable,
  ddsCategoriesTable,
  opiuCategoriesTable,
  categorizationRulesTable,
  manualAdjustmentsTable,
  contractsObligationsTable,
  opiuMonthlyTable,
  ddsMonthlyTable,
} from "@workspace/db";
import { eq, sql, desc, and, count } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export const financeRouter = Router();

// ─── Multer (in-memory, max 20 MB) ───────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  rowIndex: number;
  operationDate: string | null;
  counterpartyName: string | null;
  counterpartyInn: string | null;
  purpose: string | null;
  amount: number | null;
  direction: "income" | "expense" | null;
  accountName: string | null;
  accountNumber: string | null;
  raw: Record<string, unknown>;
}

interface ColumnMapping {
  operationDate?: string;
  counterpartyName?: string;
  counterpartyInn?: string;
  purpose?: string;
  amountIncome?: string;
  amountExpense?: string;
  amount?: string;
  direction?: string;
  accountName?: string;
  accountNumber?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNumeric(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

function normaliseDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  // dd.mm.yyyy or yyyy-mm-dd
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
    const [d, m, y] = s.split(".");
    return `${y}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Excel serial date
  if (/^\d+$/.test(s)) {
    const serial = parseInt(s, 10);
    if (serial > 40000 && serial < 60000) {
      const d = XLSX.SSF.parse_date_code(serial);
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
  }
  return null;
}

function applyMapping(row: Record<string, unknown>, mapping: ColumnMapping): ParsedRow {
  const get = (key?: string) => (key ? row[key] : undefined);

  let amount: number | null = null;
  let direction: "income" | "expense" | null = null;

  if (mapping.amountIncome || mapping.amountExpense) {
    const inc = parseNumeric(get(mapping.amountIncome));
    const exp = parseNumeric(get(mapping.amountExpense));
    if (inc && inc > 0) { amount = inc; direction = "income"; }
    else if (exp && exp > 0) { amount = exp; direction = "expense"; }
  } else if (mapping.amount) {
    amount = parseNumeric(get(mapping.amount));
    if (amount != null) {
      if (mapping.direction) {
        const d = String(get(mapping.direction) ?? "").toLowerCase();
        direction = d.includes("расход") || d.includes("debit") || d.includes("expense") || d === "-" ? "expense" : "income";
      } else if (amount < 0) {
        direction = "expense"; amount = Math.abs(amount);
      } else {
        direction = "income";
      }
    }
  }

  return {
    rowIndex: 0,
    operationDate: normaliseDate(get(mapping.operationDate)),
    counterpartyName: get(mapping.counterpartyName) ? String(get(mapping.counterpartyName)) : null,
    counterpartyInn: get(mapping.counterpartyInn) ? String(get(mapping.counterpartyInn)) : null,
    purpose: get(mapping.purpose) ? String(get(mapping.purpose)) : null,
    amount,
    direction,
    accountName: get(mapping.accountName) ? String(get(mapping.accountName)) : null,
    accountNumber: get(mapping.accountNumber) ? String(get(mapping.accountNumber)) : null,
    raw: row,
  };
}

function detectMapping(headers: string[]): ColumnMapping {
  const h = (pat: RegExp) => headers.find(h => pat.test(h.toLowerCase()));
  return {
    operationDate:    h(/дата|date|опер/),
    counterpartyName: h(/контрагент|получател|плательщик|наименован|partner|counterpart/),
    counterpartyInn:  h(/инн|inn/),
    purpose:          h(/назначени|description|purpose|платёж|платеж/),
    amountIncome:     h(/приход|зачислен|credit|поступлени|доход/),
    amountExpense:    h(/расход|списани|debit|оплата|выплат/),
    amount:           !h(/приход|зачислен|credit|поступлени|доход/) && !h(/расход|списани|debit|оплата|выплат/)
                        ? h(/сумм|amount/) : undefined,
    direction:        h(/вид операц|direction|тип|type/),
    accountName:      h(/счёт|счет|account.*name|наименование счет/),
    accountNumber:    h(/номер.*счет|account.*num|р\/с/),
  };
}

// ─── Auto-categorise a single parsed row ─────────────────────────────────────

async function categoriseRow(
  row: Pick<ParsedRow, "direction" | "counterpartyName" | "counterpartyInn" | "purpose" | "amount">,
  rules: (typeof categorizationRulesTable.$inferSelect)[],
): Promise<{ ddsCategory: string | null; opiuCategory: string | null; isUnclear: boolean; flags: Record<string, boolean> }> {
  const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();
  const cpLow = lower(row.counterpartyName);
  const innLow = lower(row.counterpartyInn);
  const purLow = lower(row.purpose);

  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (rule.direction && rule.direction !== row.direction) continue;
    if (row.amount != null) {
      if (rule.amountMin != null && row.amount < Number(rule.amountMin)) continue;
      if (rule.amountMax != null && row.amount > Number(rule.amountMax)) continue;
    }
    const cpPats = rule.counterpartyContains ?? [];
    const purPats = rule.purposeContains ?? [];
    const cpMatch = cpPats.length === 0 || cpPats.some(p => cpLow.includes(p.toLowerCase()) || innLow.includes(p.toLowerCase()));
    const purMatch = purPats.length === 0 || purPats.some(p => purLow.includes(p.toLowerCase()));
    if (cpMatch && purMatch) {
      const flags = (rule.flags ?? {}) as Record<string, boolean>;
      return {
        ddsCategory: rule.ddsCategory ?? null,
        opiuCategory: rule.opiuCategory ?? null,
        isUnclear: false,
        flags,
      };
    }
  }
  return { ddsCategory: null, opiuCategory: null, isUnclear: true, flags: {} };
}

// ─── POST /api/finance/bank/preview ──────────────────────────────────────────
// Upload a file, parse it, return headers + first 20 rows for column mapping.

financeRouter.post("/finance/bank/preview", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  req.log.info({ filename: req.file.originalname, size: req.file.size }, "Bank statement preview");

  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

    if (raw.length === 0) { res.status(400).json({ error: "File is empty" }); return; }

    const headers = Object.keys(raw[0]);
    const detectedMapping = detectMapping(headers);
    const preview = raw.slice(0, 20).map((row, i) => ({ rowIndex: i, ...row }));

    res.json({
      filename: req.file.originalname,
      sheetName,
      totalRows: raw.length,
      headers,
      detectedMapping,
      preview,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Bank statement preview failed");
    res.status(500).json({ error: `Parse error: ${message}` });
  }
});

// ─── POST /api/finance/bank/import ───────────────────────────────────────────
// Accept file + mapping config + metadata, parse, auto-categorise, save.

financeRouter.post("/finance/bank/import", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const {
    bankName = "unknown",
    accountName = "",
    accountNumber = "",
    branchName = "",
    branchCrmId = "",
    mapping: mappingJson = "{}",
    skipRows = "0",
  } = req.body as Record<string, string>;

  const mapping: ColumnMapping = JSON.parse(mappingJson);
  const skip = parseInt(skipRows, 10) || 0;
  const fileName = req.file.originalname;

  req.log.info({ bankName, accountName, branchCrmId, fileName }, "Bank import started");

  const rules = await db
    .select()
    .from(categorizationRulesTable)
    .where(eq(categorizationRulesTable.isActive, true))
    .orderBy(categorizationRulesTable.priority);

  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

    let imported = 0;
    let unclear = 0;
    let skipped = 0;
    const total = rawRows.length - skip;

    // Create the import batch record up front
    const [batch] = await db
      .insert(bankImportBatchesTable)
      .values({
        bankName: bankName || null,
        accountName: accountName || null,
        branchCrmId: branchCrmId || null,
        fileName,
        rowsTotal: total,
        rowsImported: 0,
        rowsSkipped: 0,
        rowsUnclear: 0,
        status: "importing",
      })
      .returning();

    for (let i = skip; i < rawRows.length; i++) {
      const parsed = applyMapping(rawRows[i], mapping);
      parsed.rowIndex = i;

      if (!parsed.amount || !parsed.operationDate) { skipped++; continue; }

      const cat = await categoriseRow(parsed, rules);

      const extId = `${bankName}__${accountNumber}__${parsed.operationDate}__${parsed.counterpartyName}__${parsed.amount}__${i}`;

      await db
        .insert(bankTransactionsTable)
        .values({
          importBatchId: batch.id,
          sourceSystem: "csv_upload",
          externalId: extId,
          bankName: bankName || null,
          accountName: accountName || null,
          accountNumber: accountNumber || null,
          operationDate: parsed.operationDate,
          amount: String(parsed.amount),
          direction: parsed.direction,
          counterpartyName: parsed.counterpartyName,
          counterpartyInn: parsed.counterpartyInn,
          purpose: parsed.purpose,
          ddsCategory: cat.ddsCategory,
          opiuCategory: cat.opiuCategory,
          branchName: branchName || null,
          branchCrmId: branchCrmId || null,
          isUnclear: cat.isUnclear,
          isPayroll: cat.flags["isPayroll"] ?? false,
          isCapex: cat.flags["isCapex"] ?? false,
          isDebtBody: cat.flags["isDebtBody"] ?? false,
          isDebtInterest: cat.flags["isDebtInterest"] ?? false,
          isTax: cat.flags["isTax"] ?? false,
          isTransferBetweenOwnAccounts: cat.flags["isTransfer"] ?? false,
          raw: rawRows[i],
        })
        .onConflictDoNothing();

      imported++;
      if (cat.isUnclear) unclear++;
    }

    // Update batch with final counts
    await db
      .update(bankImportBatchesTable)
      .set({ rowsImported: imported, rowsSkipped: skipped, rowsUnclear: unclear, status: "imported" })
      .where(eq(bankImportBatchesTable.id, batch.id));

    req.log.info({ imported, unclear, skipped, batchId: batch.id }, "Bank import complete");
    res.json({ success: true, imported, unclear, skipped, batchId: batch.id, message: `Imported ${imported} transactions (${unclear} unclear, ${skipped} skipped)` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Bank import failed");
    res.status(500).json({ error: `Import failed: ${message}` });
  }
});

// ─── GET /api/finance/bank/transactions ──────────────────────────────────────

financeRouter.get("/finance/bank/transactions", async (req, res): Promise<void> => {
  const { branch, direction, unclear, dateFrom, dateTo, limit = "50", offset = "0" } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit, 10) || 50, 500);
  const off = parseInt(offset, 10) || 0;

  const conditions = [];
  if (branch) conditions.push(sql`${bankTransactionsTable.branchCrmId} = ${branch}`);
  if (direction) conditions.push(sql`${bankTransactionsTable.direction} = ${direction}`);
  if (unclear === "true") conditions.push(sql`${bankTransactionsTable.isUnclear} = true`);
  if (dateFrom) conditions.push(sql`${bankTransactionsTable.operationDate} >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`${bankTransactionsTable.operationDate} <= ${dateTo}`);

  const rows = await db
    .select()
    .from(bankTransactionsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(bankTransactionsTable.operationDate))
    .limit(lim)
    .offset(off);

  const [total] = await db
    .select({ count: count() })
    .from(bankTransactionsTable)
    .where(conditions.length ? and(...conditions) : undefined);

  res.json({ transactions: rows, total: Number(total?.count ?? 0) });
});

// ─── PATCH /api/finance/bank/transactions/:id ─────────────────────────────────

financeRouter.patch("/finance/bank/transactions/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const {
    ddsCategory, opiuCategory, managementCategory,
    isPayroll, isCapex, isDebtBody, isDebtInterest, isTax,
    isTransferBetweenOwnAccounts, branchCrmId, branchName,
  } = req.body as Record<string, unknown>;

  await db
    .update(bankTransactionsTable)
    .set({
      ddsCategory: ddsCategory as string ?? undefined,
      opiuCategory: opiuCategory as string ?? undefined,
      managementCategory: managementCategory as string ?? undefined,
      isPayroll: typeof isPayroll === "boolean" ? isPayroll : undefined,
      isCapex: typeof isCapex === "boolean" ? isCapex : undefined,
      isDebtBody: typeof isDebtBody === "boolean" ? isDebtBody : undefined,
      isDebtInterest: typeof isDebtInterest === "boolean" ? isDebtInterest : undefined,
      isTax: typeof isTax === "boolean" ? isTax : undefined,
      isTransferBetweenOwnAccounts: typeof isTransferBetweenOwnAccounts === "boolean" ? isTransferBetweenOwnAccounts : undefined,
      branchCrmId: branchCrmId as string ?? undefined,
      branchName: branchName as string ?? undefined,
      isUnclear: false,
    })
    .where(eq(bankTransactionsTable.id, id));

  res.json({ success: true });
});

// ─── GET /api/finance/bank/unclear ────────────────────────────────────────────

financeRouter.get("/finance/bank/unclear", async (req, res): Promise<void> => {
  const { limit = "50" } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit, 10) || 50, 500);

  const rows = await db
    .select()
    .from(bankTransactionsTable)
    .where(eq(bankTransactionsTable.isUnclear, true))
    .orderBy(desc(bankTransactionsTable.operationDate))
    .limit(lim);

  const [{ count: total }] = await db
    .select({ count: count() })
    .from(bankTransactionsTable)
    .where(eq(bankTransactionsTable.isUnclear, true));

  res.json({ transactions: rows, total: Number(total) });
});

// ─── GET /api/finance/bank/rules ─────────────────────────────────────────────

financeRouter.get("/finance/bank/rules", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(categorizationRulesTable)
    .orderBy(categorizationRulesTable.priority);
  res.json(rows);
});

// ─── POST /api/finance/bank/rules ────────────────────────────────────────────

financeRouter.post("/finance/bank/rules", async (req, res): Promise<void> => {
  const body = req.body as {
    ruleName?: string;
    priority?: number;
    direction?: string;
    counterpartyContains?: string[];
    purposeContains?: string[];
    amountMin?: number;
    amountMax?: number;
    ddsCategory?: string;
    opiuCategory?: string;
    branchCrmId?: string;
    flags?: Record<string, boolean>;
  };

  const [rule] = await db
    .insert(categorizationRulesTable)
    .values({
      ruleName: body.ruleName ?? null,
      priority: body.priority ?? 100,
      direction: body.direction ?? null,
      counterpartyContains: body.counterpartyContains ?? [],
      purposeContains: body.purposeContains ?? [],
      amountMin: body.amountMin != null ? String(body.amountMin) : null,
      amountMax: body.amountMax != null ? String(body.amountMax) : null,
      ddsCategory: body.ddsCategory ?? null,
      opiuCategory: body.opiuCategory ?? null,
      branchCrmId: body.branchCrmId ?? null,
      flags: body.flags ?? {},
      isActive: true,
    })
    .returning();

  res.json(rule);
});

// ─── POST /api/finance/bank/autocategorize ────────────────────────────────────
// Re-run auto-categorisation on all unclear transactions.

financeRouter.post("/finance/bank/autocategorize", async (req, res): Promise<void> => {
  const rules = await db
    .select()
    .from(categorizationRulesTable)
    .where(eq(categorizationRulesTable.isActive, true))
    .orderBy(categorizationRulesTable.priority);

  const unclear = await db
    .select()
    .from(bankTransactionsTable)
    .where(eq(bankTransactionsTable.isUnclear, true));

  let resolved = 0;
  for (const tx of unclear) {
    const cat = await categoriseRow({
      direction: tx.direction as "income" | "expense" | null,
      counterpartyName: tx.counterpartyName,
      counterpartyInn: tx.counterpartyInn,
      purpose: tx.purpose,
      amount: tx.amount ? parseFloat(tx.amount) : null,
    }, rules);

    if (!cat.isUnclear) {
      await db
        .update(bankTransactionsTable)
        .set({
          ddsCategory: cat.ddsCategory,
          opiuCategory: cat.opiuCategory,
          isUnclear: false,
          isPayroll: cat.flags["isPayroll"] ?? false,
          isCapex: cat.flags["isCapex"] ?? false,
          isDebtBody: cat.flags["isDebtBody"] ?? false,
          isDebtInterest: cat.flags["isDebtInterest"] ?? false,
          isTax: cat.flags["isTax"] ?? false,
          isTransferBetweenOwnAccounts: cat.flags["isTransfer"] ?? false,
        })
        .where(eq(bankTransactionsTable.id, tx.id));
      resolved++;
    }
  }

  res.json({ processed: unclear.length, resolved, stillUnclear: unclear.length - resolved });
});

// ─── GET /api/finance/dds ────────────────────────────────────────────────────
// Aggregate DDS from bank_transactions by month.

financeRouter.get("/finance/dds", async (req, res): Promise<void> => {
  const { branch, year } = req.query as Record<string, string>;

  const baseFilter = branch
    ? sql`branch_crm_id = ${branch} AND is_transfer_between_own_accounts = false`
    : sql`is_transfer_between_own_accounts = false`;

  const yearFilter = year
    ? sql`AND EXTRACT(year FROM operation_date) = ${parseInt(year, 10)}`
    : sql``;

  // Monthly summary
  const monthly = await db.execute(sql`
    SELECT
      TO_CHAR(operation_date, 'YYYY-MM') AS month,
      direction,
      dds_category,
      SUM(amount::numeric) AS total,
      COUNT(*) AS txn_count
    FROM bank_transactions
    WHERE ${baseFilter} ${yearFilter}
      AND operation_date IS NOT NULL
    GROUP BY 1, 2, 3
    ORDER BY 1 DESC, 2, 3
  `);

  // Unclear count
  const unclearResult = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM bank_transactions WHERE is_unclear = true
  `);

  // Total in/out for current month
  const currentMonthResult = await db.execute(sql`
    SELECT
      SUM(CASE WHEN direction = 'income' THEN amount::numeric ELSE 0 END) AS income,
      SUM(CASE WHEN direction = 'expense' THEN amount::numeric ELSE 0 END) AS expense
    FROM bank_transactions
    WHERE ${baseFilter}
      AND TO_CHAR(operation_date, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
  `);
  const unclearRow = unclearResult.rows[0];
  const currentMonth = currentMonthResult.rows[0];

  res.json({
    monthly: monthly.rows,
    unclearCount: Number((unclearRow as Record<string, unknown>)?.cnt ?? 0),
    currentMonth: {
      income: Number((currentMonth as Record<string, unknown>)?.income ?? 0),
      expense: Number((currentMonth as Record<string, unknown>)?.expense ?? 0),
    },
  });
});

// ─── GET /api/finance/opiu ───────────────────────────────────────────────────
// P&L — from opiu_monthly if populated, otherwise compute from transactions.

financeRouter.get("/finance/opiu", async (req, res): Promise<void> => {
  const { branch, year } = req.query as Record<string, string>;

  const stored = await db
    .select()
    .from(opiuMonthlyTable)
    .where(branch ? eq(opiuMonthlyTable.branchCrmId, branch) : undefined)
    .orderBy(desc(opiuMonthlyTable.month))
    .limit(24);

  if (stored.length > 0) {
    res.json({ source: "opiu_monthly", rows: stored });
    return;
  }

  // Fallback: compute from categorised bank transactions
  const yearFilter = year
    ? sql`AND EXTRACT(year FROM operation_date) = ${parseInt(year, 10)}`
    : sql``;

  const computed = await db.execute(sql`
    SELECT
      TO_CHAR(operation_date, 'YYYY-MM') AS month,
      opiu_category,
      direction,
      SUM(amount::numeric) AS total
    FROM bank_transactions
    WHERE opiu_category IS NOT NULL
      AND opiu_category != 'Не-ОПиУ'
      AND is_transfer_between_own_accounts = false
      ${yearFilter}
    GROUP BY 1, 2, 3
    ORDER BY 1 DESC, 2
  `);

  res.json({ source: "computed", rows: computed.rows });
});

// ─── GET /api/finance/stats ──────────────────────────────────────────────────
// Quick summary stats for dashboard header.

financeRouter.get("/finance/stats", async (req, res): Promise<void> => {
  const [txCount] = await db.select({ count: count() }).from(bankTransactionsTable);
  const [unclearCount] = await db
    .select({ count: count() })
    .from(bankTransactionsTable)
    .where(eq(bankTransactionsTable.isUnclear, true));
  const [ruleCount] = await db.select({ count: count() }).from(categorizationRulesTable);

  const monthlyStats = await db.execute(sql`
    SELECT
      SUM(CASE WHEN direction = 'income' AND is_transfer_between_own_accounts = false THEN amount::numeric ELSE 0 END) AS income_mtd,
      SUM(CASE WHEN direction = 'expense' AND is_transfer_between_own_accounts = false THEN amount::numeric ELSE 0 END) AS expense_mtd
    FROM bank_transactions
    WHERE TO_CHAR(operation_date, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')
  `);

  const s = (monthlyStats.rows[0] ?? {}) as Record<string, unknown>;

  res.json({
    totalTransactions: Number(txCount?.count ?? 0),
    unclearTransactions: Number(unclearCount?.count ?? 0),
    categorizationRules: Number(ruleCount?.count ?? 0),
    currentMonthIncome: Number(s["income_mtd"] ?? 0),
    currentMonthExpense: Number(s["expense_mtd"] ?? 0),
    currentMonthNet: Number(s["income_mtd"] ?? 0) - Number(s["expense_mtd"] ?? 0),
  });
});

// ─── GET /api/finance/categories/dds ─────────────────────────────────────────

financeRouter.get("/finance/categories/dds", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(ddsCategoriesTable)
    .where(eq(ddsCategoriesTable.isActive, true));
  res.json(rows);
});

// ─── GET /api/finance/categories/opiu ────────────────────────────────────────

financeRouter.get("/finance/categories/opiu", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(opiuCategoriesTable)
    .where(eq(opiuCategoriesTable.isActive, true));
  res.json(rows);
});
