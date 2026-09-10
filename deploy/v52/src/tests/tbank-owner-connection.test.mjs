import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isAllowedTBankReadRequest,
  normalizePublicIntegrationIp,
  probeTBankToken,
  validateTBankToken,
} from "../lib/integrations.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const fixedNow = Date.UTC(2026, 8, 3, 12, 0, 0);
const accountsUrl = "https://business.tbank.ru/openapi/api/v4/bank-accounts?withInvest=false";
const statementBaseUrl = "https://business.tbank.ru/openapi/api/v1/statement";
const token = `t.${"a".repeat(80)}`;

test("T-Bank accepts an opaque H2H token without pretending it is a JWT", () => {
  assert.deepEqual(validateTBankToken(token), {
    valid: true,
    reason: "Формат токена Т‑Банка корректен",
  });
  assert.equal(validateTBankToken(`opaque+token/${"b".repeat(24)}=`).valid, true);
  assert.equal(validateTBankToken("short").valid, false);
  assert.equal(validateTBankToken(`${token} with-space`).valid, false);
  assert.equal(JSON.stringify(validateTBankToken(token)).includes(token), false);
});

test("T-Bank probe uses only read-only accounts v4 and a bounded statement v1", async () => {
  const accountNumbers = ["40702810900000000001", "40702810900000000002"];
  const operationIds = ["operation-secret-1", "operation-secret-2"];
  const calls = [];
  const result = await probeTBankToken(token, async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input) === accountsUrl) {
      return new Response(JSON.stringify({ accounts: accountNumbers.map((accountNumber) => ({ accountNumber })) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ operations: operationIds.map((operationId) => ({ operationId })) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, fixedNow);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, accountsUrl);
  const statement = new URL(calls[1].url);
  assert.equal(`${statement.origin}${statement.pathname}`, statementBaseUrl);
  assert.equal(statement.searchParams.get("accountNumber"), accountNumbers[0]);
  assert.equal(statement.searchParams.get("from"), new Date(fixedNow - 7 * 86_400_000).toISOString());
  assert.equal(statement.searchParams.get("to"), new Date(fixedNow).toISOString());
  assert.equal(statement.searchParams.get("limit"), "10");
  assert.equal(statement.searchParams.get("withBalances"), "false");
  for (const call of calls) {
    const headers = new Headers(call.init?.headers);
    assert.equal(call.init?.method, "GET");
    assert.equal(headers.get("authorization"), `Bearer ${token}`);
    assert.match(headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
    assert.equal(call.init?.cache, "no-store");
    assert.equal(call.init?.redirect, "error");
  }
  assert.deepEqual(result, {
    valid: true,
    reason: "ArtHello OS успешно выполнил чтение счетов и короткой выписки Т‑Банка",
    accountCount: 2,
    operationCount: 2,
    statementWindowDays: 7,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(token), false);
  for (const privateValue of [...accountNumbers, ...operationIds]) assert.equal(serialized.includes(privateValue), false);
});

test("T-Bank failures discard provider bodies and never request a statement without accounts", async () => {
  let calls = 0;
  const rejected = await probeTBankToken(token, async () => {
    calls += 1;
    return new Response(JSON.stringify({ token, error: `rejected ${token}` }), { status: 403 });
  }, fixedNow);
  assert.equal(calls, 1);
  assert.deepEqual(rejected, {
    valid: false,
    reason: "Токен Т‑Банка не даёт доступа к счетам",
    accountCount: 0,
    operationCount: 0,
    statementWindowDays: 7,
  });
  assert.equal(JSON.stringify(rejected).includes(token), false);

  calls = 0;
  const invalid = await probeTBankToken("bad token", async () => {
    calls += 1;
    throw new Error("must not run");
  }, fixedNow);
  assert.equal(invalid.valid, false);
  assert.equal(calls, 0);
});

test("T-Bank credential is constrained to the two exact read URL shapes", () => {
  assert.equal(isAllowedTBankReadRequest(accountsUrl), true);
  const statement = new URL(statementBaseUrl);
  statement.searchParams.set("accountNumber", "40702810900000000001");
  statement.searchParams.set("from", "2026-08-27T12:00:00.000Z");
  statement.searchParams.set("to", "2026-09-03T12:00:00.000Z");
  statement.searchParams.set("limit", "10");
  statement.searchParams.set("withBalances", "false");
  assert.equal(isAllowedTBankReadRequest(statement.toString()), true);
  assert.equal(isAllowedTBankReadRequest(accountsUrl, "POST"), false);
  assert.equal(isAllowedTBankReadRequest("https://business.tbank.ru/openapi/api/v1/payment"), false);
  statement.searchParams.set("limit", "1000");
  assert.equal(isAllowedTBankReadRequest(statement.toString()), false);
});

test("bank provider JSON is bounded even when the response has no content-length", async () => {
  let calls = 0;
  const result = await probeTBankToken(token, async () => {
    calls += 1;
    return new Response(`{"accounts":[]}${" ".repeat(2_000_001)}`, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, fixedNow);
  assert.equal(calls, 1);
  assert.equal(result.valid, false);
  assert.match(result.reason, /некорректный список счетов/i);
});

test("T-Bank egress configuration accepts only public IP literals", () => {
  assert.equal(normalizePublicIntegrationIp("188.225.38.55"), "188.225.38.55");
  assert.equal(normalizePublicIntegrationIp("2a00:1450:4001:81b::200e"), "2a00:1450:4001:81b::200e");
  for (const value of ["", "bank.example", "10.0.0.1", "127.0.0.1", "192.168.1.1", "203.0.113.5", "::1", "fc00::1", "fe80::1", "2001:db8::1"]) {
    assert.equal(normalizePublicIntegrationIp(value), "", value);
  }
});

test("legacy Alfa bank is replaced while AlfaCRM remains", async () => {
  const [catalog, workspace, database] = await Promise.all([
    source("lib/operating-integration-catalog.ts"),
    source("app/components/IntegrationWorkspace.tsx"),
    source("db/index.ts"),
  ]);
  for (const content of [catalog, workspace]) {
    assert.match(content, /INT-T-TBANK/);
    assert.match(content, /Т‑Банк/);
    assert.match(content, /INT-T-ALFACRM/);
    assert.doesNotMatch(content, /\["INT-T-ALFABANK"\s*,\s*"Альфа-Банк"/);
  }
  assert.match(database, /\["INT-T-TBANK"\s*,\s*"Т‑Банк"/);
  assert.doesNotMatch(database, /\["INT-T-ALFABANK"\s*,\s*"Альфа-Банк"/);
  assert.doesNotMatch(catalog, /DELETE FROM integration_connections WHERE id='INT-T-ALFABANK'/);
  assert.match(database, /LEGACY_ALFA_BANK_MIGRATION_VERSION/);
  assert.match(database, /DELETE FROM integration_connections WHERE id='INT-T-ALFABANK'/);
  assert.match(database, /await ensureOperatingIntegrationCatalogState\(\)/);
});

test("T-Bank mutations are owner-only, CSRF-protected and use the AES-GCM vault", async () => {
  const [actions, database] = await Promise.all([
    source("app/api/integration-actions/route.ts"),
    source("db/index.ts"),
  ]);
  assert.match(actions, /protectedBankConnectionIds = new Set\(\[tochkaConnectionId, tbankConnectionId\]\)/);
  assert.match(actions, /protectedBankConnectionIds\.has\(connectionId\) && protectedBankOwnerActions\.has\(action\)/);
  assert.match(actions, /isCanonicalOwnerContext\(requester\)/);
  assert.match(actions, /verifyAuthenticatedRequestCsrf\(request, context\)/);
  assert.match(actions, /probeTBankToken\(credential\)[\s\S]*?saveTBankSetupWithCredential/);
  assert.match(actions, /readTBankIntegrationCredential/);
  assert.match(actions, /revokeBankIntegrationCredential/);
  assert.doesNotMatch(actions, /(?:create|send|execute).*payment/i);

  const saveStart = database.indexOf("export async function saveTBankSetupWithCredential");
  const saveEnd = database.indexOf("export async function hasIntegrationCredential", saveStart);
  const atomicSave = database.slice(saveStart, saveEnd);
  assert.match(atomicSave, /encryptIntegrationCredential/);
  assert.match(atomicSave, /await env\.DB\.batch\(\[/);
  assert.match(atomicSave, /integration\.credential_replaced/);
  assert.match(database, /algorithm:\s*"AES-GCM"/);
  assert.match(database, /crypto\.subtle\.encrypt/);
  assert.match(actions, /setupInput\.readOnlyScopeConfirmed !== true/);
  assert.match(database, /TBANK_BANK_READ_V1/);
  assert.match(database, /const tbankCredentialScope = "bank-read-v1"/);
  assert.match(actions, /`INT-RUN-\$\{crypto\.randomUUID\(\)\.toUpperCase\(\)\}`/);
  assert.doesNotMatch(actions, /randomUUID\(\)\.slice\(0, 8\)/);
});

test("integration dialogs are portaled, keyboard-contained and fully interactive", async () => {
  const [workspace, styles] = await Promise.all([
    source("app/components/IntegrationWorkspace.tsx"),
    source("app/components/IntegrationWorkspace.ds.css"),
  ]);
  assert.equal([...workspace.matchAll(/createPortal\(/g)].length, 3);
  assert.equal([...workspace.matchAll(/className="ahIntegrationModalLayer"/g)].length, 3);
  assert.match(workspace, /event\.key === "Escape"/);
  assert.match(workspace, /event\.key !== "Tab"/);
  assert.match(workspace, /previousFocus\?\.focus\(\)/);
  assert.match(workspace, /document\.body\.style\.overflow = "hidden"/);
  assert.match(workspace, /type="submit"/);
  assert.doesNotMatch(workspace, /<form[^>]*data-ah-help-root/);
  assert.match(styles, /\.ahIntegrationModalLayer\s*\{[\s\S]*?position:\s*fixed[\s\S]*?z-index:\s*2140/);
  assert.match(styles, /\.ahIntegrationModalLayer > \.drawer-scrim/);
  assert.match(styles, /pointer-events:\s*auto/);
});

test("integration cards translate storage identifiers and journal codes for people", async () => {
  const workspace = await source("app/components/IntegrationWorkspace.tsx");
  assert.match(workspace, /recordLabel\("Запуск", run\.id\)/);
  assert.match(workspace, /recordLabel\("Запись источника", item\.externalRecordId\)/);
  assert.match(workspace, /humanOwnerLabel\(current\.ownerEntityId\)/);
  assert.match(workspace, /humanCheckpoint\(run\.checkpoint\)/);
  assert.match(workspace, /humanLogLevel\(log\.level\)/);
  assert.match(workspace, /humanLogEvent\(log\.event\)/);
  assert.doesNotMatch(workspace, /\{(?:current|item)\.ownerEntityId\}/);
  assert.doesNotMatch(workspace, /\{item\.externalRecordId\}/);
  assert.doesNotMatch(workspace, /\{log\.(?:level|event|recordRef)\}/);
  assert.doesNotMatch(workspace, /<p>\{run\.id\}<\/p>|run\.checkpoint\s*\|\|/);
});

test("T-Bank wizard explains production IP allowlisting and returns no stored customer code", async () => {
  const [workspace, integrationsApi, actions] = await Promise.all([
    source("app/components/IntegrationWorkspace.tsx"),
    source("app/api/integrations/route.ts"),
    source("app/api/integration-actions/route.ts"),
  ]);
  assert.match(workspace, /статический исходящий IP основного сервера, на котором работает ArtHello OS/);
  assert.match(workspace, /не адрес вашего компьютера или браузера/);
  assert.match(workspace, /Подтверждённый исходящий IP основного сервера/);
  assert.match(integrationsApi, /bankEgressIp:\s*scopedConnectionIds\.has\("INT-T-TBANK"\) \? configuredBankEgressIp : ""/);
  assert.doesNotMatch(integrationsApi, /configuredBankEgressIp \|\|/);
  assert.match(workspace, /входящий адрес сайта 188\.225\.38\.55 не подтверждает исходящий адрес сервера/);
  assert.match(workspace, /Подтвердите у хостинга, что исходящие запросы ArtHello OS действительно используют этот адрес/);
  assert.match(workspace, /navigator\.clipboard\.writeText\(bankEgressIp\)/);
  assert.match(workspace, /disabled=\{!bankEgressIpConfirmed \|\| !bankEgressIp\}/);
  assert.match(actions, /tbankEgressRequiredActions[\s\S]*?Исходящий IP не подтверждён администратором сервера/);
  assert.match(workspace, /не использовать 90 дней/);
  assert.match(workspace, /https:\/\/developer\.tbank\.ru\/docs\/intro\/manuals\/self-service-auth/);
  assert.match(workspace, /<option value="Bearer token">Токен Т‑Банка<\/option>/);
  assert.match(workspace, /Информация о счетах компании/);
  assert.match(workspace, /Информация об операциях компании/);
  assert.match(workspace, /без прав на платежи/);
  assert.match(workspace, /!readOnlyScopeConfirmed/);

  const publicStart = integrationsApi.indexOf("const publicSetups");
  const publicEnd = integrationsApi.indexOf("return privateJson", publicStart);
  const publicProjection = integrationsApi.slice(publicStart, publicEnd);
  assert.doesNotMatch(publicProjection, /customerCode\s*:/);
  assert.match(publicProjection, /companySelectionConfirmed/);
  assert.match(actions, /createTochkaCompanySelectionHandles\([\s\S]*?candidateProbe\.customerChoices/);
  assert.match(actions, /consumeTochkaCompanySelectionHandle\([\s\S]*?selectedCompany\?\.customerCode/);
  assert.doesNotMatch(actions, /id: String\(index \+ 1\)|`choice:\$\{choiceId\}`/);
  assert.doesNotMatch(actions, /availableCustomerCodes|selectedCustomerCode|bankResolvedCustomerCode/);
  assert.match(integrationsApi, /canAccessAssignedIntegration\(scopeContext, row\.ownerEntityId\)/);
  assert.match(integrationsApi, /allRuns\.filter\(\(row\) => scopedConnectionIds\.has\(row\.connectionId\)\)/);
  assert.match(integrationsApi, /allConflicts\.filter\(\(row\) => scopedConnectionIds\.has\(row\.connectionId\)\)/);
  assert.match(actions, /assignedIntegrationDenial\(context, connectionId\)/);
  assert.match(workspace, /title="Интеграции не назначены"/);
});
