export const SCHOOL_DIARY_ORIGIN = "https://school.arthelloteam.ru";
export const SCHOOL_DIARY_TIMEOUT_MS = 10_000;

export type SchoolDiarySyncPath = "/api/internal/staff-sync" | "/api/internal/family-access-sync";

export class SchoolDiaryConfigurationError extends Error {
  constructor() {
    super("Адрес дневника не прошёл проверку безопасности");
    this.name = "SchoolDiaryConfigurationError";
  }
}

/**
 * Produces one of the two fixed internal endpoints. The configured base must be
 * an HTTPS origin with no credentials, query, fragment or path. An alternative
 * deployment needs a second, explicit origin allow-list setting.
 */
export function resolveSchoolDiarySyncUrl(baseValue: string, path: SchoolDiarySyncPath, allowListValue = "") {
  const base = strictHttpsOrigin(baseValue);
  const configuredOrigins = allowListValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(strictHttpsOrigin)
    .map((url) => url.origin);
  const allowedOrigins = new Set([SCHOOL_DIARY_ORIGIN, ...configuredOrigins]);
  if (!allowedOrigins.has(base.origin)) throw new SchoolDiaryConfigurationError();
  return new URL(path, `${base.origin}/`).toString();
}

export function safeSchoolDiarySyncError(error: unknown) {
  if (error instanceof SchoolDiaryConfigurationError) return error.message;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "Дневник не ответил вовремя";
  }
  return "Защищённое соединение с дневником временно недоступно";
}

export function durableSchoolDiaryResult(
  result: { activationLink?: string; expiresAt?: string; deliveryStatus?: string },
  includeDeliveryStatus = false,
) {
  const expiresAt = normalizedExpiry(result.expiresAt);
  const deliveryStatus = includeDeliveryStatus ? normalizedDeliveryStatus(result.deliveryStatus) : undefined;
  return {
    ...(expiresAt ? { expiresAt } : {}),
    ...(deliveryStatus ? { deliveryStatus } : {}),
    activationPrepared: Boolean(result.activationLink),
  };
}

export function safeSchoolDiaryActivationLink(value: unknown, syncUrl: string) {
  if (typeof value !== "string" || !value || value.length > 2_048) return undefined;
  try {
    const expectedOrigin = new URL(syncUrl).origin;
    const candidate = new URL(value);
    if (candidate.protocol !== "https:" || candidate.origin !== expectedOrigin || candidate.username || candidate.password) return undefined;
    return candidate.toString();
  } catch {
    return undefined;
  }
}

function strictHttpsOrigin(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.search
      || url.hash
      || (url.pathname !== "/" && url.pathname !== "")
    ) throw new SchoolDiaryConfigurationError();
    return url;
  } catch (error) {
    if (error instanceof SchoolDiaryConfigurationError) throw error;
    throw new SchoolDiaryConfigurationError();
  }
}

function normalizedExpiry(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizedDeliveryStatus(value: unknown) {
  if (typeof value !== "string") return "";
  const aliases: Record<string, string> = {
    pending: "Ожидает отправки",
    sent: "Отправлено",
    delivered: "Доставлено",
    failed: "Ошибка доставки",
    "Ожидает отправки": "Ожидает отправки",
    "Ожидает повторной отправки": "Ожидает повторной отправки",
    "Отправлено": "Отправлено",
    "Доставлено": "Доставлено",
    "Ошибка доставки": "Ошибка доставки",
  };
  return aliases[value] ?? "";
}
