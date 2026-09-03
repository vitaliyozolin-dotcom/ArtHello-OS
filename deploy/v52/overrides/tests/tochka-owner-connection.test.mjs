import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import * as ts from "typescript";
import { canAccessAssignedIntegration, normalizePublicIntegrationIp, probeTochkaJwt, validateTochkaJwt } from "../lib/integrations.ts";

const fixedNow = Date.UTC(2026, 8, 2, 12, 0, 0);
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const customersUrl = "https://enter.tochka.com/uapi/open-banking/v1.0/customers";
const accountsUrl = "https://enter.tochka.com/uapi/open-banking/v1.0/accounts";
let routeImportNonce = 0;

async function loadIntegrationActionsRoute(stubs) {
  const routeSource = await source("app/api/integration-actions/route.ts");
  const lastImport = 'import { resolveTaskAssignment } from "../../../lib/task-access";';
  const lastImportAt = routeSource.indexOf(lastImport);
  assert.ok(lastImportAt > -1, "integration action imports changed");
  const body = routeSource.slice(lastImportAt + lastImport.length);
  const preamble = `
    const {
      consumeTochkaCompanySelectionHandle,commitIntegrationBankProbe,createTochkaCompanySelectionHandles,
      ensureCoreTables,getDb,getIntegrationSetups,readIntegrationCredential,readTBankIntegrationCredential,
      ensureOperatingIntegrationCatalog,
      revokeBankIntegrationCredential,saveIntegrationSetup,saveTBankSetupWithCredential,saveTochkaSetupWithCredential,
      validateIntegrationSetupReferences,canAccessAssignedIntegration,canResolveConflict,normalizePublicIntegrationIp,probeTBankToken,probeTochkaJwt,retryDecision,
      validateTBankToken,validateTochkaJwt,getAuthenticatedRequestContext,isCanonicalOwnerContext,
      verifyAuthenticatedRequestCsrf,canAccessModule,hasTrustedMutationOrigin,getRequestUser,findScopedAutomationTask,scopedAutomationTaskResponse,
      resolveTaskAssignment
    } = globalThis.__ARTHELLO_TOCHKA_ACTION_TEST__;
    const env = globalThis.__ARTHELLO_TOCHKA_ACTION_TEST__.env ?? {};
    const eq = () => ({});
    const auditEvents = {}, entities = { id: {} }, integrationConflicts = { id: {} },
      integrationConnections = { id: {} }, integrationLogEntries = {}, integrationSyncRuns = {},
      tasks = { automationKey: {} };
  `;
  const output = ts.transpileModule(`${preamble}\n${body}`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "integration-actions/route.ts",
    reportDiagnostics: true,
  }).outputText;
  globalThis.__ARTHELLO_TOCHKA_ACTION_TEST__ = stubs;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}#tochka-route-${routeImportNonce++}`);
}

function actionRouteStubs(overrides = {}) {
  return {
    env: {},
    consumeTochkaCompanySelectionHandle: async () => ({ ok: false, reason: "invalid selection" }),
    commitIntegrationBankProbe: async () => false,
    createTochkaCompanySelectionHandles: async () => [],
    ensureCoreTables: async () => {},
    ensureOperatingIntegrationCatalog: async () => {},
    getDb: () => { throw new Error("database must not be reached"); },
    getIntegrationSetups: async () => ({}),
    readIntegrationCredential: async () => { throw new Error("credential must not be read"); },
    readTBankIntegrationCredential: async () => { throw new Error("credential must not be read"); },
    revokeBankIntegrationCredential: async () => null,
    saveIntegrationSetup: async () => { throw new Error("setup must not be saved"); },
    saveTBankSetupWithCredential: async () => { throw new Error("credential must not be saved"); },
    saveTochkaSetupWithCredential: async () => { throw new Error("credential must not be saved"); },
    validateIntegrationSetupReferences: async () => {},
    canAccessAssignedIntegration,
    canResolveConflict: () => false,
    normalizePublicIntegrationIp,
    probeTBankToken: async () => { throw new Error("bank discovery must not run"); },
    probeTochkaJwt: async () => { throw new Error("bank discovery must not run"); },
    retryDecision: () => ({ allowed: false, reason: "blocked" }),
    validateTBankToken: () => ({ valid: false, reason: "invalid" }),
    validateTochkaJwt: () => ({ valid: false, reason: "invalid" }),
    getAuthenticatedRequestContext: async () => null,
    isCanonicalOwnerContext: () => false,
    verifyAuthenticatedRequestCsrf: () => { throw new Error("csrf"); },
    canAccessModule: () => true,
    hasTrustedMutationOrigin: () => true,
    getRequestUser: () => "HEADER-ACTOR",
    findScopedAutomationTask: async () => ({ state: "missing" }),
    scopedAutomationTaskResponse: () => null,
    resolveTaskAssignment: () => ({ ok: true, assigneeEntityId: "USR-OWNER", owner: "Owner" }),
    ...overrides,
  };
}

function integrationActionRequest(action, role = "OWNER", csrf = "csrf-ok", connectionId = "INT-T-TOCHKA") {
  return new Request("https://example.test/api/integration-actions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.test",
      "x-arthello-role": role,
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    body: JSON.stringify({ action, connectionId }),
  });
}

class CredentialD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new CredentialD1Statement(this.database, this.sql, bindings);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.bindings) };
  }
}

class CredentialD1Database {
  constructor() {
    this.database = new DatabaseSync(":memory:");
  }

  prepare(sql) {
    return new CredentialD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

async function loadCredentialDbModule(database) {
  let databaseSource = await source("db/index.ts");
  const replacements = [
    ['import { env } from "cloudflare:workers";', "const env = globalThis.__ARTHELLO_TOCHKA_DB_ENV__;"],
    ['import { drizzle } from "drizzle-orm/d1";', "const drizzle = () => { throw new Error('drizzle not used'); };"],
    ['import { entityDuplicateKey, manualEntityNormalization } from "../lib/entity-provenance";', "const entityDuplicateKey = () => ''; const manualEntityNormalization = () => null;"],
    ['import { ensureOperatingIntegrationCatalog } from "../lib/operating-integration-catalog";', "const ensureOperatingIntegrationCatalog = async () => {};"],
    ['import * as schema from "./schema";', "const schema = {};"],
  ];
  for (const [search, replacement] of replacements) {
    assert.ok(databaseSource.includes(search), `database import changed: ${search}`);
    databaseSource = databaseSource.replace(search, replacement);
  }
  globalThis.__ARTHELLO_TOCHKA_DB_ENV__ = {
    DB: database,
    INTEGRATION_CREDENTIALS_KEY: "focused-test-dedicated-key-material-32-bytes-minimum",
  };
  const output = ts.transpileModule(databaseSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "db/index.ts",
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}#tochka-db-${routeImportNonce++}`);
}

function createCredentialSchema(database) {
  database.database.exec(`
    CREATE TABLE system_runtime_state (
      state_key TEXT PRIMARY KEY NOT NULL,
      state_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE integration_connections (
      id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL DEFAULT 'Ожидает доступ',
      auth_status TEXT NOT NULL DEFAULT '',
      credential_expires_at TEXT NOT NULL DEFAULT '',
      last_success_at TEXT NOT NULL DEFAULT '',
      next_sync_at TEXT NOT NULL DEFAULT '',
      received_count INTEGER NOT NULL DEFAULT 0,
      accepted_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      verified_transfer INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE integration_sync_runs (
      id TEXT PRIMARY KEY NOT NULL, connection_id TEXT NOT NULL, started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '', trigger TEXT NOT NULL, status TEXT NOT NULL,
      received_count INTEGER NOT NULL DEFAULT 0, accepted_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0,
      conflict_count INTEGER NOT NULL DEFAULT 0, checkpoint TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '', initiated_by TEXT NOT NULL,
      correlation_id TEXT NOT NULL, dry_run INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE integration_log_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, run_id TEXT NOT NULL,
      connection_id TEXT NOT NULL, level TEXT NOT NULL, event TEXT NOT NULL,
      message TEXT NOT NULL, record_ref TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE entities (id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL);
    CREATE TABLE organization_branches (id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL);
    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    INSERT INTO integration_connections (id) VALUES ('INT-T-TOCHKA');
    INSERT INTO entities (id,entity_type) VALUES ('ORG-LIVE-1','Юрлицо'),('ORG-LIVE-2','Юрлицо');
    INSERT INTO organization_branches (id,status) VALUES ('BR-LIVE','Активен');
  `);
}

function credentialSetup(legalEntityId, customerCode) {
  return {
    connectionId: "INT-T-TOCHKA",
    authMethod: "JWT",
    startDate: "",
    syncIntervalMinutes: 0,
    syncMinute: 0,
    endpoint: "",
    legalEntityId,
    customerCode,
    branchId: "",
    allocationMode: "classify_transactions",
    accountScope: "all_permitted",
    channelType: "",
    sourceMapping: "",
    dataScopes: ["Счета"],
  };
}

function makeJwt(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "tochka-owner-test",
    exp: Math.floor(fixedNow / 1000) + 3600,
    ...overrides,
  })).toString("base64url");
  const signature = Buffer.alloc(48, 7).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

