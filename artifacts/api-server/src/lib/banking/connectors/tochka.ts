import { db } from "@workspace/db";
import { bankConnectorsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type {
  BankConnectorInterface,
  NormalizedAccount,
  NormalizedTransaction,
  NormalizedStatement,
  ConnectorHealth,
  ConnectorHealthDetail,
  DiagnosticCode,
  TochkaConfig,
  TochkaAuthStage,
  TochkaOAuthStartResult,
  TochkaOAuthStatusResult,
  TochkaCustomer,
} from "../types.js";
import { logger } from "../../logger.js";
import {
  decryptBankConnectorConfig,
  sealBankConnectorConfig,
} from "../config-vault.js";
import crypto from "crypto";

// ─── Tochka Open Banking endpoints ───────────────────────────────────────────

const TOCHKA_API_BASE       = "https://enter.tochka.com/uapi";
const TOCHKA_TOKEN_URL      = "https://enter.tochka.com/connect/token";
const TOCHKA_INTROSPECT_URL = "https://enter.tochka.com/connect/introspect";
const TOCHKA_AUTH_URL       = "https://enter.tochka.com/connect/authorize";
// Consent endpoint — /v1.0/consents (NOT /open-banking/v1.0/account-access-consents)
const CONSENT_PATH       = "/v1.0/consents";
const ACCOUNTS_PATH      = "/open-banking/v1.0/accounts";
const CUSTOMERS_PATH     = "/open-banking/v1.0/customers";
const OAUTH_SCOPE_SERVICE = "accounts balances";
// Authorization Code scope: accounts + balances + customers + statements (no openid)
const OAUTH_SCOPE_CODE    = "accounts balances customers statements";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateState(): string {
  return crypto.randomBytes(24).toString("hex");
}

function isExpired(isoTimestamp: string | undefined | null, bufferMs = 60_000): boolean {
  if (!isoTimestamp) return true;
  return new Date(isoTimestamp).getTime() <= Date.now() + bufferMs;
}

// ─── Diagnostic code helpers ──────────────────────────────────────────────────

function parseDiagnosticCode(httpStatus: number, body: string): DiagnosticCode {
  const lower = body.toLowerCase();
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus === 401) return lower.includes("expir") ? "token_expired" : "auth_failed";
  if (httpStatus === 403) {
    if (lower.includes("scope")) return "scope_missing";
    if (lower.includes("open banking") || lower.includes("not activated")) return "open_banking_not_activated";
    if (lower.includes("redirect")) return "redirect_uri_mismatch";
    return "accounts_forbidden";
  }
  if (httpStatus === 400) {
    if (lower.includes("scope")) return "scope_missing";
    if (lower.includes("redirect")) return "redirect_uri_mismatch";
    return "auth_failed";
  }
  if (httpStatus >= 500) return "api_error";
  return "api_error";
}

function responseShape(body: string): {
  responseBytes: number;
  topLevelKeys: string[];
} {
  let topLevelKeys: string[] = [];
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      topLevelKeys = Object.keys(parsed as Record<string, unknown>).slice(0, 30);
    }
  } catch {
    // Shape metadata intentionally stays empty for non-JSON responses.
  }
  return {
    responseBytes: Buffer.byteLength(body),
    topLevelKeys,
  };
}

function upstreamError(
  operation: string,
  status: number,
  body: string,
): Error {
  const error = new Error(
    `Tochka ${operation} failed with HTTP ${status}`,
  );
  Object.assign(error, {
    code: parseDiagnosticCode(status, body),
    upstreamStatus: status,
  });
  return error;
}

const DIAGNOSTIC_MESSAGES: Record<DiagnosticCode, string> = {
  ok:                         "Коннектор работает. Hybrid token активен.",
  not_configured:             "Укажите clientId и clientSecret в настройках коннектора.",
  auth_failed:                "Ошибка OAuth: неверный clientId или clientSecret.",
  token_expired:              "Hybrid token истёк — выполните обновление (refresh).",
  scope_missing:              "Недостаточно прав (scopes). Убедитесь, что в Точке выданы: accounts, balances, transactions.",
  accounts_forbidden:         "Доступ к счетам запрещён. Пройдите Authorization Code flow и подтвердите consent.",
  open_banking_not_activated: "Open Banking не активирован в личном кабинете Точки → Интеграции → Open Banking.",
  sandbox_prod_mismatch:      "Несоответствие окружений: sandbox-ключи с production-URL или наоборот.",
  redirect_uri_mismatch:      "Redirect URI не совпадает с зарегистрированным в приложении Точки.",
  awaiting_user_authorization:"Consent создан. Пользователь должен перейти по authorize URL и подтвердить доступ.",
  consent_not_created:        "Consent ещё не создан. Нажмите «Начать авторизацию» для запуска flow.",
  connector_inactive:         "Коннектор неактивен.",
  api_error:                  "Ошибка на стороне Точки. Попробуйте позже.",
  rate_limited:               "Превышен лимит запросов. Подождите несколько минут.",
  network_error:              "Сетевая ошибка: не удалось подключиться к серверу Точки.",
};

// ─── Redirect URI helper ──────────────────────────────────────────────────────

export function getDefaultRedirectUri(): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  if (domain) return `https://${domain}/api/banking/oauth/callback`;
  return `http://localhost:8080/api/banking/oauth/callback`;
}

// ─── TochkaConnector ──────────────────────────────────────────────────────────

export class TochkaConnector implements BankConnectorInterface {
  bankName = "tochka" as const;
  authType = "oauth" as const;

  private config: TochkaConfig;
  private connectorId: string;

  constructor(connectorId: string, config: TochkaConfig) {
    this.connectorId = connectorId;
    this.config = { ...config };
  }

  isConfigured(): boolean {
    return !!(this.config.clientId && this.config.clientSecret);
  }

  // ─── Auth stage ────────────────────────────────────────────────────────────

  getAuthStage(): TochkaAuthStage {
    if (!this.isConfigured()) return "not_configured";
    if (this.config.accessToken) {
      if (isExpired(this.config.tokenExpiresAt)) return "token_expired";
      return "token_ok";
    }
    if (this.config.oauthState && this.config.consentId) return "awaiting_callback";
    if (this.config.consentId) return "consent_pending";
    if (this.config.serviceToken && !isExpired(this.config.serviceTokenExpiresAt)) return "service_token_ok";
    return "not_configured";
  }

  // ─── Persist config to DB ─────────────────────────────────────────────────

  private async persistConfig(update: Partial<TochkaConfig>): Promise<void> {
    const merged = { ...this.config, ...update };
    merged.authStage = this.getAuthStageFrom(merged);
    Object.assign(this.config, merged);
    try {
      await db
        .update(bankConnectorsTable)
        .set({
          config: sealBankConnectorConfig(
            this.connectorId,
            merged as Record<string, unknown>,
          ),
          updatedAt: new Date(),
        })
        .where(eq(bankConnectorsTable.id, this.connectorId));
    } catch (err) {
      logger.warn({ err, connectorId: this.connectorId }, "Tochka: failed to persist config (non-fatal)");
    }
  }

  private getAuthStageFrom(cfg: TochkaConfig): TochkaAuthStage {
    if (!cfg.clientId || !cfg.clientSecret) return "not_configured";
    if (cfg.accessToken) {
      if (isExpired(cfg.tokenExpiresAt)) return "token_expired";
      return "token_ok";
    }
    if (cfg.oauthState && cfg.consentId) return "awaiting_callback";
    if (cfg.consentId) return "consent_pending";
    return "not_configured";
  }

  // ─── Step 1: Service token (client_credentials) ───────────────────────────

