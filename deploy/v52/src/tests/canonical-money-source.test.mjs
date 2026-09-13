import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { summarizeBankMonths, summarizeBankPeriod } from "../lib/bank-facts.ts";

async function source(relative) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("bank period summary is deterministic and excludes other periods and currencies", () => {
  const rows = [
    { operationDate: "2026-09-01", direction: "Credit", amountMinor: 10_000, currency: "RUB" },
    { operationDate: "2026-09-02", direction: "Debit", amountMinor: 3_500, currency: "RUB" },
    { operationDate: "2026-09-03", direction: "Credit", amountMinor: 2_000, currency: "USD" },
    { operationDate: "2026-08-31", direction: "Credit", amountMinor: 9_000, currency: "RUB" },
  ];
  assert.deepEqual(summarizeBankPeriod(rows, "2026-09"), {
    period: "2026-09",
    transactionCount: 2,
    incomingMinor: 10_000,
    outgoingMinor: 3_500,
    netMinor: 6_500,
  });
  assert.deepEqual(summarizeBankMonths(rows).map((item) => item.period), ["2026-08", "2026-09"]);
});

test("Home and Money consume one bank summary while Acquiring cannot read bank facts", async () => {
  const [financeRoute, financeWorkspace, dashboard, acquiringRoute, acquiringWorkspace] = await Promise.all([
    source("../app/api/finance/route.ts"),
    source("../app/components/FinanceWorkspace.tsx"),
    source("../app/components/OwnerDashboard.tsx"),
    source("../app/api/acquiring/route.ts"),
    source("../app/components/AcquiringWorkspace.tsx"),
  ]);
  assert.match(financeRoute, /D172_CANONICAL_MONEY_SOURCE/);
  assert.match(financeRoute, /summarizeBankPeriod\(sourceBankTransactions, selectedPeriod\)/);
  assert.match(financeRoute, /bankAccounts: bankAccountsView/);
  assert.match(financeRoute, /bankSynchronization/);
  assert.match(financeWorkspace, /data\.bankSummary\.incomingMinor/);
  assert.match(financeWorkspace, /data\.bankSummary\.transactionCount/);
  assert.match(financeWorkspace, /D176_MONEY_MOBILE_HISTORY/);
  assert.match(financeWorkspace, /Управленческий учёт филиала · не банковский итог/);
  assert.match(dashboard, /finance\?\.bankOperations/);
  assert.match(dashboard, /const summary = finance\?\.bankSummary/);
  assert.match(dashboard, /summary\.incomingMinor/);
  assert.doesNotMatch(acquiringRoute, /from\(bankAccounts\)|from\(bankTransactions\)|bankStatementImports|integrationConnections/);
  assert.match(acquiringRoute, /arthello_pay_requests/);
  assert.doesNotMatch(acquiringWorkspace, /Остаток по счетам|Банковские операции|Синхронизация с банками/);
  assert.match(acquiringWorkspace, /Ссылки · оплаты · возвраты · чеки/);
});
