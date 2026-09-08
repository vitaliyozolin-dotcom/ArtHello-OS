import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  bankConnectorsTable,
  bankAccountsTable,
  bankSyncRunsTable,
  bankTransactionsTable,
  contractsObligationsTable,
} from "@workspace/db";
import { eq, desc, sql, and, gte, lte, sum, count, ilike, or } from "drizzle-orm";
import { z } from "zod/v4";
import { syncConnector, buildConnector } from "../lib/banking/registry.js";
import { TochkaConnector, getDefaultRedirectUri } from "../lib/banking/connectors/tochka.js";
import { sanitizeConnectorHealthResponse } from "../lib/banking/sanitize-health.js";
import { resolveBankingFrontendBaseUrl } from "../lib/banking/oauth-redirect.js";
import {
  decryptBankConnectorConfig,
  sealBankConnectorConfig,
} from "../lib/banking/config-vault.js";
import { logger } from "../lib/logger.js";

export const bankingRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

// ─── GET /banking/connectors ──────────────────────────────────────────────────

bankingRouter.get("/banking/connectors", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(bankConnectorsTable)
      .orderBy(bankConnectorsTable.createdAt);

    // Attach account counts
    const accountCounts = await db
      .select({
        bankConnectorId: bankAccountsTable.bankConnectorId,
        count: count(),
        totalBalance: sum(bankAccountsTable.currentBalance),
      })
      .from(bankAccountsTable)
      .groupBy(bankAccountsTable.bankConnectorId);

    const countMap = new Map(accountCounts.map((r) => [r.bankConnectorId, r]));

    const result = rows.map((r) => {
      const ac = countMap.get(r.id);
      return {
        ...r,
        config: undefined, // never expose config to client
        accountCount: ac ? Number(ac.count) : 0,
        totalBalance: ac ? toNum(ac.totalBalance) : null,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "GET /banking/connectors failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /banking/connectors ─────────────────────────────────────────────────

const CreateConnectorSchema = z.object({
  bankName: z.enum(["tochka", "tinkoff", "vtb"]),
  displayName: z.string().optional(),
  authType: z.enum(["oauth", "api_key", "manual"]).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  syncFrequencyMinutes: z.number().int().min(1).max(1440).optional(),
});

bankingRouter.post("/banking/connectors", async (req, res) => {
  const parsed = CreateConnectorSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;

  try {
    const AUTH_TYPE_MAP: Record<string, string> = { tochka: "oauth", tinkoff: "api_key", vtb: "oauth" };
    const DISPLAY_NAME_MAP: Record<string, string> = { tochka: "Точка", tinkoff: "Т-Банк", vtb: "ВТБ" };
    const connectorId = randomUUID();
    const config = sealBankConnectorConfig(
      connectorId,
      data.config ?? {},
    );

    const [row] = await db
      .insert(bankConnectorsTable)
      .values({
        id: connectorId,
        bankName: data.bankName,
        displayName: data.displayName ?? DISPLAY_NAME_MAP[data.bankName],
        authType: data.authType ?? AUTH_TYPE_MAP[data.bankName],
        config,
        connectorStatus: "inactive",
        syncFrequencyMinutes: data.syncFrequencyMinutes ?? 15,
      })
      .returning();
    res.status(201).json({ ...row, config: undefined });
  } catch (err) {
    req.log.error({ err }, "POST /banking/connectors failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /banking/connectors/:id ───────────────────────────────────────────

const UpdateConnectorSchema = z.object({
  displayName: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  connectorStatus: z.enum(["active", "inactive"]).optional(),
  syncFrequencyMinutes: z.number().int().min(1).max(1440).optional(),
});

bankingRouter.patch("/banking/connectors/:id", async (req, res) => {
  const parsed = UpdateConnectorSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { id } = req.params;

  try {
    const [existing] = await db.select().from(bankConnectorsTable).where(eq(bankConnectorsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const update: Partial<typeof bankConnectorsTable.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.displayName !== undefined) update.displayName = parsed.data.displayName;
    if (parsed.data.connectorStatus !== undefined) update.connectorStatus = parsed.data.connectorStatus;
    if (parsed.data.syncFrequencyMinutes !== undefined) update.syncFrequencyMinutes = parsed.data.syncFrequencyMinutes;
    if (parsed.data.config !== undefined) {
      const currentConfig = decryptBankConnectorConfig(
        existing.id,
        existing.config,
      );
      update.config = sealBankConnectorConfig(existing.id, {
        ...currentConfig,
        ...parsed.data.config,
      });
    }

    const [row] = await db
      .update(bankConnectorsTable)
      .set(update)
      .where(eq(bankConnectorsTable.id, id))
      .returning();
    res.json({ ...row, config: undefined });
  } catch (err) {
    req.log.error({ err }, "PATCH /banking/connectors/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /banking/connectors/:id ──────────────────────────────────────────

bankingRouter.delete("/banking/connectors/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.delete(bankConnectorsTable).where(eq(bankConnectorsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /banking/connectors/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /banking/connectors/:id/sync ───────────────────────────────────────

bankingRouter.post("/banking/connectors/:id/sync", async (req, res) => {
  const { id } = req.params;
  const runType = (req.query["type"] as string) ?? "full";
  const periodDays = req.body?.periodDays ? parseInt(String(req.body.periodDays)) : undefined;
  try {
    const result = await syncConnector(id, runType as "balances" | "transactions" | "full", periodDays);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "POST /banking/connectors/:id/sync failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /banking/connectors/:id/health ──────────────────────────────────────

bankingRouter.get("/banking/connectors/:id/health", async (req, res) => {
  const { id } = req.params;
  try {
    const [row] = await db
      .select()
      .from(bankConnectorsTable)
      .where(eq(bankConnectorsTable.id, id));
    if (!row) { res.status(404).json({ error: "Connector not found" }); return; }

    const connector = buildConnector(row);
    const health = await connector.healthCheckDetailed();

    await db
      .update(bankConnectorsTable)
      .set({
        connectorStatus: health.status === "active" ? "active" : health.status === "not_configured" ? "inactive" : "error",
        lastError: health.authOk
          ? null
          : `connector_health:${health.diagnosticCode}`,
        updatedAt: new Date(),
      })
      .where(eq(bankConnectorsTable.id, id));

    res.json(sanitizeConnectorHealthResponse(health));
  } catch (err) {
    req.log.error({ err }, "GET /banking/connectors/:id/health failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /banking/connectors/:id/customers ────────────────────────────────────
// Fetch customer list from Tochka /customers endpoint (auto-resolves customerCode)

bankingRouter.get("/banking/connectors/:id/customers", async (req, res) => {
  const { id } = req.params;
  try {
    const [row] = await db
      .select()
      .from(bankConnectorsTable)
      .where(eq(bankConnectorsTable.id, id));
    if (!row) { res.status(404).json({ error: "Connector not found" }); return; }
    if (row.bankName !== "tochka") { res.status(400).json({ error: "Customers endpoint only for Tochka" }); return; }

    const connector = new TochkaConnector(
      id,
      decryptBankConnectorConfig(id, row.config),
    );
    const customers = await connector.resolveCustomerCode();

    // Rule 4: Re-read from DB to get the persisted customerCode
    const [updated] = await db
      .select()
      .from(bankConnectorsTable)
      .where(eq(bankConnectorsTable.id, id));
    const cfg = updated
      ? decryptBankConnectorConfig(updated.id, updated.config)
      : {};
    const resolvedCustomerCode = (cfg["customerCode"] as string | null | undefined) ?? null;

    // Select the Business customer for debug output
    const businessCustomer = customers.find(
      c => (c.customerType ?? "").toLowerCase() === "business"
    ) ?? customers[0] ?? null;

    const debug = {
      selected_customer_code:      businessCustomer?.customerCode ?? null,
      selected_customer_shortName: businessCustomer?.customerName ?? null,
      selected_customer_taxCode:   businessCustomer?.taxpayerNumber ?? null,
      selected_customer_type:      businessCustomer?.customerType ?? null,
      customer_code_saved:         !!resolvedCustomerCode && resolvedCustomerCode === businessCustomer?.customerCode,
      customer_code_after_reread:  resolvedCustomerCode,
      total_customers:             customers.length,
      business_count:              customers.filter(c => (c.customerType ?? "").toLowerCase() === "business").length,
    };

    req.log.info({
      connectorId: id,
      customerCount: customers.length,
      businessCustomerCount: debug.business_count,
      customerCodeSaved: debug.customer_code_saved,
    }, "GET /customers resolved customerCode");
    res.json({ customers, resolvedCustomerCode, debug });
  } catch (err) {
    req.log.error({ err }, "GET /banking/connectors/:id/customers failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /banking/connectors/:id/resolve-customer ────────────────────────────
// Save selected customerCode to connector config

bankingRouter.post("/banking/connectors/:id/resolve-customer", async (req, res) => {
  const { id } = req.params;
  const { customerCode } = req.body as { customerCode?: string };
  if (!customerCode?.trim()) { res.status(400).json({ error: "customerCode is required" }); return; }

  try {
    const [row] = await db
      .select()
      .from(bankConnectorsTable)
      .where(eq(bankConnectorsTable.id, id));
    if (!row) { res.status(404).json({ error: "Connector not found" }); return; }

    const config = {
      ...decryptBankConnectorConfig(row.id, row.config),
      customerCode: customerCode.trim(),
    };
    await db
      .update(bankConnectorsTable)
      .set({
        config: sealBankConnectorConfig(row.id, config),
        updatedAt: new Date(),
      })
      .where(eq(bankConnectorsTable.id, id));

    req.log.info({
      connectorId: id,
      customerCodeSaved: true,
    }, "Tochka: customerCode saved");
    res.json({ ok: true, customerCode: customerCode.trim() });
  } catch (err) {
    req.log.error({ err }, "POST /banking/connectors/:id/resolve-customer failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /banking/connectors/:id/oauth/start ─────────────────────────────────
// Step 1 of Tochka OAuth: create consent + return authorize URL

bankingRouter.post("/banking/connectors/:id/oauth/start", async (req, res) => {
  const { id } = req.params;
  try {
    const [row] = await db
      .select()
      .from(bankConnectorsTable)
      .where(eq(bankConnectorsTable.id, id));
    if (!row) { res.status(404).json({ error: "Connector not found" }); return; }
    if (row.bankName !== "tochka") { res.status(400).json({ error: "OAuth flow only supported for Tochka" }); return; }

    const connector = new TochkaConnector(
      id,
      decryptBankConnectorConfig(id, row.config),
    );
    const result = await connector.startOAuthFlow(getDefaultRedirectUri());
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "POST /banking/connectors/:id/oauth/start failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /banking/connectors/:id/oauth/status ─────────────────────────────────

bankingRouter.get("/banking/connectors/:id/oauth/status", async (req, res) => {
  const { id } = req.params;
  try {
    const [row] = await db
      .select()
      .from(bankConnectorsTable)
      .where(eq(bankConnectorsTable.id, id));
    if (!row) { res.status(404).json({ error: "Connector not found" }); return; }

    const connector = new TochkaConnector(
      id,
      decryptBankConnectorConfig(id, row.config),
    );
    res.json(connector.getOAuthStatus());
  } catch (err) {
    req.log.error({ err }, "GET /banking/connectors/:id/oauth/status failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /banking/connectors/:id/oauth/callback ──────────────────────────────
// Step 2: receive code from frontend after Tochka redirects back

const OAuthCodeSchema = z.string().min(1).max(2048);
const OAuthStateSchema = z.string().regex(/^[a-f0-9]{48}$/);

bankingRouter.post("/banking/connectors/:id/oauth/callback", async (req, res) => {
  const { id } = req.params;
  const parsedCallback = z.object({
    code: OAuthCodeSchema,
    state: OAuthStateSchema,
  }).safeParse(req.body);

  if (!parsedCallback.success) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }
  const { code, state } = parsedCallback.data;

  try {
    const [row] = await db
      .select()
      .from(bankConnectorsTable)
      .where(eq(bankConnectorsTable.id, id));
    if (!row) { res.status(404).json({ error: "Connector not found" }); return; }

    const config = decryptBankConnectorConfig(id, row.config);

    // State is mandatory and must match exactly (CSRF guard).
    if (
      typeof config["oauthState"] !== "string" ||
      config["oauthState"] !== state
    ) {
      res.status(400).json({ error: "OAUTH_STATE_MISMATCH" });
      return;
    }

    const connector = new TochkaConnector(id, config);
    await connector.exchangeCode(code, getDefaultRedirectUri());

    // Update connector status to active
    await db
      .update(bankConnectorsTable)
      .set({ connectorStatus: "active", lastError: null, updatedAt: new Date() })
      .where(eq(bankConnectorsTable.id, id));

    req.log.info({ connectorId: id }, "Tochka OAuth callback: hybrid token obtained, connector active");

    // Auto-sync after OAuth. syncConnector() calls ensureCustomerCode() internally —
    // customerCode will be resolved before accounts/balances are fetched.
    setImmediate(() => {
      syncConnector(id, "balances").then(() => {
        req.log.info({ connectorId: id }, "Tochka: auto-sync after OAuth complete");
      }).catch((err: unknown) => {
        req.log.warn({ connectorId: id, err }, "Tochka: auto-sync after OAuth failed (non-fatal)");
      });
    });

    res.json({ ok: true, stage: "token_ok", message: "Hybrid token получен. Коннектор активен." });
  } catch (err) {
    req.log.error({ err }, "POST /banking/connectors/:id/oauth/callback failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /banking/oauth/callback ─────────────────────────────────────────────
// Browser redirect landing — Tochka sends user here after authorization.
// Reads code+state from query, finds connector by oauthState, exchanges code,
// then redirects user back to the frontend banking page.

bankingRouter.get("/banking/oauth/callback", async (req, res) => {
  const code = OAuthCodeSchema.safeParse(req.query["code"]);
  const state = OAuthStateSchema.safeParse(req.query["state"]);
  const error =
    typeof req.query["error"] === "string" &&
    req.query["error"].length <= 128
      ? req.query["error"]
      : undefined;

  const frontendBase = resolveBankingFrontendBaseUrl();

  if (error) {
    req.log.warn({
      providerErrorPresent: true,
    }, "Tochka OAuth callback: error from bank");
    res.redirect(`${frontendBase}/?tochka_error=provider_rejected`);
    return;
  }

  if (!code.success || !state.success) {
    res.redirect(`${frontendBase}/?tochka_error=missing_code`);
    return;
  }
  const codeValue = code.data;
  const stateValue = state.data;

  try {
    // Find connector with matching oauthState
    const rows = await db
      .select()
      .from(bankConnectorsTable)
      .where(eq(bankConnectorsTable.bankName, "tochka"));

    const matchingRow = rows.find((r) => {
      try {
        const cfg = decryptBankConnectorConfig(r.id, r.config);
        return cfg["oauthState"] === stateValue;
      } catch {
        return false;
      }
    });

    if (!matchingRow) {
      req.log.warn(
        "Tochka OAuth callback: no connector with matching oauthState",
      );
      res.redirect(`${frontendBase}/?tochka_error=state_mismatch`);
      return;
    }

    const connector = new TochkaConnector(
      matchingRow.id,
      decryptBankConnectorConfig(
        matchingRow.id,
        matchingRow.config,
      ),
    );
    await connector.exchangeCode(codeValue, getDefaultRedirectUri());

    await db
      .update(bankConnectorsTable)
      .set({ connectorStatus: "active", lastError: null, updatedAt: new Date() })
      .where(eq(bankConnectorsTable.id, matchingRow.id));

    req.log.info({ connectorId: matchingRow.id }, "Tochka OAuth: authorization complete");

    // Auto-sync after OAuth. syncConnector() calls ensureCustomerCode() internally —
    // customerCode will be resolved before accounts/balances are fetched.
    const connectorId = matchingRow.id;
    setImmediate(() => {
      syncConnector(connectorId, "balances").then(() => {
        req.log.info({ connectorId }, "Tochka: auto-sync after browser OAuth complete");
      }).catch((err: unknown) => {
        req.log.warn({ connectorId, err }, "Tochka: auto-sync after browser OAuth failed (non-fatal)");
      });
    });

    res.redirect(`${frontendBase}/?tochka_oauth=success&connector=${matchingRow.id}`);
  } catch (err) {
    req.log.error({ err }, "GET /banking/oauth/callback failed");
    res.redirect(`${frontendBase}/?tochka_error=internal_error`);
  }
});

// ─── GET /banking/accounts ────────────────────────────────────────────────────

bankingRouter.get("/banking/accounts", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: bankAccountsTable.id,
        bankConnectorId: bankAccountsTable.bankConnectorId,
        externalAccountId: bankAccountsTable.externalAccountId,
        accountName: bankAccountsTable.accountName,
        accountNumber: bankAccountsTable.accountNumber,
        currency: bankAccountsTable.currency,
        currentBalance: bankAccountsTable.currentBalance,
        availableBalance: bankAccountsTable.availableBalance,
        branchCrmId: bankAccountsTable.branchCrmId,
        lastBalanceSyncAt: bankAccountsTable.lastBalanceSyncAt,
        bankName: bankConnectorsTable.bankName,
        displayName: bankConnectorsTable.displayName,
      })
      .from(bankAccountsTable)
      .leftJoin(bankConnectorsTable, eq(bankAccountsTable.bankConnectorId, bankConnectorsTable.id))
      .orderBy(bankConnectorsTable.bankName, bankAccountsTable.accountName);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /banking/accounts failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /banking/cashflow ────────────────────────────────────────────────────

bankingRouter.get("/banking/cashflow", async (req, res) => {
  try {
    // Balances by bank
    const byBank = await db
      .select({
        bankName: bankConnectorsTable.bankName,
        displayName: bankConnectorsTable.displayName,
        connectorStatus: bankConnectorsTable.connectorStatus,
        accountCount: count(bankAccountsTable.id),
        totalBalance: sum(bankAccountsTable.currentBalance),
        lastSyncAt: bankConnectorsTable.lastSyncAt,
      })
      .from(bankConnectorsTable)
      .leftJoin(bankAccountsTable, eq(bankAccountsTable.bankConnectorId, bankConnectorsTable.id))
      .groupBy(
        bankConnectorsTable.id,
        bankConnectorsTable.bankName,
        bankConnectorsTable.displayName,
        bankConnectorsTable.connectorStatus,
        bankConnectorsTable.lastSyncAt,
      );

    // Total balance (only active connectors with real account data)
    const totalBalance = byBank.reduce((s, r) => s + toNum(r.totalBalance), 0);

    // Today's cashflow from bank_api source
    const today = todayStr();
    const todayRows = await db
      .select({
        direction: bankTransactionsTable.direction,
        total: sum(bankTransactionsTable.amount),
      })
      .from(bankTransactionsTable)
      .where(
        and(
          eq(sql`${bankTransactionsTable.operationDate}::text`, today),
          eq(bankTransactionsTable.sourceType, "bank_api"),
        ),
      )
      .groupBy(bankTransactionsTable.direction);

    const todayIncome  = toNum(todayRows.find((r) => r.direction === "income")?.total);
    const todayExpense = toNum(todayRows.find((r) => r.direction === "expense")?.total);
    const netToday     = todayIncome - todayExpense;

    // Avg daily expense last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const [avgRow] = await db
      .select({ total: sum(bankTransactionsTable.amount) })
      .from(bankTransactionsTable)
      .where(
        and(
          eq(bankTransactionsTable.direction, "expense"),
          eq(bankTransactionsTable.sourceType, "bank_api"),
          gte(sql`${bankTransactionsTable.operationDate}::text`, thirtyDaysAgo),
        ),
      );
    const avgDailyExpense = toNum(avgRow?.total) / 30;
    const runwayDays = avgDailyExpense > 0 ? Math.floor(totalBalance / avgDailyExpense) : null;

    res.json({
      byBank: byBank.map((r) => ({
        ...r,
        accountCount: Number(r.accountCount),
        totalBalance: toNum(r.totalBalance),
      })),
      totalBalance,
      todayIncome,
      todayExpense,
      netToday,
      avgDailyExpense,
      runwayDays,
      hasLiveData: byBank.some((r) => r.connectorStatus === "active"),
    });
  } catch (err) {
    req.log.error({ err }, "GET /banking/cashflow failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /banking/alerts ──────────────────────────────────────────────────────

bankingRouter.get("/banking/alerts", async (req, res) => {
  try {
    const alerts: Array<{
      id: string;
      type: string;
      severity: "info" | "warning" | "critical";
      message: string;
      accountId?: string;
      amount?: number;
    }> = [];

    // Per-account low balance alerts are DISABLED until account classification is done.
    // Protocol: no "критично" for 0-balance accounts — they may be tax/restricted accounts.
    // Only show a soft total-balance info if everything is zero.
    const accounts = await db.select().from(bankAccountsTable);
    const totalBalance = accounts.reduce((s, a) => s + toNum(a.currentBalance), 0);
    if (accounts.length > 0 && totalBalance === 0 && accounts.every(a => a.lastBalanceSyncAt)) {
      alerts.push({
        id: "zero_total_balance",
        type: "zero_total_balance",
        severity: "info",
        message: "На подключённых счетах нет средств",
        amount: 0,
      });
    }

    // Missing expected payments (obligations due in last 3 days without matching transaction)
    const todayDate = new Date();
    const dayOfMonth = todayDate.getDate();
    if (dayOfMonth <= 5 || dayOfMonth >= 25) {
      const obligations = await db
        .select()
        .from(contractsObligationsTable)
        .where(eq(contractsObligationsTable.isActive, true));
      for (const ob of obligations) {
        if (!ob.paymentDay) continue;
        const diff = Math.abs(dayOfMonth - ob.paymentDay);
        if (diff <= 3) {
          // Check if there's a matching transaction this month
          const monthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1)
            .toISOString().slice(0, 10);
          const [existing] = await db
            .select({ count: count() })
            .from(bankTransactionsTable)
            .where(
              and(
                eq(bankTransactionsTable.direction, "expense"),
                gte(sql`${bankTransactionsTable.operationDate}::text`, monthStart),
                sql`${bankTransactionsTable.counterpartyName} ILIKE ${'%' + (ob.counterpartyName ?? '') + '%'}`,
              ),
            );
          if (Number(existing?.count ?? 0) === 0) {
            alerts.push({
              id: `missing_payment_${ob.id}`,
              type: "missing_payment",
              severity: "warning",
              message: `Возможно, не оплачено: ${ob.counterpartyName} (${ob.obligationType}) ≈ ${toNum(ob.monthlyAmount).toLocaleString("ru-RU")} ₽`,
              amount: toNum(ob.monthlyAmount),
            });
          }
        }
      }
    }

    // High burn rate: today's expense > 2x avg daily (last 30 days)
    const today = todayStr();
    const thirtyAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const [todayExp] = await db
      .select({ total: sum(bankTransactionsTable.amount) })
      .from(bankTransactionsTable)
      .where(
        and(
          eq(bankTransactionsTable.direction, "expense"),
          eq(sql`${bankTransactionsTable.operationDate}::text`, today),
        ),
      );
    const [avgExp] = await db
      .select({ total: sum(bankTransactionsTable.amount) })
      .from(bankTransactionsTable)
      .where(
        and(
          eq(bankTransactionsTable.direction, "expense"),
          gte(sql`${bankTransactionsTable.operationDate}::text`, thirtyAgo),
        ),
      );
    const todayExpAmt = toNum(todayExp?.total);
    const avgDaily = toNum(avgExp?.total) / 30;
    if (avgDaily > 0 && todayExpAmt > avgDaily * 2) {
      alerts.push({
        id: "high_burn_rate",
        type: "high_burn_rate",
        severity: "warning",
        message: `Высокий расход сегодня: ${todayExpAmt.toLocaleString("ru-RU")} ₽ (среднедневной: ${Math.round(avgDaily).toLocaleString("ru-RU")} ₽)`,
        amount: todayExpAmt,
      });
    }

    res.json({ alerts, total: alerts.length });
  } catch (err) {
    req.log.error({ err }, "GET /banking/alerts failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /banking/forecast ────────────────────────────────────────────────────

bankingRouter.get("/banking/forecast", async (req, res) => {
  try {
    // Current total balance
    const [balRow] = await db
      .select({ total: sum(bankAccountsTable.currentBalance) })
      .from(bankAccountsTable);
    const currentBalance = toNum(balRow?.total);

    // Avg daily cashflow (last 30 days)
    const thirtyAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const flowRows = await db
      .select({
        direction: bankTransactionsTable.direction,
        total: sum(bankTransactionsTable.amount),
      })
      .from(bankTransactionsTable)
      .where(gte(sql`${bankTransactionsTable.operationDate}::text`, thirtyAgo))
      .groupBy(bankTransactionsTable.direction);

    const avgDailyIncome  = toNum(flowRows.find((r) => r.direction === "income")?.total) / 30;
    const avgDailyExpense = toNum(flowRows.find((r) => r.direction === "expense")?.total) / 30;
    const avgDailyNet     = avgDailyIncome - avgDailyExpense;

    // Monthly obligations total
    const obligations = await db
      .select()
      .from(contractsObligationsTable)
      .where(eq(contractsObligationsTable.isActive, true));
    const monthlyObligations = obligations.reduce((s, o) => s + toNum(o.monthlyAmount), 0);
    const dailyObligations = monthlyObligations / 30;

    // Adjusted net (subtracting obligations already accounted for in avg expense,
    // so we don't double-count — just show the projection as is)
    const project = (days: number) => currentBalance + avgDailyNet * days;
    const p7  = project(7);
    const p14 = project(14);
    const p30 = project(30);

    // Cash gap: when does balance hit zero?
    let cashGapDate: string | null = null;
    if (avgDailyNet < 0) {
      const daysToZero = Math.floor(currentBalance / Math.abs(avgDailyNet));
      if (daysToZero >= 0 && daysToZero < 365) {
        const d = new Date(Date.now() + daysToZero * 86_400_000);
        cashGapDate = d.toISOString().slice(0, 10);
      }
    }

    const MIN_SAFE_BALANCE_DAYS = 14;
    const minimumSafeBalance = avgDailyExpense * MIN_SAFE_BALANCE_DAYS + dailyObligations * MIN_SAFE_BALANCE_DAYS;

    res.json({
      currentBalance,
      avgDailyIncome,
      avgDailyExpense,
      avgDailyNet,
      monthlyObligations,
      projectedBalance7d: p7,
      projectedBalance14d: p14,
      projectedBalance30d: p30,
      cashGapDate,
      minimumSafeBalance,
      burnRateTrend: avgDailyNet < 0 ? "negative" : "positive",
      hasData: currentBalance > 0 || avgDailyExpense > 0,
    });
  } catch (err) {
    req.log.error({ err }, "GET /banking/forecast failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /banking/sync-runs ───────────────────────────────────────────────────

bankingRouter.get("/banking/sync-runs", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "20")), 100);
    const rows = await db
      .select({
        id: bankSyncRunsTable.id,
        bankConnectorId: bankSyncRunsTable.bankConnectorId,
        runType: bankSyncRunsTable.runType,
        startedAt: bankSyncRunsTable.startedAt,
        finishedAt: bankSyncRunsTable.finishedAt,
        status: bankSyncRunsTable.status,
        transactionsReceived: bankSyncRunsTable.transactionsReceived,
        transactionsNew: bankSyncRunsTable.transactionsNew,
        transactionsUpdated: bankSyncRunsTable.transactionsUpdated,
        transactionsDuplicates: bankSyncRunsTable.transactionsDuplicates,
        balancesUpdated: bankSyncRunsTable.balancesUpdated,
        errorsCount: bankSyncRunsTable.errorsCount,
        durationMs: bankSyncRunsTable.durationMs,
        errorMessage: bankSyncRunsTable.errorMessage,
        bankName: bankConnectorsTable.bankName,
        displayName: bankConnectorsTable.displayName,
      })
      .from(bankSyncRunsTable)
      .leftJoin(bankConnectorsTable, eq(bankSyncRunsTable.bankConnectorId, bankConnectorsTable.id))
      .orderBy(desc(bankSyncRunsTable.startedAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /banking/sync-runs failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /banking/transactions (enhanced: filters + pagination) ───────────────

bankingRouter.get("/banking/transactions", async (req, res) => {
  try {
    const {
      from, to, accountId, direction,
      minAmount, maxAmount, counterparty, inn, purpose, matchStatus,
      limit: limitQ, offset: offsetQ, connectorId,
    } = req.query;

    const fromDate = from
      ? String(from)
      : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const toDate = to ? String(to) : new Date().toISOString().slice(0, 10);
    const limit = Math.min(parseInt(String(limitQ ?? "50")), 200);
    const offset = parseInt(String(offsetQ ?? "0"));

    const conditions = [
      gte(sql`${bankTransactionsTable.operationDate}::text`, fromDate),
      lte(sql`${bankTransactionsTable.operationDate}::text`, toDate),
    ];

    if (accountId)    conditions.push(eq(bankTransactionsTable.accountId, String(accountId)));
    if (connectorId)  conditions.push(eq(bankTransactionsTable.bankConnectorId, String(connectorId)));
    if (direction)    conditions.push(eq(bankTransactionsTable.direction, String(direction)));
    if (matchStatus)  conditions.push(eq(bankTransactionsTable.matchStatus, String(matchStatus)));
    if (minAmount)    conditions.push(gte(sql`${bankTransactionsTable.amount}::numeric`, sql`${parseFloat(String(minAmount))}`));
    if (maxAmount)    conditions.push(lte(sql`${bankTransactionsTable.amount}::numeric`, sql`${parseFloat(String(maxAmount))}`));
    if (counterparty) conditions.push(ilike(bankTransactionsTable.counterpartyName, `%${counterparty}%`));
    if (inn)          conditions.push(ilike(bankTransactionsTable.counterpartyInn, `%${inn}%`));
    if (purpose)      conditions.push(ilike(bankTransactionsTable.purpose, `%${purpose}%`));

    const [rows, countRow] = await Promise.all([
      db.select({
        id: bankTransactionsTable.id,
        externalId: bankTransactionsTable.externalId,
        bankConnectorId: bankTransactionsTable.bankConnectorId,
        bankName: bankTransactionsTable.bankName,
        accountId: bankTransactionsTable.accountId,
        maskedAccount: bankTransactionsTable.maskedAccount,
        accountName: bankTransactionsTable.accountName,
        accountNumber: bankTransactionsTable.accountNumber,
        operationDate: bankTransactionsTable.operationDate,
        bookingDateTime: bankTransactionsTable.bookingDateTime,
        valueDateTime: bankTransactionsTable.valueDateTime,
        amount: bankTransactionsTable.amount,
        currency: bankTransactionsTable.currency,
        direction: bankTransactionsTable.direction,
        counterpartyName: bankTransactionsTable.counterpartyName,
        counterpartyInn: bankTransactionsTable.counterpartyInn,
        counterpartyAccount: bankTransactionsTable.counterpartyAccount,
        purpose: bankTransactionsTable.purpose,
        operationType: bankTransactionsTable.operationType,
        matchStatus: bankTransactionsTable.matchStatus,
        matchType: bankTransactionsTable.matchType,
        matchedFamilyId: bankTransactionsTable.matchedFamilyId,
        sourceType: bankTransactionsTable.sourceType,
        syncedAt: bankTransactionsTable.syncedAt,
        createdAt: bankTransactionsTable.createdAt,
      })
        .from(bankTransactionsTable)
        .where(and(...conditions))
        .orderBy(desc(bankTransactionsTable.operationDate), desc(bankTransactionsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() })
        .from(bankTransactionsTable)
        .where(and(...conditions)),
    ]);

    res.json({
      transactions: rows.map(r => ({
        ...r,
        operationDate: r.operationDate ?? null,
        bookingDateTime: r.bookingDateTime?.toISOString() ?? null,
        valueDateTime: r.valueDateTime?.toISOString() ?? null,
        syncedAt: r.syncedAt?.toISOString() ?? null,
        createdAt: r.createdAt?.toISOString() ?? null,
      })),
      total: Number(countRow[0]?.total ?? 0),
      limit,
      offset,
      from: fromDate,
      to: toDate,
    });
  } catch (err) {
    req.log.error({ err }, "GET /banking/transactions failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /banking/transactions/stats ─────────────────────────────────────────

bankingRouter.get("/banking/transactions/stats", async (req, res) => {
  try {
    const { from, to, accountId } = req.query;
    const fromDate = from
      ? String(from)
      : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const toDate = to ? String(to) : new Date().toISOString().slice(0, 10);

    const base = [
      gte(sql`${bankTransactionsTable.operationDate}::text`, fromDate),
      lte(sql`${bankTransactionsTable.operationDate}::text`, toDate),
    ];
    if (accountId) base.push(eq(bankTransactionsTable.accountId, String(accountId)));

    const [[inRow], [outRow]] = await Promise.all([
      db.select({ total: sum(bankTransactionsTable.amount), cnt: count() })
        .from(bankTransactionsTable)
        .where(and(...base, eq(bankTransactionsTable.direction, "income"))),
      db.select({ total: sum(bankTransactionsTable.amount), cnt: count() })
        .from(bankTransactionsTable)
        .where(and(...base, eq(bankTransactionsTable.direction, "expense"))),
    ]);

    const totalIn  = parseFloat(String(inRow?.total  ?? "0")) || 0;
    const totalOut = parseFloat(String(outRow?.total ?? "0")) || 0;
    const countIn  = Number(inRow?.cnt  ?? 0);
    const countOut = Number(outRow?.cnt ?? 0);

    res.json({
      from: fromDate,
      to: toDate,
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      countIn,
      countOut,
      total: countIn + countOut,
      hasData: countIn + countOut > 0,
    });
  } catch (err) {
    req.log.error({ err }, "GET /banking/transactions/stats failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /banking/data-truth ──────────────────────────────────────────────────
// Returns freshness status of all banking data layers

bankingRouter.get("/banking/data-truth", async (req, res) => {
  try {
    const [accounts, balRow, txCountRow, txRangeRow, lastRun] = await Promise.all([
      db.select({
        id: bankAccountsTable.id,
        lastBalanceSyncAt: bankAccountsTable.lastBalanceSyncAt,
        lastStatementSyncAt: bankAccountsTable.lastStatementSyncAt,
        currentBalance: bankAccountsTable.currentBalance,
        maskedAccount: bankAccountsTable.maskedAccount,
      }).from(bankAccountsTable),

      db.select({ total: sql<string>`coalesce(sum(current_balance::numeric), 0)` })
        .from(bankAccountsTable),

      db.select({ cnt: count() }).from(bankTransactionsTable),

      db.select({
        minDate: sql<string>`min(operation_date::text)`,
        maxDate: sql<string>`max(operation_date::text)`,
      }).from(bankTransactionsTable),

      db.select({
        startedAt: bankSyncRunsTable.startedAt,
        finishedAt: bankSyncRunsTable.finishedAt,
        status: bankSyncRunsTable.status,
        statementsRequested: bankSyncRunsTable.statementsRequested,
        statementsSaved: bankSyncRunsTable.statementsSaved,
        transactionsNew: bankSyncRunsTable.transactionsNew,
        transactionsDuplicates: bankSyncRunsTable.transactionsDuplicates,
        durationMs: bankSyncRunsTable.durationMs,
        errorMessage: bankSyncRunsTable.errorMessage,
      })
        .from(bankSyncRunsTable)
        .orderBy(desc(bankSyncRunsTable.startedAt))
        .limit(1),
    ]);

    const lastBalanceSyncAt = accounts.reduce<Date | null>((latest, a) => {
      if (!a.lastBalanceSyncAt) return latest;
      return !latest || a.lastBalanceSyncAt > latest ? a.lastBalanceSyncAt : latest;
    }, null);

    const lastStatementSyncAt = accounts.reduce<Date | null>((latest, a) => {
      if (!a.lastStatementSyncAt) return latest;
      return !latest || a.lastStatementSyncAt > latest ? a.lastStatementSyncAt : latest;
    }, null);

    const txCount = Number(txCountRow[0]?.cnt ?? 0);
    const run = lastRun[0] ?? null;

    // Sample first transaction for debug
    const [firstTx] = txCount > 0
      ? await db.select({
          operationDate: bankTransactionsTable.operationDate,
          amount: bankTransactionsTable.amount,
          direction: bankTransactionsTable.direction,
          counterpartyName: bankTransactionsTable.counterpartyName,
          maskedAccount: bankTransactionsTable.maskedAccount,
        })
          .from(bankTransactionsTable)
          .orderBy(desc(bankTransactionsTable.operationDate))
          .limit(1)
      : [null];

    res.json({
      accounts: {
        count: accounts.length,
        lastSyncAt: lastBalanceSyncAt?.toISOString() ?? null,
        accountsMasked: accounts.map(a => a.maskedAccount).filter(Boolean),
      },
      balances: {
        totalBalance: parseFloat(String(balRow[0]?.total ?? "0")),
        lastSyncAt: lastBalanceSyncAt?.toISOString() ?? null,
      },
      transactions: {
        count: txCount,
        from: txRangeRow[0]?.minDate ?? null,
        to: txRangeRow[0]?.maxDate ?? null,
        lastSyncAt: lastStatementSyncAt?.toISOString() ?? null,
        hasData: txCount > 0,
        firstTransactionSample: firstTx ?? null,
      },
      lastSync: run ? {
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
        status: run.status,
        statementsRequested: run.statementsRequested ?? 0,
        statementsSaved: run.statementsSaved ?? 0,
        transactionsNew: run.transactionsNew ?? 0,
        transactionsDuplicates: run.transactionsDuplicates ?? 0,
        durationMs: run.durationMs ?? null,
        errorMessage: run.errorMessage ?? null,
      } : null,
      source: "Tochka API",
      debug: {
        accounts_loaded_count: accounts.length,
        balances_loaded_count: accounts.filter(a => a.lastBalanceSyncAt).length,
        statements_requested_count: run?.statementsRequested ?? 0,
        statements_saved_count: run?.statementsSaved ?? 0,
        transactions_saved_count: run?.transactionsNew ?? 0,
        duplicates_skipped_count: run?.transactionsDuplicates ?? 0,
        bank_transactions_total_count: txCount,
        transactions_period_from: txRangeRow[0]?.minDate ?? null,
        transactions_period_to: txRangeRow[0]?.maxDate ?? null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET /banking/data-truth failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /banking/webhooks/:bank ─────────────────────────────────────────────
// Webhook entry point — banks that support push notifications call this

bankingRouter.post("/banking/webhooks/:bank", async (req, res) => {
  const { bank } = req.params;
  req.log.info({
    bank,
    payloadPresent: Boolean(req.body),
  }, "Banking webhook received");

  try {
    // Find active connector for this bank
    const [connector] = await db
      .select()
      .from(bankConnectorsTable)
      .where(
        and(
          eq(bankConnectorsTable.bankName, bank),
          eq(bankConnectorsTable.connectorStatus, "active"),
        ),
      );

    if (connector) {
      // Trigger an async transaction sync (non-blocking)
      syncConnector(connector.id, "transactions").catch((err) =>
        logger.error({ err, bank }, "Webhook-triggered sync failed"),
      );
      res.json({ ok: true, message: "Sync triggered" });
    } else {
      res.json({ ok: true, message: "No active connector, webhook noted" });
    }
  } catch (err) {
    req.log.error({ err }, "POST /banking/webhooks/:bank failed");
    res.status(500).json({ error: "Internal server error" });
  }
});