test("Tochka JWT validation enforces structure and lifetime without exposing the token", () => {
  const token = makeJwt();
  const valid = validateTochkaJwt(token, fixedNow);
  assert.equal(valid.valid, true);
  assert.equal(valid.expiresAt, new Date(fixedNow + 3_600_000).toISOString());
  assert.doesNotMatch(JSON.stringify(valid), new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const expiredToken = makeJwt({ exp: Math.floor(fixedNow / 1000) - 60 });
  const expired = validateTochkaJwt(expiredToken, fixedNow);
  assert.equal(expired.valid, false);
  assert.match(expired.reason, /ист[её]к/i);
  assert.doesNotMatch(JSON.stringify(expired), new RegExp(expiredToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const malformed = validateTochkaJwt("not-a-jwt", fixedNow);
  assert.equal(malformed.valid, false);
});

test("Tochka probe resolves one customer before accounts and returns only safe aggregate data", async () => {
  const token = makeJwt();
  const calls = [];
  const result = await probeTochkaJwt(token, async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input) === customersUrl) {
      return new Response(JSON.stringify({
        Data: { Customer: [{ customerCode: "customer-arthello", shortName: "АртХелло" }] },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      Data: {
        Account: [
          { accountId: "account-school", balance: "1000" },
          { accountId: "account-kindergarten", balance: "2000" },
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, fixedNow);

  assert.deepEqual(calls.map(({ url }) => url), [customersUrl, accountsUrl]);
  for (const { init } of calls) {
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
  }
  assert.deepEqual(result, {
    valid: true,
    reason: "Ключ и выбранная компания подтверждены Точкой",
    expiresAt: new Date(fixedNow + 3_600_000).toISOString(),
    accountCount: 2,
    accountCountScope: "all_permitted",
    customerCode: "customer-arthello",
    customerChoices: [],
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /account-school|account-kindergarten/);
  assert.equal(serialized.includes(token), false);
});

test("Tochka probe requires an explicit customerCode when JWT exposes multiple customers", async () => {
  const token = makeJwt();
  const calls = [];
  const result = await probeTochkaJwt(token, async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({
      Data: {
        Customer: [
          { customerCode: "customer-school", shortName: "Школа" },
          { CustomerCode: "customer-kindergarten", ShortName: "Садик" },
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, fixedNow);

  assert.equal(result.valid, false);
  assert.match(result.reason, /нескольким компаниям/i);
  assert.equal(result.accountCount, 0);
  assert.equal(result.accountCountScope, "none");
  assert.equal(result.customerCode, "");
  assert.deepEqual(result.customerChoices, [
    { code: "customer-school", name: "Школа" },
    { code: "customer-kindergarten", name: "Садик" },
  ]);
  assert.deepEqual(calls, [customersUrl], "accounts must not be requested before the owner selects a customerCode");
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("Tochka probe fails safely when the bank returns no customerCode", async () => {
  const token = makeJwt();
  const calls = [];
  const result = await probeTochkaJwt(token, async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ Data: { Customer: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, fixedNow);

  assert.equal(result.valid, false);
  assert.match(result.reason, /доступных компаний нет/i);
  assert.equal(result.accountCountScope, "none");
  assert.equal(result.customerCode, "");
  assert.deepEqual(result.customerChoices, []);
  assert.deepEqual(calls, [customersUrl]);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("Tochka probe rejects a requested customerCode not granted to the JWT", async () => {
  const token = makeJwt();
  const calls = [];
  const result = await probeTochkaJwt(token, async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({
      Data: {
        Customer: [
          { customerCode: "customer-school", shortName: "Школа" },
          { customerCode: "customer-kindergarten", shortName: "Садик" },
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, fixedNow, "customer-not-granted");

  assert.equal(result.valid, false);
  assert.match(result.reason, /компания не доступна/i);
  assert.equal(result.accountCountScope, "none");
  assert.equal(result.customerCode, "");
  assert.deepEqual(result.customerChoices.map(({ code }) => code), [
    "customer-school",
    "customer-kindergarten",
  ]);
  assert.deepEqual(calls, [customersUrl], "accounts must not be requested for a foreign customerCode");
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("Tochka probe counts only accounts of the selected customer when every account is scoped", async () => {
  const token = makeJwt();
  const accountIds = ["account-school-1", "account-school-2", "account-kindergarten-1"];
  const calls = [];
  const result = await probeTochkaJwt(token, async (input) => {
    calls.push(String(input));
    if (String(input) === customersUrl) {
      return new Response(JSON.stringify({
        Data: {
          Customer: [
            { customerCode: "customer-school", shortName: "Школа" },
            { customerCode: "customer-kindergarten", shortName: "Садик" },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      Data: {
        Account: [
          { accountId: accountIds[0], customerCode: "customer-school" },
          { accountId: accountIds[1], CustomerCode: "customer-school" },
          { accountId: accountIds[2], customer_code: "customer-kindergarten" },
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, fixedNow, "customer-school");

  assert.equal(result.valid, true);
  assert.equal(result.customerCode, "customer-school");
  assert.equal(result.accountCount, 2);
  assert.equal(result.accountCountScope, "selected_customer");
  assert.deepEqual(result.customerChoices, []);
  assert.deepEqual(calls, [customersUrl, accountsUrl]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(token), false);
  for (const accountId of accountIds) assert.equal(serialized.includes(accountId), false);
});

test("Tochka probe uses all_permitted count when account customerCode is absent or incomplete", async () => {
  const token = makeJwt();
  const accountIds = ["account-school", "account-unscoped", "account-kindergarten"];
  const result = await probeTochkaJwt(token, async (input) => {
    if (String(input) === customersUrl) {
      return new Response(JSON.stringify({
        Data: { Customer: [{ customerCode: "customer-school", shortName: "Школа" }] },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      Data: {
        Account: [
          { accountId: accountIds[0], customerCode: "customer-school" },
          { accountId: accountIds[1] },
          { accountId: accountIds[2], customerCode: "customer-kindergarten" },
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, fixedNow);

  assert.equal(result.valid, true);
  assert.equal(result.customerCode, "customer-school");
  assert.equal(result.accountCount, 3);
  assert.equal(result.accountCountScope, "all_permitted");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(token), false);
  for (const accountId of accountIds) assert.equal(serialized.includes(accountId), false);
});

test("Tochka probe rejects a successful response when no supported account array contains accounts", async () => {
  const token = makeJwt();
  for (const payload of [{ Data: { Account: [] } }, { Data: { Accounts: [] } }]) {
    const result = await probeTochkaJwt(token, async (input) => new Response(
      JSON.stringify(String(input) === customersUrl
        ? { Data: { Customer: [{ customerCode: "customer-arthello" }] } }
        : payload),
      { status: 200, headers: { "content-type": "application/json" } },
    ), fixedNow);
    assert.deepEqual(result, {
      valid: false,
      reason: "Ключ Точки подтверждён, но доступных счетов нет",
      expiresAt: new Date(fixedNow + 3_600_000).toISOString(),
      accountCount: 0,
      accountCountScope: "none",
      customerCode: "customer-arthello",
      customerChoices: [],
    });
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});

test("Tochka probe discards provider and network errors even when they echo the JWT", async () => {
  const token = makeJwt();
  const providerFailure = await probeTochkaJwt(token, async () => new Response(
    JSON.stringify({ error: `Rejected ${token}`, token }),
    { status: 401, headers: { "content-type": "application/json" } },
  ), fixedNow);
  assert.deepEqual(providerFailure, {
    valid: false,
    reason: "Точка отклонила ключ",
    expiresAt: new Date(fixedNow + 3_600_000).toISOString(),
    accountCount: 0,
    accountCountScope: "none",
    customerCode: "",
    customerChoices: [],
  });
  assert.equal(JSON.stringify(providerFailure).includes(token), false);

  const networkFailure = await probeTochkaJwt(token, async () => {
    throw new Error(`transport echoed ${token}`);
  }, fixedNow);
  assert.equal(networkFailure.valid, false);
  assert.equal(networkFailure.reason, "Не удалось связаться с Точкой");
  assert.equal(JSON.stringify(networkFailure).includes(token), false);
});

test("owner credential UI is masked, transient and sends the production CSRF token", async () => {
  const [workspace, helpDom, helpSystem] = await Promise.all([
    source("app/components/IntegrationWorkspace.tsx"),
    source("app/components/contextualHelpDom.ts"),
    source("app/components/ContextualHelpSystem.tsx"),
  ]);
  assert.match(workspace, /Ключ Точки[\s\S]*?<input\s+type="password"/);
  assert.match(workspace, /autoComplete="off"/);
  assert.match(workspace, /body:\s*JSON\.stringify\(body\)/);
  assert.match(workspace, /"x-csrf-token"\s*:\s*readClientCookie\("__Host-arthello_csrf"\)/);
  assert.doesNotMatch(workspace, /(?:window\.)?(?:localStorage|sessionStorage)/);
  assert.equal([...workspace.matchAll(/createPortal\(/g)].length, 3);
  assert.match(workspace, /className="ahIntegrationModalLayer"/);
  assert.match(workspace, /event\.key === "Escape"/);
  assert.match(workspace, /previousFocus\?\.focus\(\)/);
  assert.doesNotMatch(workspace, /\.chatgpt\.site/i);
  assert.match(workspace, /className="setup-wizard ahIntegrationSetupWizard" data-ah-help-root="true"/);
  assert.match(helpDom, /if \(element\.closest\("\[data-ah-help-root\]/);
  assert.doesNotMatch(helpSystem, /fieldMarkers|data-ah-help-inline|ah-field-icon/);
});

test("all Tochka mutations and bank discovery require the canonical owner with CSRF verification", async () => {
  const [actions, integrationsApi] = await Promise.all([
    source("app/api/integration-actions/route.ts"),
    source("app/api/integrations/route.ts"),
  ]);
  assert.match(actions, /const protectedBankOwnerActions = new Set\(\[[\s\S]*?"saveSetup"[\s\S]*?"testConnection"[\s\S]*?"retrySync"[\s\S]*?"pauseConnection"[\s\S]*?"resumeConnection"[\s\S]*?"revokeCredential"/);
  assert.match(actions, /hasTrustedMutationOrigin\(request, publicOrigin\)/);
  assert.match(actions, /canAccessModule\(\{[\s\S]*?allowedModules: context\.auth\.user\.allowedModules[\s\S]*?\}, "integrations"\)/);
  assert.match(actions, /context = await getAuthenticatedRequestContext\(request\)[\s\S]*?!editors\.has\(context\.apiRole\)/);
  assert.match(actions, /verifyAuthenticatedRequestCsrf\(request, context\)[\s\S]*?protectedBankConnectionIds\.has\(connectionId\) && protectedBankOwnerActions\.has\(action\)[\s\S]*?authorizeBankOwnerMutation\(context, connectionId\)[\s\S]*?await ensureCoreTables\(\)/);
  assert.match(actions, /function authorizeBankOwnerMutation\(requester: RequestContext, connectionId: string\)/);
  assert.match(actions, /if \(!isCanonicalOwnerContext\(requester\)\)/);
  assert.match(actions, /verifyAuthenticatedRequestCsrf\(request, context\)/);
  assert.match(actions, /connectionId === tochkaConnectionId && setupInput\.authMethod !== "JWT"/);
  assert.doesNotMatch(actions, /console\.(?:error|warn|log)\([^,\n]+,\s*(?:error|body|credential|token)\b/);

  assert.match(integrationsApi, /getAuthenticatedRequestContext/);
  assert.match(integrationsApi, /canAccessModule\(\{[\s\S]*?allowedModules: requester\.auth\.user\.allowedModules[\s\S]*?\}, "integrations"\)/);
  assert.match(integrationsApi, /isCanonicalOwnerContext/);
  assert.match(integrationsApi, /canManageCredentials/);
  assert.match(integrationsApi, /canManageTochka:\s*canManageCredentials/);
  assert.match(integrationsApi, /canManageTBank:\s*canManageCredentials/);
});

test("a non-owner cannot reuse either stored bank key for discovery or revoke it", async () => {
  let ensureCalls = 0;
  let credentialReads = 0;
  let bankCalls = 0;
  let revokeCalls = 0;
  let csrfCalls = 0;
  const route = await loadIntegrationActionsRoute(actionRouteStubs({
    ensureCoreTables: async () => { ensureCalls += 1; },
    getAuthenticatedRequestContext: async () => ({
      actor: "DIRECTOR-LIVE",
      apiRole: "DIRECTOR",
      auth: { user: { isSystemOwner: false, canAccessMedical: false, allowedModules: ["integrations"] } },
    }),
    isCanonicalOwnerContext: () => false,
    verifyAuthenticatedRequestCsrf: () => { csrfCalls += 1; },
    readIntegrationCredential: async () => { credentialReads += 1; return makeJwt(); },
    readTBankIntegrationCredential: async () => { credentialReads += 1; return "tbank-token"; },
    probeTochkaJwt: async () => { bankCalls += 1; throw new Error("must not run"); },
    probeTBankToken: async () => { bankCalls += 1; throw new Error("must not run"); },
    revokeBankIntegrationCredential: async () => { revokeCalls += 1; return null; },
  }));
  try {
    for (const connectionId of ["INT-T-TOCHKA", "INT-T-TBANK"]) {
      for (const action of ["testConnection", "retrySync", "revokeCredential", "pauseConnection", "resumeConnection"]) {
        const response = await route.POST(integrationActionRequest(action, "DIRECTOR", "csrf-ok", connectionId));
        assert.equal(response.status, 403, `${action} must be owner-only for ${connectionId}`);
        assert.match((await response.json()).error, /только собственнику/i);
      }
    }
    assert.equal(ensureCalls, 0, "denial happens before the integration runtime is touched");
    assert.equal(credentialReads, 0, "a non-owner must never decrypt the owner's JWT");
    assert.equal(bankCalls, 0, "a non-owner must never start bank discovery");
    assert.equal(revokeCalls, 0, "a non-owner must never delete the credential");
    assert.equal(csrfCalls, 10, "every mutating request is CSRF-checked before bank-specific authorization");
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_ACTION_TEST__;
  }
});

test("every integration action is CSRF-protected before runtime work", async () => {
  let csrfCalls = 0;
  let ensureCalls = 0;
  const route = await loadIntegrationActionsRoute(actionRouteStubs({
    getAuthenticatedRequestContext: async () => ({
      actor: "INTEGRATOR-LIVE",
      apiRole: "INTEGRATIONS",
      auth: { user: { isSystemOwner: false, canAccessMedical: false, allowedModules: ["integrations"] } },
    }),
    verifyAuthenticatedRequestCsrf: () => { csrfCalls += 1; throw new Error("csrf"); },
    ensureCoreTables: async () => { ensureCalls += 1; },
  }));
  try {
    for (const action of ["saveSetup", "testConnection", "retrySync", "pauseConnection", "resumeConnection", "createConflictTask", "resolveConflict"]) {
      const response = await route.POST(integrationActionRequest(action, "INTEGRATIONS", "", "INT-T-ALFACRM"));
      assert.equal(response.status, 403, `${action} must reject a missing CSRF token`);
      assert.match((await response.json()).error, /защитная сессия/i);
    }
    assert.equal(csrfCalls, 7);
    assert.equal(ensureCalls, 0, "CSRF denial happens before integration tables or providers are touched");
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_ACTION_TEST__;
  }
});

test("an explicit integrations module removal closes the mutation API", async () => {
  let csrfCalls = 0;
  let ensureCalls = 0;
  const route = await loadIntegrationActionsRoute(actionRouteStubs({
    getAuthenticatedRequestContext: async () => ({
      actor: "OWNER-LIVE",
      apiRole: "OWNER",
      auth: { user: { isSystemOwner: true, canAccessMedical: false, allowedModules: ["finance"] } },
    }),
    canAccessModule: () => false,
    verifyAuthenticatedRequestCsrf: () => { csrfCalls += 1; },
    ensureCoreTables: async () => { ensureCalls += 1; },
  }));
  try {
    const response = await route.POST(integrationActionRequest("testConnection"));
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /раздел интеграций не назначен/i);
    assert.equal(csrfCalls, 0);
    assert.equal(ensureCalls, 0);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_ACTION_TEST__;
  }
});

test("a user cannot run any direct action for an integration assigned to another scope", async () => {
  let handlerCalls = 0;
  const scopedDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ ownerEntityId: "ROLE:MARKETING" }],
        }),
      }),
    }),
  };
  const route = await loadIntegrationActionsRoute(actionRouteStubs({
    getAuthenticatedRequestContext: async () => ({
      actor: "integrator@example.test",
      apiRole: "INTEGRATIONS",
      appUserId: "USR-INT",
      auth: { user: { isSystemOwner: false, canAccessMedical: false, allowedModules: ["integrations"] } },
    }),
    verifyAuthenticatedRequestCsrf: () => {},
    getDb: () => scopedDb,
    saveIntegrationSetup: async () => { handlerCalls += 1; throw new Error("must not run"); },
  }));
  try {
    for (const action of ["saveSetup", "testConnection", "retrySync", "pauseConnection", "resumeConnection", "revokeCredential"]) {
      const body = action === "saveSetup"
        ? { action, setup: { connectionId: "INT-T-FORMS" } }
        : { action, connectionId: "INT-T-FORMS" };
      const response = await route.POST(new Request("https://example.test/api/integration-actions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.test", "x-csrf-token": "csrf-ok" },
        body: JSON.stringify(body),
      }));
      assert.equal(response.status, 403, action);
      assert.match((await response.json()).error, /интеграция не назначена/i);
    }
    assert.equal(handlerCalls, 0);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_ACTION_TEST__;
  }
});

test("conflict actions inherit the assignment of their integration", async () => {
  let selectCalls = 0;
  const scopedDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCalls += 1;
            return selectCalls % 2 === 1
              ? [{ id: "INT-CNF-FOREIGN", connectionId: "INT-T-FORMS" }]
              : [{ ownerEntityId: "ROLE:MARKETING" }];
          },
        }),
      }),
    }),
  };
  const route = await loadIntegrationActionsRoute(actionRouteStubs({
    getAuthenticatedRequestContext: async () => ({
      actor: "integrator@example.test",
      apiRole: "INTEGRATIONS",
      appUserId: "USR-INT",
      auth: { user: { isSystemOwner: false, canAccessMedical: false, allowedModules: ["integrations"] } },
    }),
    verifyAuthenticatedRequestCsrf: () => {},
    getDb: () => scopedDb,
    canResolveConflict: () => true,
  }));
  try {
    for (const action of ["createConflictTask", "resolveConflict"]) {
      const response = await route.POST(new Request("https://example.test/api/integration-actions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.test", "x-csrf-token": "csrf-ok" },
        body: JSON.stringify({
          action,
          conflictId: "INT-CNF-FOREIGN",
          resolution: "Сверено владельцем",
          evidence: "Акт сверки №0001",
        }),
      }));
      assert.equal(response.status, 403, action);
      assert.match((await response.json()).error, /интеграция не назначена/i);
    }
    assert.equal(selectCalls, 4);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_ACTION_TEST__;
  }
});

test("integration mutations reject a foreign page origin before authentication", async () => {
  let authCalls = 0;
  const route = await loadIntegrationActionsRoute(actionRouteStubs({
    hasTrustedMutationOrigin: () => false,
    getAuthenticatedRequestContext: async () => { authCalls += 1; return null; },
  }));
  try {
    const response = await route.POST(integrationActionRequest("retrySync", "INTEGRATIONS"));
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /источник страницы не совпадает/i);
    assert.equal(authCalls, 0);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_ACTION_TEST__;
  }
});

test("T-Bank save and checks fail closed before runtime work without a confirmed egress IP", async () => {
  let ensureCalls = 0;
  let credentialReads = 0;
  let bankCalls = 0;
  const route = await loadIntegrationActionsRoute(actionRouteStubs({
    env: {},
    getAuthenticatedRequestContext: async () => ({
      actor: "OWNER-LIVE",
      apiRole: "OWNER",
      auth: { user: { isSystemOwner: true, canAccessMedical: false, allowedModules: ["integrations"] } },
    }),
    isCanonicalOwnerContext: () => true,
    verifyAuthenticatedRequestCsrf: () => {},
    ensureCoreTables: async () => { ensureCalls += 1; },
    readTBankIntegrationCredential: async () => { credentialReads += 1; return "never"; },
    probeTBankToken: async () => { bankCalls += 1; throw new Error("must not run"); },
  }));
  try {
    const requests = [
      integrationActionRequest("testConnection", "OWNER", "csrf-ok", "INT-T-TBANK"),
      integrationActionRequest("retrySync", "OWNER", "csrf-ok", "INT-T-TBANK"),
      new Request("https://example.test/api/integration-actions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.test", "x-csrf-token": "csrf-ok" },
        body: JSON.stringify({ action: "saveSetup", setup: { connectionId: "INT-T-TBANK" } }),
      }),
    ];
    for (const request of requests) {
      const response = await route.POST(request);
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /Исходящий IP не подтверждён администратором сервера/i);
    }
    assert.equal(ensureCalls, 0);
    assert.equal(credentialReads, 0);
    assert.equal(bankCalls, 0);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_ACTION_TEST__;
  }
});

test("owner credential deletion is CSRF-protected, local-only and never returns the key", async () => {
  let ensureCalls = 0;
  let revokeCalls = 0;
  let csrfCalls = 0;
  let revokedBy = "";
  const route = await loadIntegrationActionsRoute(actionRouteStubs({
    ensureCoreTables: async () => { ensureCalls += 1; },
    getAuthenticatedRequestContext: async () => ({
      actor: "OWNER-LIVE",
      apiRole: "OWNER",
      appUserId: "USR-OWNER",
      auth: { user: { isSystemOwner: true, canAccessMedical: false, allowedModules: ["integrations"] } },
    }),
    isCanonicalOwnerContext: (context) => context.apiRole === "OWNER",
    verifyAuthenticatedRequestCsrf: (request) => {
      csrfCalls += 1;
      if (request.headers.get("x-csrf-token") !== "csrf-ok") throw new Error("csrf");
    },
    revokeBankIntegrationCredential: async (actor) => {
      revokeCalls += 1;
      revokedBy = actor;
      return { connectionId: "INT-T-TOCHKA", secretStatus: "missing" };
    },
  }));
  try {
    const rejected = await route.POST(integrationActionRequest("revokeCredential", "OWNER", ""));
    assert.equal(rejected.status, 403);
    assert.equal(revokeCalls, 0);
    assert.equal(ensureCalls, 0);

    const accepted = await route.POST(integrationActionRequest("revokeCredential"));
    assert.equal(accepted.status, 200);
    const payload = await accepted.json();
    assert.equal(payload.setup.secretStatus, "missing");
    assert.match(payload.message, /удалён только из ArtHello OS/i);
    assert.match(payload.message, /отзовите его в личном кабинете Точки/i);
    assert.doesNotMatch(JSON.stringify(payload), /eyJ[A-Za-z0-9_-]+\./);
    assert.equal(revokeCalls, 1);
    assert.equal(ensureCalls, 1);
    assert.equal(csrfCalls, 2);
    assert.equal(revokedBy, "OWNER-LIVE", "the audit actor comes from the canonical session");
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_ACTION_TEST__;
  }
});

test("credential rotation and revoke are atomic, scoped and leave no orphan JWT", async () => {
  const database = new CredentialD1Database();
  createCredentialSchema(database);
  const dbModule = await loadCredentialDbModule(database);
  const firstToken = makeJwt({ iss: "first-key" });
  const secondToken = makeJwt({ iss: "second-key" });
  try {
    const first = await dbModule.saveTochkaSetupWithCredential(
      "OWNER-LIVE",
      credentialSetup("ORG-LIVE-1", "customer-one"),
      firstToken,
      null,
    );
    assert.equal(first.secretStatus, "stored");
    let credentialRows = database.database.prepare(
      "SELECT state_key,state_value FROM system_runtime_state WHERE state_key LIKE 'integration_credential:v2:%'",
    ).all();
    assert.equal(credentialRows.length, 1);
    assert.equal(JSON.stringify(credentialRows).includes(firstToken), false, "plaintext JWT is never persisted");

    const second = await dbModule.saveTochkaSetupWithCredential(
      "OWNER-LIVE",
      credentialSetup("ORG-LIVE-2", "customer-two"),
      secondToken,
      first,
    );
    assert.equal(second.legalEntityId, "ORG-LIVE-2");
    credentialRows = database.database.prepare(
      "SELECT state_key,state_value FROM system_runtime_state WHERE state_key LIKE 'integration_credential:v2:%'",
    ).all();
    assert.equal(credentialRows.length, 1, "atomic rebind removes every prior connection credential");
    assert.match(credentialRows[0].state_key, /ORG-LIVE-2:customer-two$/);
    assert.equal(JSON.stringify(credentialRows).includes(firstToken), false);
    assert.equal(JSON.stringify(credentialRows).includes(secondToken), false);

    const revoked = await dbModule.revokeTochkaIntegrationCredential("OWNER-LIVE");
    assert.equal(revoked.secretStatus, "missing");
    assert.equal(database.database.prepare(
      "SELECT COUNT(*) AS total FROM system_runtime_state WHERE state_key LIKE 'integration_credential:v2:%'",
    ).get().total, 0);
    const connection = database.database.prepare(
      "SELECT status,auth_status,verified_transfer,is_enabled FROM integration_connections WHERE id='INT-T-TOCHKA'",
    ).get();
    assert.deepEqual({ ...connection }, {
      status: "Ожидает доступ",
      auth_status: "Ключ Точки удалён из ArtHello OS владельцем",
      verified_transfer: 0,
      is_enabled: 0,
    });
    const audits = database.database.prepare("SELECT action,payload FROM audit_events ORDER BY id").all();
    assert.deepEqual(audits.map((row) => row.action), [
      "integration.setup_saved",
      "integration.credential_replaced",
      "integration.setup_saved",
      "integration.credential_replaced",
      "integration.credential_deleted_locally",
    ]);
    assert.equal(JSON.stringify(audits).includes(firstToken), false);
    assert.equal(JSON.stringify(audits).includes(secondToken), false);

    const lateSave = await dbModule.saveTochkaSetupWithCredential(
      "OWNER-LIVE",
      credentialSetup("ORG-LIVE-2", "customer-two"),
      makeJwt({ iss: "late-after-delete" }),
      second,
    );
    assert.equal(lateSave, null, "a late bank response cannot undo a newer credential deletion");
    assert.equal(database.database.prepare(
      "SELECT COUNT(*) AS total FROM system_runtime_state WHERE state_key LIKE 'integration_credential:v2:%'",
    ).get().total, 0);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_DB_ENV__;
    database.close();
  }
});

test("a current bank probe commits its run, log, connection state and audit together", async () => {
  const database = new CredentialD1Database();
  createCredentialSchema(database);
  const dbModule = await loadCredentialDbModule(database);
  const token = makeJwt({ iss: "current-probe" });
  try {
    const setup = await dbModule.saveTochkaSetupWithCredential(
      "OWNER-LIVE", credentialSetup("ORG-LIVE-1", "customer-one"), token, null,
    );
    assert.ok(setup);
    const committed = await dbModule.commitIntegrationBankProbe("OWNER-LIVE", setup, {
      valid: true,
      runId: "INT-RUN-CURRENT",
      correlationId: "CORR-CURRENT",
      occurredAt: new Date(fixedNow).toISOString(),
      trigger: "Current provider response",
      reason: "ok",
      receivedCount: 2,
      checkpoint: "accounts:2",
      logEvent: "tochka.accounts_verified",
      logMessage: "two accounts",
      logRecordRef: "accounts:selected-customer",
      successStatus: "Доступ к счетам подтверждён",
      successAuthStatus: "Ключ и компания подтверждены",
      failureAuthStatus: "Проверка не пройдена",
      credentialExpiresAt: new Date(fixedNow + 3_600_000).toISOString(),
      auditAction: "integration.tochka_accounts_verified",
      auditPayload: { accountCount: 2 },
    });
    assert.equal(committed, true);
    assert.deepEqual({ ...database.database.prepare(
      "SELECT status,received_count,accepted_count,verified_transfer,is_enabled FROM integration_connections WHERE id='INT-T-TOCHKA'",
    ).get() }, {
      status: "Доступ к счетам подтверждён",
      received_count: 0,
      accepted_count: 0,
      verified_transfer: 0,
      is_enabled: 0,
    });
    assert.equal(database.database.prepare(
      "SELECT COUNT(*) AS total FROM integration_sync_runs WHERE id='INT-RUN-CURRENT'",
    ).get().total, 1);
    assert.equal(database.database.prepare(
      "SELECT COUNT(*) AS total FROM integration_log_entries WHERE run_id='INT-RUN-CURRENT'",
    ).get().total, 1);
    assert.equal(database.database.prepare(
      "SELECT COUNT(*) AS total FROM audit_events WHERE action='integration.tochka_accounts_verified'",
    ).get().total, 1);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_DB_ENV__;
    database.close();
  }
});

test("a stale bank probe cannot overwrite a newer credential deletion", async () => {
  const database = new CredentialD1Database();
  createCredentialSchema(database);
  const dbModule = await loadCredentialDbModule(database);
  const token = makeJwt({ iss: "stale-probe" });
  try {
    const setup = await dbModule.saveTochkaSetupWithCredential(
      "OWNER-LIVE", credentialSetup("ORG-LIVE-1", "customer-one"), token, null,
    );
    assert.ok(setup);
    await dbModule.revokeTochkaIntegrationCredential("OWNER-LIVE");
    const committed = await dbModule.commitIntegrationBankProbe("OWNER-LIVE", setup, {
      valid: true,
      runId: "INT-RUN-STALE",
      correlationId: "CORR-STALE",
      occurredAt: new Date(fixedNow).toISOString(),
      trigger: "Late provider response",
      reason: "ok",
      receivedCount: 1,
      checkpoint: "accounts:1",
      logEvent: "tochka.accounts_verified",
      logMessage: "one account",
      logRecordRef: "accounts:selected-customer",
      successStatus: "Доступ к счетам подтверждён",
      successAuthStatus: "Ключ и компания подтверждены",
      failureAuthStatus: "Проверка не пройдена",
      credentialExpiresAt: new Date(fixedNow + 3_600_000).toISOString(),
      auditAction: "integration.tochka_accounts_verified",
      auditPayload: { accountCount: 1 },
    });
    assert.equal(committed, false);
    assert.equal(database.database.prepare("SELECT COUNT(*) AS total FROM integration_sync_runs").get().total, 0);
    assert.equal(database.database.prepare("SELECT COUNT(*) AS total FROM integration_log_entries").get().total, 0);
    const connection = database.database.prepare(
      "SELECT status,auth_status FROM integration_connections WHERE id='INT-T-TOCHKA'",
    ).get();
    assert.equal(connection.status, "Ожидает доступ");
    assert.match(connection.auth_status, /удалён из ArtHello OS/i);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_DB_ENV__;
    database.close();
  }
});

test("saving bank settings bumps the credential generation and rejects an older probe", async () => {
  const database = new CredentialD1Database();
  createCredentialSchema(database);
  const dbModule = await loadCredentialDbModule(database);
  const token = makeJwt({ iss: "settings-generation" });
  try {
    const before = await dbModule.saveTochkaSetupWithCredential(
      "OWNER-LIVE", credentialSetup("ORG-LIVE-1", "customer-one"), token, null,
    );
    assert.ok(before);
    const after = await dbModule.saveIntegrationSetup(
      "OWNER-LIVE",
      { ...credentialSetup("ORG-LIVE-1", "customer-one"), allocationMode: "single_branch", branchId: "BR-LIVE" },
    );
    assert.equal(after.secretStatus, "stored");
    assert.notEqual(after.credentialGeneration, before.credentialGeneration);
    const committed = await dbModule.commitIntegrationBankProbe("OWNER-LIVE", before, {
      valid: true,
      runId: "INT-RUN-OLD-SETTINGS",
      correlationId: "CORR-OLD-SETTINGS",
      occurredAt: new Date(fixedNow).toISOString(),
      trigger: "Old settings response",
      reason: "ok",
      receivedCount: 1,
      checkpoint: "accounts:1",
      logEvent: "tochka.accounts_verified",
      logMessage: "one account",
      logRecordRef: "accounts:selected-customer",
      successStatus: "Доступ к счетам подтверждён",
      successAuthStatus: "Ключ и компания подтверждены",
      failureAuthStatus: "Проверка не пройдена",
      credentialExpiresAt: new Date(fixedNow + 3_600_000).toISOString(),
      auditAction: "integration.tochka_accounts_verified",
      auditPayload: { accountCount: 1 },
    });
    assert.equal(committed, false);
    assert.equal(database.database.prepare(
      "SELECT COUNT(*) AS total FROM integration_sync_runs WHERE id='INT-RUN-OLD-SETTINGS'",
    ).get().total, 0);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_DB_ENV__;
    database.close();
  }
});

test("ordinary integration endpoints accept only clean HTTPS addresses", async () => {
  const database = new CredentialD1Database();
  createCredentialSchema(database);
  database.database.prepare("INSERT INTO integration_connections (id) VALUES ('INT-T-ENDPOINT')").run();
  const dbModule = await loadCredentialDbModule(database);
  const setup = (endpoint) => ({
    connectionId: "INT-T-ENDPOINT",
    authMethod: "API key",
    startDate: "2026-09-01",
    syncIntervalMinutes: 60,
    syncMinute: 10,
    endpoint,
    legalEntityId: "",
    customerCode: "",
    branchId: "BR-LIVE",
    allocationMode: "single_branch",
    accountScope: "",
    channelType: "",
    sourceMapping: "",
    dataScopes: ["Справочник"],
  });
  try {
    for (const endpoint of [
      "http://api.example.test/import",
      "https://user:password@api.example.test/import",
      "https://api.example.test/import?token=secret",
      "https://api.example.test/import#secret",
    ]) {
      await assert.rejects(
        dbModule.saveIntegrationSetup("OWNER-LIVE", setup(endpoint)),
        /HTTPS-ссылкой без логина, пароля, параметров или служебной части/,
      );
    }
    const saved = await dbModule.saveIntegrationSetup(
      "OWNER-LIVE", setup("https://api.example.test/import"),
    );
    assert.equal(saved.endpoint, "https://api.example.test/import");
    assert.equal(JSON.stringify(database.database.prepare(
      "SELECT state_value FROM system_runtime_state WHERE state_key='integration_setup:INT-T-ENDPOINT'",
    ).get()).includes("password"), false);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_DB_ENV__;
    database.close();
  }
});

test("Tochka company handles bind the exact company, key, owner and legal entity", async () => {
  const database = new CredentialD1Database();
  createCredentialSchema(database);
  const dbModule = await loadCredentialDbModule(database);
  const owner = "OWNER-LIVE";
  const legalEntity = "ORG-LIVE-1";
  const ownerToken = makeJwt({ iss: "selection-owner" });
  const otherToken = makeJwt({ iss: "selection-other" });
  try {
    const handles = await dbModule.createTochkaCompanySelectionHandles(owner, legalEntity, ownerToken, [
      { code: "customer-a", name: "Компания А" },
      { code: "customer-b", name: "Компания Б" },
    ], fixedNow);
    assert.equal(handles.length, 2);
    assert.match(handles[0].id, /^[a-f0-9]{64}$/);
    assert.deepEqual(handles.map((item) => item.name), ["Компания А", "Компания Б"]);
    assert.equal(JSON.stringify(handles).includes("customer-a"), false, "the browser receives no customer code");

    const wrongToken = await dbModule.consumeTochkaCompanySelectionHandle(
      owner, handles[0].id, legalEntity, otherToken, fixedNow + 1_000,
    );
    assert.equal(wrongToken.ok, false);
    const wrongEntity = await dbModule.consumeTochkaCompanySelectionHandle(
      owner, handles[0].id, "ORG-LIVE-2", ownerToken, fixedNow + 1_000,
    );
    assert.equal(wrongEntity.ok, false);
    const wrongOwner = await dbModule.consumeTochkaCompanySelectionHandle(
      "OWNER-OTHER", handles[0].id, legalEntity, ownerToken, fixedNow + 1_000,
    );
    assert.equal(wrongOwner.ok, false);

    const selected = await dbModule.consumeTochkaCompanySelectionHandle(
      owner, handles[0].id, legalEntity, ownerToken, fixedNow + 1_000,
    );
    assert.deepEqual(selected, { ok: true, customerCode: "customer-a" });
    const replay = await dbModule.consumeTochkaCompanySelectionHandle(
      owner, handles[0].id, legalEntity, ownerToken, fixedNow + 1_001,
    );
    assert.equal(replay.ok, false);
    assert.match(replay.reason, /использован или устарел/i);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_DB_ENV__;
    database.close();
  }
});

test("Tochka company handles expire and can be consumed only once under concurrency", async () => {
  const database = new CredentialD1Database();
  createCredentialSchema(database);
  const dbModule = await loadCredentialDbModule(database);
  const ownerToken = makeJwt({ iss: "selection-concurrency" });
  try {
    const [expiring] = await dbModule.createTochkaCompanySelectionHandles(
      "OWNER-LIVE", "ORG-LIVE-1", ownerToken, [{ code: "customer-expired", name: "Истёкшая" }], fixedNow,
    );
    const expired = await dbModule.consumeTochkaCompanySelectionHandle(
      "OWNER-LIVE", expiring.id, "ORG-LIVE-1", ownerToken, fixedNow + 5 * 60_000 + 1,
    );
    assert.equal(expired.ok, false);
    assert.match(expired.reason, /Время выбора компании истекло/i);

    const [singleUse] = await dbModule.createTochkaCompanySelectionHandles(
      "OWNER-LIVE", "ORG-LIVE-1", ownerToken, [{ code: "customer-once", name: "Один раз" }], fixedNow,
    );
    const outcomes = await Promise.all([
      dbModule.consumeTochkaCompanySelectionHandle("OWNER-LIVE", singleUse.id, "ORG-LIVE-1", ownerToken, fixedNow + 1_000),
      dbModule.consumeTochkaCompanySelectionHandle("OWNER-LIVE", singleUse.id, "ORG-LIVE-1", ownerToken, fixedNow + 1_000),
    ]);
    assert.equal(outcomes.filter((item) => item.ok).length, 1);
    assert.equal(outcomes.filter((item) => !item.ok).length, 1);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_DB_ENV__;
    database.close();
  }
});

test("Tochka selection remains bound to the named company when provider order changes", async () => {
  const database = new CredentialD1Database();
  createCredentialSchema(database);
  const dbModule = await loadCredentialDbModule(database);
  const ownerToken = makeJwt({ iss: "selection-reorder" });
  try {
    const handles = await dbModule.createTochkaCompanySelectionHandles("OWNER-LIVE", "ORG-LIVE-1", ownerToken, [
      { code: "customer-a", name: "Компания А" },
      { code: "customer-b", name: "Компания Б" },
    ], fixedNow);
    const selected = await dbModule.consumeTochkaCompanySelectionHandle(
      "OWNER-LIVE", handles[0].id, "ORG-LIVE-1", ownerToken, fixedNow + 1_000,
    );
    assert.equal(selected.ok, true);
    const result = await probeTochkaJwt(ownerToken, async (input) => {
      if (String(input) === customersUrl) {
        return Response.json({ Data: { Customer: [
          { customerCode: "customer-b", name: "Компания Б" },
          { customerCode: "customer-a", name: "Компания А" },
        ] } });
      }
      return Response.json({ Data: { Account: [{ customerCode: "customer-a", accountId: "private-account" }] } });
    }, fixedNow, selected.ok ? selected.customerCode : "");
    assert.equal(result.valid, true);
    assert.equal(result.customerCode, "customer-a");
    assert.equal(result.accountCount, 1);
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_DB_ENV__;
    database.close();
  }
});

test("readiness rejects a stale master key before stored bank credentials can be used", async () => {
  const database = new CredentialD1Database();
  createCredentialSchema(database);
  const dbModule = await loadCredentialDbModule(database);
  const runtimeEnv = globalThis.__ARTHELLO_TOCHKA_DB_ENV__;
  try {
    await dbModule.saveTochkaSetupWithCredential(
      "OWNER-LIVE",
      credentialSetup("ORG-LIVE-1", "customer-one"),
      makeJwt({ iss: "readiness-key-check" }),
      null,
    );
    await dbModule.saveIntegrationCredential(
      "OWNER-LIVE",
      "INT-T-SECOND",
      "ORG-LIVE-2",
      "customer-two",
      makeJwt({ iss: "second-readiness-key-check" }),
    );
    await dbModule.verifyStoredIntegrationCredentials();

    runtimeEnv.INTEGRATION_CREDENTIALS_KEY = "different-stale-runtime-key-material-32-bytes-minimum";
    await assert.rejects(
      dbModule.verifyStoredIntegrationCredentials(),
      /Защищённые банковские ключи не прошли проверку хранилища/,
    );

    runtimeEnv.INTEGRATION_CREDENTIALS_KEY = "focused-test-dedicated-key-material-32-bytes-minimum";
    database.database.prepare(
      "UPDATE system_runtime_state SET state_value='{}' WHERE state_key LIKE 'integration_credential:v2:INT-T-SECOND:%'",
    ).run();
    await assert.rejects(
      dbModule.verifyStoredIntegrationCredentials(),
      /Защищённые банковские ключи не прошли проверку хранилища/,
    );
  } finally {
    delete globalThis.__ARTHELLO_TOCHKA_DB_ENV__;
    database.close();
  }
});

test("a candidate JWT is probed before atomic setup and credential replacement", async () => {
  const actions = await source("app/api/integration-actions/route.ts");
  const database = await source("db/index.ts");
  const saveStart = actions.indexOf("async function saveSetup");
  const saveEnd = actions.indexOf("async function revokeCredential", saveStart);
  assert.ok(saveStart > -1 && saveEnd > saveStart, "saveSetup action must exist");
  const saveAction = actions.slice(saveStart, saveEnd);
  const probeAt = saveAction.indexOf("const candidateProbe = await probeTochkaJwt(");
  const rejectionAt = saveAction.indexOf("if (!candidateProbe.valid)", probeAt);
  const atomicPersistAt = saveAction.indexOf("await saveTochkaSetupWithCredential", rejectionAt);
  assert.ok(probeAt > -1 && rejectionAt > probeAt, "candidate must be probed before its result is accepted");
  assert.ok(atomicPersistAt > rejectionAt, "setup and credential must not be replaced before a successful candidate probe");
  assert.match(saveAction.slice(0, probeAt), /consumeTochkaCompanySelectionHandle/);
  assert.match(saveAction.slice(probeAt, rejectionAt), /selectedCompany\?\.customerCode \?\? ""/);
  assert.match(saveAction.slice(rejectionAt, atomicPersistAt), /return privateJson\(\{[\s\S]*?error: candidateProbe\.reason/);
  assert.equal(saveAction.slice(0, rejectionAt).includes("saveTochkaSetupWithCredential"), false);
  assert.doesNotMatch(actions, /await saveIntegrationCredential\(/);

  assert.match(database, /async function persistBankSetupWithCredentialCas[\s\S]*?await env\.DB\.batch\(\[/);
  assert.match(database, /persistBankSetupWithCredentialCas/);
  assert.match(database, /credentialGeneration/);
  assert.match(database, /state_key LIKE \? AND state_key<>\? AND \$\{guard\}/);
  assert.match(database, /integrationCredentialConnectionPattern\(setup\.connectionId\)/);
  assert.match(database, /integration\.credential_replaced/);
});

test("reader roles receive a factual view without management actions", async () => {
  const [workspace, integrationsApi] = await Promise.all([
    source("app/components/IntegrationWorkspace.tsx"),
    source("app/api/integrations/route.ts"),
  ]);
  assert.match(integrationsApi, /const requester = await getAuthenticatedRequestContext\(request\)/);
  assert.match(integrationsApi, /if \(!readers\.has\(requester\.apiRole\)\)/);
  assert.match(integrationsApi, /const requesterRole = requester\.apiRole/);
  assert.match(integrationsApi, /const canManageCredentials = isCanonicalOwnerContext\(requester\)/);
  assert.doesNotMatch(integrationsApi, /getRequestUser|request\.headers\.get\("x-arthello-role"\)/);
  assert.match(integrationsApi, /const managers = new Set\(\["OWNER", "DIRECTOR", "REPRESENTATIVE", "INTEGRATIONS"\]\)/);
  for (const capability of ["canManageSetup", "canRun", "canChangeState", "canResolve"]) {
    assert.match(integrationsApi, new RegExp(`${capability}:`));
  }
  assert.match(integrationsApi, /\n\s*canManageCredentials,\n/);
  assert.match(integrationsApi, /canManageTochka:\s*canManageCredentials/);
  assert.match(integrationsApi, /canManageTBank:\s*canManageCredentials/);
  assert.match(workspace, /data\.capabilities\.canManageSetup \? <Card className="integration-connect-start">/);
  assert.match(workspace, /id === TOCHKA_CONNECTION_ID \? data\.capabilities\.canManageTochka/);
  assert.match(workspace, /id === TBANK_CONNECTION_ID \? data\.capabilities\.canManageTBank/);
  assert.match(workspace, /wizardId && data\.capabilities\.canManageSetup && currentBankCapability\(wizardId, data\.capabilities\)/);
  assert.match(workspace, /data\.capabilities\.canRun \? <Button variant="primary"/);
  assert.match(workspace, /const canRunCurrent = data\.capabilities\.canRun && currentBankAllowed/);
  assert.match(workspace, /const canChangeCurrentState = data\.capabilities\.canChangeState && currentBankAllowed/);
  assert.match(workspace, /item\.connectionId === TOCHKA_CONNECTION_ID \? data\.capabilities\.canManageTochka/);
  assert.match(workspace, /canManageCredentials=\{data\.capabilities\.canManageCredentials\}/);
});

test("credential storage is encrypted and scoped by provider, legal entity and verified customerCode", async () => {
  const database = await source("db/index.ts");
  assert.match(database, /algorithm:\s*"AES-GCM"/);
  assert.match(database, /crypto\.subtle\.encrypt/);
  assert.match(database, /INTEGRATION_CREDENTIALS_KEY/);
  assert.match(database, /throw new Error\("Защищённое хранилище не настроено:[^\n]+INTEGRATION_CREDENTIALS_KEY"\)/);
  assert.match(database, /await verifyStoredIntegrationCredentials\(\)/);
  assert.match(database, /export async function verifyStoredIntegrationCredentials\(\)/);

  const encryptionKeyStart = database.indexOf("async function integrationCredentialEncryptionKey");
  const encryptionKeyEnd = database.indexOf("function encodeIntegrationCredentialBytes", encryptionKeyStart);
  const encryptionKey = database.slice(encryptionKeyStart, encryptionKeyEnd);
  assert.match(encryptionKey, /runtime\.INTEGRATION_CREDENTIALS_KEY/);
  assert.doesNotMatch(encryptionKey, /CENTRAL_ACCESS_SECRET/);

  const keyStart = database.indexOf("function integrationCredentialStateKey");
  const keyEnd = database.indexOf("function normalizeIntegrationCredentialScope", keyStart);
  assert.ok(keyStart > -1 && keyEnd > keyStart, "credential key builder must exist");
  const keyBuilder = database.slice(keyStart, keyEnd);
  assert.match(keyBuilder, /connectionId/);
  assert.match(keyBuilder, /legalEntityId/);
  assert.match(keyBuilder, /customerCode/);
  assert.doesNotMatch(keyBuilder, /\b(?:branch|account)(?:Id|Scope)?\b/i);

  const auditStart = database.indexOf('writeIntegrationDatasetAudit(actor, "integration.credential_replaced"');
  const auditEnd = database.indexOf("});", auditStart);
  assert.ok(auditStart > -1 && auditEnd > auditStart, "credential replacement audit must exist");
  const auditPayload = database.slice(auditStart, auditEnd + 3);
  assert.match(auditPayload, /connectionId/);
  assert.match(auditPayload, /legalEntityId/);
  assert.match(auditPayload, /credentialEnvelopeStored/);
  assert.doesNotMatch(auditPayload, /\b(?:secret|ciphertext|value|token|jwt)\b/i);
});

test("integration GET returns only credential state and cannot read or return credential material", async () => {
  const [database, integrationsApi] = await Promise.all([
    source("db/index.ts"),
    source("app/api/integrations/route.ts"),
  ]);
  const getStart = database.indexOf("export async function getIntegrationSetups");
  const getEnd = database.indexOf("export async function saveIntegrationSetup", getStart);
  assert.ok(getStart > -1 && getEnd > getStart, "safe setup reader must exist");
  const setupReader = database.slice(getStart, getEnd);
  assert.match(setupReader, /SELECT state_key FROM system_runtime_state WHERE state_key LIKE 'integration_credential:v2:%'/);
  assert.doesNotMatch(setupReader, /SELECT\s+state_key\s*,\s*state_value[^;]+integration_credential/v);
  assert.match(setupReader, /secretStatus:[\s\S]*?"stored"[\s\S]*?"missing"/);

  assert.match(integrationsApi, /getIntegrationSetups\(\)/);
  assert.doesNotMatch(integrationsApi, /readIntegrationCredential|saveIntegrationCredential|integrationCredentialStateKey/);
  assert.doesNotMatch(integrationsApi, /\b(?:plaintext|ciphertext|secretValue|jwtValue)\b/i);
});

test("Tochka copy removes administrator hand-off and honestly scopes all JWT-visible accounts", async () => {
  const [workspace, integrationsApi] = await Promise.all([
    source("app/components/IntegrationWorkspace.tsx"),
    source("app/api/integrations/route.ts"),
  ]);
  const copy = `${workspace}\n${integrationsApi}`;
  assert.doesNotMatch(copy, /\b(?:администратор|админ)(?:а|у|ом|е|ы|ов|ами|ах)?\b/i);
  assert.match(workspace, /Один ключ Точки для выбранной карточки юрлица/);
  assert.match(workspace, /Все счета, разрешённые ключом Точки/);
  assert.match(workspace, /accountScope:\s*bank\s*\?\s*"all_permitted"/);
  assert.match(workspace, /legalEntities\.map/);
  assert.match(workspace, /<select value=\{legalEntityId\}[\s\S]*?Сначала создайте карточку юрлица/);
  assert.match(workspace, /Можно выбрать только существующую карточку юрлица/);
  assert.match(workspace, /branches\.map/);
  assert.doesNotMatch(workspace, /ORG-ARTHELLO|ORG-IP-TYURIN|ORG-UK-DET-OBR/);
  assert.match(workspace, /Соответствие банковского доступа этой карточке фиксирует собственник/);
  assert.match(workspace, /Защищённый ключ, выбор компании и доступные счета/);
  assert.match(workspace, /startDate: bank \? "" : startDate/);
  assert.match(workspace, /syncIntervalMinutes: bank \? 0 : interval/);
  assert.match(workspace, /dataScopes: tochka \? \["Счета"\]/);
  assert.match(workspace, /Загрузка выписок, расписание синхронизации и правила распределения операций ещё не запущены/);
  assert.match(workspace, /Проверить ключ и сохранить/);
});

test("classification mode has no connector-level branch requirement and keeps ambiguous operations for review", async () => {
  const [database, workspace] = await Promise.all([
    source("db/index.ts"),
    source("app/components/IntegrationWorkspace.tsx"),
  ]);
  assert.match(database, /const requiresBranch = !bankConnection \|\| allocationMode === "single_branch"/);
  assert.match(database, /if \(requiresBranch && !branchId\)/);
  assert.match(database, /branchId:\s*bankConnection && allocationMode === "classify_transactions" \? "" : branchId/);
  assert.match(workspace, /existing\?\.allocationMode \?\? "classify_transactions"/);
  assert.match(workspace, /bank && allocationMode === "single_branch" \? <label>/);
  assert.match(workspace, /неопределённые должны оставаться в очереди «Требует разбора»/i);
  assert.match(workspace, /Один счёт может принимать деньги школы и садика/);
});

test("account discovery does not claim that transaction import is connected", async () => {
  const [actions, integrationsApi] = await Promise.all([
    source("app/api/integration-actions/route.ts"),
    source("app/api/integrations/route.ts"),
  ]);
  const discoveryStart = actions.indexOf("async function verifyTochkaConnection");
  const discoveryEnd = actions.indexOf("async function retrySync", discoveryStart);
  const discovery = actions.slice(discoveryStart, discoveryEnd);
  assert.match(discovery, /successStatus:\s*"Доступ к счетам подтверждён"/);
  assert.match(discovery, /commitIntegrationBankProbe/);
  const database = await source("db/index.ts");
  assert.match(database, /verified_transfer=0,is_enabled=0/);
  assert.match(database, /accepted_count=0/);
  assert.match(database, /last_success_at='',next_sync_at=''/);
  assert.match(discovery, /импорт операций ещё не запускался/i);
  assert.match(integrationsApi, /Ключ Точки и доступ к счетам подтверждены/);
});
