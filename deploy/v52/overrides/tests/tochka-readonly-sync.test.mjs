import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isAllowedTochkaStatementRequest,
  syncTochkaReadOnly,
  toTochkaFinancialOperation,
} from "../lib/integrations.ts";

const fixedNow = Date.parse("2026-09-03T09:00:00.000Z");
const accountId = "40817810802000000008/044525104";

function token(exp = Math.floor(fixedNow / 1000) + 3600) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ exp })}.synthetic-signature`;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Tochka read-only sync requests every permitted account statement and normalizes its payment register", async () => {
  const calls = [];
  let statementReads = 0;
  const result = await syncTochkaReadOnly({
    token: token(),
    customerCode: "300000092",
    startDate: "2026-08-01",
    nowMs: fixedNow,
    wait: async () => {},
    request: async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, method: init.method ?? "GET", body: init.body ?? "" });
      if (url.endsWith("/customers")) return json({ Data: { Customer: [{ customerCode: "300000092", shortName: "ООО АртХелло" }] } });
      if (url.endsWith("/accounts")) return json({ Data: { Account: [{
        customerCode: "300000092",
        accountId,
        status: "Enabled",
        currency: "RUB",
        accountDetails: [{ identification: accountId, name: "Основной счёт" }],
      }] } });
      if (url.endsWith("/statements") && init.method === "POST") {
        return json({ Data: { Statement: { accountId, statementId: "statement-001", status: "Created" } } });
      }
      if (url.includes("/statements/statement-001")) {
        statementReads += 1;
        if (statementReads === 1) return json({ Data: { Statement: { accountId, statementId: "statement-001", status: "Processing" } } });
        return json({ Data: { Statement: {
          accountId,
          statementId: "statement-001",
          startDateTime: "2026-08-01",
          endDateTime: "2026-09-03",
          startDateBalance: "100.00",
          endDateBalance: "250.55",
          Transaction: [
            {
              transactionId: "tx-credit-1",
              paymentId: "pay-credit-1",
              creditDebitIndicator: "Credit",
              status: "Booked",
              documentNumber: "101",
              transactionTypeCode: "Платежное поручение",
              documentProcessDate: "2026-09-02",
              description: "Оплата по договору 12",
              Amount: { amount: "120.55", currency: "RUB" },
              DebtorParty: { name: "ООО Родитель", inn: "7701000001", kpp: "770101001" },
            },
            {
              transactionId: "tx-debit-1",
              paymentId: "pay-debit-1",
              creditDebitIndicator: "Debit",
              status: "Booked",
              documentNumber: "102",
              transactionTypeCode: "Банковский ордер",
              documentProcessDate: "2026-09-03",
              description: "Оплата аренды",
              Amount: { amount: 50, currency: "RUB" },
              CreditorParty: { name: "ООО Арендодатель", inn: "7701000002" },
            },
          ],
        } } });
      }
      throw new Error(`Unexpected request: ${init.method ?? "GET"} ${url}`);
    },
  });

  assert.equal(result.valid, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.accounts.map(({ maskedAccount, name, currency, status }) => ({ maskedAccount, name, currency, status })), [
    { maskedAccount: "•• 0008", name: "Основной счёт", currency: "RUB", status: "Enabled" },
  ]);
  assert.deepEqual(result.statements.map(({ status, startBalanceMinor, endBalanceMinor, transactionCount }) => ({ status, startBalanceMinor, endBalanceMinor, transactionCount })), [
    { status: "Ready", startBalanceMinor: 10000, endBalanceMinor: 25055, transactionCount: 2 },
  ]);
  assert.deepEqual(result.transactions.map(({ providerTransactionId, direction, amountMinor, currency, counterpartyName, description }) => ({ providerTransactionId, direction, amountMinor, currency, counterpartyName, description })), [
    { providerTransactionId: "tx-credit-1", direction: "Поступление", amountMinor: 12055, currency: "RUB", counterpartyName: "ООО Родитель", description: "Оплата по договору 12" },
    { providerTransactionId: "tx-debit-1", direction: "Списание", amountMinor: 5000, currency: "RUB", counterpartyName: "ООО Арендодатель", description: "Оплата аренды" },
  ]);
  const init = calls.find((call) => call.method === "POST");
  assert.deepEqual(JSON.parse(init.body), { Data: { Statement: { accountId, startDateTime: "2026-08-01", endDateTime: "2026-09-03" } } });
  assert.equal(calls.some((call) => /\/payment\//.test(call.url)), false);
});

test("Tochka statement allowlist permits only the documented read flow and finance projection is deterministic", async () => {
  assert.equal(isAllowedTochkaStatementRequest("https://enter.tochka.com/uapi/open-banking/v1.0/statements", "POST"), true);
  assert.equal(isAllowedTochkaStatementRequest(`https://enter.tochka.com/uapi/open-banking/v1.0/accounts/${accountId}/statements/statement-001`, "GET"), true);
  assert.equal(isAllowedTochkaStatementRequest("https://enter.tochka.com/uapi/payment/v1.0/for-sign", "POST"), false);
  assert.equal(isAllowedTochkaStatementRequest("https://evil.example/uapi/open-banking/v1.0/statements", "POST"), false);

  const transaction = {
    id: "TOCHKA-TX-ABC",
    providerTransactionId: "tx-credit-1",
    paymentId: "pay-credit-1",
    statementId: "statement-001",
    accountId,
    operationDate: "2026-09-02",
    direction: "Поступление",
    amountMinor: 12055,
    currency: "RUB",
    status: "Booked",
    documentNumber: "101",
    transactionType: "Платежное поручение",
    description: "Оплата по договору 12",
    counterpartyName: "ООО Родитель",
    counterpartyInn: "7701000001",
    counterpartyKpp: "770101001",
    sourcePayloadHash: "abc123",
  };
  const first = await toTochkaFinancialOperation(transaction, "ORG-LIVE-1");
  const second = await toTochkaFinancialOperation(transaction, "ORG-LIVE-1");
  assert.deepEqual(first, second);
  assert.equal(first.amountMinor, 12055);
  assert.equal(first.legalEntityId, "ORG-LIVE-1");
  assert.equal(first.status, "Требует разбора");
  assert.match(first.sourceRef, /ООО Родитель/);
  assert.equal(await toTochkaFinancialOperation({ ...transaction, currency: "USD" }, "ORG-LIVE-1"), null);
});

