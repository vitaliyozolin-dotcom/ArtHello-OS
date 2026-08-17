import type { NextFunction, Request, Response } from "express";

export const PUBLIC_INTERNAL_ERROR = Object.freeze({
  success: false,
  error: "INTERNAL_ERROR",
});

const ALLOWED_PUBLIC_5XX_CODES = new Set([
  "LEGACY_SYNC_DISABLED",
]);

/**
 * A final response boundary for legacy handlers.
 *
 * Route implementations may log an Error through the structured redacting
 * logger, but a 5xx response never returns an exception message, upstream
 * body, probe output, identifiers, or a handler-specific debug object.
 */
export function publicErrorBoundary(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const sendJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    if (res.statusCode >= 500) {
      const publicCode =
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string" &&
        ALLOWED_PUBLIC_5XX_CODES.has(body.error)
          ? body.error
          : null;
      if (publicCode) {
        return sendJson({
          success: false,
          error: publicCode,
        });
      }
      return sendJson(PUBLIC_INTERNAL_ERROR);
    }
    return sendJson(body);
  }) as Response["json"];

  next();
}
