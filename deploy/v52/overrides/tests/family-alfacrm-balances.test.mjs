import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const temp = mkdtempSync(join(tmpdir(), "arthello-family-balances-"));
after(() => { delete globalThis.__familyAlfaTest; rmSync(temp, { recursive: true, force: true }); });
function compile(relative, output, replacements = {}) {
  let source = readFileSync(new URL(relative, import.meta.url), "utf8");
  for (const [before, after] of Object.entries(replacements)) source = source.replaceAll(before, after);
  const result = ts.transpileModule(source, { fileName: relative, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
  assert.deepEqual(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
  writeFileSync(join(temp, output), result.outputText);
}
compile("../lib/access-policy.ts", "policy.mjs");
compile("../lib/section-read-scope.ts", "scope.mjs", { '"./access-policy.ts"': '"./policy.mjs"' });
writeFileSync(join(temp, "env.mjs"), "export const env={get DB(){return globalThis.__familyAlfaTest.db}};");
writeFileSync(join(temp, "db.mjs"), "export async function ensureCoreTables(){};");
writeFileSync(join(temp, "auth.mjs"), `export async function getAuthenticatedRequestContext(){if(globalThis.__familyAlfaTest.authError)throw Error('private auth detail');return globalThis.__familyAlfaTest.context;}
export function isCanonicalOwnerContext(context){return context.canonicalOwner===true;}`);
compile("../app/api/families/alfacrm-balances/route.ts", "route.mjs", {
  '"cloudflare:workers"': '"./env.mjs"', '"../../../../db"': '"./db.mjs"',
  '"../../../../lib/access-policy"': '"./policy.mjs"', '"../../../../lib/production-auth"': '"./auth.mjs"',
  '"../../../../lib/section-read-scope"': '"./scope.mjs"',
});
compile("../app/components/FamilyAlfaBalances.tsx", "component.mjs", {
  '"react"': JSON.stringify(import.meta.resolve("react")), '"react/jsx-runtime"': JSON.stringify(import.meta.resolve("react/jsx-runtime")),
  'import styles from "./FamilyAlfaBalances.module.css";': 'const styles={card:"card",amount:"amount"};',
});
// JSX runtime import is emitted by TypeScript after replacements above.
const componentPath = join(temp, "component.mjs");
writeFileSync(componentPath, readFileSync(componentPath, "utf8").replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime"))));
const { GET } = await import(pathToFileURL(join(temp, "route.mjs")));
const { API_RULES, canAccessApi } = await import(pathToFileURL(join(temp, "policy.mjs")));
const { FamilyAlfaBalanceRows } = await import(pathToFileURL(componentPath));
const request = (id = "F-A") => new Request(`https://arthello.example.test/api/families/alfacrm-balances?familyId=${encodeURIComponent(id)}`, { headers: { "x-arthello-role": "OWNER" } });

function context(apiRole = "EMPLOYEE", modules = ["clients", "finance"], changes = {}) {
  return { appUserId: "staff", apiRole, canonicalOwner: false,
    auth: { user: { apiRole, isSystemOwner: false, isAdministrative: false, allowedModules: modules, ...changes } } };
}
function fixture(t, ctx = context()) {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE entities(id TEXT PRIMARY KEY,entity_type TEXT,scope TEXT,metadata TEXT);
    INSERT INTO entities VALUES ('F-A','Семья','School','{"localBranchId":"A"}'),('F-B','Семья','Nebo','{"localBranchId":"B"}'),('F-X','Семья','Closed','{"localBranchId":"X"}'),('CH-A','Ребёнок','School','{}');
    CREATE TABLE organization_branches(id TEXT PRIMARY KEY,name TEXT,status TEXT,sort_order INTEGER);
    INSERT INTO organization_branches VALUES ('A','School','Активен',1),('B','Nebo','Активен',2),('X','Closed','Архив',3);
    CREATE TABLE user_branch_access(user_id TEXT,branch_id TEXT);
    INSERT INTO user_branch_access VALUES ('staff','A'),('staff','X'),('other','B');
    CREATE TABLE alfacrm_projection_lineage(projection_table TEXT,projection_id TEXT,observation_id TEXT,batch_id TEXT);
    CREATE TABLE system_runtime_state(state_key TEXT,state_value TEXT);
    INSERT INTO system_runtime_state VALUES('alfacrm_connector:v1','{"branchMappings":{"1":"A","2":"B","3":"X"}}');
    CREATE TABLE alfacrm_current_records(remote_branch_id TEXT,module TEXT,record_id TEXT,active INTEGER,observation_id TEXT);
    CREATE TABLE alfacrm_raw_observations(id TEXT PRIMARY KEY,batch_id TEXT,remote_branch_id TEXT,module TEXT,record_id TEXT,payload_hash TEXT,observed_at TEXT);`);
  // Compile against the importer-owned additive DDL; production GET never creates or changes this schema.
  const importer = readFileSync(new URL("../app/api/integrations/alfacrm/route.ts", import.meta.url), "utf8");
  const ddl = importer.match(/CREATE TABLE IF NOT EXISTS alfacrm_customer_balances\s*\([\s\S]*?\n\s*\)/)?.[0];
  assert.ok(ddl, "new monetary projection schema must come from the same release importer");
  sqlite.exec(ddl);
  const db = { prepare(sql) { let values = []; const statement = {
    bind(...next) { values = next; return statement; },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
  }; return statement; } };
  globalThis.__familyAlfaTest = { context: ctx, db };
  return sqlite;
}
function balance(db, { family = "F-A", remote = "1", local = "A", customer = "c1", minor = 123456, source = "Customer.balance", lineage = true } = {}) {
  const hash = createHash("sha256").update(JSON.stringify({ remote, customer, minor })).digest("hex");
  db.prepare(`INSERT INTO alfacrm_customer_balances(remote_branch_id,customer_id,local_branch_id,family_entity_id,balance_minor,paid_lesson_count,source_field,payload_hash,imported_at) VALUES (?,?,?,?,?,NULL,?,?,?)`)
    .run(remote, customer, local, family, minor, source, hash, "2026-09-08T09:11:00.000Z");
  db.prepare("INSERT INTO alfacrm_current_records VALUES(?,'families',?,1,NULL)").run(remote,customer);
  if (lineage) {
    const id = JSON.stringify([remote, customer]);
    db.prepare("INSERT INTO alfacrm_raw_observations VALUES (?,?,?,?,?,?,?)").run(id, "batch", remote, "subscriptions", `customer-balance-v2:${customer}`, hash, "2026-09-08T09:10:00.000Z");
    db.prepare("INSERT INTO alfacrm_projection_lineage VALUES (?,?,?,?)").run("alfacrm_customer_balances", id, id, "batch");
    db.prepare("INSERT INTO alfacrm_current_records VALUES(?,'subscriptions',?,1,?)").run(remote,`customer-balance-v2:${customer}`,id);
  }
}

test("missing authentication, spoofed role and authentication failures are closed and never expose error details", async (t) => {
  fixture(t, null);
  let result = await GET(request()); assert.equal(result.status, 401); assert.match(result.headers.get("cache-control"), /no-store/);
  globalThis.__familyAlfaTest.authError = true;
  result = await GET(request()); assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /private auth/);
});

test("both clients and finance section grants are required and forged owner is denied", async (t) => {
  fixture(t);
  for (const ctx of [context("EMPLOYEE", ["clients"]), context("FINANCE", ["finance"]), context("OWNER", undefined, { isSystemOwner: true }), context("unknown")]) {
    globalThis.__familyAlfaTest.context = ctx;
    assert.equal((await GET(request())).status, 403);
  }
});

test("new nested route is covered by the authenticated family API inventory and retains the extra finance boundary", async (t) => {
  const pathname = "/api/families/alfacrm-balances";
  assert.equal(API_RULES.find((rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`))?.prefix, "/api/families");
  const clientOnly = context("EMPLOYEE", ["clients"]);
  assert.equal(canAccessApi(clientOnly.auth.user, pathname, "GET"), true);
  fixture(t, clientOnly);
  assert.equal((await GET(request())).status, 403);
});

