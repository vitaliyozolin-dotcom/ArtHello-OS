import type { NextFunction, Request, Response } from "express";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function exposeRequestId(
  req: Pick<Request, "id">,
  res: Pick<Response, "setHeader">,
  next: NextFunction,
): void {
  const requestId = req.id === undefined ? "" : String(req.id);
  if (SAFE_REQUEST_ID.test(requestId)) {
    res.setHeader("X-Request-Id", requestId);
  }
  next();
}
