import { env } from "cloudflare:workers";
import { asc, desc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import {
  bankAccounts,
  bankStatementImports,
  bankTransactions,
  entities,
  integrationConnections,
} from "../../../db/schema";
import { canAccessApi } from "../../../lib/access-policy";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedRequestContext(request);
    if (!context) return privateJson({ error: "Требуется вход" }, 401);
    if (!canAccessApi(context.auth.user, "/api/acquiring", "GET")) {
      return privateJson({ error: "Нет доступа к банковскому контуру" }, 403);
    }
    await ensureCoreTables();
    const db = getDb();
    const [accountRows, transactionRows, statementRows, connectionRows, legalEntityRows] = await Promise.all([
      db.select().from(bankAccounts).orderBy(asc(bankAccounts.legalEntityId), asc(bankAccounts.name)),
      db.select().from(bankTransactions).orderBy(desc(bankTransactions.operationDate), desc(bankTransactions.importedAt)).limit(500),
      db.select().from(bankStatementImports).orderBy(desc(bankStatementImports.fetchedAt)).limit(500),
      db.select().from(integrationConnections).orderBy(asc(integrationConnections.system)),
      db.select({ id: entities.id, name: entities.displayName }).from(entities).where(eq(entities.entityType, "Юрлицо")),
    ]);
    const accounts = accountRows.filter((row) => !row.connectionId.startsWith("TEST"));
    const visibleConnections = new Set(accounts.map((row) => row.connectionId));
    for (const id of ["INT-T-TOCHKA", "INT-T-TBANK"]) visibleConnections.add(id);
    const transactions = transactionRows.filter((row) => !row.connectionId.startsWith("TEST"));
    const statements = statementRows.filter((row) => !row.connectionId.startsWith("TEST"));
    const accountByProvider = new Map(accounts.map((account) => [
      `${account.connectionId}:${account.providerAccountId}`,
      account,
    ]));
    const entityNames = Object.fromEntries(legalEntityRows.map((row) => [row.id, row.name]));
    const latestSyncAt = [
      ...accounts.map((row) => row.syncedAt),
      ...statements.map((row) => row.fetchedAt),
    ].filter(Boolean).sort((left, right) => right.localeCompare(left))[0] ?? "";
    const rubAccounts = accounts.filter((row) => row.currency === "RUB" && row.balanceMinor !== null);
    const incomingMinor = transactions.filter((row) => row.currency === "RUB" && /credit|incoming|приход|поступ|вход/i.test(row.direction))
      .reduce((sum, row) => sum + Math.abs(Number(row.amountMinor)), 0);
    const outgoingMinor = transactions.filter((row) => row.currency === "RUB" && !/credit|incoming|приход|поступ|вход/i.test(row.direction))
      .reduce((sum, row) => sum + Math.abs(Number(row.amountMinor)), 0);
    const paymentSummary = await loadPaymentSummary();

    return privateJson({
      accounts: accounts.map((account) => ({
        id: account.id,
        provider: providerLabel(account.connectionId),
        legalEntityId: account.legalEntityId,
        legalEntityName: entityNames[account.legalEntityId] || account.legalEntityId,
        maskedAccount: account.maskedAccount,
        name: account.name,
        currency: account.currency,
        status: account.status,
        balanceMinor: account.balanceMinor,
        balanceAsOf: account.balanceAsOf,
        syncedAt: account.syncedAt,
      })),
      operations: transactions.map((operation) => {
        const account = accountByProvider.get(`${operation.connectionId}:${operation.providerAccountId}`);
        return {
          id: operation.id,
          provider: providerLabel(operation.connectionId),
          accountName: account?.name || "Банковский счёт",
          maskedAccount: account?.maskedAccount || "",
          legalEntityName: entityNames[operation.legalEntityId] || operation.legalEntityId,
          operationDate: operation.operationDate,
          direction: operation.direction,
          amountMinor: operation.amountMinor,
          currency: operation.currency,
          status: operation.status,
          documentNumber: operation.documentNumber,
          transactionType: operation.transactionType,
          description: operation.description,
          counterpartyName: operation.counterpartyName,
          importedAt: operation.importedAt,
          allocated: Boolean(operation.financialOperationId),
        };
      }),
      synchronization: connectionRows
        .filter((row) => visibleConnections.has(row.id) || /банк|bank|точка|t-?bank/i.test(`${row.system} ${row.category}`))
        .map((row) => ({
          id: row.id,
          system: row.system,
          status: row.status,
          enabled: Boolean(row.isEnabled),
          verified: Boolean(row.verifiedTransfer),
          lastSuccessAt: row.lastSuccessAt,
          nextSyncAt: row.nextSyncAt,
          receivedCount: row.receivedCount,
          acceptedCount: row.acceptedCount,
          errorCount: row.errorCount,
        })),
      summary: {
        accountCount: accounts.length,
        accountsWithBalance: rubAccounts.length,
        rubBalanceMinor: rubAccounts.reduce((sum, row) => sum + Number(row.balanceMinor ?? 0), 0),
        statementCount: statements.length,
        transactionCount: transactions.length,
        incomingMinor,
        outgoingMinor,
        latestSyncAt,
        ...paymentSummary,
      },
      capabilities: { canOpenPay: context.auth.user.canAccessPay },
      boundary: "Остатки показаны по счетам юридических лиц и не являются остатками отдельного филиала. Банковское подключение работает только на чтение: создание, подписание и отправка исходящих платежей из ArtHello OS запрещены.",
    });
  } catch (error) {
    console.error("acquiring.load_failed", error instanceof Error ? error.name : "unknown");
    return privateJson({ error: "Не удалось загрузить эквайринг" }, 503);
  }
}

async function loadPaymentSummary() {
  const database = env.DB;
  const exists = await database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='arthello_pay_requests'").first<{ name: string }>();
  if (!exists) return { paymentRequestCount: 0, activePaymentRequestCount: 0 };
  const row = await database.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status IN ('ready','link_creating','waiting','authorized') THEN 1 ELSE 0 END) AS active
    FROM arthello_pay_requests`).first<{ total: number; active: number | null }>();
  return { paymentRequestCount: Number(row?.total ?? 0), activePaymentRequestCount: Number(row?.active ?? 0) };
}

function providerLabel(connectionId: string) {
  if (connectionId.includes("TOCHKA")) return "Точка";
  if (connectionId.includes("TBANK")) return "Т‑Банк";
  return "Банк";
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store, max-age=0", pragma: "no-cache", expires: "0" } });
}
