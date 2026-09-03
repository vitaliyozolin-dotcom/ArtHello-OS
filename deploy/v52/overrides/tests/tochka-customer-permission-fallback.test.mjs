import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as ts from "typescript";
import { patchTochkaCustomerPermissionFallback } from "../scripts/patch-tochka-customer-permission-fallback.mjs";

const fixedNow = Date.UTC(2026, 8, 3, 16, 30, 0);
const customersUrl = "https://enter.tochka.com/uapi/open-banking/v1.0/customers";
const accountsUrl = "https://enter.tochka.com/uapi/open-banking/v1.0/accounts";
let importNonce = 0;

function makeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "tochka-d060-test",
    exp: Math.floor(fixedNow / 1000) + 3600,
  })).toString("base64url");
  const signature = Buffer.alloc(48, 9).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function loadPatchedIntegrations() {
  const sourceUrl = new URL("../lib/integrations.ts", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const patched = patchTochkaCustomerPermissionFallback(source);
  assert.match(patched, /TOCHKA_CUSTOMER_DIRECTORY_OPTIONAL/);
  assert.match(patched, /customerDirectoryForbidden = customersResponse\.status === 403/);
  assert.match(patched, /Ключ и компания подтверждены по доступным счетам Точки/);
  assert.equal(patchTochkaCustomerPermissionFallback(patched), patched, "D-060 patch must be idempotent");

  const output = ts.transpileModule(patched, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "integrations.ts",
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], "patched integrations.ts must transpile without TypeScript errors");
  return import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}#d060-${importNonce++}`);
}

test("D-060 accepts a Tochka key that cannot read /customers when /accounts identifies one company", async () => {
  const { probeTochkaJwt } = await loadPatchedIntegrations();
  const token = makeJwt();
  const calls = [];
  const result = await probeTochkaJwt(token, async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input) === customersUrl) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(input) === accountsUrl) {
      return new Response(JSON.stringify({
        Data: {
          Account: [
            { accountId: "40702810000000000001", customerCode: "customer-arthello" },
            { accountId: "40702810000000000002", CustomerCode: "customer-arthello" },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected Tochka request: ${input}`);
  }, fixedNow);

  assert.deepEqual(calls.map(({ url }) => url), [customersUrl, accountsUrl]);
  assert.equal(result.valid, true);
  assert.equal(result.customerCode, "customer-arthello");
  assert.equal(result.accountCount, 2);
  assert.equal(result.accountCountScope, "selected_customer");
  assert.match(result.reason, /по доступным счетам/i);
  assert.equal(JSON.stringify(result).includes(token), false);
  for (const { init } of calls) {
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
  }
});

test("D-060 still fails closed if /customers is forbidden and the account response has no owner code", async () => {
  const { probeTochkaJwt } = await loadPatchedIntegrations();
  const token = makeJwt();
  const result = await probeTochkaJwt(token, async (input) => {
    if (String(input) === customersUrl) return new Response("{}", { status: 403 });
    return new Response(JSON.stringify({
      Data: { Account: [{ accountId: "40702810000000000001" }] },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, fixedNow);

  assert.equal(result.valid, false);
  assert.match(result.reason, /не указала компанию-владельца/i);
  assert.equal(result.customerCode, "");
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("D-060 preserves a precise account permission error after optional customer-directory denial", async () => {
  const { probeTochkaJwt } = await loadPatchedIntegrations();
  const token = makeJwt();
  const result = await probeTochkaJwt(token, async (input) => {
    if (String(input) === customersUrl) return new Response("{}", { status: 403 });
    return new Response("{}", { status: 403 });
  }, fixedNow);

  assert.equal(result.valid, false);
  assert.equal(result.reason, "Ключ Точки не даёт права читать счета");
  assert.equal(JSON.stringify(result).includes(token), false);
});
