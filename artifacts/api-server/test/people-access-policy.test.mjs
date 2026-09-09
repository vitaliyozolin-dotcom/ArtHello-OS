import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const policy = await import(
  pathToFileURL(
    path.resolve(testDir, "../src/lib/security/people-access-policy.ts"),
  ).href
);
const employee = {
  id: "11111111-1111-4111-8111-111111111111",
  fullName: "Тестовый сотрудник",
  status: "active",
  employeeKind: "real_employee",
  employeeType: "administrator",
  classificationStatus: "classified",
  branchCrmId: "branch-1",
  isTestData: false,
};
const scope = { branchIds: ["branch-1"], legalEntityIds: ["entity-1"] };

test("provision requires complete scope and assignable non-owner role", () => {
  const plan = policy.buildPeopleAccessPlan(employee, null, {
    action: "PROVISION",
    login: "staff@example.test",
    role: "viewer",
    ...scope,
  });
  assert.equal(plan.ready, true);
  assert.equal(plan.target.role, "viewer");
  assert.equal(plan.approvalRequired, true);
  assert.equal(plan.forbiddenEffects.includes("ASSIGN_OWNER_ROLE"), true);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
});
test("same input creates stable plan hash", () => {
  const input = {
    action: "PROVISION",
    login: "staff@example.test",
    role: "accountant",
    ...scope,
  };
  assert.equal(
    policy.buildPeopleAccessPlan(employee, null, input).planHash,
    policy.buildPeopleAccessPlan(employee, null, input).planHash,
  );
});
test("unclassified or synthetic employee fails closed", () => {
  const plan = policy.buildPeopleAccessPlan(
    {
      ...employee,
      employeeKind: "synthetic_shared_teacher",
      classificationStatus: "needs_review",
    },
    null,
    {
      action: "PROVISION",
      login: "staff@example.test",
      role: "viewer",
      ...scope,
    },
  );
  assert.equal(plan.ready, false);
  assert.equal(
    plan.blockers.includes("EMPLOYEE_CLASSIFICATION_REQUIRED"),
    true,
  );
  assert.equal(plan.blockers.includes("EMPLOYEE_KIND_NOT_ELIGIBLE"), true);
});
test("provision refuses duplicate linked access", () => {
  const existing = {
    id: "access-1",
    employeeId: employee.id,
    login: "old",
    role: "viewer",
    active: true,
    scope: { unrestricted: false, ...scope },
  };
  const plan = policy.buildPeopleAccessPlan(employee, existing, {
    action: "PROVISION",
    login: "new",
    role: "viewer",
    ...scope,
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.blockers.includes("ACCESS_ALREADY_LINKED"), true);
});
test("offboarding revokes sessions but never deletes history", () => {
  const existing = {
    id: "access-1",
    employeeId: employee.id,
    login: "old",
    role: "viewer",
    active: true,
    scope: { unrestricted: false, ...scope },
  };
  const plan = policy.buildPeopleAccessPlan(employee, existing, {
    action: "OFFBOARD",
  });
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.effects, [
    "DEACTIVATE_ACCESS",
    "REVOKE_EXISTING_SESSIONS",
  ]);
  assert.equal(
    plan.forbiddenEffects.includes("DELETE_EMPLOYEE_OR_ACCESS_HISTORY"),
    true,
  );
});
test("owner access is immutable for operator", () => {
  const existing = {
    id: "access-owner",
    employeeId: employee.id,
    login: "owner",
    role: "owner",
    active: true,
    scope: { unrestricted: true, branchIds: [], legalEntityIds: [] },
  };
  const plan = policy.buildPeopleAccessPlan(employee, existing, {
    action: "OFFBOARD",
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.blockers.includes("OWNER_ACCESS_IMMUTABLE"), true);
});
