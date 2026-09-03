import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as ts from "typescript";
import { patchTochkaCustomerPermissionFallback } from "../scripts/patch-tochka-customer-permission-fallback.mjs";
import { patchTochkaStatementArrayResponse } from "../scripts/patch-tochka-statement-array-response.mjs";

const fixedNow = Date.UTC(2026, 8, 3, 17, 30, 0);
const customersUrl = "https://enter.tochka.com/uapi/open-banking/v1.0/customers";
const accountsUrl = "https://enter.tochka.com/uapi/open-banking/v1.0/accounts";
const statementsUrl = "https://enter.tochka.com/uapi/open-banking/v1.0/statements";
const accountId = "40702810000000000001/044525104";
const customerCode = "customer-arthello";
let importNonce = 0;

function makeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(fixedNow / 1000) + 3600 })).toString("base64url");
  const signature = Buffer.alloc(48, 5).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function loadPatchedIntegrations() {
  const source = await readFile(new URL("../lib/integrations.ts", import.meta.url), "utf8");
  const d060 = patchTochkaCustomerPermissionFallback(source);
  const patched = patchTochkaStatementArrayResponse(d060);
  assert.match(patched, /TOCHKA_STATEMENT_ARRAY_RESPONSE/);
  assert.equal(patchTochkaStatementArrayResponse(patched), patched, "D-065 patch must be idempotent");
  const output = ts.transpileModule(patched, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "integrations.ts",
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], "D-065 patched integrations.ts must transpile");
  return import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}#d065-${importNonce++}`);
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function makeRequest(statementRows) {
  return async (input, init) => {
    const url = String(input);
    if (url === customersUrl) return jsonResponse({ error: "forbidden" }, 403);
    if (url === accountsUrl) {
      return jsonResponse({ Data: { Account: [{ accountId, customerCode, currency: "RUB", status: "Enabled" }] } });
    }
    if (url === statementsUrl && init?.method === "POST") {
      return jsonResponse({ Data: { Statement: { accountId, statementId: "statement-1", status: "Created" } } });
    }
    if (url === `${accountsUrl}/${accountId}/statements/statement-1` && init?.method === "GET") {
      return jsonResponse({ Data: { Statement: statementRows } });
    }
    throw new Error(`unexpected Tochka request: ${url}`);
  };
}

test("D-065 accepts the documented Get Statement array and imports a ready statement", async () => {
  const { syncTochkaReadOnly } = await loadPatchedIntegrations();
  const result = await syncTochkaReadOnly({
    token: makeJwt(),
    customerCode,
    startDate: "2026-09-01",
    nowMs: fixedNow,
    wait: async () => {},
    request: makeRequest([{
      accountId,
      statementId: "statement-1",
      status: "Ready",
      startDateTime: "2026-09-01",
      endDateTime: "2026-09-03",
      creationDateTime: "2026-09-03T17:30:00+00:00",
      startDateBalance: 1000.25,
      endDateBalance: 1200.50,
      Transaction: [],
    }]),
  });

  assert.equal(result.valid, true);
  assert.equal(result.complete, true);
  assert.equal(result.statements.length, 1);
  assert.equal(result.statements[0].statementId, "statement-1");
  assert.equal(result.statements[0].startBalanceMinor, 100025);
  assert.equal(result.statements[0].endBalanceMinor, 120050);
  assert.equal(result.transactions.length, 0);
  assert.match(result.reason, /выписки и операции загружены/i);
});

test("D-065 keeps an ambiguous multi-row response fail-closed for a specific statement URL", async () => {
  const { syncTochkaReadOnly } = await loadPatchedIntegrations();
  const row = {
    accountId,
    statementId: "statement-1",
    status: "Ready",
    startDateTime: "2026-09-01",
    endDateTime: "2026-09-03",
    creationDateTime: "2026-09-03T17:30:00+00:00",
    Transaction: [],
  };
  const result = await syncTochkaReadOnly({
    token: makeJwt(), customerCode, startDate: "2026-09-01", nowMs: fixedNow, wait: async () => {},
    request: makeRequest([row, { ...row, statementId: "statement-2" }]),
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "Точка вернула некорректную выписку");
});
