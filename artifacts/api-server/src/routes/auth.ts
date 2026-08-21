import { Router, type NextFunction, type Request, type Response } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";
import {
  decideRouteAccess,
  hasCompleteBusinessScope,
  type AuthRole,
  type BusinessScope,
} from "../lib/security/access-policy.js";
import { recordAccessAudit } from "../lib/security/access-audit.js";
import { shouldAuditAccess } from "../lib/security/access-audit-policy.js";
import {
  PostgresAuthStore,
  type AuthSession,
  type AuthStore,
  type AuthUser,
} from "../lib/security/auth-store.js";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "../lib/security/password.js";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PASSWORD_CHANGE_PATHS = new Set(["/auth/me", "/auth/password", "/auth/logout"]);

const store: AuthStore = new PostgresAuthStore();
const dummyPasswordHash = hashPassword(`${randomBytes(32).toString("base64url")}7a`);

export const authRouter = Router();

interface RequestAuth { tokenHash: string; session: AuthSession; }

function positiveIntegerFromEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function getSessionTtlMs(): number {
  return positiveIntegerFromEnv("AUTH_SESSION_TTL_MS", SESSION_TTL_MS, 15 * 60 * 1000, 24 * 60 * 60 * 1000);
}

function getLoginPolicy() {
  return {
    maxAttempts: positiveIntegerFromEnv("AUTH_LOGIN_MAX_ATTEMPTS", LOGIN_MAX_ATTEMPTS, 3, 20),
    windowMs: positiveIntegerFromEnv("AUTH_LOGIN_WINDOW_MS", LOGIN_WINDOW_MS, 60 * 1000, 60 * 60 * 1000),
    lockMs: positiveIntegerFromEnv("AUTH_LOGIN_LOCK_MS", LOGIN_LOCK_MS, 60 * 1000, 24 * 60 * 60 * 1000),
  };
}

function isProduction(): boolean { return process.env.NODE_ENV === "production"; }
function sessionCookieName(): string { return isProduction() ? "__Host-arthello_session" : "arthello_session"; }
function csrfCookieName(): string { return isProduction() ? "__Host-arthello_csrf" : "arthello_csrf"; }
function cookieBaseOptions() { return { secure: isProduction(), sameSite: "strict" as const, path: "/" }; }

function setAuthCookies(res: Response, sessionToken: string, csrfToken: string, maxAge: number): void {
  res.cookie(sessionCookieName(), sessionToken, { ...cookieBaseOptions(), httpOnly: true, maxAge });
  res.cookie(csrfCookieName(), csrfToken, { ...cookieBaseOptions(), httpOnly: false, maxAge });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(sessionCookieName(), { ...cookieBaseOptions(), httpOnly: true });
  res.clearCookie(csrfCookieName(), { ...cookieBaseOptions(), httpOnly: false });
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function normalizeLogin(value: string): string { return value.trim().toLowerCase(); }
function normalizeIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0 && value.length <= 128))];
}
function requestAddress(req: Request): string { return req.ip || req.socket.remoteAddress || "unknown"; }
function loginAttemptKey(login: string, req: Request): string { return sha256(`${normalizeLogin(login)}\n${requestAddress(req)}`); }
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
  if (typeof cookie !== "string" || typeof header !== "string") return false;
  const cookieHash = sha256(cookie);
  const headerHash = sha256(header);
  return timingSafeEqual(Buffer.from(cookieHash), Buffer.from(headerHash)) && timingSafeEqual(Buffer.from(cookieHash), Buffer.from(expectedHash));
}

function publicUser(user: Omit<AuthUser, "passwordHash">) {
  return {
    id: user.id, login: user.login, role: user.role, name: user.name,
    scope: user.scope, active: user.active, mustChangePassword: user.mustChangePassword,
  };
}

function requireOwner(res: Response): RequestAuth | null {
  const auth = getRequestAuth(res);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return null; }
  if (auth.session.role !== "owner") { res.status(403).json({ error: "Недостаточно прав" }); return null; }
  return auth;
}

function passwordError(password: string): string | null { return validatePasswordPolicy(password); }

authRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

