import assert from "node:assert/strict";
import test from "node:test";
import { educationScope, filterEducationScope } from "../lib/education.ts";
import { canAccessApi, canAccessModule } from "../lib/access-policy.ts";

const groups = [
  { id: "school-own", unitEntityId: "BR-SCHOOL", teacherEntityId: "EMP-1" },
  { id: "school-other", unitEntityId: "BR-SCHOOL", teacherEntityId: "EMP-2" },
  { id: "nebo-own", unitEntityId: "BR-NEBO", teacherEntityId: "EMP-1" },
  { id: "legacy", unitEntityId: "UNT-T-001", teacherEntityId: "EMP-2" },
  { id: "unknown", unitEntityId: "BR-UNKNOWN", teacherEntityId: "EMP-1" },
];
const students = [
  { id: "child-1", groupId: "school-own", familyEntityId: "FAM-1" },
  { id: "child-2", groupId: "school-own", familyEntityId: "FAM-2" },
  { id: "child-3", groupId: "school-other", familyEntityId: "FAM-3" },
  { id: "child-4", groupId: "nebo-own", familyEntityId: "FAM-1" },
];
const school = { sectionAllowed: true, unrestrictedOwner: false, branchIds: ["BR-SCHOOL"] };
const ids = (rows) => rows.map((row) => row.id);

for (const apiRole of ["ADMIN", "DEPUTY", "DIRECTOR", "METHODIST"]) {
  test(`${apiRole} opens education within assigned branches`, () => {
    const user = { apiRole, isSystemOwner: false };
    assert.equal(canAccessModule(user, "education"), true);
    assert.equal(canAccessApi(user, "/api/education", "GET"), true);
    const scope = educationScope(apiRole, "USER-1", school);
    assert.equal(scope.kind, "branches");
    assert.deepEqual(ids(filterEducationScope(scope, groups, students).groups), ["school-own", "school-other", "legacy"]);
  });
}

for (const section of ["education", "methods"]) {
  test(`explicit ${section} assignment gives a branch read model and no extra mutation`, () => {
    const user = { apiRole: "FINANCE", isSystemOwner: false, allowedModules: [section] };
    assert.equal(canAccessModule(user, section), true);
    const allowed = canAccessApi(user, "/api/education", "GET");
    const scope = educationScope(user.apiRole, "USER-FIN", { ...school, sectionAllowed: allowed });
    assert.equal(scope.kind, "branches");
    assert.deepEqual(ids(filterEducationScope(scope, groups, students).students), ["child-1", "child-2", "child-3"]);
    assert.equal(canAccessApi(user, "/api/education-actions", "POST"), false);
  });
}

test("unchecked education is denied by navigation, API, and data scope", () => {
  const user = { apiRole: "DEPUTY", isSystemOwner: false, allowedModules: [] };
  assert.equal(canAccessModule(user, "education"), false);
  const scope = educationScope(user.apiRole, "USER-1", { ...school, sectionAllowed: canAccessApi(user, "/api/education", "GET") });
  assert.equal(scope.kind, "none");
  assert.deepEqual(filterEducationScope(scope, groups, students), { groups: [], students: [] });
});

test("an assigned section with no branch grants returns no records", () => {
  const scope = educationScope("ADMIN", "USER-1", { ...school, branchIds: [] });
  assert.deepEqual(filterEducationScope(scope, groups, students), { groups: [], students: [] });
});

test("unknown branch does not fall back to school when checking access", () => {
  const result = filterEducationScope(educationScope("ADMIN", "USER-1", school), groups, students);
  assert.equal(ids(result.groups).includes("unknown"), false);
});

test("teacher remains restricted to own groups inside assigned branches", () => {
  const result = filterEducationScope(educationScope("TEACHER", "EMP-1", school), groups, students);
  assert.deepEqual(ids(result.groups), ["school-own"]);
  assert.deepEqual(ids(result.students), ["child-1", "child-2"]);
});

test("administrative teacher still sees only own groups in active branches", () => {
  const result = filterEducationScope(educationScope("TEACHER", "EMP-1", { ...school, branchIds: ["BR-SCHOOL", "BR-NEBO"] }), groups, students);
  assert.deepEqual(ids(result.groups), ["school-own", "nebo-own"]);
  assert.equal(ids(result.students).includes("child-3"), false);
});

test("parent sees own child, excludes classmates and unassigned branches", () => {
  const result = filterEducationScope(educationScope("PARENT", "FAM-1", school), groups, students);
  assert.deepEqual(ids(result.groups), ["school-own"]);
  assert.deepEqual(ids(result.students), ["child-1"]);
});

test("empty teacher or family identity cannot match empty assignment rows", () => {
  for (const role of ["TEACHER", "PARENT"]) {
    const result = filterEducationScope(educationScope(role, "", { ...school, unrestrictedOwner: true }), groups, students);
    assert.deepEqual(result, { groups: [], students: [] });
  }
});

test("canonical owner with verified owner grant keeps full education scope", () => {
  const scope = educationScope("OWNER", "USR-OWNER", { ...school, unrestrictedOwner: true });
  assert.equal(scope.kind, "all");
  assert.deepEqual(ids(filterEducationScope(scope, groups, students).groups), ids(groups));
});

test("education assignment cannot grant medical access", () => {
  const user = { apiRole: "ADMIN", isSystemOwner: false, canAccessMedical: false, allowedModules: ["education", "medical"] };
  assert.equal(canAccessModule(user, "education"), true);
  assert.equal(canAccessModule(user, "medical"), false);
  assert.equal(canAccessApi(user, "/api/medical", "GET"), false);
});
