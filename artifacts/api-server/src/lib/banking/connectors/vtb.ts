import type {
  BankConnectorInterface,
  NormalizedAccount,
  NormalizedTransaction,
  ConnectorHealth,
  ConnectorHealthDetail,
  VtbConfig,
} from "../types.js";
import { logger } from "../../logger.js";

// ВТБ Business API
// Docs: https://developers.vtb.ru/
// Auth: OAuth 2.0

const VTB_API_BASE = "https://api.vtb.ru/open-banking/v1.0";
const VTB_TOKEN_URL = "https://api.vtb.ru/oauth2/token";

export class VtbConnector implements BankConnectorInterface {
  bankName = "vtb" as const;
  authType = "oauth" as const;

  private config: VtbConfig;
  private connectorId: string;

  constructor(connectorId: string, config: VtbConfig) {
    this.connectorId = connectorId;
    this.config = config;
  }

  isConfigured(): boolean {
    return !!(this.config.clientId && this.config.clientSecret);
  }

  private isTokenValid(): boolean {
    if (!this.config.accessToken || !this.config.tokenExpiresAt) return false;
    return new Date(this.config.tokenExpiresAt).getTime() > Date.now() + 60_000;
  }

  async authenticate(): Promise<void> {
    if (!this.isConfigured()) throw new Error("VTB: clientId and clientSecret are required");
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId!,
      client_secret: this.config.clientSecret!,
      scope: "accounts:read transactions:read",
    });
    const res = await fetch(VTB_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`VTB auth failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
    this.config.accessToken = data.access_token;
    if (data.refresh_token) this.config.refreshToken = data.refresh_token;
    this.config.tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    logger.info({ connectorId: this.connectorId }, "VTB: authenticated");
  }

  async refreshToken(): Promise<void> {
    if (this.config.refreshToken) {
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.config.refreshToken,
        client_id: this.config.clientId!,
        client_secret: this.config.clientSecret!,
      });
      const res = await fetch(VTB_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
      if (res.ok) {
        const data = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
        this.config.accessToken = data.access_token;
        if (data.refresh_token) this.config.refreshToken = data.refresh_token;
        this.config.tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
        return;
      }
    }
    await this.authenticate();
  }

  private async apiFetch<T>(path: string): Promise<T> {
    if (!this.isTokenValid()) await this.refreshToken();
    const url = `${VTB_API_BASE}${path}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.accessToken}` },
    });
    if (res.status === 401) {
      await this.authenticate();
      const retry = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.accessToken}` },
      });
      if (!retry.ok) throw new Error(`VTB API ${path}: ${retry.status}`);
      return retry.json() as Promise<T>;
    }
    if (!res.ok) throw new Error(`VTB API ${path}: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async getAccounts(): Promise<NormalizedAccount[]> {
    if (!this.isConfigured()) throw new Error("VTB: not configured");
    const data = await this.apiFetch<{ data: { accounts: Array<Record<string, unknown>> } }>("/accounts");
    return (data.data?.accounts ?? []).map((a) => this.normalizeAccount(a));
  }

  async getBalances(accountIds: string[]): Promise<NormalizedAccount[]> {
    if (!this.isConfigured()) throw new Error("VTB: not configured");
    const results: NormalizedAccount[] = [];
    for (const id of accountIds) {
      const data = await this.apiFetch<{ data: Record<string, unknown> }>(`/accounts/${id}/balances`);
      const d = data.data ?? {};
      results.push({
        externalAccountId: id,
        accountName: String(d["accountName"] ?? ""),
        accountNumber: String(d["accountNumber"] ?? id),
        currency: String(d["currency"] ?? "RUB"),
        currentBalance: parseFloat(String(d["currentBalance"] ?? "0")),
        availableBalance: parseFloat(String(d["availableBalance"] ?? "0")),
        raw: d,
      });
    }
    return results;
  }

  async getTransactions(from: Date, to: Date, accountId?: string): Promise<NormalizedTransaction[]> {
    if (!this.isConfigured()) throw new Error("VTB: not configured");
    const fromStr = from.toISOString();
    const toStr = to.toISOString();
    const path = accountId
      ? `/accounts/${accountId}/transactions?dateFrom=${fromStr}&dateTo=${toStr}`
      : `/transactions?dateFrom=${fromStr}&dateTo=${toStr}`;
    const data = await this.apiFetch<{ data: { items: Array<Record<string, unknown>> } }>(path);
    return (data.data?.items ?? []).map((t) => this.normalizeTransaction(t));
  }

  private normalizeAccount(raw: Record<string, unknown>): NormalizedAccount {
    return {
      externalAccountId: String(raw["accountId"] ?? ""),
      accountName: String(raw["accountName"] ?? raw["accountId"] ?? ""),
      accountNumber: String(raw["accountNumber"] ?? ""),
      currency: String(raw["currency"] ?? "RUB"),
      currentBalance: parseFloat(String(raw["currentBalance"] ?? "0")),
      availableBalance: parseFloat(String(raw["availableBalance"] ?? "0")),
      raw,
    };
  }

  normalizeTransaction(raw: Record<string, unknown>): NormalizedTransaction {
    const dc = String(raw["debitCreditCode"] ?? "");
    const direction: "income" | "expense" = dc === "CREDIT" ? "income" : "expense";
    const amount = parseFloat(String(raw["amount"] ?? "0"));
    return {
      externalTransactionId: String(raw["transactionId"] ?? raw["id"] ?? ""),
      accountId: String(raw["accountId"] ?? ""),
      operationDate: String(raw["operationDate"] ?? raw["date"] ?? "").slice(0, 10),
      amount: Math.abs(amount),
      currency: String(raw["currency"] ?? "RUB"),
      direction,
      counterpartyName: String(raw["counterpartyName"] ?? ""),
      counterpartyInn: String(raw["counterpartyInn"] ?? ""),
      purpose: String(raw["paymentPurpose"] ?? raw["purpose"] ?? ""),
      raw,
    };
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return { status: "not_configured", message: "clientId и clientSecret не заданы", checkedAt };
    }
    try {
      await this.authenticate();
      return { status: "active", message: "OAuth OK", checkedAt };
    } catch (err) {
      return { status: "error", message: String(err), checkedAt };
    }
  }

  async healthCheckDetailed(): Promise<ConnectorHealthDetail> {
    const checkedAt = new Date().toISOString();
    const apiBase = VTB_API_BASE;
    const environment = "production" as const;
    if (!this.isConfigured()) {
      return {
        status: "not_configured", message: "clientId и clientSecret не заданы",
        checkedAt, authOk: false, scopesGranted: [], hasAccountsScope: false,
        hasTransactionsScope: false, accountsAccessOk: false, transactionsAccessOk: false,
        environment, apiBase, diagnosticCode: "not_configured",
        diagnosticMessage: "Укажите clientId и clientSecret в настройках коннектора",
      };
    }
    try {
      await this.authenticate();
      const accounts = await this.getAccounts();
      return {
        status: "active", message: `Всё работает. ${accounts.length} счёт(а).`,
        checkedAt, authOk: true, scopesGranted: ["accounts:read", "transactions:read"],
        hasAccountsScope: true, hasTransactionsScope: true,
        accountsAccessOk: true, transactionsAccessOk: true,
        accountCount: accounts.length, environment, apiBase,
        diagnosticCode: "ok", diagnosticMessage: "Коннектор работает корректно",
      };
    } catch (err) {
      return {
        status: "error", message: String(err), checkedAt, authOk: false,
        scopesGranted: [], hasAccountsScope: false, hasTransactionsScope: false,
        accountsAccessOk: false, transactionsAccessOk: false,
        environment, apiBase, diagnosticCode: "auth_failed",
        diagnosticMessage: String(err),
      };
    }
  }
}
