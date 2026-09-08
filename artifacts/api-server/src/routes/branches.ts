import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { crmBranchesTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SetAtlasBranchBody } from "@workspace/api-zod";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// GET /api/branches — list all synced branches with raw JSON
router.get("/branches", async (_req, res): Promise<void> => {
  const branches = await db
    .select()
    .from(crmBranchesTable)
    .orderBy(crmBranchesTable.name);

  res.json(
    branches.map((b) => ({
      crmId: b.crmId,
      name: b.name,
      raw: b.raw,
      syncedAt: b.syncedAt?.toISOString() ?? null,
    })),
  );
});

// POST /api/branches/set-atlas — manually set the Atlas branch
router.post("/branches/set-atlas", async (req, res): Promise<void> => {
  const parsed = SetAtlasBranchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.error.message });
    return;
  }

  const { branchCrmId } = parsed.data;

  // Verify branch exists
  const [branch] = await db
    .select()
    .from(crmBranchesTable)
    .where(eq(crmBranchesTable.crmId, branchCrmId))
    .limit(1);

  if (!branch) {
    res.status(404).json({
      success: false,
      message: `Branch with crm_id=${branchCrmId} not found in local DB. Sync branches first.`,
    });
    return;
  }

  await db
    .insert(settingsTable)
    .values({ key: "atlas_branch_id", value: branchCrmId })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: branchCrmId, updatedAt: new Date() },
    });

  logger.info({ branchCrmId, name: branch.name }, "Atlas branch manually set");

  res.json({
    success: true,
    message: `Atlas branch set to "${branch.name}" (crm_id=${branchCrmId})`,
    recordsCount: null,
    atlasBranchId: branchCrmId,
    data: null,
  });
});

export default router;
