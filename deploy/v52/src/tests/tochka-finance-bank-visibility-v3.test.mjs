import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as ts from "typescript";
import { patchTochkaCustomerPermissionFallback } from "../scripts/patch-tochka-customer-permission-fallback.mjs";
import { patchTochkaStatementArrayResponse } from "../scripts/patch-tochka-statement-array-response.mjs";
import { patchD066Integrations, patchD066FinanceRoute, patchD066FinanceWorkspace, patchD066FinanceCss } from "../scripts/patch-tochka-finance-bank-visibility-v3.mjs";

const fixedNow = Date.UTC(2026, 8, 3, 18, 0, 0);
const customersUrl = "https://enter.tochka.com/uapi/open-banking/v1.0/customers";
const accountsUrl = "https://enter.tochka.com/uapi/open-banking/v1.0/accounts";
const statementsUrl = "https://enter.tochka.com/uapi/open-banking/v1.0/statements";
const accountId = "40702810000000000001/044525104";
const customerCode = "customer-arthello";
let importNonce = 0;

function makeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(fixedNow / 1000) + 3600 })).toString("base64url");
  const signature = Buffer.alloc(48, 7).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function loadPatchedIntegrations() {
  const source = await readFile(new URL("../lib/integrations.ts", import.meta.url), "utf8");
  const patched = patchD066Integrations(patchTochkaStatementArrayResponse(patchTochkaCustomerPermissionFallback(source)));
  assert.match(patched, /D066_TOCHKA_FINANCE_BANK_VISIBILITY/);
  assert.equal(patchD066Integrations(patched), patched);
  const output = ts.transpileModule(patched, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "integrations.ts",
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, []);
  return import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}#d066-${importNonce++}`);
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function makeRequest(transaction) {
  return async (input, init) => {
    const url = String(input);
    if (url === customersUrl) return jsonResponse({ error: "forbidden" }, 403);
    if (url === accountsUrl) return jsonResponse({ Data: { Account: [{ accountId, customerCode, currency: "RUB", status: "Enabled" }] } });
    if (url === statementsUrl && init?.method === "POST") return jsonResponse({ Data: { Statement: { accountId, statementId: "statement-1", status: "Created" } } });
    if (url === `${accountsUrl}/${accountId}/statements/statement-1` && init?.method === "GET") {
      return jsonResponse({ Data: { Statement: [{
        accountId,
        statementId: "statement-1",
        status: "Ready",
        startDateTime: "2026-09-01",
        endDateTime: "2026-09-03",
        creationDateTime: "2026-09-03T18:00:00+00:00",
        startDateBalance: 5000,
        endDateBalance: 6200,
        Transaction: [transaction],
      }] } });
    }
    throw new Error(`unexpected Tochka request: ${url}`);
  };
}

test("D-066 imports a documented Tochka transaction without transactionId", async () => {
  const { syncTochkaReadOnly, toTochkaFinancialOperation } = await loadPatchedIntegrations();
  const transaction = {
    creditDebitIndicator: "Credit",
    status: "Booked",
    documentProcessDate: "2026-09-03",
    documentNumber: "315",
    description: "Оплата по договору",
    Amount: { amount: "1200.00", currency: "RUB" },
    DebtorParty: { name: "Плательщик", inn: "7800000000" },
  };
  const result = await syncTochkaReadOnly({ token: makeJwt(), customerCode, startDate: "2026-09-01", nowMs: fixedNow, wait: async () => {}, request: makeRequest(transaction) });
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.complete, true);
  assert.equal(result.transactions.length, 1);
  assert.match(result.transactions[0].providerTransactionId, /^DERIVED-[A-F0-9]{48}$/);
  assert.equal(result.transactions[0].amountMinor, 120000);
  const operation = await toTochkaFinancialOperation(result.transactions[0], "ORG-T-001");
  assert.ok(operation);
  assert.equal(operation.sourceSystem, "BANK_TOCHKA_API");
  assert.equal(operation.amountMinor, 120000);
});

test("D-066 bank source remains connected while D130 hides shared legal-entity balances from branch reports", async () => {
  const source = await readFile(new URL("../app/api/finance/route.ts", import.meta.url), "utf8");
  const patched = patchD066FinanceRoute(source);
  assert.match(patched, /bankAccountsView/);
  assert.match(patched, /rubBalanceMinor/);
  assert.match(patched, /const openingBalanceMinor = 0;/, "bank balance must not silently redefine forecast opening balance");
  assert.match(patched, /const bankAccountsView: typeof sourceBankAccounts = \[\];/);
  assert.match(patched, /общий остаток юрлица не включён/);
  const start = patched.indexOf("db.select({\n        id: bankAccounts.id");
  const end = patched.indexOf("}).from(bankAccounts)", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(patched.slice(start, end), /providerAccountId:/);
  assert.equal(patchD066FinanceRoute(patched), patched);
});

test("D-066 finance UI adds a bank panel without changing the four-KPI contract", async () => {
  const [workspaceSource, cssSource] = await Promise.all([
    readFile(new URL("../app/components/FinanceWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/FinanceWorkspace.ds.css", import.meta.url), "utf8"),
  ]);
  const workspace = patchD066FinanceWorkspace(workspaceSource);
  const css = patchD066FinanceCss(cssSource);
  assert.match(workspace, /Счета Точки и текущие остатки/);
  assert.match(workspace, /data\.bankAccounts\.map/);
  const kpiBlock = workspace.slice(workspace.indexOf('<div className="ahFinanceKpis">'), workspace.indexOf('</div>', workspace.indexOf('<div className="ahFinanceKpis">')) + 6);
  assert.equal((kpiBlock.match(/<KpiCard/g) ?? []).length, 4);
  assert.match(css, /D066_TOCHKA_FINANCE_BANK_VISIBILITY/);
  assert.match(css, /ahFinanceBankGrid/);
  assert.match(cssSource, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.equal(patchD066FinanceWorkspace(workspace), workspace);
  assert.equal(patchD066FinanceCss(css), css);
});
