import { Router } from "express";
import { db } from "@workspace/db";
import { contractsTable, type Contract } from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod/v4";

export const contractsModuleRouter = Router();

const contractSchema = z.object({
  contractType: z.string().default("family"),
  contractNumber: z.string().optional(),
  title: z.string().optional(),
  status: z.string().default("active"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  signedAt: z.string().optional(),
  autoRenewal: z.boolean().default(false),
  monthlyAmount: z.string().optional(),
  totalAmount: z.string().optional(),
  currency: z.string().default("RUB"),
  paymentTerms: z.string().optional(),
  familyId: z.string().uuid().optional(),
  personId: z.string().uuid().optional(),
  counterpartyId: z.string().uuid().optional(),
  studentCrmId: z.string().optional(),
  directionId: z.string().uuid().optional(),
  branchCrmId: z.string().optional(),
  fileUrl: z.string().optional(),
  notes: z.string().optional(),
  isTestData: z.boolean().default(false),
});

// ─── GET /api/contracts ───────────────────────────────────────────────────────

contractsModuleRouter.get("/contracts", async (req, res) => {
  const { type, status, search } = req.query as Record<string, string>;
  const where = [];
  if (type) where.push(eq(contractsTable.contractType, type));
  if (status) where.push(eq(contractsTable.status, status));

  const rows = await db
    .select()
    .from(contractsTable)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(contractsTable.createdAt))
    .limit(200);

  const filtered = search
    ? rows.filter(
        (r: Contract) =>
          r.title?.toLowerCase().includes(search.toLowerCase()) ||
          r.contractNumber?.toLowerCase().includes(search.toLowerCase()),
      )
    : rows;

  res.json(filtered);
});

// ─── GET /api/contracts/stats ─────────────────────────────────────────────────

contractsModuleRouter.get("/contracts/stats", async (_req, res) => {
  const rows = await db.select().from(contractsTable);
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let totalMonthlyAmount = 0;

  for (const r of rows) {
    byType[r.contractType] = (byType[r.contractType] || 0) + 1;
    byStatus[r.status ?? "active"] = (byStatus[r.status ?? "active"] || 0) + 1;
    if (r.status === "active" && r.monthlyAmount) {
      totalMonthlyAmount += parseFloat(r.monthlyAmount);
    }
  }

  res.json({
    total: rows.length,
    active: byStatus["active"] ?? 0,
    expiringSoon: rows.filter((r: Contract) => {
      if (!r.endDate || r.status !== "active") return false;
      const days = (new Date(r.endDate).getTime() - Date.now()) / 86400000;
      return days >= 0 && days <= 30;
    }).length,
    totalMonthlyAmount,
    byType,
    byStatus,
  });
});

// ─── POST /api/contracts ──────────────────────────────────────────────────────

contractsModuleRouter.post("/contracts", async (req, res) => {
  const data = contractSchema.parse(req.body);
  const [row] = await db
    .insert(contractsTable)
    .values(data as typeof contractsTable.$inferInsert)
    .returning();
  res.status(201).json(row);
});

// ─── PATCH /api/contracts/:id ─────────────────────────────────────────────────

contractsModuleRouter.patch("/contracts/:id", async (req, res) => {
  const { id } = req.params;
  const data = contractSchema.partial().parse(req.body);
  const [row] = await db
    .update(contractsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(
      eq(
        contractsTable.id,
        id as `${string}-${string}-${string}-${string}-${string}`,
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

// ─── DELETE /api/contracts/:id ────────────────────────────────────────────────

contractsModuleRouter.delete("/contracts/:id", async (req, res) => {
  const { id } = req.params;
  await db
    .delete(contractsTable)
    .where(
      eq(
        contractsTable.id,
        id as `${string}-${string}-${string}-${string}-${string}`,
      ),
    );
  res.json({ ok: true });
});
