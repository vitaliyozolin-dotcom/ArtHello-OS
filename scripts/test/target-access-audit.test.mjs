import test from "node:test";
import assert from "node:assert/strict";
import { summarizeTargetAccess } from "../../deploy/target-access-audit.mjs";

const targetHash = "4edb1dc0f3a13ed7463b08ecf08dd55d091e94f73aa47c13ed6fce6f5c22f250";

test("target access audit reports family/student capabilities and Atlas diary grant", () => {
  const result = summarizeTargetAccess({
    users: [{
      id: "USR-K",
      displayName: "Екатерина Груданова",
      status: "Активен",
      role: "Администратор",
      isAdministrative: true,
      allowedModules: ["clients", "education"],
    }],
    systemGrants: [
      { userId: "USR-K", systemId: "SYS-ARTHELLO-OS", status: "Активен", role: "Администратор" },
      { userId: "USR-K", systemId: "SYS-SCHOOL-ATLAS", status: "Активен", role: "admin", lastSyncStatus: "Вход через ArtHello OS" },
    ],
  }, targetHash);

  assert.equal(result.accountMatches, 1);
  assert.equal(result.familyCardEdit, true);
  assert.equal(result.studentCardEdit, true);
  assert.equal(result.familyDiaryAccessManagement, true);
  assert.deepEqual(result.atlasDiary, { active: true, role: "admin", loginMode: "Вход через ArtHello OS" });
  assert.equal(result.schoolDiary.active, false);
  assert.equal(result.productionMutations, false);
});

test("target access audit fails closed when the account identity is ambiguous", () => {
  assert.throws(() => summarizeTargetAccess({
    users: [
      { id: "A", displayName: "Екатерина Груданова" },
      { id: "B", displayName: "Екатерина Груданова" },
    ],
    systemGrants: [],
  }, targetHash), /TARGET_ACCOUNT_AMBIGUOUS/);
});

test("administrative flag alone never grants family or student mutation capability", () => {
  const result = summarizeTargetAccess({
    users: [{
      id: "USR-K",
      displayName: "Екатерина Груданова",
      status: "Активен",
      role: "Завуч",
      isAdministrative: true,
      allowedModules: ["clients"],
    }],
    systemGrants: [],
  }, targetHash);
  assert.equal(result.familyCardEdit, false);
  assert.equal(result.studentCardEdit, false);
  assert.equal(result.familyDiaryAccessManagement, false);
});
