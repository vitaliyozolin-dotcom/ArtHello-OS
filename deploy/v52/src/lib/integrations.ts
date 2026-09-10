import type { TochkaPendingStatementStore } from './tochka-statement-state';
// TOCHKA_PENDING_STATEMENT_LIFECYCLE_V1
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

export type TochkaAccountSnapshot = {
  id: string;
  accountId: string;
  maskedAccount: string;
  name: string;
  currency: string;
  status: string;
};

export type TochkaStatementSnapshot = {
  id: string;
  statementId: string;
  accountId: string;
  status: string;
  startDate: string;
  endDate: string;
  startBalanceMinor: number;
  endBalanceMinor: number;
  currency: string;
  transactionCount: number;
};

export type TochkaTransactionSnapshot = {
  id: string;
  providerTransactionId: string;
  paymentId: string;
  statementId: string;
  accountId: string;
  operationDate: string;
  direction: "Поступление" | "Списание";
  amountMinor: number;
  currency: string;
  status: string;
  documentNumber: string;
  transactionType: string;
  description: string;
  counterpartyName: string;
  counterpartyInn: string;
  counterpartyKpp: string;
  sourcePayloadHash: string;
};

export type TochkaReadOnlySyncResult = TochkaJwtValidation & {
  complete: boolean;
  customerCode: string;
  accounts: TochkaAccountSnapshot[];
  statements: TochkaStatementSnapshot[];
  transactions: TochkaTransactionSnapshot[];
  rejectedCount: number;
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
const TOCHKA_STATEMENTS_URL = "https://enter.tochka.com/uapi/open-banking/v1.0/statements";
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
    const hasEmbeddedExpiry = payload.exp !== undefined && payload.exp !== null && payload.exp !== "";
    const expiresAtSeconds = hasEmbeddedExpiry ? Number(payload.exp) : 0;
    if (hasEmbeddedExpiry && (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds <= 0)) {
      return { valid: false, reason: "В ключе Точки указан некорректный срок действия", expiresAt: "" };
    }
    if (hasEmbeddedExpiry && expiresAtSeconds * 1000 <= nowMs + 30_000) {
      return { valid: false, reason: "Срок действия ключа Точки истёк", expiresAt: new Date(expiresAtSeconds * 1000).toISOString() };
    }
    const notBeforeSeconds = payload.nbf === undefined ? 0 : Number(payload.nbf);
    if (Number.isFinite(notBeforeSeconds) && notBeforeSeconds * 1000 > nowMs + 30_000) {
      return { valid: false, reason: "Ключ Точки ещё не начал действовать", expiresAt: hasEmbeddedExpiry ? new Date(expiresAtSeconds * 1000).toISOString() : "" };
    }
    return hasEmbeddedExpiry
      ? { valid: true, reason: "Формат и срок ключа Точки корректны", expiresAt: new Date(expiresAtSeconds * 1000).toISOString() }
      : { valid: true, reason: "Формат ключа корректен; фактический срок проверит Точка", expiresAt: "" };
  } catch {
    return { valid: false, reason: "Не удалось прочитать служебную часть ключа Точки", expiresAt: "" };
  }
}

/**
 * Hard boundary for the statement transport. Payment creation and signing live
 * under different Tochka paths and can never pass this predicate.
 */
export function isAllowedTochkaStatementRequest(input: string, method = "GET") {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname !== "enter.tochka.com" || url.username || url.password || url.hash || url.search) {
    return false;
  }
  const normalizedMethod = method.toUpperCase();
  if (url.pathname === "/uapi/open-banking/v1.0/statements") return normalizedMethod === "POST";
  if (normalizedMethod !== "GET") return false;
  return /^\/uapi\/open-banking\/v1\.0\/accounts\/\d{20}(?:\/\d{9})?\/statements\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(url.pathname);
}

/**
 * Imports the read-only bank facts needed by the product: accounts, statement
 * balances and the booked/pending operation register. It never calls Tochka's
 * payment creation, signing or sending endpoints.
 */
