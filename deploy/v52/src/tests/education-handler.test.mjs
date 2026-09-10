import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// Execute the real GET handler against deterministic session/database adapters.
// No production session, database, identity, or network is used by these tests.
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const tableNames = ["educationAttendance", "educationCommunications", "educationFeedback", "educationGroups", "educationLessons", "educationPrograms", "educationProgress", "educationStudents", "entities", "organizationBranches", "userBranchAccess"];
const schema = dataModule(tableNames.map((name) => `export const ${name} = { name: "${name}", ...Object.fromEntries(["id", "branchId", "userId", "status", "title", "scheduledAt", "createdAt", "displayName"].map(field => [field, {table: "${name}", field}])) };`).join("\n"));
const adapters = {
  "drizzle-orm": dataModule("export const eq=(column,value)=>({column,value}); export const and=(...conditions)=>({conditions}); export const asc=(column)=>column;"),
  "../../../db": dataModule("export const ensureCoreTables=async()=>{}; export const getDb=()=>globalThis.__educationHandlerFixture.db;"),
  "../../../db/schema": schema,
  "../../../lib/production-auth": dataModule("export const getAuthenticatedRequestContext=async()=>{ const fixture=globalThis.__educationHandlerFixture; if(fixture.authError) throw new Error('auth unavailable'); return fixture.context; };"),
  "../../../lib/task-access-query": dataModule("export const selectVisibleTasks=async()=>[]; export const redactHiddenTaskReferences=(rows)=>rows.map(row=>({...row,relatedTaskId:0}));"),
  "../../../lib/education": new URL("../lib/education.ts", import.meta.url).href,
  "../../../lib/access-policy": new URL("../lib/access-policy.ts", import.meta.url).href,
};
const raw = await readFile(new URL("../app/api/education/route.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(raw, { mode: "strip" }).replace(/from\s+"([^"]+)"/g, (_match, name) => {
  assert.ok(adapters[name], `Unmocked dependency: ${name}`);
  return `from "${adapters[name]}"`;
});
const { GET } = await import(dataModule(compiled));

function evaluate(condition, row) {
  if (condition.conditions) return condition.conditions.every((entry) => evaluate(entry, row));
  const left = row[condition.column.table]?.[condition.column.field];
  const right = condition.value?.table ? row[condition.value.table]?.[condition.value.field] : condition.value;
  return left === right;
}

function database(tables) {
  return { select(projection) { return { from(table) {
    let rows = (tables[table.name] ?? []).map((row) => ({ [table.name]: row }));
    const query = {
      innerJoin(joined, condition) {
        rows = rows.flatMap((row) => (tables[joined.name] ?? []).map((entry) => ({ ...row, [joined.name]: entry }))).filter((row) => evaluate(condition, row));
        return query;
      },
      where(condition) { rows = rows.filter((row) => evaluate(condition, row)); return query; },
      orderBy() { return query; },
      then(resolve, reject) {
        const result = rows.map((row) => projection ? Object.fromEntries(Object.entries(projection).map(([name, column]) => [name, row[column.table]?.[column.field]])) : row[table.name]);
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return query;
  } }; } };
}

function fixture(apiRole = "ADMIN", userPatch = {}) {
  const appUserId = apiRole === "TEACHER" ? "EMP-1" : "USER-1";
  const user = { apiRole, isSystemOwner: false, isAdministrative: false, ...userPatch };
  const tables = {
    organizationBranches: [{ id: "BR-SCHOOL", status: "Активен" }, { id: "BR-NEBO", status: "Активен" }, { id: "BR-CLOSED", status: "Закрыт" }],
    userBranchAccess: [{ userId: appUserId, branchId: "BR-SCHOOL" }, { userId: "OTHER", branchId: "BR-NEBO" }, { userId: appUserId, branchId: "BR-CLOSED" }],
    educationGroups: [
      { id: "G-1", programId: "P-1", unitEntityId: "BR-SCHOOL", teacherEntityId: "EMP-1" },
      { id: "G-2", programId: "P-2", unitEntityId: "BR-NEBO", teacherEntityId: "EMP-1" },
      { id: "G-3", programId: "P-1", unitEntityId: "BR-SCHOOL", teacherEntityId: "EMP-2" },
      { id: "G-4", programId: "P-4", unitEntityId: "BR-CLOSED", teacherEntityId: "EMP-1" },
      { id: "G-5", programId: "P-5", unitEntityId: "BR-UNKNOWN", teacherEntityId: "EMP-1" },
    ],
    educationStudents: [
      { id: "S-1", groupId: "G-1", childEntityId: "CH-1", familyEntityId: "F-1" },
      { id: "S-2", groupId: "G-2", childEntityId: "CH-2", familyEntityId: "F-2" },
      { id: "S-3", groupId: "G-3", childEntityId: "CH-3", familyEntityId: "F-3" },
    ],
    educationLessons: [{ id: "L-1", groupId: "G-1", teacherEntityId: "EMP-1", substituteEntityId: "", scheduledAt: "2026-09-07T08:00:00Z" }, { id: "L-2", groupId: "G-2", teacherEntityId: "EMP-1", substituteEntityId: "", scheduledAt: "2026-09-07T08:00:00Z" }],
    educationAttendance: [{ id: "A-1", lessonId: "L-1", studentId: "S-1", attendanceStatus: "Присутствовал" }, { id: "A-2", lessonId: "L-2", studentId: "S-2", attendanceStatus: "Присутствовал" }],
    educationPrograms: [{ id: "P-1", authorEntityId: "AUTHOR-1", methodistEntityId: "METHOD-1" }, { id: "P-2", authorEntityId: "AUTHOR-2", methodistEntityId: "METHOD-2" }],
    educationProgress: [{ id: "PR-1", studentId: "S-1", score: 75 }, { id: "PR-2", studentId: "S-2", score: 81 }],
    educationFeedback: [{ id: "FB-1", studentId: "S-1", familyEntityId: "F-1", relatedTaskId: 12 }, { id: "FB-2", studentId: "S-2", familyEntityId: "F-2" }],
    educationCommunications: [{ id: "C-1", audienceType: "Группа", audienceId: "G-1" }, { id: "C-2", audienceType: "Семья", audienceId: "F-1" }, { id: "C-3", audienceType: "Семья", audienceId: "F-2" }, { id: "C-4", audienceType: "Неизвестно", audienceId: "F-1" }],
    entities: ["EMP-1", "EMP-2", "CH-1", "CH-2", "CH-3", "F-1", "F-2", "F-3", "AUTHOR-1", "METHOD-1", "AUTHOR-2", "METHOD-2", "UNRELATED-MEDICAL-PERSON"].map((id) => ({ id, displayName: id })),
  };
  const value = { context: { appUserId, apiRole, actor: "fixture@example.test", auth: { user } }, tables, db: database(tables) };
  globalThis.__educationHandlerFixture = value;
  return value;
}
const request = () => new Request("https://arthello.example.test/api/education", { headers: { "x-arthello-role": "OWNER" } });
const ids = (rows) => rows.map((row) => row.id);

test("GET uses authenticated ADMIN identity and active personal branch grants", async () => {
  fixture();
  const response = await GET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(ids(body.groups), ["G-1", "G-3"]);
  assert.deepEqual(ids(body.students), ["S-1", "S-3"]);
  assert.deepEqual(ids(body.lessons), ["L-1"]);
  assert.deepEqual(ids(body.attendance), ["A-1"]);
  assert.deepEqual(ids(body.progress), ["PR-1"]);
  assert.deepEqual(ids(body.feedback), ["FB-1"]);
  assert.deepEqual(ids(body.communications), ["C-1"]);
  assert.deepEqual(ids(body.programs), ["P-1"]);
  for (const id of ["CH-2", "F-2", "AUTHOR-2", "METHOD-2", "UNRELATED-MEDICAL-PERSON"]) assert.equal(body.entityNames[id], undefined);
});

test("GET opens explicit education read assignment for a non-education role", async () => {
  fixture("FINANCE", { allowedModules: ["education"] });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(ids((await response.json()).groups), ["G-1", "G-3"]);
});

test("GET opens DEPUTY with methods only", async () => {
  fixture("DEPUTY", { allowedModules: ["methods"] });
  assert.equal((await GET(request())).status, 200);
});

test("GET rejects a revoked section even if the forged header says OWNER", async () => {
  fixture("ADMIN", { allowedModules: [] });
  assert.equal((await GET(request())).status, 403);
});

test("GET teacher sees own assigned group without other-family communications", async () => {
  fixture("TEACHER");
  const response = await GET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(ids(body.groups), ["G-1"]);
  assert.deepEqual(ids(body.communications), ["C-1"]);
  assert.equal(body.entityNames["CH-3"], undefined);
});

test("GET returns an empty model when no branch is granted", async () => {
  const state = fixture();
  state.tables.userBranchAccess = [];
  const response = await GET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.groups, []);
  assert.deepEqual(body.entityNames, {});
});

test("GET all-branch administration includes active branches and excludes closed or unknown branches", async () => {
  fixture("ADMIN", { isAdministrative: true });
  const body = await (await GET(request())).json();
  assert.deepEqual(ids(body.groups), ["G-1", "G-2", "G-3"]);
  assert.equal(body.entityNames["UNRELATED-MEDICAL-PERSON"], undefined);
});

test("GET canonical owner retains separate access to closed and unassigned branches", async () => {
  fixture("OWNER", { isSystemOwner: true, isAdministrative: true });
  const body = await (await GET(request())).json();
  assert.deepEqual(ids(body.groups), ["G-1", "G-2", "G-3", "G-4", "G-5"]);
});

test("GET administrative teacher cannot use the broad branch flag to read another teacher's class", async () => {
  fixture("TEACHER", { isAdministrative: true });
  const body = await (await GET(request())).json();
  assert.deepEqual(ids(body.groups), ["G-1", "G-2"]);
  assert.equal(body.entityNames["CH-3"], undefined);
});

for (const role of ["DIRECTOR", "METHODIST"]) {
  test(`GET ${role} can select an existing unassigned program before the first group exists`, async () => {
    const state = fixture(role);
    state.tables.educationGroups = [];
    state.tables.educationPrograms.push({ id: "P-FIRST-GROUP", title: "Первый учебный план", authorEntityId: "AUTHOR-NEW", methodistEntityId: "METHOD-NEW" });
    state.tables.entities.push({ id: "AUTHOR-NEW", displayName: "Unrelated author" });
    const response = await GET(request());
    assert.equal(response.status, 200);
    const body = await response.json();
    // The current group editor reads its <select> options directly from programs.
    assert.ok(body.programs.find((program) => program.id === "P-FIRST-GROUP"));
    assert.deepEqual(body.groups, []);
    assert.deepEqual(body.students, []);
    assert.deepEqual(body.entityNames, {});
  });
}

test("GET an explicitly checked section does not grant the shared program catalogue", async () => {
  fixture("FINANCE", { isAdministrative: true, allowedModules: ["education"] }).tables.educationGroups = [];
  const body = await (await GET(request())).json();
  assert.deepEqual(body.programs, []);
  assert.deepEqual(body.entityNames, {});
});

test("GET requires a real session", async () => {
  fixture().context = null;
  assert.equal((await GET(request())).status, 401);
});

test("GET authentication failure returns 503 without pretending success", async () => {
  fixture().authError = true;
  assert.equal((await GET(request())).status, 503);
});