test("assigned active branch scope hides other families, archive and child IDs", async (t) => {
  const db = fixture(t); balance(db); balance(db, { family: "F-B", local: "B", remote: "2" });
  for (const id of ["F-B", "F-X", "CH-A", "missing", "F-A' OR 1=1 --"]) assert.equal((await GET(request(id))).status, 404);
  const result = await GET(request()); const body = await result.json();
  assert.equal(result.status, 200); assert.equal(body.balances.length, 1);
  assert.deepEqual(body.balances[0], { customerId: "c1", remoteBranchId: "1", branchName: "School", balanceMinor: 123456, observedAt: "2026-09-08T09:10:00.000Z", source: "AlfaCRM", currency: null, status: "available", refreshUnconfirmed: false });
  assert.doesNotMatch(JSON.stringify(body), /payload|hash|batch|family_entity|raw/);
});

test("a newer unprojectable observation keeps a dated prior balance and explicitly labels the failed refresh", async (t) => {
  const db = fixture(t); balance(db);
  db.exec("UPDATE alfacrm_current_records SET observation_id='new-invalid-observation' WHERE module='subscriptions'");
  const body = await (await GET(request())).json();
  assert.equal(body.balances[0].balanceMinor, 123456); assert.equal(body.balances[0].refreshUnconfirmed, true);
  assert.equal(body.balances[0].observedAt, "2026-09-08T09:10:00.000Z");
  const html = renderToStaticMarkup(React.createElement(FamilyAlfaBalanceRows, { balances: body.balances }));
  assert.match(html, /Последнее обновление не подтверждено/); assert.match(html, /предыдущий подтверждённый остаток/);
});

