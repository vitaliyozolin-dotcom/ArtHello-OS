import type { NextFunction, Request, Response } from "express";

/**
 * The historical /sync surface contains write jobs and diagnostic probes that
 * predate the current security/data-quality gates. It remains unreachable in
 * every runtime until the handlers are replaced by scoped, source-specific
 * jobs with sanitized evidence.
 */
export function blockLegacySyncSurface(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.path === "/sync" || req.path.startsWith("/sync/")) {
    res.status(503).json({
      success: false,
      error: "LEGACY_SYNC_DISABLED",
    });
    return;
  }

  next();
}