authRouter.post("/auth/login", async (req, res) => {
  if (!req.is("application/json")) { res.status(415).json({ error: "Требуется application/json" }); return; }
  const parsed = z.object({ login: z.string().trim().min(1).max(80), password: z.string().min(1).max(1024) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некорректный запрос" }); return; }

  const { login, password } = parsed.data;
  const attemptKey = loginAttemptKey(login, req);
  const policy = getLoginPolicy();
  try {
    const currentLimit = await store.getLoginLimit(attemptKey);
    if (currentLimit.blocked) {
      res.setHeader("Retry-After", String(Math.max(1, currentLimit.retryAfterSeconds)));
      res.status(429).json({ error: "Слишком много попыток. Повторите позже." });
      return;
    }

    const user = await store.getActiveUserByLogin(normalizeLogin(login));
    const passwordValid = await verifyPassword(password, user?.passwordHash ?? await dummyPasswordHash);
    if (!user || !passwordValid) {
      const updatedLimit = await store.recordLoginFailure(attemptKey, policy.maxAttempts, policy.windowMs, policy.lockMs);
      if (updatedLimit.blocked) {
        res.setHeader("Retry-After", String(Math.max(1, updatedLimit.retryAfterSeconds)));
        res.status(429).json({ error: "Слишком много попыток. Повторите позже." });
        return;
      }
      res.status(401).json({ error: "Неверный логин или пароль" });
      return;
    }

    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const ttlMs = getSessionTtlMs();
    await store.createSession({
      tokenHash: sha256(sessionToken), userId: user.id, csrfHash: sha256(csrfToken),
      role: user.role, name: user.name, scope: user.scope,
      mustChangePassword: user.mustChangePassword, expiresAt: new Date(Date.now() + ttlMs),
    });
    await store.clearLoginFailures(attemptKey);
    setAuthCookies(res, sessionToken, csrfToken, ttlMs);
    res.json({ role: user.role, name: user.name, mustChangePassword: user.mustChangePassword });
  } catch (err) {
    logger.error({ err }, "Authentication storage unavailable");
    res.status(503).json({ error: "Сервис входа временно недоступен" });
  }
});

authRouter.get("/auth/me", (_req, res) => {
  const auth = getRequestAuth(res);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json({
    role: auth.session.role, name: auth.session.name, scope: auth.session.scope,
    mustChangePassword: auth.session.mustChangePassword,
  });
});

authRouter.post("/auth/logout", async (_req, res) => {
  const auth = getRequestAuth(res);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    await store.revokeSession(auth.tokenHash);
    clearAuthCookies(res);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Session revocation failed");
    res.status(503).json({ error: "Не удалось завершить сессию" });
  }
});

authRouter.post("/auth/password", async (req, res) => {
  const auth = getRequestAuth(res);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = z.object({ currentPassword: z.string().min(1).max(1024), newPassword: z.string().min(1).max(1024) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некорректный запрос" }); return; }
  const policyError = passwordError(parsed.data.newPassword);
  if (policyError) { res.status(400).json({ error: policyError }); return; }
  try {
    const user = await store.getUserById(auth.session.userId);
    if (!user || !await verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
      res.status(401).json({ error: "Текущий пароль неверен" }); return;
    }
    if (await verifyPassword(parsed.data.newPassword, user.passwordHash)) {
      res.status(400).json({ error: "Новый пароль должен отличаться от текущего" }); return;
    }
    const updated = await store.updateUserPassword(user.id, await hashPassword(parsed.data.newPassword), false);
    if (!updated) { res.status(404).json({ error: "Пользователь не найден" }); return; }
    await store.revokeSessionsForUser(user.id);
    clearAuthCookies(res);
    res.json({ ok: true, reauthenticate: true });
  } catch (err) {
    logger.error({ err }, "Password change failed");
    res.status(503).json({ error: "Не удалось изменить пароль" });
  }
});

authRouter.get("/auth/users", async (_req, res) => {
  if (!requireOwner(res)) return;
  try { res.json((await store.listUsers()).map(publicUser)); }
  catch (err) { logger.error({ err }, "User list failed"); res.status(503).json({ error: "Список пользователей недоступен" }); }
});

authRouter.post("/auth/users", async (req, res) => {
  const auth = requireOwner(res); if (!auth) return;
  const parsed = z.object({
    login: z.string().trim().min(3).max(80), name: z.string().trim().min(2).max(120),
    role: z.enum(["owner", "accountant", "viewer"]), temporaryPassword: z.string().min(1).max(1024),
    branchIds: z.array(z.string().max(128)).max(100).default([]),
    legalEntityIds: z.array(z.string().max(128)).max(100).default([]),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некорректный запрос" }); return; }
  const policyError = passwordError(parsed.data.temporaryPassword);
  if (policyError) { res.status(400).json({ error: policyError }); return; }
  const scope: BusinessScope = parsed.data.role === "owner"
    ? { unrestricted: true, branchIds: [], legalEntityIds: [] }
    : { unrestricted: false, branchIds: normalizeIds(parsed.data.branchIds), legalEntityIds: normalizeIds(parsed.data.legalEntityIds) };
  if (parsed.data.role !== "owner" && !hasCompleteBusinessScope(scope)) {
    res.status(400).json({ error: "Для ограниченной роли нужны филиалы и юридические лица" }); return;
  }
  try {
    const user = await store.createUser({
      login: parsed.data.login.trim(), loginNormalized: normalizeLogin(parsed.data.login),
      passwordHash: await hashPassword(parsed.data.temporaryPassword), role: parsed.data.role,
      name: parsed.data.name, scope, mustChangePassword: true, createdByUserId: auth.session.userId,
    });
    res.status(201).json(publicUser(user));
  } catch (err) {
    if ((err as { code?: string }).code === "23505") { res.status(409).json({ error: "Такой логин уже существует" }); return; }
    logger.error({ err }, "User creation failed");
    res.status(503).json({ error: "Не удалось создать пользователя" });
  }
});

authRouter.post("/auth/users/:userId/reset-password", async (req, res) => {
  const auth = requireOwner(res); if (!auth) return;
  const parsed = z.object({ temporaryPassword: z.string().min(1).max(1024) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некорректный запрос" }); return; }
  const policyError = passwordError(parsed.data.temporaryPassword);
  if (policyError) { res.status(400).json({ error: policyError }); return; }
  try {
    const updated = await store.updateUserPassword(req.params.userId, await hashPassword(parsed.data.temporaryPassword), true);
    if (!updated) { res.status(404).json({ error: "Пользователь не найден" }); return; }
    await store.revokeSessionsForUser(req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Password reset failed");
    res.status(503).json({ error: "Не удалось сбросить пароль" });
  }
});

authRouter.patch("/auth/users/:userId", async (req, res) => {
  const auth = requireOwner(res); if (!auth) return;
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Некорректный запрос" }); return; }
  if (req.params.userId === auth.session.userId && !parsed.data.active) {
    res.status(409).json({ error: "Нельзя отключить собственную учётную запись" }); return;
  }
  try {
    const target = await store.getUserById(req.params.userId);
    if (!target) { res.status(404).json({ error: "Пользователь не найден" }); return; }
    if (!parsed.data.active && target.role === "owner" && await store.countActiveOwners() <= 1) {
      res.status(409).json({ error: "Нельзя отключить последнего владельца" }); return;
    }
    await store.setUserActive(target.id, parsed.data.active);
    if (!parsed.data.active) await store.revokeSessionsForUser(target.id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "User state change failed");
    res.status(503).json({ error: "Не удалось изменить пользователя" });
  }
});

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionToken = readSessionToken(req);
  if (!sessionToken) { res.status(401).json({ error: "Unauthorized" }); return; }
  const tokenHash = sha256(sessionToken);
  try {
    const session = await store.getActiveSession(tokenHash);
    if (!session) { clearAuthCookies(res); res.status(401).json({ error: "Session expired" }); return; }
    res.locals.auth = { tokenHash, session } satisfies RequestAuth;
    next();
  } catch (err) {
    logger.error({ err }, "Session lookup failed");
    res.status(503).json({ error: "Сервис сессий временно недоступен" });
  }
}

export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) { next(); return; }
  const auth = getRequestAuth(res);
  if (!auth || !csrfMatches(req, auth.session.csrfHash)) { res.status(403).json({ error: "CSRF validation failed" }); return; }
  next();
}

export async function requireRouteAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getRequestAuth(res);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (auth.session.mustChangePassword && !PASSWORD_CHANGE_PATHS.has(req.path)) {
    res.status(403).json({ error: "Требуется смена временного пароля", code: "PASSWORD_CHANGE_REQUIRED" }); return;
  }
  const decision = decideRouteAccess(auth.session.role, req.method, req.path, auth.session.scope);
  if (shouldAuditAccess(req.method, req.path)) {
    try {
      await recordAccessAudit({
        tokenHash: auth.tokenHash, role: auth.session.role, method: req.method,
        path: req.path, scope: auth.session.scope, decision,
        requestId: (req as Request & { id?: string | number }).id,
      });
    } catch (err) {
      logger.error({ err, role: auth.session.role, method: req.method, path: req.path, decision: decision.policy }, "Security access audit unavailable");
      if (decision.allowed) { res.status(503).json({ error: "Аудит доступа временно недоступен" }); return; }
    }
  }
  if (!decision.allowed) {
    logger.warn({ role: auth.session.role, method: req.method, path: req.path, policy: decision.policy,
      branchScopeCount: auth.session.scope.branchIds.length,
      legalEntityScopeCount: auth.session.scope.legalEntityIds.length }, "Route access denied");
    res.status(403).json({ error: "Недостаточно прав" }); return;
  }
  next();
}
