import type {
  BankConnectorInterface,
  NormalizedAccount,
  NormalizedTransaction,
  ConnectorHealth,
  ConnectorHealthDetail,
  TinkoffConfig,
} from "../types.js";
import { logger } from "../../logger.js";

// Т-Банк (Tinkoff) Business API
// Docs: https://business.tinkoff.ru/openapi/docs
// Auth: API Key (x-api-key header) or OAuth 2.0

const TINKOFF_API_BASE = "https://business.tinkoff.ru/openapi/v1";

export class TinkoffConnector implements BankConnectorInterface {
  bankName = "tinkoff" as const;
  authType = "api_key" as const;

  private config: TinkoffConfig;
  private connectorId: string;

  constructor(connectorId: string, config: TinkoffConfig) {
    this.connectorId = connectorId;
    this.config = config;
  }

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  async authenticate(): Promise<void> {
    // API key auth — nothing to do
    if (!this.isConfigured()) throw new Error("Tinkoff: apiKey is required");
    logger.info({ connectorId: this.connectorId }, "Tinkoff: API key auth (no-op)");
  }

  async refreshToken(): Promise<void> {
    // API keys don't expire
  }

  private async apiFetch<T>(path: string): Promise<T> {
    if (!this.isConfigured()) throw new Error("Tinkoff: not configured");
    const url = `${TINKOFF_API_BASE}${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Tinkoff API ${path}: ${res.status} ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async getAccounts(): Promise<NormalizedAccount[]> {
    if (!this.isConfigured()) throw new Error("Tinkoff: not configured");
    const data = await this.apiFetch<{ accounts: Array<Record<string, unknown>> }>("/accounts");
    return (data.accounts ?? []).map((a) => this.normalizeAccount(a));
  }

  async getBalances(accountIds: string[]): Promise<NormalizedAccount[]> {
    if (!this.isConfigured()) throw new Error("Tinkoff: not configured");
    const all = await this.getAccounts();
    return all.filter((a) => accountIds.includes(a.externalAccountId));
  }

  async getTransactions(from: Date, to: Date, accountId?: string): Promise<NormalizedTransaction[]> {
    if (!this.isConfigured()) throw new Error("Tinkoff: not configured");
    const cursor = from.toISOString();
    const path = accountId
      ? `/accounts/${accountId}/transactions?from=${cursor}&to=${to.toISOString()}`
      : `/transactions?from=${cursor}&to=${to.toISOString()}`;
    const data = await this.apiFetch<{ items: Array<Record<string, unknown>> }>(path);
    return (data.items ?? []).map((t) => this.normalizeTransaction(t));
  }

  private normalizeAccount(raw: Record<string, unknown>): NormalizedAccount {
    const balance = parseFloat(String(raw["balance"] ?? "0")) / 100; // kopecks
    return {
      externalAccountId: String(raw["accountNumber"] ?? ""),
      accountName: String(raw["name"] ?? raw["accountNumber"] ?? ""),
      accountNumber: String(raw["accountNumber"] ?? ""),
      currency: String(raw["currency"] ?? "RUB"),
      currentBalance: balance,
      availableBalance: balance,
      raw,
    };
  }

  normalizeTransaction(raw: Record<string, unknown>): NormalizedTransaction {
    const typeCode = String(raw["typeCode"] ?? "");
    const direction: "income" | "expense" =
      typeCode === "CREDIT" || typeCode === "incoming" ? "income" : "expense";
    const amount = Math.abs(parseFloat(String(raw["operationAmount"] ?? raw["amount"] ?? "0"))) / 100;
    return {
      externalTransactionId: String(raw["operationId"] ?? raw["id"] ?? ""),
      accountId: String(raw["accountNumber"] ?? ""),
      operationDate: String(raw["operationDate"] ?? raw["date"] ?? "").slice(0, 10),
      amount,
      currency: String(raw["currency"] ?? "RUB"),
      direction,
      counterpartyName: String(raw["counterpartyName"] ?? raw["merchantName"] ?? ""),
      counterpartyInn: String(raw["counterpartyInn"] ?? ""),
      purpose: String(raw["paymentPurpose"] ?? raw["description"] ?? ""),
      raw,
    };
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return { status: "not_configured", message: "API ключ не задан", checkedAt };
    }
    try {
      await this.apiFetch("/accounts");
      return { status: "active", message: "API key OK", checkedAt };
    } catch (err) {
      return { status: "error", message: String(err), checkedAt };
    }
  }

  async healthCheckDetailed(): Promise<ConnectorHealthDetail> {
    const checkedAt = new Date().toISOString();
    const apiBase = TINKOFF_API_BASE;
    const environment = "production" as const;
    if (!this.isConfigured()) {
      return {
        status: "not_configured", message: "API ключ не задан",
        checkedAt, authOk: false, scopesGranted: [], hasAccountsScope: false,
        hasTransactionsScope: false, accountsAccessOk: false, transactionsAccessOk: false,
        environment, apiBase, diagnosticCode: "not_configured",
        diagnosticMessage: "Укажите API ключ в настройках коннектора",
      };
    }
    let apiStatus = 0;
    let apiBody = "";
    const accountsUrl = `${TINKOFF_API_BASE}/accounts`;
    try {
      const res = await fetch(accountsUrl, {
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
      });
      apiStatus = res.status;
      apiBody = (await res.text()).slice(0, 800);
      if (res.ok) {
        let data: { accounts?: unknown[] } = {};
        try { data = JSON.parse(apiBody); } catch { /* ignore */ }
        return {
          status: "active", message: `Всё работает. ${data.accounts?.length ?? 0} счёт(а).`,
          checkedAt, authOk: true, scopesGranted: ["api_key"],
          hasAccountsScope: true, hasTransactionsScope: true,
          accountsAccessOk: true, transactionsAccessOk: true,
          accountCount: data.accounts?.length ?? 0, environment, apiBase,
          diagnosticCode: "ok", diagnosticMessage: "Коннектор работает корректно",
          debug: { requestUrl: accountsUrl, responseStatus: apiStatus },
        };
      }
      const code = apiStatus === 403 ? "accounts_forbidden" as const : apiStatus === 401 ? "auth_failed" as const : "api_error" as const;
      return {
        status: "error", message: `HTTP ${apiStatus}`, checkedAt, authOk: false,
        scopesGranted: [], hasAccountsScope: false, hasTransactionsScope: false,
        accountsAccessOk: false, transactionsAccessOk: false,
        environment, apiBase, diagnosticCode: code, diagnosticMessage: apiBody,
        debug: { requestUrl: accountsUrl, responseStatus: apiStatus, responseBody: apiBody },
      };
    } catch (err) {
      return {
        status: "error", message: String(err), checkedAt, authOk: false,
        scopesGranted: [], hasAccountsScope: false, hasTransactionsScope: false,
        accountsAccessOk: false, transactionsAccessOk: false,
        environment, apiBase, diagnosticCode: "network_error",
        diagnosticMessage: "Сетевая ошибка при подключении к Т-Банку",
      };
    }
  }
}