export async function syncTochkaReadOnly(input: {
  statementState?: TochkaPendingStatementStore;
  endDate?: string;
  token: unknown;
  customerCode: string;
  startDate: string;
  request?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  nowMs?: number;
}): Promise<TochkaReadOnlySyncResult> {
  const request = input.request ?? fetch;
  const wait = input.wait ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const nowMs = input.nowMs ?? Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  const token = typeof input.token === "string" ? input.token.trim() : "";
  const validation = validateTochkaJwt(token, nowMs);
  const empty = (reason: string, complete = false): TochkaReadOnlySyncResult => ({
    valid: false,
    complete,
    reason,
    expiresAt: validation.expiresAt,
    customerCode: "",
    accounts: [],
    statements: [],
    transactions: [],
    rejectedCount: 0,
  });
  if (!validation.valid) return empty(validation.reason);

  const customerCode = cleanTochkaCode(input.customerCode);
  if (!customerCode) return empty("Не выбрана компания Точки");
  const startDate = cleanIsoDate(input.startDate);
  const currentEndDate = new Date(nowMs).toISOString().slice(0, 10);
  const targetEndDate = input.endDate === undefined ? currentEndDate : cleanIsoDate(input.endDate);
  let endDate = targetEndDate;
  if (!endDate || endDate > currentEndDate) return empty('Укажите корректную дату окончания загрузки выписок');
  if (!startDate || startDate > endDate) return empty("Укажите корректную дату начала загрузки выписок");

  const requestInit = (method: "GET" | "POST", body?: string): RequestInit => ({
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
    cache: "no-store",
    redirect: "error",
    signal: controller.signal,
  });

  try {
    const customersResponse = await request(TOCHKA_CUSTOMERS_URL, requestInit("GET"));
    const customerDirectoryForbidden = customersResponse.status === 403;
    let customers: TochkaCustomerChoice[] = [];
    if (customersResponse.ok) {
      const customersPayload = await readLimitedJson(customersResponse);
      if (customersPayload === null) return empty("Точка вернула некорректный список компаний");
      customers = extractTochkaCustomers(customersPayload);
      if (!customers.some((customer) => customer.code === customerCode)) return empty("Выбранная компания не доступна этому ключу Точки");
    } else if (!customerDirectoryForbidden) {
      return empty(tochkaReadFailure(customersResponse.status, "компаниям"));
    }

    const accountsResponse = await request(TOCHKA_ACCOUNTS_URL, requestInit("GET"));
    if (!accountsResponse.ok) return empty(tochkaReadFailure(accountsResponse.status, "счетам"));
    const accountsPayload = await readLimitedJson(accountsResponse);
    if (accountsPayload === null) return empty("Точка вернула некорректный список счетов");
    const rawAccounts = extractTochkaAccounts(accountsPayload);
    const hasOwnerCodes = rawAccounts.length > 0 && rawAccounts.every((account) => Boolean(readTochkaCustomerCode(account)));
    if (customerDirectoryForbidden && !hasOwnerCodes) {
      return empty("Точка разрешила чтение счетов, но не указала владельца счетов. Для безопасной загрузки нужен customerCode в ответе Точки");
    }
    if (hasOwnerCodes && !rawAccounts.some((account) => readTochkaCustomerCode(account) === customerCode)) {
      return empty("Выбранная компания не доступна этому ключу Точки");
    }
    if (!hasOwnerCodes && customers.length > 1) {
      return empty("Точка не указала владельца счетов. Для безопасной загрузки используйте ключ одной компании");
    }
    const selectedAccounts = hasOwnerCodes
      ? rawAccounts.filter((account) => readTochkaCustomerCode(account) === customerCode)
      : rawAccounts;
    const accounts = (await Promise.all(selectedAccounts.slice(0, 200).map(normalizeTochkaAccount))).filter((account): account is TochkaAccountSnapshot => Boolean(account));
    if (!accounts.length) return empty("Для выбранной компании нет доступных расчётных счетов");
    endDate = await input.statementState?.resolveEndDate(startDate, targetEndDate, accounts.map(account => account.accountId)) ?? targetEndDate;
    if (!endDate || endDate < startDate || endDate > targetEndDate) return empty('Не удалось определить период незавершённой выписки');

    const statements: TochkaStatementSnapshot[] = [];
    const transactions: TochkaTransactionSnapshot[] = [];
    let rejectedCount = selectedAccounts.length - accounts.length;
    let complete = true;
    for (const account of accounts) {
      const statementScope = { accountId: account.accountId, startDate, endDate };
      let initiatedStatementId = await input.statementState?.get(statementScope) ?? '';
      const resumedStatement = Boolean(initiatedStatementId);
      let finalStatement: Record<string, unknown> | null = null;
      // A disappeared retained reference may be replaced once. Fresh requests,
      // transient failures and permission/rate-limit errors are never retried here.
      statementJob: for (let jobAttempt = 0; jobAttempt < 2; jobAttempt += 1) {
        if (!initiatedStatementId) {
          const statementBody = JSON.stringify({ Data: { Statement: { accountId: account.accountId, startDateTime: startDate, endDateTime: endDate } } });
          if (!isAllowedTochkaStatementRequest(TOCHKA_STATEMENTS_URL, 'POST')) return empty('Загрузка заблокирована внутренним ограничением методов');
          const initResponse = await request(TOCHKA_STATEMENTS_URL, requestInit('POST', statementBody));
          if (!initResponse.ok) return empty(tochkaReadFailure(initResponse.status, 'выпискам'));
          const initPayload = await readLimitedJson(initResponse);
          const initiated = readTochkaStatement(initPayload);
          const initiatedAccountId = cleanTochkaAccountId(initiated?.accountId ?? initiated?.AccountId);
          initiatedStatementId = cleanProviderId(String(initiated?.statementId ?? initiated?.StatementId ?? ''));
          if (!initiated || initiatedAccountId !== account.accountId || !initiatedStatementId) {
            return empty('Точка не вернула номер созданной выписки');
          }
          // Persist before polling: retries and restarted workers resume this exact bank job.
          await input.statementState?.put(statementScope, initiatedStatementId);
        }

        const statementUrl = `${TOCHKA_ACCOUNTS_URL}/${account.accountId}/statements/${initiatedStatementId}`;
        if (!isAllowedTochkaStatementRequest(statementUrl, "GET")) return empty("Чтение выписки заблокировано внутренним ограничением методов");
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const response = await request(statementUrl, requestInit("GET"));
          if (!response.ok) {
            if (response.status === 404 || response.status === 410) {
              await input.statementState?.forget(statementScope, initiatedStatementId);
              if (resumedStatement && jobAttempt === 0) {
                initiatedStatementId = '';
                continue statementJob;
              }
            }
            return empty(tochkaReadFailure(response.status, 'готовой выписке'));
          }
          if (response.status === 202 || response.status === 204) {
            if (attempt < 3) await wait(400 * (attempt + 1));
            continue;
          }
          const payload = await readLimitedJson(response, 10_000_000);
          const statement = readTochkaStatement(payload);
          if (!statement) return empty("Точка вернула некорректную выписку");
          const returnedAccount = statement.accountId ?? statement.AccountId;
          const returnedId = statement.statementId ?? statement.StatementId;
          const returnedStart = statement.startDateTime ?? statement.StartDateTime;
          const returnedEnd = statement.endDateTime ?? statement.EndDateTime;
          if ((returnedAccount !== undefined && cleanTochkaAccountId(returnedAccount) !== account.accountId)
            || (returnedId !== undefined && cleanProviderId(String(returnedId)) !== initiatedStatementId)
            || (returnedStart !== undefined && cleanIsoDate(returnedStart) !== startDate)
            || (returnedEnd !== undefined && cleanIsoDate(returnedEnd) !== endDate)) {
            return empty('Выписка Точки не соответствует запрошенному счёту или периоду');
          }
          const status = cleanText(statement.status ?? statement.Status, 40);
          if (/^(ready|completed)$/i.test(status) || (!status && isCompleteTochkaStatement(statement))) {
            finalStatement = statement;
            break;
          }
          if (/^(error|failed|rejected)$/i.test(status)) {
            await input.statementState?.forget(statementScope, initiatedStatementId);
            return empty('Точка не смогла сформировать выписку. Повторите загрузку для нового запроса.');
          }
          if (attempt < 3) await wait(400 * (attempt + 1));
        }
        break;
      }
      if (!finalStatement) {
        complete = false;
        continue;
      }

      const normalizedTransactions = (await Promise.all(
        extractTochkaStatementTransactions(finalStatement).slice(0, 20_000).map((transaction) => normalizeTochkaTransaction(transaction, account.accountId, initiatedStatementId)),
      )).filter((transaction): transaction is TochkaTransactionSnapshot => Boolean(transaction));
      rejectedCount += extractTochkaStatementTransactions(finalStatement).length - normalizedTransactions.length;
      transactions.push(...normalizedTransactions);
      const startBalanceMinor = toMinorUnits(finalStatement.startDateBalance ?? finalStatement.StartDateBalance) ?? 0;
      const endBalanceMinor = toMinorUnits(finalStatement.endDateBalance ?? finalStatement.EndDateBalance) ?? 0;
      const currency = cleanCurrency(readNestedCurrency(finalStatement)) || account.currency;
      const statementId = cleanProviderId(String(finalStatement.statementId ?? finalStatement.StatementId ?? initiatedStatementId));
      statements.push({
        id: `TOCHKA-STMT-${(await sha256Text(`${account.accountId}|${statementId}`)).slice(0, 32).toUpperCase()}`,
        statementId,
        accountId: account.accountId,
        status: cleanText(finalStatement.status ?? finalStatement.Status, 40) || "Ready",
        startDate: cleanIsoDate(finalStatement.startDateTime ?? finalStatement.StartDateTime) || startDate,
        endDate: cleanIsoDate(finalStatement.endDateTime ?? finalStatement.EndDateTime) || endDate,
        startBalanceMinor,
        endBalanceMinor,
        currency,
        transactionCount: normalizedTransactions.length,
      });
    }

    return {
      valid: true,
      complete: complete && rejectedCount === 0 && endDate === targetEndDate,
      reason: rejectedCount > 0 ? "Часть данных выписки не обработана. Проверьте отклонённые операции; загрузка не завершена." : complete && endDate < targetEndDate ? "Сохранённая выписка загружена. Повторите синхронизацию, чтобы догрузить операции нового дня." : complete ? "Счета, остатки, выписки и операции загружены из Точки" : "Точка ещё формирует часть выписок — повторите синхронизацию",
      expiresAt: validation.expiresAt,
      customerCode,
      accounts,
      statements,
      transactions,
      rejectedCount,
    };
  } catch {
    return empty("Не удалось связаться с Точкой");
  } finally {
    clearTimeout(timeout);
  }
}