  async getOrRefreshServiceToken(): Promise<string> {
    if (this.config.serviceToken && !isExpired(this.config.serviceTokenExpiresAt)) {
      return this.config.serviceToken;
    }
    if (!this.isConfigured()) throw new Error("Tochka: clientId и clientSecret не заданы");

    logger.info({ connectorId: this.connectorId }, "Tochka: fetching service token (client_credentials)");

    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId!,
      client_secret: this.config.clientSecret!,
      scope: OAUTH_SCOPE_SERVICE,
    });
    const res = await fetch(TOCHKA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const fullBody = await res.text();
    if (!res.ok) {
      throw upstreamError("service token", res.status, fullBody);
    }
    let data: Record<string, unknown>;
    try { data = JSON.parse(fullBody); } catch {
      throw new Error("Tochka service token returned invalid JSON");
    }
    const token = data["access_token"];
    if (typeof token !== "string" || !token.trim()) {
      throw new Error(`Tochka service token: access_token missing or wrong type (${typeof token})`);
    }
    const expiresIn = typeof data["expires_in"] === "number" ? data["expires_in"] : 3600;
    await this.persistConfig({
      serviceToken: token,
      serviceTokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    });
    logger.info({
      connectorId: this.connectorId,
      expiresIn,
    }, "Tochka: service token OK");
    return token;
  }

  // ─── Step 2: Create consent ───────────────────────────────────────────────

  async createConsent(): Promise<string> {
    // ONLY service token (client_credentials grant) — never hybrid token here
    const serviceToken = await this.getOrRefreshServiceToken();
    const url = `${TOCHKA_API_BASE}${CONSENT_PATH}`;

    // Strictly: Authorization + Content-Type + Accept. No CustomerCode for consent.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const consentBody = {
      Data: {
        permissions: [
          "ReadAccountsBasic",
          "ReadAccountsDetail",
          "ReadBalances",
          "ReadStatements",
          "ReadCustomerData",
        ],
      },
    };
    const bodyStr = JSON.stringify(consentBody);

    logger.info({
      connectorId: this.connectorId,
      authorizationHeaderSent: true,
      permissionCount: consentBody.Data.permissions.length,
    }, "Tochka: creating consent");

    const res = await fetch(url, { method: "POST", headers, body: bodyStr });
    const fullBody = await res.text();

    logger.info({
      connectorId: this.connectorId,
      status: res.status,
      ...responseShape(fullBody),
    }, "Tochka: consent response");

    if (!res.ok) {
      throw upstreamError("consent creation", res.status, fullBody);
    }
    let data: Record<string, unknown>;
    try { data = JSON.parse(fullBody); } catch {
      throw new Error("Tochka consent returned invalid JSON");
    }

    // Response may be wrapped in Data block or at root level
    const dataBlock = (data["Data"] ?? data) as Record<string, unknown>;
    const consentId = (dataBlock["ConsentId"] ?? dataBlock["consentId"] ?? dataBlock["consent_id"] ?? dataBlock["id"]) as string | undefined;
    if (!consentId) {
      throw new Error(
        `Tochka consent: ConsentId missing in response. ` +
        `Top-level keys: ${Object.keys(data).join(", ")}. ` +
        `Data keys: ${Object.keys(dataBlock).join(", ")}`
      );
    }
    const consentStatus = String(dataBlock["Status"] ?? dataBlock["status"] ?? "AwaitingAuthorisation");
    await this.persistConfig({ consentId, consentStatus, consentCreatedAt: new Date().toISOString() });
    logger.info({ connectorId: this.connectorId, consentId, consentStatus }, "Tochka: consent created");
    return consentId;
  }

  // ─── Step 3: Build authorize URL ──────────────────────────────────────────

  buildAuthorizeUrl(consentId: string, state: string, redirectUri: string): string {
    // Strictly: https://enter.tochka.com/connect/authorize — not id.tochka.com
    const params = new URLSearchParams({
      client_id: this.config.clientId!,
      response_type: "code",
      state,
      redirect_uri: redirectUri,
      scope: OAUTH_SCOPE_CODE,
      consent_id: consentId,
    });
    return `${TOCHKA_AUTH_URL}?${params.toString()}`;
  }

  // ─── OAuth start (Steps 2+3 combined) ────────────────────────────────────

  async startOAuthFlow(redirectUri?: string): Promise<TochkaOAuthStartResult> {
    if (!this.isConfigured()) throw new Error("Tochka: не настроен (нужны clientId и clientSecret)");
    const resolvedRedirectUri = redirectUri ?? this.config.redirectUri ?? getDefaultRedirectUri();
    const consentId = await this.createConsent();
    const state = generateState();
    const authorizeUrl = this.buildAuthorizeUrl(consentId, state, resolvedRedirectUri);
    await this.persistConfig({ oauthState: state });
    logger.info({ connectorId: this.connectorId, consentId, authorizeUrl }, "Tochka: OAuth flow started");
    return {
      authorizeUrl,
      consentId,
      state,
      stage: "awaiting_callback",
    };
  }

  // ─── Step 5: Exchange authorization code → hybrid tokens ─────────────────

  async exchangeCode(code: string, redirectUri?: string): Promise<void> {
    const resolvedRedirectUri = redirectUri ?? this.config.redirectUri ?? getDefaultRedirectUri();
    // scope must match what was used in the authorize request
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: resolvedRedirectUri,
      client_id: this.config.clientId!,
      client_secret: this.config.clientSecret!,
      scope: OAUTH_SCOPE_CODE,
    });
    logger.info({
      connectorId: this.connectorId,
      redirectUri: resolvedRedirectUri,
      scope: OAUTH_SCOPE_CODE,
      tokenUrl: TOCHKA_TOKEN_URL,
    }, "Tochka: exchanging auth code");
    const res = await fetch(TOCHKA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const fullBody = await res.text();
    if (!res.ok) {
      throw upstreamError("authorization code exchange", res.status, fullBody);
    }
    let data: Record<string, unknown>;
    try { data = JSON.parse(fullBody); } catch {
      throw new Error("Tochka authorization code exchange returned invalid JSON");
    }
    const accessToken = data["access_token"];
    if (typeof accessToken !== "string" || !accessToken.trim()) {
      throw new Error(`Tochka code exchange: access_token missing (type: ${typeof accessToken}). Fields: ${Object.keys(data).join(", ")}`);
    }
    const refreshToken = typeof data["refresh_token"] === "string" ? data["refresh_token"] : undefined;
    const expiresIn = typeof data["expires_in"] === "number" ? data["expires_in"] : 3600;
    const scopesGranted = String(data["scope"] ?? "").split(/[\s,]+/).filter(Boolean);

    await this.persistConfig({
      accessToken,
      refreshToken,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      oauthState: undefined,   // clear state after successful exchange
      consentStatus: "Authorised",
    });
    logger.info({
      connectorId: this.connectorId,
      hasRefreshToken: !!refreshToken,
      scopesGranted,
      expiresIn,
    }, "Tochka: hybrid token obtained");

    // ── Await customerCode resolution immediately after token is obtained ──────
    // Blocking: sync must not start until customerCode is confirmed.
    try {
      const customers = await this.resolveCustomerCode();
      logger.info(
        {
          connectorId: this.connectorId,
          customerCodePresent: !!this.config.customerCode,
          count: customers.length,
        },
        "Tochka: customerCode resolved after token exchange"
      );
    } catch (err: unknown) {
      logger.warn(
        { connectorId: this.connectorId, err },
        "Tochka: customerCode resolve failed after token exchange — sync will retry"
      );
    }
  }

  // ─── Step 6: Refresh hybrid token ────────────────────────────────────────

  async refreshHybridToken(): Promise<void> {
    if (!this.config.refreshToken) {
      throw new Error("Tochka: refresh_token отсутствует — необходима повторная авторизация");
    }
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.config.refreshToken,
      client_id: this.config.clientId!,
      client_secret: this.config.clientSecret!,
    });
    logger.info({ connectorId: this.connectorId }, "Tochka: refreshing hybrid token");
    const res = await fetch(TOCHKA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const fullBody = await res.text();
    if (!res.ok) {
      throw upstreamError("token refresh", res.status, fullBody);
    }
    let data: Record<string, unknown>;
    try { data = JSON.parse(fullBody); } catch {
      throw new Error("Tochka token refresh returned invalid JSON");
    }
    const accessToken = data["access_token"];
    if (typeof accessToken !== "string" || !accessToken.trim()) {
      throw new Error(`Tochka refresh: access_token missing (type: ${typeof accessToken})`);
    }
    const refreshToken = typeof data["refresh_token"] === "string" ? data["refresh_token"] : this.config.refreshToken;
    const expiresIn = typeof data["expires_in"] === "number" ? data["expires_in"] : 3600;
    await this.persistConfig({
      accessToken,
      refreshToken,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    });
    logger.info({ connectorId: this.connectorId, tokenLength: accessToken.length }, "Tochka: hybrid token refreshed");
  }

  // ─── BankConnectorInterface.authenticate() ────────────────────────────────
  // This only gets service_token. To get a hybrid token, call startOAuthFlow().

  async authenticate(): Promise<void> {
    await this.getOrRefreshServiceToken();
  }

  async refreshToken(): Promise<void> {
    if (this.config.refreshToken) {
      await this.refreshHybridToken();
    } else {
      await this.getOrRefreshServiceToken();
    }
  }

  // ─── Ensure valid hybrid token before API calls ───────────────────────────

  private async ensureHybridToken(): Promise<string> {
    if (this.config.accessToken && !isExpired(this.config.tokenExpiresAt)) {
      return this.config.accessToken;
    }
    if (this.config.refreshToken) {
      await this.refreshHybridToken();
      if (this.config.accessToken) return this.config.accessToken;
    }
    // No hybrid token — cannot proceed
    const stage = this.getAuthStage();
    if (stage === "awaiting_callback" || stage === "consent_pending") {
      throw new Error(
        "Tochka: гибридный токен отсутствует — пользователь ещё не подтвердил доступ. " +
        "Пройдите Authorization Code flow: нажмите «Начать авторизацию» и подтвердите в Точке."
      );
    }
    throw new Error(
      "Tochka: hybrid access_token отсутствует. Запустите OAuth flow: POST /banking/connectors/:id/oauth/start."
    );
  }

  // ─── Internal API fetch (requires hybrid token + customerCode) ───────────────

  private async apiFetch<T>(path: string): Promise<T> {
    const token = await this.ensureHybridToken();

    // Strict customerCode validation for all protected endpoints
    // /customers is the discovery endpoint itself — it must NOT send CustomerCode
    const isDiscoveryPath = path === CUSTOMERS_PATH;
    if (!isDiscoveryPath && !this.config.customerCode) {
      throw new Error(
        `Tochka: CustomerCode не определён — невозможно вызвать ${path}. ` +
        `Выполните GET /banking/connectors/:id/customers для автоматического определения.`
      );
    }

    const url = `${TOCHKA_API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    // Only add CustomerCode header for non-discovery requests
    const sentCustomerHeader = !isDiscoveryPath && !!this.config.customerCode;
    if (sentCustomerHeader) {
      headers["CustomerCode"] = this.config.customerCode!;
    }

    // Rule 5: structured request log with sent_customer_header for observability
    logger.info({
      step: "api_fetch",
      status: "request",
      path,
      sent_customer_header: sentCustomerHeader,
    }, "Tochka: apiFetch request");

    logger.debug({
      connectorId: this.connectorId,
      url,
      sentCustomerHeader,
    }, "Tochka: API request");

    const res = await fetch(url, { headers });

    if (res.status === 401) {
      logger.warn({ connectorId: this.connectorId, url }, "Tochka: 401 — refreshing hybrid token");
      await this.refreshHybridToken();
      const retryToken = this.config.accessToken!;
      const retryHeaders: Record<string, string> = {
        Authorization: `Bearer ${retryToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (!isDiscoveryPath && this.config.customerCode) retryHeaders["CustomerCode"] = this.config.customerCode;
      const retry = await fetch(url, { headers: retryHeaders });
      if (!retry.ok) {
        const body = await retry.text();
        throw upstreamError(`GET ${path}`, retry.status, body);
      }
      return retry.json() as Promise<T>;
    }
    if (!res.ok) {
      const body = await res.text();
      throw upstreamError(`GET ${path}`, res.status, body);
    }
    return res.json() as Promise<T>;
  }

  // ─── API POST (for statement init and other write operations) ─────────────

  private async apiPost<T>(path: string, body: unknown): Promise<T> {
    const token = await this.ensureHybridToken();
    if (!this.config.customerCode) {
      throw new Error(`Tochka: CustomerCode не определён — невозможно POST ${path}. Запустите resolveCustomerCode().`);
    }

    const url = `${TOCHKA_API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      CustomerCode: this.config.customerCode,
    };

    logger.info({
      step: "api_post",
      status: "request",
      path,
      sent_customer_header: true,
    }, "Tochka: apiPost request");

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

    if (res.status === 401) {
      logger.warn({ connectorId: this.connectorId, url }, "Tochka: 401 on POST — refreshing token");
      await this.refreshHybridToken();
      const retryToken = this.config.accessToken!;
      const retryHeaders: Record<string, string> = {
        Authorization: `Bearer ${retryToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        CustomerCode: this.config.customerCode!,
      };
      const retry = await fetch(url, { method: "POST", headers: retryHeaders, body: JSON.stringify(body) });
      if (!retry.ok) {
        const b = await retry.text();
        throw upstreamError(`POST ${path}`, retry.status, b);
      }
      return retry.json() as Promise<T>;
    }

    if (!res.ok) {
      const text = await res.text();
      throw upstreamError(`POST ${path}`, res.status, text);
    }
    return res.json() as Promise<T>;
  }

  // ─── Public API methods ───────────────────────────────────────────────────

  async getAccounts(): Promise<NormalizedAccount[]> {
    if (!this.isConfigured()) throw new Error("Tochka: не настроен");
    const data = await this.apiFetch<{ Data: { Account: Array<Record<string, unknown>> } }>(ACCOUNTS_PATH);
    return (data.Data?.Account ?? []).map((a) => this.normalizeAccount(a));
  }

  async getBalances(accountIds: string[]): Promise<NormalizedAccount[]> {
    if (!this.isConfigured()) throw new Error("Tochka: не настроен");
    const results: NormalizedAccount[] = [];
    for (const id of accountIds) {
      // Tochka accountId format: "40702810503270002143/044525104" (account/bic)
      // The slash IS part of the API path structure — do NOT percent-encode it
      // e.g. /open-banking/v1.0/accounts/40702810503270002143/044525104/balances
      try {
        const data = await this.apiFetch<Record<string, unknown>>(
          `/open-banking/v1.0/accounts/${id}/balances`
        );
        // Tochka balance response: Data.Balance[] with camelCase OR PascalCase fields
        const dataBlock = (data["Data"] ?? data) as Record<string, unknown>;
        const balArr = (dataBlock["Balance"] ?? dataBlock["balance"] ?? []) as Record<string, unknown>[];

        // Pick best balance type: InterimAvailable (real-time intraday) is most current.
        // OpeningAvailable is yesterday's opening — least preferred.
        const TYPE_PRIORITY = ["InterimAvailable", "ClosingAvailable", "Expected", "OpeningAvailable"];
        let bal: Record<string, unknown> = {};
        for (const typeName of TYPE_PRIORITY) {
          const found = balArr.find(b => String(b["Type"] ?? b["type"] ?? "") === typeName);
          if (found) { bal = found; break; }
        }
        if (!Object.keys(bal).length) bal = balArr[0] ?? {};

        // Amount block — try camelCase and PascalCase
        const balAmt = (bal["Amount"] ?? bal["amount"] ?? {}) as Record<string, unknown>;
        const amountStr = String(balAmt["Amount"] ?? balAmt["amount"] ?? "0");
        const currency = String(balAmt["Currency"] ?? balAmt["currency"] ?? "RUB");
        const rawAmount = Math.abs(parseFloat(amountStr) || 0);

        // Tochka CreditDebitIndicator uses BANK's accounting perspective:
        //   "Debit"  → bank has a debit obligation to client = client has money (POSITIVE)
        //   "Credit" → bank has a credit from client = client is overdrawn (NEGATIVE)
        // This is opposite to UK Open Banking customer-perspective convention.
        const indicator = String(bal["CreditDebitIndicator"] ?? bal["creditDebitIndicator"] ?? "Debit");
        const signedAmount = indicator === "Credit" ? -rawAmount : rawAmount;
        const balanceType = String(bal["Type"] ?? bal["type"] ?? "");

        logger.info({
          step: "get_balances",
          status: "ok",
          accountId: id,
          raw_balance_value: parseFloat(amountStr) || 0,
          parsed_balance_value: signedAmount,
          credit_debit_indicator: indicator,
          balance_sign_source: indicator === "Credit" ? "inverted_credit_overdraft" : "debit_positive",
          currency,
          balanceType,
          balance_types_available: balArr.map(b => String(b["Type"] ?? b["type"] ?? "")),
        }, "Tochka: balance fetched");

        results.push({
          externalAccountId: id,
          accountName: String(bal["Name"] ?? bal["name"] ?? ""),
          accountNumber: String(bal["AccountId"] ?? bal["accountId"] ?? id),
          currency,
          currentBalance: signedAmount,
          availableBalance: signedAmount,
          raw: bal,
        });
      } catch (err) {
        logger.warn({ step: "get_balances", status: "error", accountId: id, err }, "Tochka: balance fetch failed for account (non-fatal)");
      }
    }
    return results;
  }

  async getTransactions(from: Date, to: Date, accountId?: string): Promise<NormalizedTransaction[]> {
    if (!this.isConfigured()) throw new Error("Tochka: не настроен");
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    // Tochka accountId "account/bic" — slash is part of the path, NOT percent-encoded
    const path = accountId
      ? `/open-banking/v1.0/accounts/${accountId}/transactions?fromBookingDateTime=${fromStr}&toBookingDateTime=${toStr}`
      : `/open-banking/v1.0/transactions?fromBookingDateTime=${fromStr}&toBookingDateTime=${toStr}`;

    let data: Record<string, unknown>;
    try {
      data = await this.apiFetch<Record<string, unknown>>(path);
    } catch (err) {
      const msg = String(err);
      // 501 = Not Implemented — Tochka requires statements endpoint for transactions
      if (msg.includes(": 501 ") || msg.includes(":501 ") || msg.toLowerCase().includes("notimplemented") || msg.includes("501 —")) {
        const notImpl = new Error(
          `transactions_not_implemented: Tochka /transactions endpoint returned 501 Not Implemented. ` +
          `Statements API required to load transactions.`
        ) as Error & { code: string };
        notImpl.code = "TOCHKA_501_NOT_IMPLEMENTED";
        throw notImpl;
      }
      throw err;
    }

    const dataBlock = (data["Data"] ?? data) as Record<string, unknown>;
    const txArr = (dataBlock["Transaction"] ?? dataBlock["transaction"] ?? []) as Record<string, unknown>[];
    return txArr.map((t) => this.normalizeTransaction(t));
  }

  // ─── Statements API (canonical source for Tochka transactions) ──────────────
  // Tochka does not implement GET /transactions (returns 501).
  // The Statements API is the correct endpoint for loading operations:
  //   GET /open-banking/v1.0/accounts/{externalAccountId}/statements
  //   GET /open-banking/v1.0/accounts/{externalAccountId}/statements/{id}/transactions

  async getStatements(accountId: string, from: Date, to: Date): Promise<NormalizedStatement[]> {
    if (!this.isConfigured()) throw new Error("Tochka: не настроен");
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);
    // Same accountId/BIC path format as balances
    const path = `/open-banking/v1.0/accounts/${accountId}/statements?fromStatementDateTime=${fromStr}&toStatementDateTime=${toStr}`;
    const data = await this.apiFetch<Record<string, unknown>>(path);
    const dataBlock = (data["Data"] ?? data) as Record<string, unknown>;
    const stmtArr = (dataBlock["Statement"] ?? dataBlock["statement"] ?? []) as Record<string, unknown>[];

    logger.info({
      step: "get_statements",
      status: "ok",
      accountId,
      statements_count: stmtArr.length,
      from: fromStr,
      to: toStr,
    }, "Tochka: statements fetched");

    return stmtArr.map((s) => this.normalizeStatement(s, accountId));
  }

  async getStatementTransactions(accountId: string, statementId: string): Promise<NormalizedTransaction[]> {
    if (!this.isConfigured()) throw new Error("Tochka: не настроен");
    const path = `/open-banking/v1.0/accounts/${accountId}/statements/${statementId}/transactions`;
    const data = await this.apiFetch<Record<string, unknown>>(path);
    const dataBlock = (data["Data"] ?? data) as Record<string, unknown>;
    const txArr = (dataBlock["Transaction"] ?? dataBlock["transaction"] ?? []) as Record<string, unknown>[];

    logger.info({
      step: "get_statement_transactions",
      status: "ok",
      accountId,
      statementId,
      transactions_count: txArr.length,
    }, "Tochka: statement transactions fetched");

    return txArr.map((t) => this.normalizeStatementTransaction(t, accountId));
  }

  // ─── Statements API v2 (correct async pipeline) ───────────────────────────
  // Protocol:
  //   1. POST /statements → statementId (async init, returns Created status)
  //   2. Poll GET /statements until status = "Ready"
  //   3. GET /accounts/{accountId}/statements/{statementId} → transactions

  /**
   * Tochka requires EXACT zero-time datetimes: YYYY-MM-DDT00:00:00
   * No milliseconds, no timezone suffix, no Z, no offset.
   */
  private buildTochkaStatementDate(date: Date): string {
    const yyyy = date.getUTCFullYear();
    const mm   = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd   = String(date.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T00:00:00`;
  }

  async initStatement(accountId: string, from: Date, to: Date): Promise<string> {
    const startDateTime = this.buildTochkaStatementDate(from);
    const endDateTime   = this.buildTochkaStatementDate(to);

    const body = {
      Data: {
        Statement: {
          accountId,
          startDateTime,
          endDateTime,
        },
      },
    };

    logger.info({
      step: "init_statement",
      accountId,
      startDateTime,
      endDateTime,
    }, "Tochka: initiating statement (async)");

    const data = await this.apiPost<Record<string, unknown>>("/open-banking/v1.0/statements", body);
    const dataBlock = (data["Data"] ?? data) as Record<string, unknown>;
    const stmtBlock = (dataBlock["Statement"] ?? dataBlock) as Record<string, unknown>;
    const statementId = String(stmtBlock["StatementId"] ?? stmtBlock["statementId"] ?? "");

    if (!statementId) {
      throw new Error(
        `Tochka initStatement: StatementId отсутствует в ответе. ` +
        `Data keys: ${Object.keys(dataBlock).join(", ")}`
      );
    }

    logger.info({
      step: "init_statement",
      status: "ok",
      accountId,
      statementId,
    }, "Tochka: statement initiated — waiting for Ready status");

    return statementId;
  }

  async getStatementsList(): Promise<Array<{
    statementId: string;
    accountId: string;
    status: string;
    startDateTime: string;
    endDateTime: string;
  }>> {
    const data = await this.apiFetch<Record<string, unknown>>("/open-banking/v1.0/statements");
    const dataBlock = (data["Data"] ?? data) as Record<string, unknown>;
    const stmtArr = (dataBlock["Statement"] ?? []) as Record<string, unknown>[];

    logger.info({
      step: "get_statements_list",
      status: "ok",
      count: stmtArr.length,
    }, "Tochka: statements list fetched");

    return stmtArr.map((s) => ({
      statementId:   String(s["StatementId"]  ?? s["statementId"]  ?? ""),
      accountId:     String(s["AccountId"]    ?? s["accountId"]    ?? ""),
      status:        String(s["Status"]       ?? s["status"]       ?? ""),
      startDateTime: String(s["StartDateTime"] ?? s["startDateTime"] ?? ""),
      endDateTime:   String(s["EndDateTime"]  ?? s["endDateTime"]  ?? ""),
    }));
  }

  async getStatementById(
    accountId: string,
    statementId: string,
  ): Promise<{ raw: Record<string, unknown>; transactions: NormalizedTransaction[] }> {
    const path = `/open-banking/v1.0/accounts/${accountId}/statements/${statementId}`;

    logger.info({
      step: "get_statement_by_id",
      accountId,
      statementId,
    }, "Tochka: fetching ready statement");

    const data = await this.apiFetch<Record<string, unknown>>(path);
    const dataBlock = (data["Data"] ?? data) as Record<string, unknown>;

    // ── Tochka response shape: Data.Statement is ALWAYS an array ─────────────
    // Correct:  data.Data.Statement[0].Transaction[{...}]
    // Wrong:    data.Data.Statement.Transaction  ← was undefined (array ≠ object)
    const stmtRaw = dataBlock["Statement"];
    const stmtBlock = (
      Array.isArray(stmtRaw) ? (stmtRaw[0] ?? {}) :
      (stmtRaw ?? {})
    ) as Record<string, unknown>;

    // Probe all known field variants inside the statement object
    const txArr = (
      stmtBlock["Transaction"]  ??
      stmtBlock["Transactions"] ??
      stmtBlock["transaction"]  ??
      stmtBlock["transactions"] ??
      // Fallback: some implementations put transactions directly on Data
      dataBlock["Transaction"]  ??
      dataBlock["Transactions"] ??
      dataBlock["transaction"]  ??
      dataBlock["transactions"] ??
      []
    ) as Record<string, unknown>[];

    // Log only the response shape, never raw transactions or counterparties.
    logger.info({
      tag: "TX_SYNC_STATEMENT_RAW",
      step: "get_statement_by_id",
      status: "raw_debug",
      accountId,
      statementId,
      top_level_keys: Object.keys(data),
      data_block_keys: Object.keys(dataBlock),
      stmt_block_keys: Object.keys(stmtBlock),
      stmt_is_array: Array.isArray(stmtRaw),
      stmt_array_length: Array.isArray(stmtRaw) ? stmtRaw.length : null,
      raw_transaction_count: txArr.length,
    }, "[TX_SYNC_STATEMENT_RAW] Tochka statement raw response structure");

    logger.info({
      tag: "TX_SYNC_READY",
      step: "get_statement_by_id",
      status: "ok",
      accountId,
      statementId,
      transactions_count: txArr.length,
      first_tx_keys: txArr[0] ? Object.keys(txArr[0]) : [],
    }, "[TX_SYNC_READY] Tochka: statement downloaded");

    return {
      raw: dataBlock,
      transactions: txArr.map((t) => this.normalizeStatementTransaction(t, accountId)),
    };
  }

  private normalizeStatement(raw: Record<string, unknown>, accountId: string): NormalizedStatement {
    const statementId = String(raw["StatementId"] ?? raw["statementId"] ?? "");
    const startDt = String(raw["StartDateTime"] ?? raw["startDateTime"] ?? "");
    const endDt   = String(raw["EndDateTime"]   ?? raw["endDateTime"]   ?? "");
    return {
      externalStatementId: statementId,
      externalAccountId: accountId,
      periodFrom: startDt.slice(0, 10),
      periodTo:   endDt.slice(0, 10),
      raw,
    };
  }

  private normalizeStatementTransaction(raw: Record<string, unknown>, accountId: string): NormalizedTransaction {
    // For transactions (not balances): standard OB UK customer perspective
    //   "Credit" = money credited to account = income
    //   "Debit"  = money debited from account = expense
    // Note: this is OPPOSITE to our balance parsing (which uses Tochka's bank-accounting view)
    const indicator = String(raw["CreditDebitIndicator"] ?? raw["creditDebitIndicator"] ?? "");
    const direction: "income" | "expense" = indicator === "Credit" ? "income" : "expense";

    const rawAmt = (raw["Amount"] ?? raw["amount"] ?? {}) as Record<string, unknown>;
    const amountStr = String(rawAmt["Amount"] ?? rawAmt["amount"] ?? "0");
    const amount = Math.abs(parseFloat(amountStr) || 0);
    const currency = String(rawAmt["Currency"] ?? rawAmt["currency"] ?? "RUB");

    // Tochka Statement transactions use these counterparty structures:
    //   CreditorParty/DebtorParty — has name + inn (actual counterparty)
    //   CreditorAgent/DebtorAgent — has bank details (BIK, bank name)
    //   CreditorAccount/DebtorAccount — has account identification
    // For income: counterparty is the debtor (who sent money)
    // For expense: counterparty is the creditor (who received money)
    const creditorParty   = (raw["CreditorParty"]   ?? raw["creditorParty"]   ?? {}) as Record<string, unknown>;
    const debtorParty     = (raw["DebtorParty"]     ?? raw["debtorParty"]     ?? {}) as Record<string, unknown>;
    const creditorAgent   = (raw["CreditorAgent"]   ?? raw["creditorAgent"]   ?? {}) as Record<string, unknown>;
    const debtorAgent     = (raw["DebtorAgent"]     ?? raw["debtorAgent"]     ?? {}) as Record<string, unknown>;
    const creditorAccount = (raw["CreditorAccount"] ?? raw["creditorAccount"] ?? {}) as Record<string, unknown>;
    const debtorAccount   = (raw["DebtorAccount"]   ?? raw["debtorAccount"]   ?? {}) as Record<string, unknown>;

    // Name: prefer CreditorParty/DebtorParty, fall back to Agent
    const counterpartyName = direction === "income"
      ? String(debtorParty["name"]   ?? debtorParty["Name"]   ?? debtorAgent["Name"]   ?? debtorAgent["name"]   ?? "") || null
      : String(creditorParty["name"] ?? creditorParty["Name"] ?? creditorAgent["Name"] ?? creditorAgent["name"] ?? "") || null;

    // Account: Identification from CreditorAccount/DebtorAccount
    const counterpartyAccount = direction === "income"
      ? String(debtorAccount["Identification"]   ?? debtorAccount["identification"]   ?? "") || null
      : String(creditorAccount["Identification"] ?? creditorAccount["identification"] ?? "") || null;

    const remittance = (raw["RemittanceInformation"] ?? raw["remittanceInformation"] ?? {}) as Record<string, unknown>;
    const purpose = String(
      // Tochka statement transactions use "description" field
      raw["description"] ?? raw["Description"] ??
      remittance["Unstructured"] ?? remittance["unstructured"] ??
      raw["TransactionInformation"] ?? raw["transactionInformation"] ?? ""
    ) || null;

    const bookingDateTime = String(raw["BookingDateTime"] ?? raw["bookingDateTime"] ?? "");
    const valueDateTime   = String(raw["ValueDateTime"]   ?? raw["valueDateTime"]   ?? "");
    // Tochka Statement transactions use documentProcessDate instead of BookingDateTime
    const documentProcessDate = String(raw["documentProcessDate"] ?? raw["DocumentProcessDate"] ?? "");
    // Derive YYYY-MM-DD: prefer bookingDateTime, then valueDateTime, then documentProcessDate
    const operationDate =
      bookingDateTime.slice(0, 10) ||
      valueDateTime.slice(0, 10) ||
      documentProcessDate.slice(0, 10) ||
      new Date().toISOString().slice(0, 10); // safe fallback: today

    const txnId = String(raw["TransactionId"] ?? raw["transactionId"] ?? raw["TransactionReference"] ?? raw["transactionReference"] ?? "");

    // INN: from CreditorParty/DebtorParty (preferred) or Agent Identification
    const counterpartyInn = direction === "income"
      ? String(debtorParty["inn"]   ?? debtorParty["Inn"]   ?? debtorAgent["Identification"]   ?? debtorAgent["identification"]   ?? "") || null
      : String(creditorParty["inn"] ?? creditorParty["Inn"] ?? creditorAgent["Identification"] ?? creditorAgent["identification"] ?? "") || null;

    return {
      externalTransactionId: txnId,
      accountId,
      operationDate,
      amount,
      currency,
      direction,
      counterpartyName,
      counterpartyInn,
      purpose,
      raw,
      bookingDateTime: bookingDateTime || undefined,
      valueDateTime:   valueDateTime   || undefined,
      counterpartyAccount: counterpartyAccount ?? undefined,
      operationType: String(raw["transactionTypeCode"] ?? raw["TransactionCode"] ?? raw["transactionCode"] ?? "") || undefined,
    };
  }

  // ─── Customer discovery ──────────────────────────────────────────────────────

  // Step 1: Introspect the hybrid token → extract "sub" as customerCode.
  // POST /connect/introspect with client credentials + token.
  // This is the primary discovery method per Tochka Open Banking documentation.
  private async introspectToken(): Promise<string | null> {
    if (!this.config.accessToken) return null;
    const params = new URLSearchParams({
      token: this.config.accessToken,
    });
    const credentials = Buffer.from(
      `${this.config.clientId!}:${this.config.clientSecret!}`
    ).toString("base64");

    logger.info({ connectorId: this.connectorId, url: TOCHKA_INTROSPECT_URL }, "Tochka: introspecting hybrid token");
    const res = await fetch(TOCHKA_INTROSPECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: params,
    });
    const body = await res.text();
    logger.info({
      connectorId: this.connectorId,
      status: res.status,
      ...responseShape(body),
    }, "Tochka: introspect response");

    if (!res.ok) {
      throw upstreamError("token introspection", res.status, body);
    }
    let data: Record<string, unknown>;
    try { data = JSON.parse(body); } catch {
      throw new Error("Tochka token introspection returned invalid JSON");
    }
    const sub = typeof data["sub"] === "string" && data["sub"].trim() ? data["sub"].trim() : null;
    logger.info({
      connectorId: this.connectorId,
      subjectPresent: !!sub,
      active: data["active"] === true,
    }, "Tochka: introspect parsed");
    return sub;
  }

  // Step 2 (fallback): Fetch /customers WITHOUT CustomerCode header.
  // Used when introspect does not return a usable "sub" value.
  // Returns raw body string via out-param for error reporting.
  async getCustomers(): Promise<TochkaCustomer[]> {
    const token = await this.ensureHybridToken();
    const url = `${TOCHKA_API_BASE}${CUSTOMERS_PATH}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    logger.info({ connectorId: this.connectorId, url }, "Tochka: fetching customers");
    const res = await fetch(url, { headers });
    const body = await res.text();

    logger.info({
      connectorId: this.connectorId,
      status: res.status,
      ...responseShape(body),
    }, "Tochka: customers response");

    if (!res.ok) {
      throw upstreamError("GET /customers", res.status, body);
    }
    let data: Record<string, unknown>;
    try { data = JSON.parse(body); } catch {
      throw new Error("Tochka /customers returned invalid JSON");
    }

    const dataBlock = data["Data"] as Record<string, unknown> | undefined;

    // Support multiple response shapes: Data.Customer[], Data.customer[],
    // top-level Customer[], top-level customer[], or root array
    const customerList =
      dataBlock?.["Customer"] ??
      dataBlock?.["customer"] ??
      data["Customer"] ??
      data["customer"] ??
      (Array.isArray(data) ? data : null);

    const arr: Record<string, unknown>[] = Array.isArray(customerList)
      ? (customerList as Record<string, unknown>[])
      : [];

    // Structured debug: step / status / input / output
    logger.info({
      step: "get_customers",
      status: "parsing",
      input: { topLevelKeys: Object.keys(data), dataBlockKeys: dataBlock ? Object.keys(dataBlock) : [] },
      output: {
        customerCount: arr.length,
        firstCustomerKeys: arr[0] ? Object.keys(arr[0]) : [],
      },
    }, "Tochka: customers structure debug");

    const customers = arr.map((c: Record<string, unknown>) => {
      // Field name priority: camelCase (actual Tochka), PascalCase (fallbacks), legacy
      const rawCode =
        c["customerCode"] ??     // camelCase — actual Tochka API field ← PRIMARY
        c["CustomerCode"] ??     // PascalCase — legacy fallback
        c["code"] ??
        c["customer_code"] ??
        c["customerId"] ??
        c["id"] ?? "";
      const customerCode = String(rawCode).trim();

      const customerType = String(c["customerType"] ?? c["CustomerType"] ?? "").trim() || undefined;

      const customerName = String(
        c["customerName"] ?? c["CustomerName"] ??
        c["shortName"] ?? c["ShortName"] ??
        c["fullName"] ?? c["FullName"] ??
        c["name"] ?? ""
      ).trim();

      const rawTax =
        c["taxCode"] ??           // camelCase — actual Tochka API field ← PRIMARY
        c["TaxpayerNumber"] ??
        c["taxpayerNumber"] ??
        c["Inn"] ?? null;
      const taxpayerNumber = rawTax ? String(rawTax).trim() : undefined;

      if (!customerCode) {
        logger.warn({
          step: "get_customers",
          status: "error",
          error: "empty_customer_code",
          customerObjectKeys: Object.keys(c),
        }, "Tochka: /customers — customer entry has empty code");
      } else {
        logger.info({
          step: "get_customers",
          status: "ok",
          customerCodePresent: true,
          customerNamePresent: !!customerName,
          customerTypePresent: !!customerType,
          taxpayerNumberPresent: !!taxpayerNumber,
        }, "Tochka: customer entry mapped");
      }

      return { customerCode, customerName, customerType, taxpayerNumber, raw: c };
    });

    if (customers.length === 0) {
      logger.warn({
        connectorId: this.connectorId,
        topLevelKeys: Object.keys(data),
        dataBlockKeys: dataBlock ? Object.keys(dataBlock) : [],
      }, "Tochka: /customers returned empty list — no customer code extractable");
    }

    return customers;
  }

  // ─── ensureCustomerCode ───────────────────────────────────────────────────
  // Checks in-memory config first. If missing, auto-resolves via introspect + /customers,
  // then re-reads from DB to verify the persist. Returns resolved code or null.
  async ensureCustomerCode(): Promise<string | null> {
    if (this.config.customerCode) return this.config.customerCode;

    logger.info({ connectorId: this.connectorId }, "Tochka: customerCode missing — auto-resolving");
    try {
      await this.resolveCustomerCode();
    } catch (err) {
      logger.warn({ connectorId: this.connectorId, err }, "Tochka: resolveCustomerCode failed during ensureCustomerCode");
    }

    // Re-read from DB to verify persist
    try {
      const [fresh] = await db
        .select({ config: bankConnectorsTable.config })
        .from(bankConnectorsTable)
        .where(eq(bankConnectorsTable.id, this.connectorId));
      const freshCode = fresh
        ? (
            decryptBankConnectorConfig(
              this.connectorId,
              fresh.config,
            ) as TochkaConfig
          ).customerCode
        : undefined;
      if (freshCode) {
        this.config.customerCode = freshCode;
        logger.info(
          { connectorId: this.connectorId, customerCodePresent: true },
          "Tochka: customerCode verified from DB after auto-resolve"
        );
        return freshCode;
      }
    } catch (err) {
      logger.warn({ connectorId: this.connectorId, err }, "Tochka: DB re-read failed during ensureCustomerCode");
    }

    logger.error(
      { connectorId: this.connectorId },
      "Tochka: ensureCustomerCode — could not obtain customerCode after all attempts"
    );
    return null;
  }

  // Primary discovery: /customers → Business customer → save → re-read → validate → update in-memory.
  // Introspect is attempted AFTER as supplementary only (non-blocking).
  // Returns customer list for display.
  async resolveCustomerCode(): Promise<TochkaCustomer[]> {
    // ── Step 1: Always fetch /customers — single source of truth ─────────────
    let customers: TochkaCustomer[] = [];
    try {
      customers = await this.getCustomers();
    } catch (err) {
      const errorCode =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code ?? "unknown")
          : "unknown";
      logger.error({
        step: "resolve_customer_code", status: "error",
        errorCode,
      }, "Tochka: /customers fetch failed — cannot resolve customerCode");
      return [];
    }

    if (customers.length === 0) {
      logger.error({
        step: "resolve_customer_code", status: "error",
        error: "empty_customers_list",
      }, "Tochka: /customers returned empty list");
      return [];
    }

    // ── Step 2: Select Business customer; fall back to first ─────────────────
    const businessCustomers = customers.filter(
      c => (c.customerType ?? "").toLowerCase() === "business"
    );
    const selected = businessCustomers[0] ?? customers[0]!;

    if (businessCustomers.length > 1) {
      logger.warn({
        step: "resolve_customer_code", status: "warn",
        error: "multiple_business_customers",
        business_count: businessCustomers.length,
      }, "Tochka: multiple Business customers — using first");
    }

    if (!selected.customerCode) {
      logger.error({
        step: "resolve_customer_code", status: "error",
        error: "empty_selected_code",
        customer_count: customers.length,
        selected_customer_type_present: !!selected.customerType,
      }, "Tochka: selected customer has empty customerCode");
      return customers;
    }

    logger.info({
      step: "resolve_customer_code", status: "selected",
      customerCodePresent: true,
      customerNamePresent: !!selected.customerName,
      taxpayerNumberPresent: !!selected.taxpayerNumber,
      customerTypePresent: !!selected.customerType,
      total_customers: customers.length,
      business_count: businessCustomers.length,
    }, "Tochka: Business customer selected for customerCode");

    // ── Step 3 (Rule 4): persistConfig → re-read → validate → update in-memory
    await this.persistConfig({
      customers,
      customerCode: selected.customerCode,
      customerCodeSource: "customers_api",
      resolvedCustomerCodeAt: new Date().toISOString(),
    });

    const [fresh] = await db
      .select({ config: bankConnectorsTable.config })
      .from(bankConnectorsTable)
      .where(eq(bankConnectorsTable.id, this.connectorId));
    const persisted = fresh
      ? (
          decryptBankConnectorConfig(
            this.connectorId,
            fresh.config,
          ) as TochkaConfig
        ).customerCode
      : undefined;
    const customer_code_saved = !!persisted && persisted === selected.customerCode;

    logger.info({
      step: "resolve_customer_code",
      status: customer_code_saved ? "persisted_ok" : "persist_mismatch",
      customer_code_saved,
      customer_code_after_reread_present: !!persisted,
    }, "Tochka: customerCode persist validation");

    if (customer_code_saved && persisted) {
      // Rule 8: update in-memory immediately so same-request API calls use it
      this.config.customerCode = persisted;
      logger.info({
        step: "resolve_customer_code", status: "in_memory_updated",
        customerCodePresent: true,
      }, "Tochka: in-memory customerCode updated after persist");
    } else if (!customer_code_saved) {
      logger.error({
        step: "resolve_customer_code", status: "persist_failed",
        expectedPresent: !!selected.customerCode,
        actualPresent: !!persisted,
      }, "Tochka: CRITICAL — customerCode persist mismatch");
    }

    // ── Step 4: Introspect as supplementary (non-blocking) ───────────────────
    try {
      const sub = await this.introspectToken();
      logger.info({
        step: "resolve_customer_code", status: "introspect_supplementary",
        introspectSubjectPresent: !!sub,
        matches_customerCode: sub === selected.customerCode,
      }, "Tochka: introspect sub (supplementary — not used for customerCode)");
    } catch {
      // Non-blocking — introspect often returns HTTP 400, that's OK
    }

    return customers;
  }

  private normalizeAccount(raw: Record<string, unknown>): NormalizedAccount {
    // Tochka returns camelCase: accountId, accountDetails[], status, currency
    // PascalCase fallbacks for spec-compliant variants (Account, AccountId, Status, etc.)

    // External account ID — Tochka uses camelCase "accountId"
    const externalAccountId = String(
      raw["accountId"] ?? raw["AccountId"] ?? ""
    ).trim();

    // Account details array — Tochka uses "accountDetails" (camelCase), OB standard uses "Account"
    const detailsArr = raw["accountDetails"] ?? raw["Account"];
    const detail = (Array.isArray(detailsArr) ? detailsArr[0] : (detailsArr ?? {})) as Record<string, unknown>;

    // Identification string: "40702810503270002143/044525104" — accountNumber/bankBic
    const identification = String(
      detail["identification"] ?? detail["Identification"] ?? ""
    ).trim();

    // Account number = part before "/" (or full string if no slash)
    const accountNumber = identification.includes("/")
      ? identification.split("/")[0]!
      : identification;

    // Masked = last 4 of account number
    const maskedAccount = accountNumber.length > 4
      ? `****${accountNumber.slice(-4)}`
      : accountNumber || undefined;

    // Status — Tochka uses camelCase "status"
    const accountStatus = String(raw["status"] ?? raw["Status"] ?? "").trim() || undefined;

    // Account name — use detail "name" or fall back to account number
    const accountName = String(
      raw["nickname"] ?? raw["Nickname"] ??
      detail["name"] ?? detail["Name"] ??
      accountNumber ?? ""
    ).trim();

    logger.info({
      step: "normalize_account",
      status: "ok",
      externalAccountId,
      accountNumber,
      maskedAccount,
      accountName,
      accountStatus,
    }, "Tochka: normalizeAccount result");

    return {
      externalAccountId,
      accountName,
      accountNumber,
      accountStatus,
      maskedAccount,
      currency: String(raw["currency"] ?? raw["Currency"] ?? "RUB").trim(),
      currentBalance: 0,
      availableBalance: 0,
      raw,
    };
  }

  normalizeTransaction(raw: Record<string, unknown>): NormalizedTransaction {
    const credit = raw["CreditDebitIndicator"];
    const direction: "income" | "expense" = credit === "Credit" ? "income" : "expense";
    const rawAmt = (raw["Amount"] ?? {}) as Record<string, unknown>;
    const creditorAgent = (raw["CreditorAgent"] ?? {}) as Record<string, unknown>;
    const debtorAgent  = (raw["DebtorAgent"]  ?? {}) as Record<string, unknown>;
    const remittance   = (raw["RemittanceInformation"] ?? {}) as Record<string, unknown>;
    return {
      externalTransactionId: String(raw["TransactionId"] ?? raw["TransactionReference"] ?? ""),
      accountId: String(raw["AccountId"] ?? ""),
      operationDate: String(raw["BookingDateTime"] ?? "").slice(0, 10),
      amount: parseFloat(String(rawAmt["Amount"] ?? "0")),
      currency: String(rawAmt["Currency"] ?? "RUB"),
      direction,
      counterpartyName: String(creditorAgent["Name"] ?? debtorAgent["Name"] ?? "") || null,
      counterpartyInn: null,
      purpose: String(remittance["Unstructured"] ?? "") || null,
      raw,
    };
  }

  // ─── OAuth status ─────────────────────────────────────────────────────────

  getOAuthStatus(): TochkaOAuthStatusResult {
    const stage = this.getAuthStage();
    const messages: Record<TochkaAuthStage, string> = {
      not_configured:      "Укажите clientId и clientSecret в настройках",
      service_token_ok:    "OAuth клиент готов. Нажмите «Начать авторизацию» для создания consent",
      consent_pending:     "Consent создан. Нажмите «Начать авторизацию» для перехода на страницу подтверждения Точки",
      awaiting_callback:   "Ожидаем подтверждения в Точке. После одобрения вернитесь на эту страницу",
      token_ok:            "Hybrid token активен — API доступен",
      token_expired:       "Hybrid token истёк. Выполняется автоматическое обновление через refresh_token",
      error:               "Ошибка авторизации — повторите OAuth flow",
    };
    return {
      stage,
      consentId: this.config.consentId ?? null,
      consentStatus: this.config.consentStatus ?? null,
      hasHybridToken: !!this.config.accessToken,
      hybridTokenExpiresAt: this.config.tokenExpiresAt ?? null,
      message: messages[stage] ?? "Неизвестный статус",
    };
  }

  // ─── Basic health check ───────────────────────────────────────────────────

  async healthCheck(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return { status: "not_configured", message: "clientId и clientSecret не заданы", checkedAt };
    }
    const stage = this.getAuthStage();
    if (stage === "token_ok") return { status: "active", message: "Hybrid token активен", checkedAt };
    return { status: "inactive", message: `Статус: ${stage}`, checkedAt };
  }

  // ─── Detailed health check with diagnostics ───────────────────────────────

  async healthCheckDetailed(): Promise<ConnectorHealthDetail> {
    const checkedAt = new Date().toISOString();
    const environment = "production" as const;
    const apiBase = TOCHKA_API_BASE;
    const stage = this.getAuthStage();

    if (!this.isConfigured()) {
      return {
        status: "not_configured",
        message: "clientId и clientSecret не заданы",
        checkedAt, authOk: false, authStage: "not_configured",
        scopesGranted: [], hasAccountsScope: false, hasTransactionsScope: false,
        accountsAccessOk: false, transactionsAccessOk: false,
        environment, apiBase,
        diagnosticCode: "not_configured",
        diagnosticMessage: DIAGNOSTIC_MESSAGES["not_configured"],
        debug: { clientId: "(не задан)", tokenUrl: TOCHKA_TOKEN_URL },
      };
    }

    // ── If no hybrid token → explain what needs to happen ────────────────────

    if (stage !== "token_ok") {
      let diagCode: DiagnosticCode;
      let message: string;
      let authOk = false;
      let authorizeUrl: string | null = null;

      if (stage === "awaiting_callback" || stage === "consent_pending") {
        diagCode = "awaiting_user_authorization";
        message = "Hybrid token отсутствует — пользователь должен подтвердить доступ в Точке";
        if (this.config.consentId) {
          try {
            const state = this.config.oauthState ?? generateState();
            authorizeUrl = this.buildAuthorizeUrl(
              this.config.consentId,
              state,
              this.config.redirectUri ?? getDefaultRedirectUri()
            );
          } catch {/* ignore */}
        }
      } else if (stage === "token_expired") {
        diagCode = "token_expired";
        message = "Hybrid token истёк — выполните обновление через refresh_token";
        authOk = !!this.config.refreshToken;
      } else {
        diagCode = "consent_not_created";
        message = "Consent не создан. Нажмите «Начать авторизацию»";
      }

      // Try to verify service token at least
      let serviceTokenOk = false;
      let serviceTokenLength = 0;
      try {
        const svcToken = await this.getOrRefreshServiceToken();
        serviceTokenOk = true;
        serviceTokenLength = svcToken.length;
        if (stage !== "awaiting_callback" && stage !== "consent_pending" && stage !== "token_expired") {
          authOk = true;
          // Update diagCode since service token works
          diagCode = "consent_not_created";
          message = "Сервисный токен OK. Consent не создан — нажмите «Начать авторизацию»";
        }
      } catch {/* service token failure is non-fatal here */}

      return {
        status: "error",
        message,
        checkedAt,
        authOk,
        authStage: stage,
        consentId: this.config.consentId ?? null,
        consentStatus: this.config.consentStatus ?? null,
        authorizeUrl,
        scopesGranted: [],
        hasAccountsScope: false,
        hasTransactionsScope: false,
        accountsAccessOk: false,
        transactionsAccessOk: false,
        environment,
        apiBase,
        diagnosticCode: diagCode,
        diagnosticMessage: DIAGNOSTIC_MESSAGES[diagCode],
        debug: {
          tokenUrl: TOCHKA_TOKEN_URL,
          serviceTokenExists: serviceTokenOk,
          serviceTokenLength,
          hybridTokenExists: false,
          hybridTokenLength: 0,
        },
      };
    }

    // ── Have hybrid token → auto-resolve customerCode if missing, then /accounts ─

    const hybridToken = this.config.accessToken!;
    const accountsUrl = `${TOCHKA_API_BASE}${ACCOUNTS_PATH}`;
    let accountsAccessOk = false;
    let accountCount: number | null = null;
    let apiStatus = 0;
    let apiBodyDebug = "";
    let customersResponseDebug = "";
    let resolvedCustomerCode = this.config.customerCode ?? null;
    let resolvedSource = this.config.customerCodeSource ?? null;
    let customers: TochkaCustomer[] = this.config.customers ?? [];

    // Auto-resolve customerCode via introspect → /customers fallback
    if (!resolvedCustomerCode) {
      try {
        logger.info({ connectorId: this.connectorId }, "Tochka health: no customerCode — running auto-resolve (introspect → /customers)");
        const discovered = await this.resolveCustomerCode();
        customers = discovered;
        customersResponseDebug = `${discovered.length} customer record(s) received`;
        resolvedCustomerCode = this.config.customerCode ?? null;
        resolvedSource = this.config.customerCodeSource ?? null;
        logger.info(
          {
            connectorId: this.connectorId,
            customerCodePresent: !!resolvedCustomerCode,
            source: resolvedSource,
            count: discovered.length,
          },
          "Tochka health: customerCode resolved"
        );
      } catch (custErr) {
        customersResponseDebug = "customer resolution failed";
        logger.warn({ connectorId: this.connectorId, err: custErr }, "Tochka health: customerCode resolve failed (non-fatal)");
      }
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${hybridToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (resolvedCustomerCode) requestHeaders["CustomerCode"] = resolvedCustomerCode;
    const sentCustomerHeader = !!resolvedCustomerCode;

    try {
      const res = await fetch(accountsUrl, { headers: requestHeaders });
      apiStatus = res.status;
      const fullBody = await res.text();
      apiBodyDebug = fullBody;

      if (res.ok) {
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(fullBody); } catch { /* keep empty */ }
        const accounts = (parsed["Data"] as Record<string, unknown> | undefined)?.["Account"] as unknown[];
        accountCount = Array.isArray(accounts) ? accounts.length : 0;
        accountsAccessOk = true;
        logger.info({
          connectorId: this.connectorId,
          accountCount,
          customerCodePresent: !!resolvedCustomerCode,
        }, "Tochka: health detailed OK");
      } else {
        logger.warn({
          connectorId: this.connectorId,
          status: apiStatus,
          ...responseShape(fullBody),
          customerHeaderSent: sentCustomerHeader,
        }, "Tochka: accounts failed");
      }
    } catch (fetchErr) {
      apiBodyDebug = "";
      logger.warn({ connectorId: this.connectorId, err: fetchErr }, "Tochka: accounts request failed");
    }

    const sentHeadersDebug = Object.keys(requestHeaders).sort().join(", ");

    if (!accountsAccessOk) {
      const code = parseDiagnosticCode(apiStatus, apiBodyDebug);
      const noCustomerHint = !resolvedCustomerCode
        ? " CustomerCode не получен — introspect и /customers не вернули код."
        : "";
      return {
        status: "error",
        message: `Hybrid token present, accounts → ${apiStatus}.${noCustomerHint}`,
        checkedAt, authOk: true,
        tokenExpiresAt: this.config.tokenExpiresAt,
        authStage: stage,
        consentId: this.config.consentId ?? null,
        consentStatus: this.config.consentStatus ?? null,
        scopesGranted: [],
        hasAccountsScope: false,
        hasTransactionsScope: false,
        accountsAccessOk: false,
        transactionsAccessOk: false,
        environment, apiBase,
        diagnosticCode: code,
        diagnosticMessage: DIAGNOSTIC_MESSAGES[code],
        customersCount: customers.length,
        debug: {
          requestUrl: accountsUrl,
          responseStatus: apiStatus,
          tokenUrl: TOCHKA_TOKEN_URL,
          tokenExists: true,
          tokenLength: hybridToken.length,
          tokenTypeOf: "string",
          sentHeaders: sentHeadersDebug,
          accountsUrl,
          customerCodeSource: resolvedSource ?? "(не определён)",
          sentCustomerHeader,
          customersResponse: customersResponseDebug || "(не запрашивались — customerCode уже был)",
          hybridTokenExists: true,
          hybridTokenLength: hybridToken.length,
        },
      };
    }

    return {
      status: "active",
      message: `Всё работает. ${accountCount} счёт(а) доступно.`,
      checkedAt, authOk: true,
      tokenExpiresAt: this.config.tokenExpiresAt,
      tokenExpired: false,
      authStage: "token_ok",
      consentId: this.config.consentId ?? null,
      consentStatus: "Authorised",
      scopesGranted: ["accounts", "balances", "transactions"],
      hasAccountsScope: true,
      hasTransactionsScope: true,
      accountsAccessOk: true,
      transactionsAccessOk: true,
      accountCount,
      environment, apiBase,
      diagnosticCode: "ok",
      diagnosticMessage: DIAGNOSTIC_MESSAGES["ok"],
      customersCount: customers.length,
      debug: {
        requestUrl: accountsUrl,
        responseStatus: apiStatus,
        tokenUrl: TOCHKA_TOKEN_URL,
        tokenExists: true,
        tokenLength: hybridToken.length,
        accountsUrl,
        customerCodeSource: resolvedSource ?? "(не определён)",
        sentCustomerHeader,
        customersResponse: customersResponseDebug || "(не запрашивались — customerCode уже был)",
        hybridTokenExists: true,
        hybridTokenLength: hybridToken.length,
      },
    };
  }
}
