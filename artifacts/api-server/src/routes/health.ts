import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

export const healthRouter: IRouter = Router();

healthRouter.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});
