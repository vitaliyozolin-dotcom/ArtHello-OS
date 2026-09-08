import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { API_ROLES, accessibleModules, canAccessApi, canAccessModule, resolveModuleRoute } from "../lib/access-policy.ts";
import { moduleCatalog } from "../data/test-snapshot.ts";

// Product contract, kept independent of the policy's internal endpoint maps.
const sections = {
  tasks: ["tasks"], finance: ["finance"], accounting: ["accounting"],
  registry: ["entities", "entity-detail"], sales: ["sales"], clients: ["entities", "families"],
  education: ["education"], methods: ["education"], hr: ["hr"], legal: ["legal"],
  procurement: ["procurement"], food: ["food"], safety: ["safety"], medical: ["medical"],
  content: ["content"], events: ["tasks"], projects: ["strategy"], analytics: ["analytics"],
  contractors: ["contractors"], assets: ["procurement"], quality: ["readiness"],
  acceptance: ["readiness", "acceptance"], integrations: ["integrations"], access: [],
};
const moduleIds = moduleCatalog.map(({ id }) => id);
const businessMutations = ["tasks", "task-actions", "finance-actions", "accounting-actions", "sales-actions", "content-actions", "content-generate", "education-actions", "hr-actions", "legal-actions", "procurement-actions", "food-actions", "safety-actions", "strategy-actions", "analytics-actions", "integration-actions", "readiness-actions", "acceptance", "entities", "families", "entity-relations", "entity-documents", "entity-merge", "medical-actions"];
const user = (apiRole, allowedModules, extra = {}) => ({ apiRole, isSystemOwner: apiRole === "OWNER", allowedModules, ...extra });

test("contract covers every product section including special access and medical", () => {
  assert.deepEqual(Object.keys(sections).sort(), moduleIds.filter((id) => id !== "home").sort());
});

for (const apiRole of API_ROLES) {
  test(`${apiRole}: unchecked sections are hidden, direct hashes close, and APIs deny GET and POST`, () => {
    const revoked = user(apiRole, [], { canAccessMedical: true });
    assert.deepEqual(accessibleModules(revoked, moduleIds), ["home"]);
    for (const [moduleId, endpoints] of Object.entries(sections)) {
      assert.equal(resolveModuleRoute(revoked, moduleId, moduleIds), "home", moduleId);
      for (const endpoint of endpoints) {
        assert.equal(canAccessApi(revoked, `/api/${endpoint}`, "GET"), false, endpoint);
        assert.equal(canAccessApi(revoked, `/api/${endpoint}`, "POST"), false, endpoint);
      }
    }
    for (const endpoint of businessMutations) {
      assert.equal(canAccessApi(revoked, `/api/${endpoint}`, "POST"), false, endpoint);
    }
  });
  test(`${apiRole}: each single checked section opens only its screen and documented reads`, () => {
    for (const [moduleId, endpoints] of Object.entries(sections)) {
      const context = user(apiRole, [moduleId], { canAccessMedical: true });
      const allowed = moduleId === "access" ? apiRole === "OWNER" : moduleId === "medical" ? apiRole === "MEDICAL" : true;
      assert.equal(canAccessModule(context, moduleId), allowed, moduleId);
      assert.equal(resolveModuleRoute(context, moduleId, moduleIds), allowed ? moduleId : "home", moduleId);
      assert.deepEqual(accessibleModules(context, moduleIds).sort(), (allowed ? ["home", moduleId] : ["home"]).sort());
      for (const endpoint of endpoints) assert.equal(canAccessApi(context, `/api/${endpoint}`, "GET"), allowed, endpoint);
    }
  });
}

test("manual section assignment cannot grant role-prohibited mutations or special authority", () => {
  const context = user("EMPLOYEE", Object.keys(sections));
  for (const endpoint of ["finance-actions", "accounting-actions", "sales-actions", "content-actions", "education-actions", "hr-actions", "legal-actions", "procurement-actions", "food-actions", "safety-actions", "strategy-actions", "analytics-actions", "integration-actions", "readiness-actions", "acceptance", "entities", "families", "entity-merge"]) {
    assert.equal(canAccessApi(context, `/api/${endpoint}`, "POST"), false, endpoint);
  }
  assert.equal(canAccessModule(context, "access"), false);
  assert.equal(canAccessModule(context, "medical"), false);
  assert.equal(canAccessModule(user("OWNER", ["finance"], { isSystemOwner: false }), "finance"), false);
  assert.equal(canAccessModule(user("UNKNOWN", ["finance"]), "finance"), false);
});

