export type ConnectionFacts = {
  authStatus: string;
  verifiedTransfer: boolean;
  lastSuccessAt: string;
  isEnabled: boolean;
  status?: string;
};

export type IntegrationScopeContext = {
  apiRole: string;
  appUserId: string;
  isSystemOwner: boolean;
};

/**
 * Integration ownership is an explicit second boundary after module access.
 * The canonical owner sees the whole catalog; every other user sees only a
 * role or user assignment written on the connection itself.
 */
export function canAccessAssignedIntegration(
  context: IntegrationScopeContext,
  ownerEntityIdValue: unknown,
) {
  const apiRole = String(context.apiRole ?? "").trim().toUpperCase();
  const appUserId = String(context.appUserId ?? "").trim().toUpperCase();
  const ownerEntityId = typeof ownerEntityIdValue === "string"
    ? ownerEntityIdValue.trim().toUpperCase()
    : "";
  if (context.isSystemOwner && apiRole === "OWNER") return true;
  if (!ownerEntityId || !apiRole || !appUserId) return false;
  return ownerEntityId === `ROLE:${apiRole}`
    || ownerEntityId === `USER:${appUserId}`
    || ownerEntityId === appUserId;
}

export function connectionState(facts: ConnectionFacts) {
  if (facts.status === "На паузе" || (!facts.isEnabled && facts.status === "На паузе")) {
    return { state: "paused", label: "На паузе", connected: false };
  }
  if (!facts.verifiedTransfer) {
    return {
      state: facts.authStatus.includes("активна") ? "unverified" : "disconnected",
      label: facts.authStatus.includes("активна") ? "Требует проверки передачи" : "Не подключён",
      connected: false,
    };
  }
  if (!facts.lastSuccessAt) return { state: "unverified", label: "Передача не подтверждена", connected: false };
  if (facts.isEnabled) return { state: "connected", label: "Подключён и проверен", connected: true };
  return { state: "snapshot", label: "Проверенный снимок", connected: false };
}

