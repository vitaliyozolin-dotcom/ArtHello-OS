import { Router } from "express";
import { db } from "@workspace/db";
import { assertPlanMonth, parsePlanInput } from "@workspace/shared/pulse-plan";
import {
  PlanConflictError,
  readPulseFacts,
  readPulsePlan,
  savePulsePlan,
} from "../lib/pulse-plan.js";

export const pulsePlanRouter = Router();

pulsePlanRouter.get("/finance/monthly-plan", async (req, res) => {
  try {
    assertPlanMonth(req.query.month);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  const month = req.query.month;
  const [plan, facts] = await Promise.all([
    readPulsePlan(db, month),
    readPulseFacts(db, month),
  ]);
  res.json({ month, plan, facts });
});

pulsePlanRouter.put("/finance/monthly-plan", async (req, res) => {
  let input;
  try {
    input = parsePlanInput(req.body);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  const auth = res.locals.auth as
    { session?: { userId?: string; role?: string } } | undefined;
  if (auth?.session?.role !== "owner" || !auth.session.userId) {
    res.status(403).json({ error: "Настройка плана доступна владельцу" });
    return;
  }
  try {
    res.json(await savePulsePlan(db, input, auth.session.userId));
  } catch (error) {
    if (!(error instanceof PlanConflictError)) throw error;
    res.status(409).json({ error: error.message });
  }
});
