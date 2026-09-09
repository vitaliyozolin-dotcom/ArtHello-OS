import { Router } from "express";
import { z } from "zod/v4";
import { and, desc, eq, isNull, sql, count } from "drizzle-orm";
import { db } from "@workspace/db";
import { documentsTable } from "@workspace/db";

export const documentsModuleRouter = Router();

// ─── GET /documents ───────────────────────────────────────────────────────────

documentsModuleRouter.get("/documents", async (req, res) => {
  try {
    const { period, docType, status, contractorId } = req.query as Record<
      string,
      string | undefined
    >;

    const conditions = [];
    if (period) conditions.push(eq(documentsTable.linkedPeriod, period));
    if (docType) conditions.push(eq(documentsTable.docType, docType));
    if (status) conditions.push(eq(documentsTable.status, status));
    if (contractorId)
      conditions.push(
        eq(
          documentsTable.linkedContractorId,
          contractorId as `${string}-${string}-${string}-${string}-${string}`,
        ),
      );

    const rows = await db
      .select()
      .from(documentsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(documentsTable.createdAt));

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /documents failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /documents/summary ───────────────────────────────────────────────────

documentsModuleRouter.get("/documents/summary", async (req, res) => {
  try {
    const byType = await db
      .select({
        docType: documentsTable.docType,
        count: count(documentsTable.id),
      })
      .from(documentsTable)
      .groupBy(documentsTable.docType);

    const byStatus = await db
      .select({
        status: documentsTable.status,
        count: count(documentsTable.id),
      })
      .from(documentsTable)
      .groupBy(documentsTable.status);

    const [totals] = await db
      .select({ total: count(documentsTable.id) })
      .from(documentsTable);
    const [expected] = await db
      .select({ cnt: count(documentsTable.id) })
      .from(documentsTable)
      .where(eq(documentsTable.status, "expected"));
    const [noLink] = await db
      .select({ cnt: count(documentsTable.id) })
      .from(documentsTable)
      .where(
        and(
          isNull(documentsTable.linkedOperationId),
          isNull(documentsTable.linkedContractorId),
        ),
      );

    res.json({
      total: Number(totals?.total ?? 0),
      expected: Number(expected?.cnt ?? 0),
      unlinked: Number(noLink?.cnt ?? 0),
      byType: byType.map((r) => ({
        docType: r.docType,
        count: Number(r.count),
      })),
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: Number(r.count),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "GET /documents/summary failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /documents ──────────────────────────────────────────────────────────

const createDocSchema = z.object({
  docType: z.string().default("other"),
  docNumber: z.string().optional(),
  docDate: z.string().optional(),
  amount: z.string().optional(),
  fileName: z.string().optional(),
  fileUrl: z.string().optional(),
  status: z.string().default("received"),
  linkedOperationId: z.string().uuid().optional(),
  linkedContractorId: z.string().uuid().optional(),
  linkedPeriod: z.string().optional(),
  counterpartyName: z.string().optional(),
  description: z.string().optional(),
  isTestData: z.boolean().optional(),
});

documentsModuleRouter.post("/documents", async (req, res) => {
  try {
    const body = createDocSchema.parse(req.body);
    const [doc] = await db
      .insert(documentsTable)
      .values({
        ...body,
        docDate: body.docDate ?? null,
        linkedOperationId: body.linkedOperationId as
          `${string}-${string}-${string}-${string}-${string}` | undefined,
        linkedContractorId: body.linkedContractorId as
          `${string}-${string}-${string}-${string}-${string}` | undefined,
        aiStatus: "pending",
      })
      .returning();
    res.json(doc);
  } catch (err) {
    req.log.error({ err }, "POST /documents failed");
    res.status(400).json({ error: String(err) });
  }
});

// ─── PATCH /documents/:id ─────────────────────────────────────────────────────

documentsModuleRouter.patch("/documents/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const schema = z.object({
      status: z.string().optional(),
      docNumber: z.string().optional(),
      docDate: z.string().optional(),
      amount: z.string().optional(),
      counterpartyName: z.string().optional(),
      description: z.string().optional(),
      linkedOperationId: z.string().uuid().optional(),
      linkedContractorId: z.string().uuid().optional(),
      linkedPeriod: z.string().optional(),
      aiStatus: z.string().optional(),
      aiNotes: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const [updated] = await db
      .update(documentsTable)
      .set({ ...body, updatedAt: new Date() })
      .where(
        eq(
          documentsTable.id,
          id as `${string}-${string}-${string}-${string}-${string}`,
        ),
      )
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH /documents/:id failed");
    res.status(400).json({ error: String(err) });
  }
});

// ─── DELETE /documents/:id ────────────────────────────────────────────────────

documentsModuleRouter.delete("/documents/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db
      .delete(documentsTable)
      .where(
        eq(
          documentsTable.id,
          id as `${string}-${string}-${string}-${string}-${string}`,
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /documents/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /documents/:id/ai-check ─────────────────────────────────────────────

documentsModuleRouter.post("/documents/:id/ai-check", async (req, res) => {
  try {
    const { id } = req.params;
    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(
        eq(
          documentsTable.id,
          id as `${string}-${string}-${string}-${string}-${string}`,
        ),
      );

    if (!doc) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const issues: string[] = [];

    if (!doc.docDate) issues.push("Нет даты документа");
    if (!doc.docNumber) issues.push("Нет номера документа");
    if (!doc.amount) issues.push("Не указана сумма");
    if (!doc.counterpartyName) issues.push("Не указан контрагент");
    if (!doc.linkedOperationId && !doc.linkedContractorId)
      issues.push("Документ не привязан к операции или подрядчику");
    if (!doc.linkedPeriod) issues.push("Не указан период");
    if (doc.docType === "other") issues.push("Уточните тип документа");
    if (doc.status === "expected")
      issues.push("Документ ожидается, но не получен");

    const aiStatus = issues.length === 0 ? "ok" : "issues_found";
    const aiNotes =
      issues.length > 0
        ? issues.join("; ")
        : "Документ проверен — проблем не найдено";

    const [updated] = await db
      .update(documentsTable)
      .set({ aiStatus, aiNotes, updatedAt: new Date() })
      .where(
        eq(
          documentsTable.id,
          id as `${string}-${string}-${string}-${string}-${string}`,
        ),
      )
      .returning();

    res.json({ aiStatus, aiNotes, issues, document: updated });
  } catch (err) {
    req.log.error({ err }, "POST /documents/:id/ai-check failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /documents/ai-check-all ─────────────────────────────────────────────

documentsModuleRouter.post("/documents/ai-check-all", async (req, res) => {
  try {
    const docs = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.aiStatus, "pending"));

    let checked = 0;
    for (const doc of docs) {
      const issues: string[] = [];
      if (!doc.docDate) issues.push("Нет даты");
      if (!doc.docNumber) issues.push("Нет номера");
      if (!doc.amount) issues.push("Нет суммы");
      if (!doc.counterpartyName) issues.push("Нет контрагента");
      if (!doc.linkedOperationId && !doc.linkedContractorId)
        issues.push("Не привязан");
      if (doc.status === "expected") issues.push("Ожидается");

      await db
        .update(documentsTable)
        .set({
          aiStatus: issues.length === 0 ? "ok" : "issues_found",
          aiNotes: issues.length > 0 ? issues.join("; ") : "OK",
          updatedAt: new Date(),
        })
        .where(eq(documentsTable.id, doc.id));
      checked++;
    }

    res.json({ checked });
  } catch (err) {
    req.log.error({ err }, "POST /documents/ai-check-all failed");
    res.status(500).json({ error: "Internal error" });
  }
});