test("integration wizard has an independently scrollable mobile body and describes the real read-only import", () => {
  const workspace = readFileSync(new URL("../app/components/IntegrationWorkspace.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/components/IntegrationWorkspace.ds.css", import.meta.url), "utf8");
  const globalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const mobileStyles = readFileSync(new URL("../app/components/SystemWideMobilePolish.css", import.meta.url), "utf8");
  assert.match(workspace, /className="ahIntegrationSetupBody"/);
  assert.match(workspace, /\["Счета", "Выписки", "Операции и платежи", "Реестр операций", "Остатки"\]/);
  assert.match(workspace, /Загружать выписки с/);
  assert.doesNotMatch(workspace, /Загрузка выписок, расписание синхронизации и правила распределения операций ещё не запущены/);
  assert.doesNotMatch(styles, /!important/i);
  assert.doesNotMatch(globalStyles, /\.connection-modal,\.setup-wizard\{height:auto!important/);
  assert.match(globalStyles, /\.connection-modal,\.setup-wizard:not\(\.ahIntegrationSetupWizard\)\{height:auto!important/);
  assert.match(mobileStyles, /\.setup-wizard:not\(\.ahIntegrationSetupWizard\),[\s\S]*?max-height:\s*none\s*!important;[\s\S]*?overflow:\s*visible\s*!important/);
  assert.match(styles, /\.ahIntegrationModalLayer > \.ahIntegrationSetupWizard\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;[\s\S]*?height:\s*min\(820px, calc\(100dvh - 48px\)\);[\s\S]*?max-height:\s*calc\(100dvh - 48px\);[\s\S]*?overflow:\s*hidden;[\s\S]*?padding:\s*0/);
  assert.match(styles, /\.ahIntegrationModalLayer \.ahIntegrationSetupWizard > \.ahIntegrationSetupBody\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;[\s\S]*?-webkit-overflow-scrolling:\s*touch;[\s\S]*?touch-action:\s*pan-y/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.ahIntegrationModalLayer > \.ahIntegrationSetupWizard\s*\{[\s\S]*?height:\s*calc\(100dvh - 20px\);[\s\S]*?max-height:\s*calc\(100dvh - 20px\);[\s\S]*?overflow:\s*hidden/);
  assert.match(styles, /body:has\(\.ahIntegrationModalLayer\) \[data-ah-help-root\] \.ah-launch\s*\{[\s\S]*?display:\s*none/);
});
