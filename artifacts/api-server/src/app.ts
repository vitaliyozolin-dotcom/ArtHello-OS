import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { apiRouter } from "./routes/index.js";
import { logger } from "./lib/logger.js";
import {
  requireAuth,
  requireCsrf,
  requireRouteAccess,
} from "./lib/security/auth-middleware.js";
import { publicErrorBoundary } from "./lib/security/public-error-boundary.js";
import { blockLegacySyncSurface } from "./lib/security/legacy-sync-gate.js";
import { exposeRequestId } from "./lib/security/request-correlation.js";

const app: Express = express();
app.disable("x-powered-by");

const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? "0");
if (
  Number.isInteger(trustProxyHops) &&
  trustProxyHops > 0 &&
  trustProxyHops <= 4
) {
  app.set("trust proxy", trustProxyHops);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(exposeRequestId);
const allowedOrigins = (process.env.APP_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((_, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

app.use(
  cors({
    origin:
      allowedOrigins.length === 0
        ? false
        : (origin, callback) =>
            callback(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(
  "/api/webhooks/website-lead",
  express.raw({ type: "application/json", limit: "1mb" }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use("/api", publicErrorBoundary);
app.use("/api", blockLegacySyncSurface);

app.use("/api", (req, res, next) => {
  const publicRoute =
    ((req.method === "GET" || req.method === "HEAD") &&
      req.path === "/healthz") ||
    (req.method === "POST" && req.path === "/auth/login") ||
    (req.method === "POST" && req.path === "/webhooks/smsvizitka") ||
    (req.method === "POST" && req.path === "/webhooks/website-lead") ||
    (req.method === "GET" && req.path === "/banking/oauth/callback");

  if (publicRoute) {
    res.locals.publicApiRoute = true;
    next();
    return;
  }

  void requireAuth(req, res, next).catch(next);
});

app.use("/api", (req, res, next) => {
  if (res.locals.publicApiRoute === true) {
    next();
    return;
  }
  requireCsrf(req, res, next);
});

app.use("/api", (req, res, next) => {
  if (res.locals.publicApiRoute === true) {
    next();
    return;
  }
  void requireRouteAccess(req, res, next).catch(next);
});

app.use("/api", apiRouter);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error({ err }, "Unhandled API error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Внутренняя ошибка сервера" });
    }
  },
);

export default app;
