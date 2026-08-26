import { env } from "cloudflare:workers";

import {
  getAuthenticatedRequestContext,
  isCanonicalOwnerContext,
  ProductionAuthAdminError,
  verifyAuthenticatedRequestCsrf,
  verifyCurrentPassword,
  type AuthenticatedRequestContext,
} from "../../../../lib/production-auth";

type BackupControlEnv = {
  ARTHELLO_BACKUP_CONTROL_URL?: string;
  ARTHELLO_BACKUP_CONTROL_TOKEN?: string;
};

type JsonObject = Record<string, unknown>;

type BackupOperation = {
  id: string;
  type: "create" | "restore";
  status: "queued" | "running" | "succeeded" | "failed";
  backupId?: string;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
};

type ControlResult = {
  status: number;
  ok: boolean;
  payload: unknown;
};

const CONTROL_TIMEOUT_MS = 10_000;
const MAX_CONTROL_RESPONSE_BYTES = 1_000_000;
const RESTORE_CONFIRMATION = "ВОССТАНОВИТЬ";
const PUBLIC_CACHE_CONTROL = "private, no-store, max-age=0";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._+:-]{0,127}$/;
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

class BackupControlFailure extends Error {
  constructor(readonly reason: "configuration" | "timeout" | "unavailable" | "invalid-response") {
    super("Backup control request failed");
    this.name = "BackupControlFailure";
  }
}

function runtimeEnv() {
  return env as unknown as BackupControlEnv;
}

function responseHeaders(extra?: Record<string, string>) {
  const headers = new Headers({
    "cache-control": PUBLIC_CACHE_CONTROL,
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    expires: "0",
    pragma: "no-cache",
  });
  for (const [name, value] of Object.entries(extra ?? {})) headers.set(name, value);
  return headers;
}

function jsonResponse(payload: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders(extraHeaders),
  });
}

async function requireCanonicalOwner(request: Request): Promise<
  { context: AuthenticatedRequestContext; response?: never }
  | { context?: never; response: Response }
> {
  let context: AuthenticatedRequestContext | null;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return { response: jsonResponse({ error: "Сервис авторизации временно недоступен" }, 503) };
  }

  if (!context) {
    return { response: jsonResponse({ error: "Сессия истекла. Войдите заново." }, 401) };
  }
  if (!isCanonicalOwnerContext(context)) {
    return { response: jsonResponse({ error: "Резервными копиями может управлять только собственник" }, 403) };
  }
  if (context.auth.user.mustChangePassword) {
    return { response: jsonResponse({ error: "Сначала смените временный пароль" }, 403) };
  }
  return { context };
}

function backupControlConfiguration() {
  const bindings = runtimeEnv();
  const rawUrl = bindings.ARTHELLO_BACKUP_CONTROL_URL;
  const token = bindings.ARTHELLO_BACKUP_CONTROL_TOKEN;

  if (typeof rawUrl !== "string" || rawUrl !== rawUrl.trim()) {
    throw new BackupControlFailure("configuration");
  }
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.exec(rawUrl);
  const port = match ? Number(match[1]) : 0;
  if (!match || port > 65_535) throw new BackupControlFailure("configuration");
  if (typeof token !== "string"
    || token.length < 32
    || token.length > 2_048
    || !/^[\x21-\x7e]+$/.test(token)) {
    throw new BackupControlFailure("configuration");
  }

  return { origin: `http://127.0.0.1:${port}`, token };
}

