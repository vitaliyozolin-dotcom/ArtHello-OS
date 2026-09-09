import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as ts from "typescript";
import { patchTochkaCustomerPermissionFallback } from "../scripts/patch-tochka-customer-permission-fallback.mjs";
import {
  patchTochkaMultiCompanyLabels,
  patchTochkaMultiCompanyWorkspace,
} from "../scripts/patch-tochka-multi-company-selection.mjs";

const fixedNow = Date.UTC(2026, 8, 3, 17, 0, 0);
const customersUrl = "https://enter.tochka.com/uapi/open-banking/v1.0/customers";
const accountsUrl = "https://enter.tochka.com/uapi/open-banking/v1.0/accounts";
let importNonce = 0;

function makeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "tochka-d064-test",
    exp: Math.floor(fixedNow / 1000) + 3600,
  })).toString("base64url");
  const signature = Buffer.alloc(48, 7).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function loadPatchedIntegrations() {
  const source = await readFile(new URL("../lib/integrations.ts", import.meta.url), "utf8");
  const d060 = patchTochkaCustomerPermissionFallback(source);
  const patched = patchTochkaMultiCompanyLabels(d060);
  assert.match(patched, /TOCHKA_CUSTOMER_DIRECTORY_OPTIONAL/);
  assert.match(patched, /TOCHKA_MULTI_COMPANY_ACCOUNT_LABELS/);
  assert.equal(patchTochkaMultiCompanyLabels(patched), patched, "D-064 backend patch must be idempotent");

  const output = ts.transpileModule(patched, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "integrations.ts",
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], "D-064 patched integrations.ts must transpile");
  return import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}#d064-${importNonce++}`);
}

function multiCompanyRequest(input) {
  if (String(input) === customersUrl) return new Response("{}", { status: 403 });
  if (String(input) === accountsUrl) {
    return new Response(JSON.stringify({
      Data: {
        Account: [
          { accountId: "40702810000000000001", customerCode: "customer-alpha", name: "Расчётный счёт" },
          { accountId: "40702810000000000002", customerCode: "customer-beta", name: "Основной счёт" },
          { accountId: "40702810000000000003", customerCode: "customer-beta", name: "Второй счёт" },
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`unexpected Tochka request: ${input}`);
}

test("D-064 turns multiple account-owner codes into safe distinguishable choices", async () => {
  const { probeTochkaJwt } = await loadPatchedIntegrations();
  const token = makeJwt();
  const result = await probeTochkaJwt(token, multiCompanyRequest, fixedNow);

  assert.equal(result.valid, false);
  assert.match(result.reason, /выберите компанию для выбранного юрлица/i);
  assert.equal(result.customerChoices.length, 2);
  const labels = result.customerChoices.map((choice) => choice.name).join(" | ");
  assert.match(labels, /•• 0001/);
  assert.match(labels, /•• 0002/);
  assert.match(labels, /•• 0003/);
  assert.doesNotMatch(labels, /4070281000000000000[123]/);
  assert.doesNotMatch(labels, /customer-(?:alpha|beta)/);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("D-064 validates the explicitly selected company and scopes its account count", async () => {
  const { probeTochkaJwt } = await loadPatchedIntegrations();
  const token = makeJwt();
  const result = await probeTochkaJwt(token, multiCompanyRequest, fixedNow, "customer-beta");

  assert.equal(result.valid, true);
  assert.equal(result.customerCode, "customer-beta");
  assert.equal(result.accountCount, 2);
  assert.equal(result.accountCountScope, "selected_customer");
  assert.deepEqual(result.customerChoices, []);
});

test("D-064 wizard treats company choice as a continuation step and requires explicit selection", async () => {
  const source = await readFile(new URL("../app/components/IntegrationWorkspace.tsx", import.meta.url), "utf8");
  const patched = patchTochkaMultiCompanyWorkspace(source);

  assert.match(patched, /TOCHKA_MULTI_COMPANY_SELECTION_STEP/);
  assert.match(patched, /Ключ Точки подтверждён\. Выберите компанию в этом окне\./);
  assert.match(patched, /customerChoiceRef\.current\?\.scrollIntoView/);
  assert.match(patched, /ref=\{customerChoiceRef\}/);
  assert.match(patched, /setCustomerChoiceId\(""\)/);
  assert.doesNotMatch(patched, /setCustomerChoiceId\(result\.payload\.customerChoices\[0\]\?\.id/);
  assert.match(patched, /безопасные маски её счетов/);
  assert.equal(patchTochkaMultiCompanyWorkspace(patched), patched, "D-064 UI patch must be idempotent");
});
