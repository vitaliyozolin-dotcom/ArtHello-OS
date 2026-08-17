import { Router } from "express";
import { z } from "zod/v4";
import { and, desc, eq, ilike, or, sum, sql, count } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  contractorsTable,
  contractorAccrualsTable,
  contractorPaymentsTable,
  contractorDocumentsTable,
} from "@workspace/db";

export const contractorsModuleRouter = Router();

// ─── GET /contractors ─────────────────────────────────────────────────────────

contractorsModuleRouter.get("/contractors", async (req, res) => {
  try {
    const { search, type, risk, active } = req.query as Record<string, string | undefined>;

    const conditions = [];
    if (active !== "false") conditions.push(eq(contractorsTable.isActive, true));
    if (type) conditions.push(eq(contractorsTable.type, type));
    if (risk) conditions.push(eq(contractorsTable.riskLevel, risk));
    if (search) {
      const sc = or(
        ilike(contractorsTable.name, `%${search}%`),
        ilike(contractorsTable.inn, `%${search}%`),
      );
      if (sc) conditions.push(sc);
    }

    const rows = await db
      .select()
      .from(contractorsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(contractorsTable.name);

    // Enrich with balance (accrued - paid)
    const accrualTotals = await db
      .select({
        contractorId: contractorAccrualsTable.contractorId,
        total: sum(contractorAccrualsTable.amount),
      })
      .from(contractorAccrualsTable)
      .groupBy(contractorAccrualsTable.contractorId);

    const paymentTotals = await db
      .select({
        contractorId: contractorPaymentsTable.contractorId,
        total: sum(contractorPaymentsTable.amount),
      })
      .from(contractorPaymentsTable)
      .groupBy(contractorPaymentsTable.contractorId);

    const accrualMap = new Map(accrualTotals.map((r) => [r.contractorId, parseFloat(String(r.total ?? "0"))]));
    const paymentMap = new Map(paymentTotals.map((r) => [r.contractorId, parseFloat(String(r.total ?? "0"))]));

    const enriched = rows.map((c) => {
      const accrued = accrualMap.get(c.id) ?? 0;
      const paid = paymentMap.get(c.id) ?? 0;
      const balance = accrued - paid;
      return {
        ...c,
        totalAccrued: accrued,
        totalPaid: paid,
        balance,  // positive = we owe them, negative = overpaid
        hasDebt: balance > 0.01,
        hasOverpay: balance < -0.01,
      };
    });

    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "GET /contractors failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /contractors ────────────────────────────────────────────────────────

const contractorBodySchema = z.object({
  name: z.string().min(1),
  inn: z.string().optional(),
  type: z.enum(["ip", "ooo", "self_employed", "individual"]).optional(),
  taxStatus: z.string().optional(),
  paymentTerms: z.string().optional(),
  direction: z.string().optional(),
  responsible: z.string().optional(),
  trustScore: z.number().min(0).max(100).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  notes: z.string().optional(),
});

contractorsModuleRouter.post("/contractors", async (req, res) => {
  const parsed = contractorBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: z.prettifyError(parsed.error) }); return; }

  try {
    const [contractor] = await db.insert(contractorsTable).values(parsed.data).returning();
    res.json(contractor);
  } catch (err) {
    req.log.error({ err }, "POST /contractors failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /contractors/:id ─────────────────────────────────────────────────────

contractorsModuleRouter.get("/contractors/:id", async (req, res) => {
  try {
    const [contractor] = await db
      .select()
      .from(contractorsTable)
      .where(eq(contractorsTable.id, req.params.id));

    if (!contractor) { res.status(404).json({ error: "Not found" }); return; }

    const accruals = await db
      .select()
      .from(contractorAccrualsTable)
      .where(eq(contractorAccrualsTable.contractorId, req.params.id))
      .orderBy(desc(contractorAccrualsTable.accrualDate));

    const payments = await db
      .select()
      .from(contractorPaymentsTable)
      .where(eq(contractorPaymentsTable.contractorId, req.params.id))
      .orderBy(desc(contractorPaymentsTable.paymentDate));

    const documents = await db
      .select()
      .from(contractorDocumentsTable)
      .where(eq(contractorDocumentsTable.contractorId, req.params.id))
      .orderBy(desc(contractorDocumentsTable.docDate));

    const totalAccrued = accruals.reduce((s, a) => s + parseFloat(String(a.amount)), 0);
    const totalPaid = payments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);
    const docsExpected = accruals.length;
    const docsReceived = documents.length;

    res.json({
      contractor,
      accruals,
      payments,
      documents,
      summary: {
        totalAccrued,
        totalPaid,
        balance: totalAccrued - totalPaid,
        docsExpected,
        docsReceived,
        docsCoverage: docsExpected > 0 ? docsReceived / docsExpected : 1,
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET /contractors/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── PATCH /contractors/:id ───────────────────────────────────────────────────

contractorsModuleRouter.patch("/contractors/:id", async (req, res) => {
  try {
    const [updated] = await db
      .update(contractorsTable)
      .set({ ...req.body as Partial<typeof contractorsTable.$inferInsert>, updatedAt: new Date() })
      .where(eq(contractorsTable.id, req.params.id))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH /contractors/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /contractors/:id/accruals ───────────────────────────────────────────

const accrualSchema = z.object({
  amount: z.number().positive(),
  accrualDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accrualMonth: z.string().regex(/^\d{4}-\d{2}$/),
  description: z.string().optional(),
  status: z.enum(["pending", "approved", "paid", "cancelled"]).optional(),
});

contractorsModuleRouter.post("/contractors/:id/accruals", async (req, res) => {
  const parsed = accrualSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: z.prettifyError(parsed.error) }); return; }

  try {
    const [accrual] = await db
      .insert(contractorAccrualsTable)
      .values({ contractorId: req.params.id, ...parsed.data, amount: String(parsed.data.amount) })
      .returning();
    res.json(accrual);
  } catch (err) {
    req.log.error({ err }, "POST /contractors/:id/accruals failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /contractors/:id/payments ───────────────────────────────────────────

const paymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMonth: z.string().regex(/^\d{4}-\d{2}$/),
  accrualId: z.string().uuid().optional(),
  method: z.enum(["bank", "cash", "card"]).optional(),
  notes: z.string().optional(),
});

contractorsModuleRouter.post("/contractors/:id/payments", async (req, res) => {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: z.prettifyError(parsed.error) }); return; }

  try {
    const [payment] = await db
      .insert(contractorPaymentsTable)
      .values({ contractorId: req.params.id, ...parsed.data, amount: String(parsed.data.amount) })
      .returning();
    res.json(payment);
  } catch (err) {
    req.log.error({ err }, "POST /contractors/:id/payments failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /contractors/:id/documents ──────────────────────────────────────────

const docSchema = z.object({
  docType: z.enum(["contract", "act", "invoice", "upd", "reconciliation", "other"]),
  docNumber: z.string().optional(),
  docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount: z.number().optional(),
  status: z.enum(["expected", "received", "signed", "overdue"]).optional(),
  accrualId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

contractorsModuleRouter.post("/contractors/:id/documents", async (req, res) => {
  const parsed = docSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: z.prettifyError(parsed.error) }); return; }

  try {
    const [doc] = await db
      .insert(contractorDocumentsTable)
      .values({
        contractorId: req.params.id,
        ...parsed.data,
        amount: parsed.data.amount != null ? String(parsed.data.amount) : null,
      })
      .returning();
    res.json(doc);
  } catch (err) {
    req.log.error({ err }, "POST /contractors/:id/documents failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /contractors/stats/summary ───────────────────────────────────────────

contractorsModuleRouter.get("/contractors/stats/summary", async (req, res) => {
  try {
    const [{ total }] = await db.select({ total: count(contractorsTable.id) }).from(contractorsTable).where(eq(contractorsTable.isActive, true));
    const [{ highRisk }] = await db.select({ highRisk: count(contractorsTable.id) }).from(contractorsTable).where(and(eq(contractorsTable.isActive, true), eq(contractorsTable.riskLevel, "high")));

    const accruals = await db.select({ total: sum(contractorAccrualsTable.amount) }).from(contractorAccrualsTable);
    const payments = await db.select({ total: sum(contractorPaymentsTable.amount) }).from(contractorPaymentsTable);
    const docsExpected = await db.select({ cnt: count(contractorAccrualsTable.id) }).from(contractorAccrualsTable);
    const docsReceived = await db.select({ cnt: count(contractorDocumentsTable.id) }).from(contractorDocumentsTable);

    const totalAccrued = parseFloat(String(accruals[0]?.total ?? "0"));
    const totalPaid = parseFloat(String(payments[0]?.total ?? "0"));

    res.json({
      totalContractors: Number(total),
      highRisk: Number(highRisk),
      totalAccrued,
      totalPaid,
      totalDebt: totalAccrued - totalPaid,
      docsExpected: Number(docsExpected[0]?.cnt ?? 0),
      docsReceived: Number(docsReceived[0]?.cnt ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "GET /contractors/stats/summary failed");
    res.status(500).json({ error: "Internal error" });
  }
});