async function callBackupControl(
  endpoint: "/v1/backups" | "/v1/restores",
  init: { method: "GET" | "POST"; body?: JsonObject; idempotencyKey?: string },
): Promise<ControlResult> {
  const { origin, token } = backupControlConfiguration();
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "cache-control": "no-store",
  });
  if (init.body) headers.set("content-type", "application/json");
  if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONTROL_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${origin}${endpoint}`, {
      method: init.method,
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    throw new BackupControlFailure(controller.signal.aborted ? "timeout" : "unavailable");
  } finally {
    clearTimeout(timeout);
  }

  let payload: unknown = null;
  try {
    const raw = await response.text();
    if (raw.length > MAX_CONTROL_RESPONSE_BYTES) throw new Error("response-too-large");
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    if (response.ok) throw new BackupControlFailure("invalid-response");
  }

  return { status: response.status, ok: response.ok, payload };
}

function controlFailureResponse(error: unknown) {
  if (error instanceof BackupControlFailure && error.reason === "timeout") {
    return jsonResponse({
      error: "Сервис не ответил вовремя. Не создавайте новый запрос: повтор с тем же ключом проверит результат или потребует сверки оператором.",
    }, 504);
  }
  return jsonResponse({ error: "Сервис резервного копирования временно недоступен" }, 503);
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function finiteNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeId(value: unknown) {
  return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

function safeRevision(value: unknown) {
  return typeof value === "string" && SAFE_REVISION.test(value) ? value : null;
}

function safeDate(value: unknown) {
  if (typeof value !== "string" || value.length > 64 || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function safeNullableDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  return safeDate(value) ?? undefined;
}

function safeScope(value: unknown) {
  if (typeof value !== "string") return null;
  const scope = value.trim();
  if (!scope || scope.length > 200) return null;
  if (/(?:file:\/\/|[A-Za-z]:\\|\/(?:app|data|home|root|srv|tmp|var)\/)/i.test(scope)) return null;
  return scope;
}

function sanitizeOperation(value: unknown): BackupOperation | null | undefined {
  if (value === null) return null;
  const raw = asObject(value);
  if (!raw) return undefined;
  const id = safeId(raw.id);
  const type = raw.type === "create" || raw.type === "restore" ? raw.type : null;
  const status = raw.status === "queued" || raw.status === "running"
    || raw.status === "succeeded" || raw.status === "failed" ? raw.status : null;
  if (!id || !type || !status) return undefined;

  const operation: BackupOperation = { id, type, status };
  if (raw.backupId !== undefined) {
    const backupId = safeId(raw.backupId);
    if (!backupId) return undefined;
    operation.backupId = backupId;
  }
  if (raw.startedAt !== undefined) {
    const startedAt = safeDate(raw.startedAt);
    if (!startedAt) return undefined;
    operation.startedAt = startedAt;
  }
  if (raw.finishedAt !== undefined) {
    const finishedAt = safeDate(raw.finishedAt);
    if (!finishedAt) return undefined;
    operation.finishedAt = finishedAt;
  }
  operation.message = operationMessage(type, status);
  return operation;
}

function operationMessage(type: BackupOperation["type"], status: BackupOperation["status"]) {
  if (type === "create") {
    if (status === "queued") return "Создание резервной копии поставлено в очередь";
    if (status === "running") return "Создаётся резервная копия";
    if (status === "succeeded") return "Резервная копия создана";
    return "Не удалось создать резервную копию";
  }
  if (status === "queued") return "Восстановление поставлено в очередь";
  if (status === "running") return "Идёт восстановление системы";
  if (status === "succeeded") return "Система восстановлена";
  return "Не удалось восстановить систему";
}

function sanitizePoint(value: unknown) {
  const raw = asObject(value);
  if (!raw) return null;
  const id = safeId(raw.id);
  const kind = raw.kind === "automatic" || raw.kind === "monthly" || raw.kind === "manual"
    || raw.kind === "pre_deploy" || raw.kind === "pre_restore" ? raw.kind : null;
  const createdAt = safeDate(raw.createdAt);
  const sizeBytes = finiteNonNegativeInteger(raw.sizeBytes);
  const integrity = raw.integrity === "verified" || raw.integrity === "failed" ? raw.integrity : null;
  const applicationRevision = safeRevision(raw.applicationRevision);
  const coreSchemaVersion = raw.coreSchemaVersion === null ? null : safeRevision(raw.coreSchemaVersion);
  const expiresAt = safeNullableDate(raw.expiresAt);
  if (!id || !kind || !createdAt || sizeBytes === null || !integrity
    || typeof raw.compatible !== "boolean" || !applicationRevision
    || coreSchemaVersion === undefined || expiresAt === undefined) return null;
  return {
    id,
    kind,
    createdAt,
    sizeBytes,
    integrity,
    compatible: raw.compatible,
    applicationRevision,
    coreSchemaVersion,
    expiresAt,
  };
}

function sanitizeCatalog(value: unknown) {
  const raw = asObject(value);
  const policy = asObject(raw?.policy);
  const health = asObject(raw?.health);
  const storage = asObject(health?.storage);
  if (!raw || !policy || !health || !storage || !Array.isArray(raw.points)) return null;

  const time = typeof policy.time === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(policy.time)
    ? policy.time
    : null;
  const timezone = policy.timezone === "Europe/Moscow" ? policy.timezone : null;
  const dailyRetentionDays = finiteNonNegativeInteger(policy.dailyRetentionDays);
  const monthlyRetentionMonths = finiteNonNegativeInteger(policy.monthlyRetentionMonths);
  const scope = safeScope(policy.scope);
  const lastAutomaticAt = safeNullableDate(health.lastAutomaticAt);
  const nextAutomaticAt = safeDate(health.nextAutomaticAt);
  const status = health.status === "ok" || health.status === "degraded" ? health.status : null;
  const local = storage.local === "ready" || storage.local === "error" ? storage.local : null;
  const offsite = storage.offsite === "configured" || storage.offsite === "not_configured"
    || storage.offsite === "error" ? storage.offsite : null;
  const points = raw.points.map(sanitizePoint);
  const activeOperation = sanitizeOperation(raw.activeOperation);

  if (typeof policy.automaticEnabled !== "boolean" || !time || !timezone
    || dailyRetentionDays === null || monthlyRetentionMonths === null || !scope
    || !status || lastAutomaticAt === undefined || !nextAutomaticAt || !local || !offsite
    || points.some((point) => point === null) || activeOperation === undefined) return null;

  return {
    policy: {
      automaticEnabled: policy.automaticEnabled,
      time,
      timezone,
      dailyRetentionDays,
      monthlyRetentionMonths,
      scope,
    },
    health: {
      status,
      lastAutomaticAt,
      nextAutomaticAt,
      lastError: health.lastError === null ? null : "Последняя операция резервного копирования завершилась с ошибкой",
      storage: { local, offsite },
    },
    points,
    activeOperation,
  };
}

function sanitizeOperationEnvelope(value: unknown) {
  const raw = asObject(value);
  if (!raw) return null;
  const operation = sanitizeOperation(raw.operation);
  return operation && operation !== null ? { operation } : null;
}

function idempotencyKey(request: Request) {
  const supplied = request.headers.get("idempotency-key");
  if (supplied === null) return { key: crypto.randomUUID() };
  if (!SAFE_IDEMPOTENCY_KEY.test(supplied)) {
    return { response: jsonResponse({ error: "Некорректный ключ повторного запроса" }, 400) };
  }
  return { key: supplied };
}

function mutationControlError(status: number, action: "create" | "restore", key: string) {
  const headers = { "idempotency-key": key };
  if (status === 409) {
    return jsonResponse({
      error: "Операция уже выполняется, ключ использован с другими данными или итог прошлого запуска требует сверки оператором",
    }, 409, headers);
  }
  if (action === "restore" && status === 404) {
    return jsonResponse({ error: "Выбранная резервная копия не найдена" }, 404, headers);
  }
  if (action === "restore" && (status === 400 || status === 422)) {
    return jsonResponse({ error: "Выбранную резервную копию нельзя восстановить" }, 422, headers);
  }
  if (status === 429) {
    return jsonResponse({ error: "Слишком много запросов. Повторите позже." }, 429, headers);
  }
  return jsonResponse({ error: "Операцию резервного копирования выполнить не удалось" }, 503, headers);
}

export async function GET(request: Request) {
  const authorization = await requireCanonicalOwner(request);
  if (authorization.response) return authorization.response;

  let control: ControlResult;
  try {
    control = await callBackupControl("/v1/backups", { method: "GET" });
  } catch (error) {
    return controlFailureResponse(error);
  }
  if (!control.ok) return jsonResponse({ error: "Не удалось получить список резервных копий" }, 503);

  const catalog = sanitizeCatalog(control.payload);
  if (!catalog) return jsonResponse({ error: "Сервис резервного копирования вернул некорректный ответ" }, 502);
  return jsonResponse(catalog);
}

export async function POST(request: Request) {
  const authorization = await requireCanonicalOwner(request);
  if (authorization.response) return authorization.response;
  const context = authorization.context;

  try {
    verifyAuthenticatedRequestCsrf(request, context);
  } catch {
    return jsonResponse({ error: "Защитная сессия устарела. Войдите заново." }, 403);
  }

  let body: JsonObject;
  try {
    const candidate = await request.json();
    const parsed = asObject(candidate);
    if (!parsed) throw new Error("invalid-body");
    body = parsed;
  } catch {
    return jsonResponse({ error: "Переданы некорректные данные" }, 400);
  }

  if (body.action !== "create" && body.action !== "restore") {
    return jsonResponse({ error: "Неизвестное действие с резервной копией" }, 400);
  }
  const action = body.action;
  const idempotency = idempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  const key = idempotency.key;

  let endpoint: "/v1/backups" | "/v1/restores";
  let controlBody: JsonObject;
  if (action === "create") {
    endpoint = "/v1/backups";
    controlBody = { kind: "manual", actor: context.appUserId };
  } else {
    const backupId = safeId(body.backupId);
    if (!backupId) return jsonResponse({ error: "Не выбрана резервная копия" }, 400);
    if (body.confirmation !== RESTORE_CONFIRMATION) {
      return jsonResponse({ error: `Для восстановления введите ${RESTORE_CONFIRMATION}` }, 400);
    }
    if (typeof body.currentPassword !== "string" || !body.currentPassword || body.currentPassword.length > 512) {
      return jsonResponse({ error: "Введите текущий пароль" }, 400);
    }
    try {
      await verifyCurrentPassword(context, body.currentPassword);
    } catch (error) {
      if (error instanceof ProductionAuthAdminError) {
        if (error.status === 429) return jsonResponse({ error: "Слишком много попыток. Повторите через 15 минут." }, 429);
        return jsonResponse({ error: "Текущий пароль указан неверно" }, error.status === 403 ? 403 : 400);
      }
      return jsonResponse({ error: "Не удалось проверить текущий пароль" }, 503);
    }
    endpoint = "/v1/restores";
    controlBody = { backupId, actor: context.appUserId };
  }

  let control: ControlResult;
  try {
    control = await callBackupControl(endpoint, {
      method: "POST",
      body: controlBody,
      idempotencyKey: key,
    });
  } catch (error) {
    const failure = controlFailureResponse(error);
    failure.headers.set("idempotency-key", key);
    return failure;
  }
  if (!control.ok) return mutationControlError(control.status, action, key);

  const result = sanitizeOperationEnvelope(control.payload);
  if (!result) {
    return jsonResponse({ error: "Сервис резервного копирования вернул некорректный ответ" }, 502, { "idempotency-key": key });
  }
  return jsonResponse(result, 202, { "idempotency-key": key });
}