export async function toTochkaFinancialOperation(transaction: TochkaTransactionSnapshot, legalEntityId: string) {
  if (transaction.currency !== "RUB" || transaction.status.toLowerCase() !== "booked") return null;
  const normalizedLegalEntityId = cleanText(legalEntityId, 80);
  if (!normalizedLegalEntityId) return null;
  const idHash = await sha256Text(`${normalizedLegalEntityId}|${transaction.accountId}|${transaction.providerTransactionId}`);
  const counterparty = [transaction.counterpartyName, transaction.counterpartyInn ? `ИНН ${transaction.counterpartyInn}` : ""].filter(Boolean).join(" · ");
  const sourceRef = [counterparty, transaction.description, transaction.documentNumber ? `документ № ${transaction.documentNumber}` : ""].filter(Boolean).join(" · ").slice(0, 500);
  return {
    id: `FIN-TOCHKA-${idHash.slice(0, 32).toUpperCase()}`,
    operationDate: transaction.operationDate,
    period: transaction.operationDate.slice(0, 7),
    direction: transaction.direction,
    amountMinor: transaction.amountMinor,
    category: "Не классифицировано",
    reportClass: "Не включено в ОПиУ",
    counterpartyEntityId: "",
    contractId: "",
    documentId: "",
    projectEntityId: "",
    legalEntityId: normalizedLegalEntityId,
    objectEntityId: "",
    cfrEntityId: "",
    bankOperationRef: transaction.providerTransactionId,
    operationKind: "BANK_STATEMENT",
    sourceSystem: "BANK_TOCHKA_API",
    sourceFile: "API Точки",
    sourceSheet: "Выписка",
    sourceRef,
    dataQuality: "Проведённая операция банковской выписки",
    status: "Требует разбора",
    createdBy: "INTEGRATION:TOCHKA",
  };
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
      // TOCHKA_CUSTOMER_DIRECTORY_OPTIONAL: ReadCustomerData is optional. When the key cannot read the
      // customer directory, prove ownership from account customerCode values.
      if (customersResponse.status === 403) {
        const accountsResponse = await request(TOCHKA_ACCOUNTS_URL, requestInit);
        if (!accountsResponse.ok) {
          const reason = accountsResponse.status === 401
            ? "Точка отклонила ключ"
            : accountsResponse.status === 403
              ? "Ключ Точки не даёт права читать счета"
              : accountsResponse.status === 429
                ? "Точка временно ограничила число проверок"
                : "Точка не подтвердила доступ к счетам";
          return fail(reason);
        }
        const accountsPayload = await readLimitedJson(accountsResponse);
        if (accountsPayload === null) return fail("Точка вернула некорректный список счетов");
        const accounts = extractTochkaAccounts(accountsPayload);
        if (!accounts.length) return fail("Ключ Точки подтверждён, но доступных счетов нет");
        const customerCodes = [...new Set(accounts.map(readTochkaCustomerCode).filter(Boolean))];
        // TOCHKA_MULTI_COMPANY_ACCOUNT_LABELS: distinguish companies without exposing customerCode to the browser.
        // If ReadCustomerData is unavailable, only masked account suffixes are shown to the owner.
        const customerChoices = await Promise.all(customerCodes.map(async (code, index) => {
          const normalizedAccounts = (await Promise.all(
            accounts
              .filter((account) => readTochkaCustomerCode(account) === code)
              .slice(0, 5)
              .map((account) => normalizeTochkaAccount(account)),
          )).filter((account): account is TochkaAccountSnapshot => Boolean(account));
          const masks = normalizedAccounts.map((account) => account.maskedAccount).filter(Boolean);
          const suffix = masks.length ? " · счета " + masks.join(", ") : "";
          return { code, name: "Компания " + (index + 1) + suffix };
        }));
        const requested = cleanTochkaCode(requestedCustomerCode);
        if (!customerCodes.length) {
          return fail("Точка разрешила чтение счетов, но не указала компанию-владельца. Для безопасной привязки нужен customerCode в ответе счетов");
        }
        let selectedCustomerCode = "";
        if (requested) {
          if (!customerCodes.includes(requested)) {
            return fail("Выбранная компания не доступна этому ключу Точки", customerChoices);
          }
          selectedCustomerCode = requested;
        } else if (customerCodes.length === 1) {
          selectedCustomerCode = customerCodes[0];
        } else {
          return fail("Ключ Точки подтверждён. Выберите компанию для выбранного юрлица.", customerChoices);
        }
        const accountCount = accounts.filter((account) => readTochkaCustomerCode(account) === selectedCustomerCode).length;
        if (!accountCount) return fail("Ключ Точки подтверждён, но для выбранной компании доступных счетов нет", [], selectedCustomerCode);
        return {
          valid: true,
          reason: "Ключ и компания подтверждены по доступным счетам Точки",
          expiresAt: validation.expiresAt,
          accountCount,
          accountCountScope: "selected_customer",
          customerCode: selectedCustomerCode,
          customerChoices: [],
        };
      }
      const reason = customersResponse.status === 401
        ? "Точка отклонила ключ"
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

async function readLimitedJson(response: Response, maximumBytes = 2_000_000): Promise<unknown | null> {
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

function tochkaReadFailure(status: number, capability: string) {
  if (status === 401) return "Точка отклонила ключ";
  if (status === 403) return `Ключ Точки не даёт права читать ${capability}`;
  if (status === 429) return "Точка временно ограничила число запросов";
  return `Точка не подтвердила доступ к ${capability}`;
}

async function normalizeTochkaAccount(value: unknown): Promise<TochkaAccountSnapshot | null> {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const details = Array.isArray(row.accountDetails ?? row.AccountDetails)
    ? (row.accountDetails ?? row.AccountDetails) as unknown[]
    : [];
  const firstDetail = details.find((detail) => detail && typeof detail === "object") as Record<string, unknown> | undefined;
  const accountId = cleanTochkaAccountId(row.accountId ?? row.AccountId ?? firstDetail?.identification ?? firstDetail?.Identification);
  if (!accountId) return null;
  const hash = await sha256Text(accountId);
  return {
    id: `TOCHKA-ACC-${hash.slice(0, 32).toUpperCase()}`,
    accountId,
    maskedAccount: `•• ${accountId.slice(0, 20).slice(-4)}`,
    name: cleanText(firstDetail?.name ?? firstDetail?.Name ?? row.name ?? row.Name, 120) || "Расчётный счёт",
    currency: cleanCurrency(row.currency ?? row.Currency ?? firstDetail?.currency ?? firstDetail?.Currency) || "RUB",
    status: cleanText(row.status ?? row.Status, 40) || "Enabled",
  };
}

function readTochkaStatement(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const dataCandidate = root.Data ?? root.data;
  const data = dataCandidate && typeof dataCandidate === "object" && !Array.isArray(dataCandidate)
    ? dataCandidate as Record<string, unknown>
    : undefined;
  // TOCHKA_STATEMENT_ARRAY_RESPONSE: Init Statement returns Data.Statement as one object, while the
  // documented Get Statement response uses StatementListModel, where
  // Data.Statement is an array of StatementModel objects. Accept both exact
  // provider shapes and reject primitive/empty/ambiguous payloads.
  const statement = data?.Statement ?? data?.statement ?? data?.Statements ?? data?.statements
    ?? root.Statement ?? root.statement ?? root.Statements ?? root.statements;
  if (Array.isArray(statement)) {
    const rows = statement.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    return rows.length === 1 ? rows[0] : null;
  }
  return statement && typeof statement === "object" && !Array.isArray(statement)
    ? statement as Record<string, unknown>
    : null;
}

function extractTochkaStatementTransactions(statement: Record<string, unknown>) {
  const candidate = statement.Transaction ?? statement.transaction ?? statement.Transactions ?? statement.transactions;
  if (Array.isArray(candidate)) return candidate;
  return candidate && typeof candidate === "object" ? [candidate] : [];
}

function isCompleteTochkaStatement(statement: Record<string, unknown>) {
  return [
    "creationDateTime", "CreationDateTime",
    "startDateBalance", "StartDateBalance",
    "endDateBalance", "EndDateBalance",
    "Transaction", "transaction", "Transactions", "transactions",
  ].some((field) => Object.prototype.hasOwnProperty.call(statement, field));
}

async function normalizeTochkaTransaction(
  value: unknown,
  accountId: string,
  statementId: string,
): Promise<TochkaTransactionSnapshot | null> {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const rawProviderTransactionId = cleanText(row.transactionId ?? row.TransactionId, 210);
  const paymentId = cleanProviderId(String(row.paymentId ?? row.PaymentId ?? ""));
  const indicator = cleanText(row.creditDebitIndicator ?? row.CreditDebitIndicator, 20).toLowerCase();
  const direction = indicator === "credit" ? "Поступление" : indicator === "debit" ? "Списание" : "";
  const amountRow = (row.Amount ?? row.amount) as Record<string, unknown> | undefined;
  const amountMinor = toMinorUnits(amountRow?.amount ?? amountRow?.Amount);
  const currency = cleanCurrency(amountRow?.currency ?? amountRow?.Currency);
  const operationDate = cleanIsoDate(row.documentProcessDate ?? row.DocumentProcessDate ?? row.bookingDate ?? row.BookingDate);
  const status = cleanText(row.status ?? row.Status, 40);
  if (!direction || amountMinor === null || amountMinor <= 0 || !currency || !operationDate || !status) return null;
  const party = (direction === "Поступление"
    ? row.DebtorParty ?? row.debtorParty
    : row.CreditorParty ?? row.creditorParty) as Record<string, unknown> | undefined;
  const sourcePayloadHash = await sha256Text(JSON.stringify(row));
  // D066_TOCHKA_FINANCE_BANK_VISIBILITY: transactionId is optional in Tochka TransactionModel.
  // Preserve a safe provider id when present. Otherwise derive a stable
  // identifier from the immutable bank row and normalized business fields.
  let providerTransactionId = "";
  if (rawProviderTransactionId) {
    providerTransactionId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(rawProviderTransactionId)
      ? rawProviderTransactionId
      : `TOCHKA-${(await sha256Text(rawProviderTransactionId)).slice(0, 48).toUpperCase()}`;
  } else {
    const fallbackDocumentNumber = cleanText(row.documentNumber ?? row.DocumentNumber, 80);
    const fallbackTransactionType = cleanText(row.transactionTypeCode ?? row.TransactionTypeCode, 120);
    const fallbackDescription = cleanText(row.description ?? row.Description, 500);
    const fallbackCounterpartyName = cleanText(party?.name ?? party?.Name, 200);
    const fallbackCounterpartyInn = cleanDigits(party?.inn ?? party?.Inn, 12);
    const discriminator = [paymentId, fallbackDocumentNumber, fallbackTransactionType, fallbackDescription, fallbackCounterpartyInn, fallbackCounterpartyName]
      .filter(Boolean)
      .join("|");
    if (!discriminator) return null;
    const fallbackSeed = [accountId, operationDate, direction, String(amountMinor), currency, status, discriminator, sourcePayloadHash].join("|");
    providerTransactionId = `DERIVED-${(await sha256Text(fallbackSeed)).slice(0, 48).toUpperCase()}`;
  }
  const idHash = await sha256Text(`${accountId}|${providerTransactionId}`);
  return {
    id: `TOCHKA-TX-${idHash.slice(0, 32).toUpperCase()}`,
    providerTransactionId,
    paymentId,
    statementId,
    accountId,
    operationDate,
    direction,
    amountMinor,
    currency,
    status,
    documentNumber: cleanText(row.documentNumber ?? row.DocumentNumber, 80),
    transactionType: cleanText(row.transactionTypeCode ?? row.TransactionTypeCode, 120),
    description: cleanText(row.description ?? row.Description, 500),
    counterpartyName: cleanText(party?.name ?? party?.Name, 200),
    counterpartyInn: cleanDigits(party?.inn ?? party?.Inn, 12),
    counterpartyKpp: cleanDigits(party?.kpp ?? party?.Kpp, 9),
    sourcePayloadHash,
  };
}

function cleanTochkaAccountId(value: unknown) {
  if (typeof value !== "string") return "";
  const accountId = value.trim();
  return /^\d{20}(?:\/\d{9})?$/.test(accountId) ? accountId : "";
}

function cleanProviderId(value: string) {
  const id = value.trim().slice(0, 128);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ? id : "";
}

function cleanIsoDate(value: unknown) {
  if (typeof value !== "string") return "";
  const date = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : "";
}

function cleanCurrency(value: unknown) {
  if (typeof value !== "string") return "";
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "";
}

function cleanText(value: unknown, maximumLength: number) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximumLength);
}

function cleanDigits(value: unknown, maximumLength: number) {
  const text = cleanText(value, maximumLength);
  return new RegExp(`^\\d{1,${maximumLength}}$`).test(text) ? text : "";
}

function toMinorUnits(value: unknown): number | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    return toMinorUnits(row.amount ?? row.Amount);
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const source = String(value).trim().replace(",", ".");
  const match = source.match(/^(-?)(\d{1,15})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const minor = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  const result = match[1] ? -minor : minor;
  return Number.isSafeInteger(result) ? result : null;
}

function readNestedCurrency(statement: Record<string, unknown>) {
  for (const balance of [statement.endDateBalance, statement.EndDateBalance, statement.startDateBalance, statement.StartDateBalance]) {
    if (balance && typeof balance === "object" && !Array.isArray(balance)) {
      const row = balance as Record<string, unknown>;
      const currency = cleanCurrency(row.currency ?? row.Currency);
      if (currency) return currency;
    }
  }
  return "";
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