export function credentialState(authStatus: string, expiresAt: string, now = "2026-08-21") {
  if (!expiresAt) {
    if (authStatus.toLowerCase().includes("активна")) return "valid";
    return authStatus.toLowerCase().includes("не требуется") ? "not-required" : "missing";
  }
  const days = Math.ceil((Date.parse(`${expiresAt}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return "expired";
  if (days <= 14) return "expiring";
  return "valid";
}

export function validateRunCounts(received: number, accepted: number, rejected: number, errors: number, conflicts: number) {
  if ([received, accepted, rejected, errors, conflicts].some((value) => !Number.isInteger(value) || value < 0)) return false;
  return accepted + rejected <= received && (received === 0 || errors <= received) && conflicts <= received;
}

export function retryDecision(facts: ConnectionFacts) {
  if (facts.status === "На паузе") return { allowed: false, reason: "Интеграция на паузе" };
  if (!facts.verifiedTransfer || !facts.authStatus.includes("активна")) {
    return { allowed: false, reason: "Нет проверенной авторизации и передачи" };
  }
  return { allowed: true, reason: "Можно запустить контролируемый повтор" };
}

export function canResolveConflict(resolution: string, evidence: string) {
  const confirmedEvidence = evidence.trim();
  if (/^CONTROL:EVIDENCE(?::|$)/i.test(confirmedEvidence)) return false;
  return resolution.trim().length >= 8 && confirmedEvidence.length >= 8;
}

export type TochkaJwtValidation = {
  valid: boolean;
  reason: string;
  expiresAt: string;
};

export type TochkaCustomerChoice = { code: string; name: string };
export type TochkaProbeResult = TochkaJwtValidation & {
  accountCount: number;
  accountCountScope: "selected_customer" | "all_permitted" | "none";
  customerCode: string;
  customerChoices: TochkaCustomerChoice[];
};

export type TBankTokenValidation = {
  valid: boolean;
  reason: string;
};

export type TBankProbeResult = TBankTokenValidation & {
  accountCount: number;
  operationCount: number;
  statementWindowDays: number;
};

/**
 * This allowlist is the architectural boundary for the T‑Bank credential.
 * Any future payment or other protected method needs a separate credential
 * type and transport; it must not widen this predicate.
 */
export function isAllowedTBankReadRequest(input: string, method = "GET") {
  if (method.toUpperCase() !== "GET") return false;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname !== "business.tbank.ru" || url.username || url.password || url.hash) {
    return false;
  }
  if (url.pathname === "/openapi/api/v4/bank-accounts") {
    return url.searchParams.size === 1 && url.searchParams.get("withInvest") === "false";
  }
  if (url.pathname !== "/openapi/api/v1/statement" || url.searchParams.size !== 5) return false;
  const accountNumber = url.searchParams.get("accountNumber") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  return /^\d{20}$/.test(accountNumber)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(from)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(to)
    && url.searchParams.get("limit") === String(TBANK_STATEMENT_LIMIT)
    && url.searchParams.get("withBalances") === "false";
}

/** Returns a canonical public IPv4/IPv6 literal, or an empty string. */
export function normalizePublicIntegrationIp(value: unknown) {
  if (typeof value !== "string") return "";
  const source = value.trim().toLowerCase();
  const ipv4 = normalizePublicIpv4(source);
  if (ipv4) return ipv4;
  if (!isPublicIpv6(source)) return "";
  return source;
}

const TOCHKA_CUSTOMERS_URL = "https://enter.tochka.com/uapi/open-banking/v1.0/customers";
const TOCHKA_ACCOUNTS_URL = "https://enter.tochka.com/uapi/open-banking/v1.0/accounts";
const TBANK_ACCOUNTS_URL = "https://business.tbank.ru/openapi/api/v4/bank-accounts?withInvest=false";
const TBANK_STATEMENT_URL = "https://business.tbank.ru/openapi/api/v1/statement";
const TBANK_STATEMENT_WINDOW_DAYS = 7;
const TBANK_STATEMENT_LIMIT = 10;

/**
 * Performs only local structural and lifetime checks. Authenticity and granted
 * permissions are deliberately confirmed by Tochka during the live probe.
 */
export function validateTochkaJwt(value: unknown, nowMs = Date.now()): TochkaJwtValidation {
  const token = typeof value === "string" ? value.trim() : "";
  if (token.length < 40 || token.length > 16_384) {
    return { valid: false, reason: "Ключ Точки выглядит неполным", expiresAt: "" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    return { valid: false, reason: "Ключ Точки имеет неверный формат", expiresAt: "" };
  }
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { exp?: unknown; nbf?: unknown };
    const expiresAtSeconds = Number(payload.exp);
    if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds <= 0) {
      return { valid: false, reason: "В ключе Точки нет корректного срока действия", expiresAt: "" };
    }
    if (expiresAtSeconds * 1000 <= nowMs + 30_000) {
      return { valid: false, reason: "Срок действия ключа Точки истёк", expiresAt: new Date(expiresAtSeconds * 1000).toISOString() };
    }
    const notBeforeSeconds = payload.nbf === undefined ? 0 : Number(payload.nbf);
    if (Number.isFinite(notBeforeSeconds) && notBeforeSeconds * 1000 > nowMs + 30_000) {
      return { valid: false, reason: "Ключ Точки ещё не начал действовать", expiresAt: new Date(expiresAtSeconds * 1000).toISOString() };
    }
    return { valid: true, reason: "Формат и срок ключа Точки корректны", expiresAt: new Date(expiresAtSeconds * 1000).toISOString() };
  } catch {
    return { valid: false, reason: "Не удалось прочитать служебную часть ключа Точки", expiresAt: "" };
  }
}

/**
 * Confirms the credential against Tochka's read-only customers and accounts
 * endpoints. A customerCode is selected only from the bank response; provider
 * payloads, account identifiers and the token never leave this boundary.
 */
export async function probeTochkaJwt(
  value: unknown,
  request: typeof fetch = fetch,
  nowMs = Date.now(),
  requestedCustomerCode = "",
): Promise<TochkaProbeResult> {
  const token = typeof value === "string" ? value.trim() : "";
  const validation = validateTochkaJwt(token, nowMs);
  const fail = (
    reason: string,
    customerChoices: TochkaCustomerChoice[] = [],
    customerCode = "",
  ): TochkaProbeResult => ({
    valid: false,
    reason,
    expiresAt: validation.expiresAt,
    accountCount: 0,
    accountCountScope: "none",
    customerCode,
    customerChoices,
  });
  if (!validation.valid) return fail(validation.reason);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const requestInit: RequestInit = {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    redirect: "error",
    signal: controller.signal,
  };
  try {
    const customersResponse = await request(TOCHKA_CUSTOMERS_URL, requestInit);
    if (!customersResponse.ok) {
      const reason = customersResponse.status === 401
        ? "Точка отклонила ключ"
        : customersResponse.status === 403
          ? "Ключ Точки не даёт права читать список компаний"
          : customersResponse.status === 429
            ? "Точка временно ограничила число проверок"
            : "Точка не подтвердила доступ к компаниям";
      return fail(reason);
    }

    const customersPayload = await readLimitedJson(customersResponse);
    if (customersPayload === null) return fail("Точка вернула некорректный список компаний");
    const customerChoices = extractTochkaCustomers(customersPayload);
    if (!customerChoices.length) return fail("Ключ Точки подтверждён, но доступных компаний нет");

    const requested = String(requestedCustomerCode ?? "").trim().slice(0, 80);
    let selectedCustomer: TochkaCustomerChoice | undefined;
    if (requested) {
      selectedCustomer = customerChoices.find((customer) => customer.code === requested);
      if (!selectedCustomer) {
        return fail("Выбранная компания не доступна этому ключу Точки", customerChoices);
      }
    } else if (customerChoices.length === 1) {
      selectedCustomer = customerChoices[0];
    } else {
      return fail("Ключ Точки даёт доступ к нескольким компаниям. Выберите одну.", customerChoices);
    }

    const accountsResponse = await request(TOCHKA_ACCOUNTS_URL, requestInit);
    if (!accountsResponse.ok) {
      const reason = accountsResponse.status === 401
        ? "Точка отклонила ключ"
        : accountsResponse.status === 403
          ? "Ключ Точки не даёт права читать счета"
          : accountsResponse.status === 429
            ? "Точка временно ограничила число проверок"
            : "Точка не подтвердила доступ к счетам";
      return fail(reason, [], selectedCustomer.code);
    }

    const accountsPayload = await readLimitedJson(accountsResponse);
    if (accountsPayload === null) return fail("Точка вернула некорректный список счетов", [], selectedCustomer.code);
    const accounts = extractTochkaAccounts(accountsPayload);
    const accountCustomerCodes = accounts.map(readTochkaCustomerCode);
    const canScopeCount = accounts.length > 0 && accountCustomerCodes.every(Boolean);
    const accountCount = canScopeCount
      ? accountCustomerCodes.filter((code) => code === selectedCustomer?.code).length
      : accounts.length;
    const accountCountScope = canScopeCount ? "selected_customer" : "all_permitted";
    if (accountCount === 0) {
      return fail(
        canScopeCount
          ? "Ключ Точки подтверждён, но для выбранной компании доступных счетов нет"
          : "Ключ Точки подтверждён, но доступных счетов нет",
        [],
        selectedCustomer.code,
      );
    }
    return {
      valid: true,
      reason: "Ключ и выбранная компания подтверждены Точкой",
      expiresAt: validation.expiresAt,
      accountCount,
      accountCountScope,
      customerCode: selectedCustomer.code,
      customerChoices: [],
    };
  } catch {
    return fail("Не удалось связаться с Точкой");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * T‑API issues an opaque H2H bearer token, not a JWT. Only conservative local
 * syntax checks are possible. The two read calls confirm that these operations
 * work, but do not introspect or prove the token's complete permission set.
 */
export function validateTBankToken(value: unknown): TBankTokenValidation {
  const token = typeof value === "string" ? value.trim() : "";
  if (token.length < 24 || token.length > 4096) {
    return { valid: false, reason: "Токен Т‑Банка выглядит неполным" };
  }
  if (!/^[A-Za-z0-9._~+/-]+={0,2}$/.test(token)) {
    return { valid: false, reason: "Токен Т‑Банка содержит недопустимые символы" };
  }
  return { valid: true, reason: "Формат токена Т‑Банка корректен" };
}

/**
 * Verifies the two least-privileged T‑API capabilities used by ArtHello OS:
 * listing company accounts and reading a short statement for one account.
 * Account numbers, operations, counterparties and the token never leave this
 * boundary; callers receive aggregate counts only.
 */
export async function probeTBankToken(
  value: unknown,
  request: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<TBankProbeResult> {
  const token = typeof value === "string" ? value.trim() : "";
  const validation = validateTBankToken(token);
  const fail = (reason: string): TBankProbeResult => ({
    valid: false,
    reason,
    accountCount: 0,
    operationCount: 0,
    statementWindowDays: TBANK_STATEMENT_WINDOW_DAYS,
  });
  if (!validation.valid) return fail(validation.reason);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const headers = () => ({
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "x-request-id": crypto.randomUUID(),
  });
  const requestInit = (): RequestInit => ({
    method: "GET",
    headers: headers(),
    cache: "no-store",
    redirect: "error",
    signal: controller.signal,
  });

  try {
    const accountsInit = requestInit();
    if (!isAllowedTBankReadRequest(TBANK_ACCOUNTS_URL, accountsInit.method)) {
      return fail("Проверка Т‑Банка заблокирована внутренним ограничением методов");
    }
    const accountsResponse = await request(TBANK_ACCOUNTS_URL, accountsInit);
    if (!accountsResponse.ok) return fail(tBankFailure(accountsResponse.status, "счетам"));
    const accountsPayload = await readLimitedJson(accountsResponse);
    if (accountsPayload === null) return fail("Т‑Банк вернул некорректный список счетов");
    const accountNumbers = extractTBankAccountNumbers(accountsPayload);
    if (!accountNumbers.length) return fail("Токен подтверждён, но доступных расчётных счетов нет");

    const to = new Date(nowMs);
    const from = new Date(nowMs - TBANK_STATEMENT_WINDOW_DAYS * 86_400_000);
    const statementUrl = new URL(TBANK_STATEMENT_URL);
    statementUrl.searchParams.set("accountNumber", accountNumbers[0]);
    statementUrl.searchParams.set("from", from.toISOString());
    statementUrl.searchParams.set("to", to.toISOString());
    statementUrl.searchParams.set("limit", String(TBANK_STATEMENT_LIMIT));
    statementUrl.searchParams.set("withBalances", "false");
    const statementInit = requestInit();
    if (!isAllowedTBankReadRequest(statementUrl.toString(), statementInit.method)) {
      return fail("Проверка Т‑Банка заблокирована внутренним ограничением методов");
    }
    const statementResponse = await request(statementUrl.toString(), statementInit);
    if (!statementResponse.ok) return fail(tBankFailure(statementResponse.status, "короткой выписке"));
    const statementPayload = await readLimitedJson(statementResponse);
    if (statementPayload === null) return fail("Т‑Банк вернул некорректную короткую выписку");

    return {
      valid: true,
      reason: "ArtHello OS успешно выполнил чтение счетов и короткой выписки Т‑Банка",
      accountCount: accountNumbers.length,
      operationCount: countTBankOperations(statementPayload),
      statementWindowDays: TBANK_STATEMENT_WINDOW_DAYS,
    };
  } catch {
    return fail("Не удалось связаться с Т‑Банком");
  } finally {
    clearTimeout(timeout);
  }
}

function tBankFailure(status: number, capability: string) {
  if (status === 401) return "Т‑Банк отклонил токен";
  if (status === 403) return `Токен Т‑Банка не даёт доступа к ${capability}`;
  if (status === 429) return "Т‑Банк временно ограничил число проверок";
  return `Т‑Банк не подтвердил доступ к ${capability}`;
}

async function readLimitedJson(response: Response): Promise<unknown | null> {
  const maximumBytes = 2_000_000;
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > maximumBytes) return null;
  try {
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function extractTBankAccountNumbers(payload: unknown) {
  const result = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 500)) visit(item, depth + 1);
      return;
    }
    const row = value as Record<string, unknown>;
    const accountNumber = row.accountNumber ?? row.account_number ?? row.AccountNumber;
    if (typeof accountNumber === "string" && /^\d{20}$/.test(accountNumber)) result.add(accountNumber);
    for (const key of ["accounts", "bankAccounts", "data", "results", "items"]) {
      if (key in row) visit(row[key], depth + 1);
    }
  };
  visit(payload, 0);
  return [...result];
}

function countTBankOperations(payload: unknown) {
  const visit = (value: unknown, depth: number): number | null => {
    if (depth > 5 || value === null || typeof value !== "object") return null;
    if (Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    for (const key of ["operations", "transactions", "items"]) {
      if (Array.isArray(row[key])) return Math.min(row[key].length, TBANK_STATEMENT_LIMIT);
    }
    for (const key of ["data", "result", "statement"]) {
      const found = visit(row[key], depth + 1);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(payload, 0) ?? 0;
}

function extractTochkaCustomers(payload: unknown): TochkaCustomerChoice[] {
  const records = findTochkaCollection(payload, ["customer", "customers"]);
  const customers = records.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const row = record as Record<string, unknown>;
    const code = cleanTochkaCode(row.CustomerCode ?? row.customerCode ?? row.customer_code ?? row.Code ?? row.code);
    if (!code) return [];
    const rawName = row.ShortName ?? row.shortName ?? row.CustomerName ?? row.customerName
      ?? row.FullName ?? row.fullName ?? row.Name ?? row.name;
    const name = typeof rawName === "string"
      ? rawName.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120)
      : "";
    return [{ code, name }];
  });
  return [...new Map(customers.map((customer) => [customer.code, customer])).values()];
}

function extractTochkaAccounts(payload: unknown) {
  return findTochkaCollection(payload, ["account", "accounts"]);
}

function findTochkaCollection(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const data = (root.Data ?? root.data) as Record<string, unknown> | undefined;
  const variants = keys.flatMap((key) => [key, `${key[0].toUpperCase()}${key.slice(1)}`]);
  for (const container of [root, data]) {
    for (const key of variants) {
      const candidate = container?.[key];
      if (Array.isArray(candidate)) return candidate;
      if (candidate && typeof candidate === "object") return [candidate];
    }
  }
  return [];
}

function readTochkaCustomerCode(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  return cleanTochkaCode(row.CustomerCode ?? row.customerCode ?? row.customer_code);
}

function cleanTochkaCode(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const code = String(value).trim().slice(0, 80);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(code) ? code : "";
}

function normalizePublicIpv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return "";
  const numbers = parts.map(Number);
  const unavailable = numbers[0] === 0 || numbers[0] === 10 || numbers[0] === 127 || numbers[0] >= 224
    || (numbers[0] === 100 && numbers[1] >= 64 && numbers[1] <= 127)
    || (numbers[0] === 169 && numbers[1] === 254)
    || (numbers[0] === 172 && numbers[1] >= 16 && numbers[1] <= 31)
    || (numbers[0] === 192 && numbers[1] === 0 && numbers[2] === 0)
    || (numbers[0] === 192 && numbers[1] === 0 && numbers[2] === 2)
    || (numbers[0] === 192 && numbers[1] === 168)
    || (numbers[0] === 198 && numbers[1] >= 18 && numbers[1] <= 19)
    || (numbers[0] === 198 && numbers[1] === 51 && numbers[2] === 100)
    || (numbers[0] === 203 && numbers[1] === 0 && numbers[2] === 113);
  return unavailable ? "" : numbers.join(".");
}

function isPublicIpv6(value: string) {
  if (!value.includes(":") || /[^0-9a-f:.]/.test(value) || value.includes(":::")) return false;
  const halves = value.split("::");
  if (halves.length > 2) return false;
  const groups = (part: string) => part ? part.split(":") : [];
  const left = groups(halves[0]);
  const right = groups(halves[1] ?? "");
  const all = [...left, ...right];
  let count = all.length;
  for (let index = 0; index < all.length; index += 1) {
    const group = all[index];
    if (group.includes(".")) {
      if (index !== all.length - 1 || !normalizePublicIpv4(group)) return false;
      count += 1;
    } else if (!/^[0-9a-f]{1,4}$/.test(group)) return false;
  }
  if (halves.length === 1 ? count !== 8 : count >= 8) return false;
  if (/^(?:::|0*:){0,7}0*1$/.test(value) || /^(?:::|0*:){1,8}$/.test(value)) return false;
  const first = Number.parseInt(left[0] || right[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return false;
  if (/^2001:0?db8(?::|$)/.test(value)) return false;
  return true;
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
