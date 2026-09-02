export type ConnectionFacts = {
  authStatus: string;
  verifiedTransfer: boolean;
  lastSuccessAt: string;
  isEnabled: boolean;
  status?: string;
};

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
  return resolution.trim().length >= 8 && evidence.trim().length >= 8;
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

const TOCHKA_CUSTOMERS_URL = "https://enter.tochka.com/uapi/open-banking/v1.0/customers";
const TOCHKA_ACCOUNTS_URL = "https://enter.tochka.com/uapi/open-banking/v1.0/accounts";

/**
 * Performs only local structural and lifetime checks. Authenticity and granted
 * permissions are deliberately confirmed by Tochka during the live probe.
 */
export function validateTochkaJwt(value: unknown, nowMs = Date.now()): TochkaJwtValidation {
  const token = typeof value === "string" ? value.trim() : "";
  if (token.length < 40 || token.length > 16_384) {
    return { valid: false, reason: "JWT выглядит неполным", expiresAt: "" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    return { valid: false, reason: "JWT должен состоять из трёх частей", expiresAt: "" };
  }
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { exp?: unknown; nbf?: unknown };
    const expiresAtSeconds = Number(payload.exp);
    if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds <= 0) {
      return { valid: false, reason: "В JWT нет корректного срока действия", expiresAt: "" };
    }
    if (expiresAtSeconds * 1000 <= nowMs + 30_000) {
      return { valid: false, reason: "Срок действия JWT истёк", expiresAt: new Date(expiresAtSeconds * 1000).toISOString() };
    }
    const notBeforeSeconds = payload.nbf === undefined ? 0 : Number(payload.nbf);
    if (Number.isFinite(notBeforeSeconds) && notBeforeSeconds * 1000 > nowMs + 30_000) {
      return { valid: false, reason: "JWT ещё не начал действовать", expiresAt: new Date(expiresAtSeconds * 1000).toISOString() };
    }
    return { valid: true, reason: "Формат и срок JWT корректны", expiresAt: new Date(expiresAtSeconds * 1000).toISOString() };
  } catch {
    return { valid: false, reason: "Не удалось прочитать служебную часть JWT", expiresAt: "" };
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
        ? "Точка отклонила JWT"
        : customersResponse.status === 403
          ? "JWT не даёт права читать список компаний"
          : customersResponse.status === 429
            ? "Точка временно ограничила число проверок"
            : "Точка не подтвердила доступ к компаниям";
      return fail(reason);
    }

    let customersPayload: unknown;
    try {
      customersPayload = await customersResponse.json();
    } catch {
      return fail("Точка вернула некорректный список компаний");
    }
    const customerChoices = extractTochkaCustomers(customersPayload);
    if (!customerChoices.length) return fail("JWT подтверждён, но доступных customerCode нет");

    const requested = String(requestedCustomerCode ?? "").trim().slice(0, 80);
    let selectedCustomer: TochkaCustomerChoice | undefined;
    if (requested) {
      selectedCustomer = customerChoices.find((customer) => customer.code === requested);
      if (!selectedCustomer) {
        return fail("Указанный customerCode не доступен этому JWT", customerChoices);
      }
    } else if (customerChoices.length === 1) {
      selectedCustomer = customerChoices[0];
    } else {
      return fail("JWT даёт доступ к нескольким customerCode. Выберите один.", customerChoices);
    }

    const accountsResponse = await request(TOCHKA_ACCOUNTS_URL, requestInit);
    if (!accountsResponse.ok) {
      const reason = accountsResponse.status === 401
        ? "Точка отклонила JWT"
        : accountsResponse.status === 403
          ? "JWT не даёт права читать счета"
          : accountsResponse.status === 429
            ? "Точка временно ограничила число проверок"
            : "Точка не подтвердила доступ к счетам";
      return fail(reason, [], selectedCustomer.code);
    }

    let accountsPayload: unknown;
    try {
      accountsPayload = await accountsResponse.json();
    } catch {
      return fail("Точка вернула некорректный список счетов", [], selectedCustomer.code);
    }
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
          ? "JWT подтверждён, но для выбранного customerCode доступных счетов нет"
          : "JWT подтверждён, но доступных счетов нет",
        [],
        selectedCustomer.code,
      );
    }
    return {
      valid: true,
      reason: "JWT и customerCode подтверждены банком",
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

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
