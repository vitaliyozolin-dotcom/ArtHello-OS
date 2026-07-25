import { Router } from "express";
import { db } from "@workspace/db";
import { articles } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";

export const articlesModuleRouter = Router();

// GET /articles
articlesModuleRouter.get("/articles", async (req, res) => {
  try {
    const list = await db.select().from(articles)
      .orderBy(asc(articles.type), asc(articles.sortOrder), asc(articles.code));
    res.json(list);
  } catch (err) {
    req.log.error({ err }, "GET /articles failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// POST /articles
articlesModuleRouter.post("/articles", async (req, res) => {
  try {
    const schema = z.object({
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
      sortOrder: z.number().int().optional(),
    });
    const body = schema.parse(req.body);
    const [article] = await db.insert(articles).values(body).returning();
    res.json(article);
  } catch (err) {
    req.log.error({ err }, "POST /articles failed");
    res.status(400).json({ error: String(err) });
  }
});

// PATCH /articles/:id
articlesModuleRouter.patch("/articles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const schema = z.object({
      name: z.string().optional(),
      groupName: z.string().optional(),
      subGroup: z.string().optional(),
      affectsDds: z.boolean().optional(),
      affectsPl: z.boolean().optional(),
      affectsEbitda: z.boolean().optional(),
      taxDeductible: z.boolean().optional(),
      isFixed: z.boolean().optional(),
      isOperational: z.boolean().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    });
    const body = schema.parse(req.body);
    const [updated] = await db.update(articles)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(articles.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH /articles/:id failed");
    res.status(400).json({ error: String(err) });
  }
});

// DELETE /articles/:id (soft — deactivate)
articlesModuleRouter.delete("/articles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.update(articles)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(articles.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /articles/:id failed");
    res.status(500).json({ error: "Internal error" });
  }
});
