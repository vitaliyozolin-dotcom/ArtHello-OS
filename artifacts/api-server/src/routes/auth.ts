import { Router, type NextFunction, type Request, type Response } from "express";
import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";
import {
  decideRouteAccess,
  hasCompleteBusinessScope,
  type AuthRole,
  type BusinessScope,
} from "../lib/security/access-policy.js";
import {
  recordAccessAudit,
} from "../lib/security/access-audit.js";
import { shouldAuditAccess } from "../lib/security/access-audit-policy.js";
import {
  PostgresAuthStore,
  type AuthSession,
  type AuthStore,
} from "../lib/security/auth-store.js";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const store: AuthStore = new PostgresAuthStore();

export const authRouter = Router();

interface Account {
  login: string;
  password: string;
  role: AuthRole;
  name: string;
  scope: BusinessScope;
}

interface RequestAuth {
  tokenHash: string;
  session: AuthSession;
}

function positiveIntegerFromEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function getSessionTtlMs(): number {
  return positiveIntegerFromEnv(
    "AUTH_SESSION_TTL_MS",
    SESSION_TTL_MS,
    15 * 60 * 1000,
    24 * 60 * 60 * 1000,
  );
}

function getLoginPolicy() {
  return {
    maxAttempts: positiveIntegerFromEnv(
      "AUTH_LOGIN_MAX_ATTEMPTS",
      LOGIN_MAX_ATTEMPTS,
      3,
      20,
    ),
    windowMs: positiveIntegerFromEnv(
      "AUTH_LOGIN_WINDOW_MS",
      LOGIN_WINDOW_MS,
      60 * 1000,
      60 * 60 * 1000,
    ),
    lockMs: positiveIntegerFromEnv(
      "AUTH_LOGIN_LOCK_MS",
      LOGIN_LOCK_MS,
      60 * 1000,
      24 * 60 * 60 * 1000,
    ),
  };
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function sessionCookieName(): string {
  return isProduction()
    ? "__Host-arthello_session"
    : "arthello_session";
}

function csrfCookieName(): string {
  return isProduction() ? "__Host-arthello_csrf" : "arthello_csrf";
}

function cookieBaseOptions() {
  return {
    secure: isProduction(),
    sameSite: "strict" as const,
    path: "/",
  };
}

function setAuthCookies(
  res: Response,
  sessionToken: string,
  csrfToken: string,
  maxAge: number,
): void {
  res.cookie(sessionCookieName(), sessionToken, {
    ...cookieBaseOptions(),
    httpOnly: true,
    maxAge,
  });
  res.cookie(csrfCookieName(), csrfToken, {
    ...cookieBaseOptions(),
    httpOnly: false,
    maxAge,
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(sessionCookieName(), {
    ...cookieBaseOptions(),
    httpOnly: true,
  });
  res.clearCookie(csrfCookieName(), {
    ...cookieBaseOptions(),
    httpOnly: false,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function idListFromEnv(name: string): string[] {
  return [
    ...new Set(
      (process.env[name] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value.length <= 128),
    ),
  ];
}

function restrictedScope(prefix: "ACCOUNTANT" | "VIEWER"): BusinessScope {
  return {
    unrestricted: false,
    branchIds: idListFromEnv(`${prefix}_BRANCH_IDS`),
    legalEntityIds: idListFromEnv(`${prefix}_LEGAL_ENTITY_IDS`),
  };
}

function getAccounts(): Account[] {
  const accountantScope = restrictedScope("ACCOUNTANT");
  const viewerScope = restrictedScope("VIEWER");
  const candidates: Array<Account | null> = [
    process.env.DASHBOARD_PASSWORD
      ? {
          login: "owner",
          password: process.env.DASHBOARD_PASSWORD,
          role: "owner",
          name: "Владелец",
          scope: {
            unrestricted: true,
            branchIds: [],
            legalEntityIds: [],
          },
        }
      : null,
    process.env.ACCOUNTANT_PASSWORD &&
    hasCompleteBusinessScope(accountantScope)
      ? {
          login: "accountant",
          password: process.env.ACCOUNTANT_PASSWORD,
          role: "accountant",
          name: "Бухгалтер",
          scope: accountantScope,
        }
      : null,
    process.env.VIEWER_PASSWORD &&
    hasCompleteBusinessScope(viewerScope)
      ? {
          login: "viewer",
          password: process.env.VIEWER_PASSWORD,
          role: "viewer",
          name: "Просмотр",
          scope: viewerScope,
        }
      : null,
  ];

  return candidates.filter(
    (account): account is Account =>
      account !== null && account.password.length >= 12,
  );
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function requestAddress(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function loginAttemptKey(login: string, req: Request): string {
  return sha256(`${login.trim().toLowerCase()}\n${requestAddress(req)}`);
}

function getRequestAuth(res: Response): RequestAuth | null {
  const candidate = res.locals.auth as RequestAuth | undefined;
  return candidate?.session && candidate.tokenHash ? candidate : null;
}

function readSessionToken(req: Request): string | null {
  const value = req.cookies?.[sessionCookieName()];
  return typeof value === "string" && value.length >= 32 ? value : null;
}

function csrfMatches(req: Request, expectedHash: string): boolean {
  const cookie = req.cookies?.[csrfCookieName()];
  const header = req.header("x-csrf-token");
  if (typeof cookie !== "string" || typeof header !== "string") {
    return false;
  }

  const cookieHash = sha256(cookie);
  const headerHash = sha256(header);
  return (
    timingSafeEqual(Buffer.from(cookieHash), Buffer.from(headerHash)) &&
    timingSafeEqual(Buffer.from(cookieHash), Buffer.from(expectedHash))
  );
}

authRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

authRouter.post("/auth/login", async (req, res) => {
  if (!req.is("application/json")) {
    res.status(415).json({ error: "Требуется application/json" });
    return;
  }

  const parsed = z
    .object({
      login: z.string().trim().min(1).max(80),
      password: z.string().min(1).max(1024),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Некорректный запрос" });
    return;
  }

  const { login, password } = parsed.data;
  const attemptKey = loginAttemptKey(login, req);
  const policy = getLoginPolicy();

  try {
    const currentLimit = await store.getLoginLimit(attemptKey);
    if (currentLimit.blocked) {
      res.setHeader(
        "Retry-After",
        String(Math.max(1, currentLimit.retryAfterSeconds)),
      );
      res
        .status(429)
        .json({ error: "Слишком много попыток. Повторите позже." });
      return;
    }

    const accounts = getAccounts();
    if (accounts.length === 0) {
      res.status(503).json({ error: "Аутентификация не настроена" });
      return;
    }

    const account = accounts.find((candidate) => candidate.login === login);
    const passwordValid = account
      ? secretsMatch(password, account.password)
      : secretsMatch(password, randomBytes(32).toString("hex"));

    if (!account || !passwordValid) {
      const updatedLimit = await store.recordLoginFailure(
        attemptKey,
        policy.maxAttempts,
        policy.windowMs,
        policy.lockMs,
      );
      if (updatedLimit.blocked) {
        res.setHeader(
          "Retry-After",
          String(Math.max(1, updatedLimit.retryAfterSeconds)),
        );
        res
          .status(429)
          .json({ error: "Слишком много попыток. Повторите позже." });
        return;
      }
      res.status(401).json({ error: "Неверный логин или пароль" });
      return;
    }

    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const ttlMs = getSessionTtlMs();
    await store.createSession({
      tokenHash: sha256(sessionToken),
      csrfHash: sha256(csrfToken),
      role: account.role,
      name: account.name,
      scope: account.scope,
      expiresAt: new Date(Date.now() + ttlMs),
    });
    await store.clearLoginFailures(attemptKey);

    setAuthCookies(res, sessionToken, csrfToken, ttlMs);
    res.json({ role: account.role, name: account.name });
  } catch (err) {
    logger.error({ err }, "Authentication storage unavailable");
    res.status(503).json({ error: "Сервис входа временно недоступен" });
  }
});

authRouter.get("/auth/me", (_req, res) => {
  const auth = getRequestAuth(res);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({
    role: auth.session.role,
    name: auth.session.name,
    scope: auth.session.scope,
  });
});

authRouter.post("/auth/logout", async (_req, res) => {
  const auth = getRequestAuth(res);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await store.revokeSession(auth.tokenHash);
    clearAuthCookies(res);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Session revocation failed");
    res.status(503).json({ error: "Не удалось завершить сессию" });
  }
});

authRouter.get("/auth/users", (_req, res) => {
  res.json(
    getAccounts().map(({ login, role, name }) => ({
      login,
      role,
      name,
    })),
  );
});

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sessionToken = readSessionToken(req);
  if (!sessionToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tokenHash = sha256(sessionToken);
  try {
    const session = await store.getActiveSession(tokenHash);
    if (!session) {
      clearAuthCookies(res);
      res.status(401).json({ error: "Session expired" });
      return;
    }
    res.locals.auth = { tokenHash, session } satisfies RequestAuth;
    next();
  } catch (err) {
    logger.error({ err }, "Session lookup failed");
    res.status(503).json({ error: "Сервис сессий временно недоступен" });
  }
}

export function requireCsrf(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const auth = getRequestAuth(res);
  if (!auth || !csrfMatches(req, auth.session.csrfHash)) {
    res.status(403).json({ error: "CSRF validation failed" });
    return;
  }
  next();
}

export async function requireRouteAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getRequestAuth(res);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const decision = decideRouteAccess(
    auth.session.role,
    req.method,
    req.path,
    auth.session.scope,
  );

  if (shouldAuditAccess(req.method, req.path)) {
    try {
      await recordAccessAudit({
        tokenHash: auth.tokenHash,
        role: auth.session.role,
        method: req.method,
        path: req.path,
        scope: auth.session.scope,
        decision,
        requestId: (
          req as Request & { id?: string | number }
        ).id,
      });
    } catch (err) {
      logger.error(
        {
          err,
          role: auth.session.role,
          method: req.method,
          path: req.path,
          decision: decision.policy,
        },
        "Security access audit unavailable",
      );
      if (decision.allowed) {
        res
          .status(503)
          .json({ error: "Аудит доступа временно недоступен" });
        return;
      }
    }
  }

  if (!decision.allowed) {
    logger.warn(
      {
        role: auth.session.role,
        method: req.method,
        path: req.path,
        policy: decision.policy,
        branchScopeCount: auth.session.scope.branchIds.length,
        legalEntityScopeCount:
          auth.session.scope.legalEntityIds.length,
      },
      "Route access denied",
    );
    res.status(403).json({ error: "Недостаточно прав" });
    return;
  }
  next();
}