test("each projection retains its original branch; administrative access still excludes archive", async (t) => {
  const db = fixture(t); balance(db); balance(db, { local: "B", remote: "2" }); balance(db, { local: "X", remote: "3" });
  assert.deepEqual((await (await GET(request())).json()).balances.map((row) => row.remoteBranchId), ["1"]);
  globalThis.__familyAlfaTest.context.auth.user.isAdministrative = true;
  assert.deepEqual((await (await GET(request())).json()).balances.map((row) => row.remoteBranchId), ["1", "2"]);
});

test("canonical owner can inspect archive, and no imported snapshot remains unknown rather than zero", async (t) => {
  const db = fixture(t, { ...context("OWNER", undefined, { isSystemOwner: true }), canonicalOwner: true });
  balance(db, { family: "F-X", local: "X", remote: "3", minor: 0 });
  const body = await (await GET(request("F-X"))).json(); assert.equal(body.balances[0].balanceMinor, 0);
  assert.deepEqual((await (await GET(request())).json()).balances, []);
  db.exec("DROP TABLE alfacrm_customer_balances");
  assert.deepEqual((await (await GET(request())).json()).balances, []);
});

test("removed/remapped branches and inactive customers hide old monetary snapshots", async (t) => {
  const db = fixture(t); balance(db);
  db.exec("UPDATE system_runtime_state SET state_value='{\"branchMappings\":{\"1\":\"B\"}}'");
  assert.deepEqual((await (await GET(request())).json()).balances, []);
  db.exec("UPDATE system_runtime_state SET state_value='{\"branchMappings\":{}}'");
  assert.deepEqual((await (await GET(request())).json()).balances, []);
  db.exec("UPDATE system_runtime_state SET state_value='{\"branchMappings\":{\"1\":\"A\"}}'; UPDATE alfacrm_current_records SET active=0");
  assert.deepEqual((await (await GET(request())).json()).balances, []);
});

test("zero and negative amounts are displayed faithfully, never aggregated across imported customers", async (t) => {
  const db = fixture(t); balance(db, { minor: 0 }); balance(db, { customer: "c2", minor: -1234 });
  const body = await (await GET(request())).json();
  assert.deepEqual(body.balances.map((row) => row.balanceMinor), [0, -1234]); assert.equal(body.total, undefined);
  const html = renderToStaticMarkup(React.createElement(FamilyAlfaBalanceRows, { balances: body.balances }));
  assert.match(html, /0,00/); assert.match(html, /-12,34/); assert.match(html, /Источник: AlfaCRM/); assert.match(html, /МСК/);
  assert.doesNotMatch(html, /₽|RUB|руб\./); assert.match(html, /отдельно от банковских платежей/);
});

test("missing or mismatched source lineage cannot become a confirmed monetary balance", async (t) => {
  const db = fixture(t); balance(db, { lineage: false }); balance(db, { customer: "wrong-hash" });
  balance(db, { customer: "wrong-record" }); balance(db, { customer: "wrong-branch" });
  balance(db, { customer: "bad-time" });
  db.exec("UPDATE alfacrm_raw_observations SET payload_hash='bad' WHERE record_id='customer-balance-v2:wrong-hash'; UPDATE alfacrm_raw_observations SET record_id='legacy' WHERE record_id='customer-balance-v2:wrong-record'; UPDATE alfacrm_raw_observations SET remote_branch_id='other' WHERE record_id='customer-balance-v2:wrong-branch'; UPDATE alfacrm_raw_observations SET observed_at='invalid' WHERE record_id='customer-balance-v2:bad-time'");
  const body = await (await GET(request())).json();
  assert.equal(body.balances.length, 5); assert.ok(body.balances.every((row) => row.status === "unconfirmed" && row.balanceMinor === null && row.observedAt === null));
  const html = renderToStaticMarkup(React.createElement(FamilyAlfaBalanceRows, { balances: body.balances }));
  assert.match(html, /Не подтверждён/); assert.doesNotMatch(html, /0,00|NaN|Invalid Date/);
});

test("invalid imported branch identity does not fall back to a matching display label", async (t) => {
  const db = fixture(t); balance(db);
  db.exec("UPDATE entities SET metadata='{\"localBranchId\":\"missing\"}' WHERE id='F-A'");
  assert.equal((await GET(request())).status, 404);
  db.exec("UPDATE entities SET metadata='{}' WHERE id='F-A'; INSERT INTO organization_branches VALUES('DUP','School','Активен',4)");
  assert.equal((await GET(request())).status, 404);
});

test("schema or database failure exposes a generic error, never zero, SQL or credentials", async (t) => {
  const db = fixture(t); db.exec("DROP TABLE alfacrm_projection_lineage");
  const result = await GET(request()); assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /no such|SELECT|0,00/);
});

test("unimported UI states are explicit and integration is mounted only for the current family identity", () => {
  const html = renderToStaticMarkup(React.createElement(FamilyAlfaBalanceRows, { balances: [] }));
  assert.match(html, /Остаток не получен/); assert.doesNotMatch(html, /0,00/);
  const source = readFileSync(new URL("../app/components/FamilyWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /<FamilyAlfaBalances key=\{detail.family.id\} familyId=\{detail.family.id\}/);
});
