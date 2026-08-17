import { Router } from "express";
import { db } from "@workspace/db";
import {
  operations, operationHistory, articles,
} from "@workspace/db";
import {
  eq, desc, asc, and, gte, lte, ilike, sql, sum, count, ne, isNull,
} from "drizzle-orm";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";

export const ledgerRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function toMonth(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Record every changed field in operation_history */
async function auditChanges(
  operationId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  changedBy = "system",
  reason?: string,
) {
  const entries: typeof operationHistory.$inferInsert[] = [];
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      entries.push({
        operationId,
        changedBy,
        fieldName: key,
        oldValue: before[key] != null ? String(before[key]) : null,
        newValue: after[key] != null ? String(after[key]) : null,
        changeReason: reason ?? null,
      });
    }
  }
  if (entries.length > 0) {
    await db.insert(operationHistory).values(entries);
  }
}

// ─── GET /ledger/articles ─────────────────────────────────────────────────────

ledgerRouter.get("/ledger/articles", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(articles)
      .where(eq(articles.isActive, true))
      .orderBy(asc(articles.sortOrder), asc(articles.code));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /ledger/articles failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /ledger/articles ────────────────────────────────────────────────────

const ArticleSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  groupName: z.string().min(1),
  subGroup: z.string().optional(),
  type: z.enum(["income", "expense", "transfer", "asset", "liability"]),
  affectsDds: z.boolean().optional(),
  affectsPl: z.boolean().optional(),
  affectsEbitda: z.boolean().optional(),
  taxDeductible: z.boolean().optional(),
  isFixed: z.boolean().optional(),
  isOperational: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

ledgerRouter.post("/ledger/articles", async (req, res) => {
  const parsed = ArticleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: z.prettifyError(parsed.error) }); return; }

  try {
    const [row] = await db.insert(articles).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "POST /ledger/articles failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── PATCH /ledger/articles/:id ───────────────────────────────────────────────

ledgerRouter.patch("/ledger/articles/:id", async (req, res) => {
  const { id } = req.params;
  const parsed = ArticleSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: z.prettifyError(parsed.error) }); return; }

  try {
    const [row] = await db
      .update(articles)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(articles.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Article not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "PATCH /ledger/articles/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── DELETE /ledger/articles/:id ─────────────────────────────────────────────

ledgerRouter.delete("/ledger/articles/:id", async (req, res) => {
  try {
    await db.update(articles).set({ isActive: false }).where(eq(articles.id, req.params.id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /ledger/articles/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /ledger/seed-articles ───────────────────────────────────────────────

const DEFAULT_ARTICLES: typeof articles.$inferInsert[] = [
  // ── Income ──────────────────────────────────────────────────────────────────
  { code: "1.1", name: "Оплата за обучение",           groupName: "Доходы от обучения",         type: "income",  affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: false, isFixed: false, isOperational: true,  sortOrder: 10 },
  { code: "1.2", name: "Вступительный взнос",           groupName: "Доходы от обучения",         type: "income",  affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: false, isFixed: false, isOperational: true,  sortOrder: 20 },
  { code: "1.3", name: "Дополнительные занятия",        groupName: "Доходы от обучения",         type: "income",  affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: false, isFixed: false, isOperational: true,  sortOrder: 30 },
  { code: "1.4", name: "Продажа материалов",            groupName: "Прочие доходы",              type: "income",  affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: false, isFixed: false, isOperational: true,  sortOrder: 40 },
  { code: "1.5", name: "Возврат от поставщика",         groupName: "Прочие доходы",              type: "income",  affectsDds: true, affectsPl: true, affectsEbitda: false, taxDeductible: false, isFixed: false, isOperational: false, sortOrder: 50 },
  { code: "1.9", name: "Прочие доходы",                 groupName: "Прочие доходы",              type: "income",  affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: false, isFixed: false, isOperational: true,  sortOrder: 90 },
  // ── Payroll / HR ────────────────────────────────────────────────────────────
  { code: "2.1", name: "ФОТ — педагоги",               groupName: "Фонд оплаты труда",          type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 110 },
  { code: "2.2", name: "ФОТ — административный персонал",groupName: "Фонд оплаты труда",        type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: true,  isOperational: true,  sortOrder: 120 },
  { code: "2.3", name: "Страховые взносы (СВ)",        groupName: "Фонд оплаты труда",          type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 130 },
  { code: "2.4", name: "НДФЛ",                          groupName: "Фонд оплаты труда",          type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: false, taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 140 },
  { code: "2.5", name: "Самозанятые и ИП",             groupName: "Фонд оплаты труда",          type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 150 },
  // ── Operations ──────────────────────────────────────────────────────────────
  { code: "3.1", name: "Аренда помещений",              groupName: "Операционные расходы",       type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: true,  isOperational: true,  sortOrder: 210 },
  { code: "3.2", name: "Коммунальные услуги",           groupName: "Операционные расходы",       type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: true,  isOperational: true,  sortOrder: 220 },
  { code: "3.3", name: "Интернет и связь",              groupName: "Операционные расходы",       type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: true,  isOperational: true,  sortOrder: 230 },
  { code: "3.4", name: "Уборка и обслуживание",         groupName: "Операционные расходы",       type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: true,  isOperational: true,  sortOrder: 240 },
  { code: "3.5", name: "Охрана",                        groupName: "Операционные расходы",       type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: true,  isOperational: true,  sortOrder: 250 },
  // ── Marketing ───────────────────────────────────────────────────────────────
  { code: "4.1", name: "Реклама — VK Ads",             groupName: "Маркетинг и реклама",        type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 310 },
  { code: "4.2", name: "Реклама — Яндекс",             groupName: "Маркетинг и реклама",        type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 320 },
  { code: "4.3", name: "Реклама — Instagram / Meta",   groupName: "Маркетинг и реклама",        type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 330 },
  { code: "4.4", name: "Маркетинг — прочее",           groupName: "Маркетинг и реклама",        type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 340 },
  // ── Materials ───────────────────────────────────────────────────────────────
  { code: "5.1", name: "Учебные материалы",             groupName: "Материалы и расходники",     type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 410 },
  { code: "5.2", name: "Канцелярия и хозтовары",        groupName: "Материалы и расходники",     type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 420 },
  // ── Taxes ───────────────────────────────────────────────────────────────────
  { code: "6.1", name: "УСН (6%)",                      groupName: "Налоги",                     type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: false, taxDeductible: false, isFixed: false, isOperational: true,  sortOrder: 510 },
  { code: "6.2", name: "Налоги прочие",                 groupName: "Налоги",                     type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: false, taxDeductible: false, isFixed: false, isOperational: true,  sortOrder: 520 },
  // ── Bank / Finance ──────────────────────────────────────────────────────────
  { code: "7.1", name: "Банковская комиссия",           groupName: "Банк и финансы",             type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: false, taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 610 },
  { code: "7.2", name: "Эквайринг",                     groupName: "Банк и финансы",             type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: false, taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 620 },
  { code: "7.3", name: "Межбанковский перевод",         groupName: "Банк и финансы",             type: "transfer",affectsDds: true, affectsPl: false,affectsEbitda: false, taxDeductible: false, isFixed: false, isOperational: false, sortOrder: 630 },
  // ── Other expenses ──────────────────────────────────────────────────────────
  { code: "8.1", name: "Подрядчики — разовые",          groupName: "Прочие расходы",             type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 710 },
  { code: "8.2", name: "Командировочные",                groupName: "Прочие расходы",             type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: true,  isFixed: false, isOperational: true,  sortOrder: 720 },
  { code: "8.9", name: "Прочие расходы",                groupName: "Прочие расходы",             type: "expense", affectsDds: true, affectsPl: true, affectsEbitda: true,  taxDeductible: false, isFixed: false, isOperational: true,  sortOrder: 790 },
];

ledgerRouter.post("/ledger/seed-articles", async (req, res) => {
  try {
    const existing = await db.select({ code: articles.code }).from(articles);
    const existingCodes = new Set(existing.map((r) => r.code));
    const toInsert = DEFAULT_ARTICLES.filter((a) => !existingCodes.has(a.code!));

    if (toInsert.length === 0) {
      res.json({ message: "Already seeded", inserted: 0 });
    }
    const inserted = await db.insert(articles).values(toInsert).returning({ id: articles.id });
    res.json({ message: "Seeded", inserted: inserted.length });
  } catch (err) {
    req.log.error({ err }, "POST /ledger/seed-articles failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /ledger/operations ───────────────────────────────────────────────────

const ListOperationsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(500).default(50),
  month: z.string().optional(),           // "2025-08" — filter by cashflow OR pl month
  mode: z.enum(["dds", "pl"]).default("dds"),  // which month field to filter
  dateFrom: z.string().optional(),        // ISO date
  dateTo: z.string().optional(),
  type: z.string().optional(),            // comma-separated operation types
  direction: z.string().optional(),       // in | out | internal
  articleId: z.string().uuid().optional(),
  verificationStatus: z.string().optional(),
  source: z.string().optional(),
  search: z.string().optional(),
});

ledgerRouter.get("/ledger/operations", async (req, res) => {
  const parsed = ListOperationsSchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: z.prettifyError(parsed.error) }); return; }

  const { page, limit, month, mode, dateFrom, dateTo, type, direction, articleId, verificationStatus, source, search } = parsed.data;

  try {
    const wheres = [eq(operations.isDeleted, false)];

    if (month) {
      if (mode === "pl") wheres.push(eq(operations.plMonth, month));
      else wheres.push(eq(operations.cashflowMonth, month));
    }
    if (dateFrom) wheres.push(gte(operations.cashflowDate, new Date(dateFrom)));
    if (dateTo)   wheres.push(lte(operations.cashflowDate, new Date(dateTo)));
    if (type)     wheres.push(sql`${operations.operationType} = ANY(${type.split(",").map(t => t.trim())})`);
    if (direction)         wheres.push(eq(operations.direction, direction));
    if (articleId)         wheres.push(eq(operations.articleId, articleId));
    if (verificationStatus)wheres.push(eq(operations.verificationStatus, verificationStatus));
    if (source)            wheres.push(eq(operations.source, source));
    if (search)            wheres.push(ilike(operations.description, `%${search}%`));

    const where = and(...wheres);
    const offset = (page - 1) * limit;

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(operations)
        .where(where)
        .orderBy(desc(operations.cashflowDate), desc(operations.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(operations).where(where),
    ]);

    res.json({ operations: rows, total: Number(total), page, limit, pages: Math.ceil(Number(total) / limit) });
  } catch (err) {
    req.log.error({ err }, "GET /ledger/operations failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /ledger/operations ──────────────────────────────────────────────────

const CreateOperationSchema = z.object({
  operationType: z.string().min(1),
  source: z.string().default("manual"),
  direction: z.enum(["in", "out", "internal"]),
  amount: z.number().positive(),
  currency: z.string().default("RUB"),
  description: z.string().optional(),
  cashflowDate: z.string(),             // ISO date string
  accrualDate: z.string().optional(),
  plMonth: z.string().optional(),       // overrides auto-calculated; "YYYY-MM"
  articleId: z.string().uuid().optional(),
  department: z.string().optional(),
  project: z.string().optional(),
  location: z.string().optional(),
  counterpartyName: z.string().optional(),
  counterpartyType: z.string().optional(),
  familyId: z.string().uuid().optional(),
  paymentStatus: z.string().default("paid"),
  verificationStatus: z.string().default("unverified"),
  notes: z.string().optional(),
  bankTransactionId: z.string().optional(),
  externalId: z.string().optional(),
  createdBy: z.string().default("owner"),
});

ledgerRouter.post("/ledger/operations", async (req, res) => {
  const parsed = CreateOperationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: z.prettifyError(parsed.error) }); return; }

  const data = parsed.data;
  const cashflowDate = new Date(data.cashflowDate);
  const cashflowMonth = toMonth(cashflowDate);

  // accrualDate defaults to cashflowDate when not specified
  const accrualDate = data.accrualDate ? new Date(data.accrualDate) : cashflowDate;
  // P&L month defaults to accrual month (override possible)
  const plMonth = data.plMonth ?? toMonth(accrualDate);

  try {
    // Resolve article name
    let articleName: string | null = null;
    let articleCode: string | null = null;
    if (data.articleId) {
      const [art] = await db.select().from(articles).where(eq(articles.id, data.articleId));
      articleName = art?.name ?? null;
      articleCode = art?.code ?? null;
    }

    // Compute trust score based on completeness
    let trustScore = 50;
    if (data.articleId) trustScore += 20;
    if (data.description) trustScore += 10;
    if (data.counterpartyName) trustScore += 10;
    if (data.verificationStatus === "verified") trustScore += 10;

    const [row] = await db.insert(operations).values({
      operationType: data.operationType,
      source: data.source,
      direction: data.direction,
      amount: String(data.amount),
      currency: data.currency,
      description: data.description ?? null,
      cashflowDate,
      accrualDate,
      cashflowMonth,
      plMonth,
      articleId: data.articleId ?? null,
      articleName,
      articleCode,
      department: data.department ?? null,
      project: data.project ?? null,
      location: data.location ?? null,
      counterpartyName: data.counterpartyName ?? null,
      counterpartyType: data.counterpartyType ?? null,
      familyId: data.familyId ?? null,
      paymentStatus: data.paymentStatus,
      verificationStatus: data.verificationStatus,
      trustScore,
      bankTransactionId: data.bankTransactionId ?? null,
      externalId: data.externalId ?? null,
      notes: data.notes ?? null,
      createdBy: data.createdBy,
    }).returning();

    // Log creation in history
    await db.insert(operationHistory).values({
      operationId: row.id,
      changedBy: data.createdBy,
      fieldName: "_created",
      oldValue: null,
      newValue: "operation created",
    });

    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "POST /ledger/operations failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /ledger/operations/:id ───────────────────────────────────────────────

ledgerRouter.get("/ledger/operations/:id", async (req, res) => {
  try {
    const [op] = await db.select().from(operations).where(
      and(eq(operations.id, req.params.id), eq(operations.isDeleted, false))
    );
    if (!op) { res.status(404).json({ error: "Not found" }); return; }

    const history = await db
      .select()
      .from(operationHistory)
      .where(eq(operationHistory.operationId, op.id))
      .orderBy(desc(operationHistory.changedAt));

    res.json({ ...op, history });
  } catch (err) {
    req.log.error({ err }, "GET /ledger/operations/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── PATCH /ledger/operations/:id ────────────────────────────────────────────

const UpdateOperationSchema = CreateOperationSchema.partial().extend({
  changeReason: z.string().optional(),
});

ledgerRouter.patch("/ledger/operations/:id", async (req, res) => {
  const parsed = UpdateOperationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: z.prettifyError(parsed.error) }); return; }

  const { changeReason, ...data } = parsed.data;

  try {
    const [before] = await db.select().from(operations).where(eq(operations.id, req.params.id));
    if (!before || before.isDeleted) { res.status(404).json({ error: "Not found" }); return; }

    // Recompute derived fields if dates change
    const updates: Partial<typeof operations.$inferInsert> = { ...data as Partial<typeof operations.$inferInsert>, updatedAt: new Date() };

    if (data.cashflowDate) {
      const d = new Date(data.cashflowDate);
      updates.cashflowDate = d;
      updates.cashflowMonth = toMonth(d);
    }
    if (data.accrualDate) {
      const d = new Date(data.accrualDate);
      updates.accrualDate = d;
      if (!data.plMonth) updates.plMonth = toMonth(d);
    }
    if (data.amount != null) {
      updates.amount = String(data.amount);
    }

    // Resolve article name if article changed
    if (data.articleId) {
      const [art] = await db.select().from(articles).where(eq(articles.id, data.articleId));
      updates.articleName = art?.name ?? null;
      updates.articleCode = art?.code ?? null;
    }

    const [after] = await db.update(operations).set(updates).where(eq(operations.id, req.params.id)).returning();

    // Audit changed fields
    await auditChanges(
      req.params.id,
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      data.createdBy ?? "owner",
      changeReason,
    );

    res.json(after);
  } catch (err) {
    req.log.error({ err }, "PATCH /ledger/operations/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── DELETE /ledger/operations/:id ───────────────────────────────────────────

ledgerRouter.delete("/ledger/operations/:id", async (req, res) => {
  try {
    const [op] = await db.select().from(operations).where(eq(operations.id, req.params.id));
    if (!op) { res.status(404).json({ error: "Not found" }); return; }

    await db.update(operations).set({
      isDeleted: true,
      deletedAt: new Date(),
      deletedBy: "owner",
      updatedAt: new Date(),
    }).where(eq(operations.id, req.params.id));

    await db.insert(operationHistory).values({
      operationId: req.params.id,
      changedBy: "owner",
      fieldName: "_deleted",
      oldValue: "active",
      newValue: "deleted",
    });

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /ledger/operations/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /ledger/operations/:id/history ──────────────────────────────────────

ledgerRouter.get("/ledger/operations/:id/history", async (req, res) => {
  try {
    const history = await db
      .select()
      .from(operationHistory)
      .where(eq(operationHistory.operationId, req.params.id))
      .orderBy(desc(operationHistory.changedAt));
    res.json(history);
  } catch (err) {
    req.log.error({ err }, "GET /ledger/operations/:id/history failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /ledger/stats ────────────────────────────────────────────────────────

ledgerRouter.get("/ledger/stats", async (req, res) => {
  const { month, mode = "dds" } = req.query as { month?: string; mode?: string };

  try {
    const wheres = [eq(operations.isDeleted, false)];
    if (month) {
      if (mode === "pl") wheres.push(eq(operations.plMonth, month as string));
      else wheres.push(eq(operations.cashflowMonth, month as string));
    }

    const where = and(...wheres);

    // Aggregate by direction
    const [aggRows] = await Promise.all([
      db.select({
        direction: operations.direction,
        total: sum(operations.amount),
        cnt: count(),
      })
        .from(operations)
        .where(where)
        .groupBy(operations.direction),
    ]);

    // By article (top 10 expense articles)
    const byArticle = await db.select({
      articleId: operations.articleId,
      articleName: operations.articleName,
      articleCode: operations.articleCode,
      direction: operations.direction,
      total: sum(operations.amount),
      cnt: count(),
    })
      .from(operations)
      .where(where)
      .groupBy(operations.articleId, operations.articleName, operations.articleCode, operations.direction)
      .orderBy(desc(sum(operations.amount)))
      .limit(20);

    // By type
    const byType = await db.select({
      type: operations.operationType,
      total: sum(operations.amount),
      cnt: count(),
    })
      .from(operations)
      .where(where)
      .groupBy(operations.operationType)
      .orderBy(desc(sum(operations.amount)));

    // Verification breakdown
    const byVerification = await db.select({
      status: operations.verificationStatus,
      cnt: count(),
    })
      .from(operations)
      .where(where)
      .groupBy(operations.verificationStatus);

    const totalIn  = aggRows.find((r) => r.direction === "in");
    const totalOut = aggRows.find((r) => r.direction === "out");

    const inAmt  = toNum(totalIn?.total);
    const outAmt = toNum(totalOut?.total);
    const netAmt = inAmt - outAmt;

    // Trust score: % of operations that are verified
    const verifiedCount = byVerification.find((r) => r.status === "verified")?.cnt ?? 0;
    const totalCount = byVerification.reduce((s, r) => s + Number(r.cnt), 0);
    const trustScore  = totalCount > 0 ? Math.round((Number(verifiedCount) / totalCount) * 100) : 0;

    // Unverified count
    const unverifiedCount = byVerification.find((r) => r.status === "unverified")?.cnt ?? 0;

    res.json({
      month,
      mode,
      totalIn: inAmt,
      totalOut: outAmt,
      net: netAmt,
      totalOperations: totalCount,
      verifiedCount: Number(verifiedCount),
      unverifiedCount: Number(unverifiedCount),
      trustScore,
      byArticle,
      byType,
      byVerification,
    });
  } catch (err) {
    req.log.error({ err }, "GET /ledger/stats failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /ledger/months ───────────────────────────────────────────────────────
// Returns list of months that have operations

ledgerRouter.get("/ledger/months", async (req, res) => {
  try {
    const months = await db
      .selectDistinct({ cashflowMonth: operations.cashflowMonth })
      .from(operations)
      .where(eq(operations.isDeleted, false))
      .orderBy(desc(operations.cashflowMonth))
      .limit(24);
    res.json(months.map((r) => r.cashflowMonth));
  } catch (err) {
    req.log.error({ err }, "GET /ledger/months failed");
    res.status(500).json({ error: "Internal error" });
  }
});