// Execute actual route handlers with real domain functions and deterministic
// session/empty database adapters. No production identity or record is used.
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const fixtureKey = "__sectionAssignmentFixture";
const dbAdapter = dataModule(`
  const query = { from(){return this}, innerJoin(){return this}, where(){return this}, orderBy(){return this}, limit(){return this}, then(resolve,reject){return Promise.resolve([]).then(resolve,reject)} };
  export const ensureCoreTables=async()=>{globalThis.${fixtureKey}.reads++};
  export const ensureAnalyticsDemoBootstrap=async()=>{};
  export const getSystemDataMode=async()=>"empty";
  export const getDb=()=>({select:()=>query});
`);
const authAdapter = dataModule(`
  export const getAuthenticatedRequestContext=async()=>{const f=globalThis.${fixtureKey};if(f.authError)throw Error("unavailable");return f.context};
  export const verifyAuthenticatedRequestCsrf=()=>{};
`);
const workerAdapter = dataModule(`export const env={DB:{prepare:()=>({bind(){return this},all:async()=>({results:[]}),first:async()=>null})}};`);

async function loadHandler(name) {
  const raw = await readFile(new URL(`../app/api/${name}/route.ts`, import.meta.url), "utf8");
  const compiled = stripTypeScriptTypes(raw, { mode: "strip" }).replace(/from\s*["']([^"']+)["']/g, (_match, dependency) => {
    let mapped;
    if (dependency === "../../../db") mapped = dbAdapter;
    else if (dependency === "../../../lib/production-auth") mapped = authAdapter;
    else if (dependency === "cloudflare:workers") mapped = workerAdapter;
    else if (dependency === "drizzle-orm") mapped = dataModule("export const asc=x=>x,desc=x=>x,eq=(...x)=>x,and=(...x)=>x;");
    else if (dependency === "../../../lib/task-access-query") mapped = dataModule("export const selectVisibleTasks=async()=>[],redactHiddenTaskReferences=rows=>rows;");
    else if (dependency === "../../../db/schema") {
      const imports = raw.match(/import\s*\{([^}]+)\}\s*from\s*["']\.\.\/\.\.\/\.\.\/db\/schema["']/)[1];
      mapped = dataModule(imports.split(",").map((x) => x.trim()).filter(Boolean).map((name) => `export const ${name}={};`).join("\n"));
    } else if (dependency.startsWith("../../../lib/")) mapped = new URL(`../lib/${dependency.slice("../../../lib/".length)}.ts`, import.meta.url).href;
    assert.ok(mapped, `Unmocked dependency ${name}: ${dependency}`);
    return `from "${mapped}"`;
  });
  return import(dataModule(compiled));
}
const routes = ["accounting", "hr", "legal", "procurement", "food", "safety", "strategy", "analytics", "readiness", "acceptance"];
const moduleByRoute = { strategy: "projects", readiness: "quality" };
for (const route of routes) {
  const { GET, POST } = await loadHandler(route);
  const moduleId = moduleByRoute[route] ?? route;
  const request = () => new Request(`https://arthello.example.test/api/${route}`, { headers: { "x-arthello-role": "OWNER", "x-arthello-system-owner": "1" } });
  const fixture = (context) => (globalThis[fixtureKey] = { reads: 0, context: context ? { apiRole: context.apiRole, actor: "fixture@example.test", appUserId: "FIXTURE-USER", auth: { user: context } } : null });
  test(`${route} GET: an explicitly checked section opens for EMPLOYEE beyond the role template`, async () => {
    const state = fixture(user("EMPLOYEE", [moduleId]));
    const response = await GET(request());
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.equal(state.reads, route === "acceptance" ? 0 : 1);
  });
  test(`${route} GET: no checkbox denies before data reads even for DIRECTOR and forged OWNER headers`, async () => {
    const state = fixture(user("DIRECTOR", []));
    assert.equal((await GET(request())).status, 403);
    assert.equal(state.reads, 0);
  });
  test(`${route} GET: unassigned legacy EMPLOYEE remains denied`, async () => {
    const state = fixture(user("EMPLOYEE", undefined));
    assert.equal((await GET(request())).status, 403);
    assert.equal(state.reads, 0);
  });
  test(`${route} GET: absent session and unavailable authentication fail closed`, async () => {
    const state = fixture(null);
    assert.equal((await GET(request())).status, 401);
    state.authError = true;
    assert.equal((await GET(request())).status, 503);
    assert.equal(state.reads, 0);
  });
  if (route === "acceptance") test("acceptance: read checkbox cannot approve a release", async () => {
    const state = fixture(user("EMPLOYEE", ["acceptance"]));
    assert.equal((await POST(new Request("https://arthello.example.test/api/acceptance", { method: "POST" }))).status, 403);
    assert.equal(state.reads, 0);
  });
}
