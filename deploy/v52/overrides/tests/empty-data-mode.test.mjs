import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import * as ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const dbSource = read("../db/index.ts");
const readinessActionsSource = read("../app/api/readiness-actions/route.ts");
const dataModeSource = read("../app/api/data-mode/route.ts");

let importNonce = 0;

class D1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1Statement(this.database, this.sql, bindings);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings);
  }

  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.bindings) };
  }
}

class D1Database {
  constructor(database = new DatabaseSync(":memory:")) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
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

function transpile(source, replacements, label) {
  let transformed = source;
  for (const [search, replacement] of replacements) {
    assert.ok(transformed.includes(search), `${label}: expected source fragment was not found: ${search}`);
    transformed = transformed.replace(search, replacement);
  }
  assert.doesNotMatch(transformed, /^import\s/m, `${label}: executable test module still has imports`);
  return ts.transpileModule(transformed, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: label,
    reportDiagnostics: true,
  }).outputText;
}

async function importCode(code, label) {
  const encoded = Buffer.from(code).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${label}-${importNonce++}`);
}

async function loadDbModule(database) {
  globalThis.__ARTHELLO_EMPTY_MODE_ENV__ = { DB: database };
  try {
    const code = transpile(dbSource, [
      ['import { env } from "cloudflare:workers";', "const env = globalThis.__ARTHELLO_EMPTY_MODE_ENV__;"],
      ['import { drizzle } from "drizzle-orm/d1";', "const drizzle = () => { throw new Error('drizzle is not used by this test'); };"],
      ['import { entityDuplicateKey, manualEntityNormalization } from "../lib/entity-provenance";', "const entityDuplicateKey = ({entityType,displayName}) => `${entityType}:${displayName}`; const manualEntityNormalization = () => null;"],
      ['import { ensureOperatingIntegrationCatalog } from "../lib/operating-integration-catalog";', "const ensureOperatingIntegrationCatalog = async () => {};"],
      ['import { toTochkaFinancialOperation } from "../lib/integrations";', "const toTochkaFinancialOperation = async () => null;"],
      ['import type { TochkaReadOnlySyncResult } from "../lib/integrations";', ""],
      ['import * as schema from "./schema";', "const schema = {};"],
    ], "db/index.ts");
    return await importCode(code, "db-index");
  } finally {
    delete globalThis.__ARTHELLO_EMPTY_MODE_ENV__;
  }
}

function count(database, table, where = "") {
  const row = database.database.prepare(`SELECT COUNT(*) AS total FROM ${table} ${where}`).get();
  return Number(row.total);
}

function businessCounts(database) {
  const tables = [
    "entities",
    "tasks",
    "financial_operations",
    "finance_accruals",
    "finance_payroll_summary",
    "integration_connections",
    "integration_sync_runs",
    "analytics_metric_definitions",
    "readiness_validation_runs",
  ];
  return Object.fromEntries(tables.map((table) => [table, count(database, table)]));
}

test("fresh database fails closed to empty and creates schema without business data", async (t) => {
  const database = new D1Database();
  t.after(() => database.close());
  const db = await loadDbModule(database);

  await db.ensureCoreTables();

  assert.equal(await db.getSystemDataMode(), "empty");
  assert.ok(count(database, "sqlite_schema") >= 120, "complete application schema should be present");
  assert.deepEqual(businessCounts(database), {
    entities: 0,
    tasks: 0,
    financial_operations: 0,
    finance_accruals: 0,
    finance_payroll_summary: 0,
    integration_connections: 0,
    integration_sync_runs: 0,
    analytics_metric_definitions: 0,
    readiness_validation_runs: 0,
  });

  database.database.prepare("INSERT INTO system_runtime_state (state_key,state_value) VALUES ('system_data_mode','unexpected')").run();
  assert.equal(await db.getSystemDataMode(), "empty", "unknown persisted values must fail closed");
});

test("a new process repairs an optional table without running demo seeds", async (t) => {
  const database = new D1Database();
  t.after(() => database.close());
  const firstProcess = await loadDbModule(database);
  await firstProcess.ensureCoreTables();
  database.database.exec("DROP TABLE integration_sync_runs");
  assert.equal(count(database, "sqlite_schema", "WHERE type='table' AND name='integration_sync_runs'"), 0);

  const restartedProcess = await loadDbModule(database);
  await restartedProcess.ensureCoreTables();

  assert.equal(count(database, "sqlite_schema", "WHERE type='table' AND name='integration_sync_runs'"), 1);
  assert.deepEqual(Object.values(businessCounts(database)), Array(9).fill(0));
  assert.equal(await restartedProcess.getSystemDataMode(), "empty");
});

test("empty mode preserves the three production people and cannot be reopened by web helpers", async (t) => {
  const database = new D1Database();
  t.after(() => database.close());
  const firstProcess = await loadDbModule(database);
  await firstProcess.ensureCoreTables();

  const insertUser = database.database.prepare(`INSERT INTO app_users
    (id,contact_type,contact,display_name,role,is_administrative,status,invitation_status,invited_by)
    VALUES (?,?,?,?,?,1,'Активен','Активирован','owner')`);
  insertUser.run("USR-VITALY", "email", "vitaly@example.test", "Виталий Озолин", "OWNER");
  insertUser.run("USR-GUTAKOVSKAYA", "phone", "+79040000001", "Наталья Гутаковская", "DIRECTOR");

  const insertEntity = database.database.prepare(`INSERT INTO entities
    (id,entity_type,display_name,source_system,source_record_id,data_quality,scope,created_by)
    VALUES (?,'Сотрудник',?,'MANUAL',?,'Проверено','Команда','owner')`);
  insertEntity.run("EMP-GUTAKOVSKAYA", "Наталья Гутаковская", "EMP-GUTAKOVSKAYA");
  insertEntity.run("EMP-DMITRIEVA", "Наталья Дмитриева", "EMP-DMITRIEVA");
  const insertEmployee = database.database.prepare(`INSERT INTO hr_employees
    (id,candidate_id,contract_id,position_id,unit,rate_minor,hire_date,status,access_status)
    VALUES (?,'','','','Все филиалы',0,'2026-08-26','Работает','Не выдан')`);
  insertEmployee.run("EMP-GUTAKOVSKAYA");
  insertEmployee.run("EMP-DMITRIEVA");
  database.database.prepare("INSERT INTO system_runtime_state (state_key,state_value) VALUES ('system_data_mode','empty')").run();

  const restartedProcess = await loadDbModule(database);
  await restartedProcess.ensureCoreTables();

  assert.deepEqual(
    database.database.prepare("SELECT display_name FROM app_users ORDER BY display_name").all().map((row) => row.display_name),
    ["Виталий Озолин", "Наталья Гутаковская"],
  );
  assert.deepEqual(
    database.database.prepare("SELECT display_name FROM entities WHERE entity_type='Сотрудник' ORDER BY display_name").all().map((row) => row.display_name),
    ["Наталья Гутаковская", "Наталья Дмитриева"],
  );
  await assert.rejects(() => restartedProcess.setSystemDataMode("owner", "test"), /офлайн-процедурой/);
  await assert.rejects(() => restartedProcess.setSystemDataMode("owner", "source_only"), /офлайн-процедурой/);
  await assert.rejects(() => restartedProcess.restoreSystemDemoData("owner"), /офлайн-процедуру/);
  await assert.rejects(() => restartedProcess.removeSystemDemoData("owner"), /web runtime/);
  assert.equal(await restartedProcess.getSystemDataMode(), "empty");
  assert.equal(count(database, "audit_events"), 0, "rejected transitions must not leave audit or business records");
});

test("readiness action returns 409 in empty mode before touching scenario data", async () => {
  let databaseCalls = 0;
  globalThis.__ARTHELLO_READINESS_TEST__ = {
    env: { DB: { prepare() { databaseCalls += 1; throw new Error("database must not be touched"); } } },
    ensureCoreTables: async () => {},
    getSystemDataMode: async () => "empty",
    scenarioPassed: () => false,
    summarizeValidation: () => ({ status: "Не пройдено", passed: 0, failed: 0, skipped: 0 }),
    getAuthenticatedRequestContext: async () => ({ actor: "owner@example.test", apiRole: "OWNER" }),
    verifyAuthenticatedRequestCsrf: () => {},
  };
  try {
    const code = transpile(readinessActionsSource, [
      ['import{env}from"cloudflare:workers";', "const {env}=globalThis.__ARTHELLO_READINESS_TEST__;"],
      ['import{ensureCoreTables,getSystemDataMode}from"../../../db";', "const {ensureCoreTables,getSystemDataMode}=globalThis.__ARTHELLO_READINESS_TEST__;"],
      ['import{scenarioPassed,summarizeValidation}from"../../../lib/readiness";', "const {scenarioPassed,summarizeValidation}=globalThis.__ARTHELLO_READINESS_TEST__;"],
      ['import{getAuthenticatedRequestContext,verifyAuthenticatedRequestCsrf}from"../../../lib/production-auth";', "const {getAuthenticatedRequestContext,verifyAuthenticatedRequestCsrf}=globalThis.__ARTHELLO_READINESS_TEST__;"],
    ], "readiness-actions/route.ts");
    const route = await importCode(code, "readiness-actions");
    const response = await route.POST(new Request("https://example.test/api/readiness-actions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-arthello-role": "OWNER" },
      body: JSON.stringify({ action: "runAllScenarios" }),
    }));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /пустом production-контуре/);
    assert.equal(databaseCalls, 0);
  } finally {
    delete globalThis.__ARTHELLO_READINESS_TEST__;
  }
});

test("data-mode endpoint reports unknown with 503 when mode cannot be confirmed", async () => {
  globalThis.__ARTHELLO_DATA_MODE_TEST__ = {
    ensureCoreTables: async () => { throw new Error("D1 unavailable"); },
    getSystemDataMode: async () => "test",
    getRequestUser: () => "USR-VITALY",
  };
  try {
    const code = transpile(dataModeSource, [
      ['import { ensureCoreTables, getSystemDataMode } from "../../../db";', "const {ensureCoreTables,getSystemDataMode}=globalThis.__ARTHELLO_DATA_MODE_TEST__;"],
      ['import { getRequestUser } from "../../../lib/request-user";', "const {getRequestUser}=globalThis.__ARTHELLO_DATA_MODE_TEST__;"],
    ], "data-mode/route.ts");
    const route = await importCode(code, "data-mode");
    const response = await route.GET(new Request("https://example.test/api/data-mode"));
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.systemDataMode, "unknown");
    assert.notEqual(body.systemDataMode, "test");
  } finally {
    delete globalThis.__ARTHELLO_DATA_MODE_TEST__;
  }
});
