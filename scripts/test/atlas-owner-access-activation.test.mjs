import assert from "node:assert/strict";
import test from "node:test";

import { activateAtlasOwnerAccess } from "../../deploy/activate-atlas-owner-access.mjs";

function settings(grant) {
  return {
    canManage: true,
    me: {
      id: "USR-OWNER",
      displayName: "Владелец проверки",
      role: "Собственник",
      isAdministrative: true,
      status: "Активен",
      accessVersion: 7,
      updatedAt: "2026-09-11T00:00:00.000Z",
    },
    systemGrants: grant ? [grant] : [],
  };
}

function atlasGrant(role = "director") {
  return {
    userId: "USR-OWNER",
    systemId: "SYS-SCHOOL-ATLAS",
    role,
    status: "Активен",
    accessVersion: 7,
  };
}

test("missing owner Atlas grant is created through the owner settings action and then verified", async () => {
  const calls = [];
  let current = settings(null);
  const client = {
    async login() { calls.push("login"); return { userId: "USR-OWNER", isSystemOwner: true, mustChangePassword: false }; },
    async settings() { calls.push("settings"); return current; },
    async saveOwnerAtlasAccess(payload) {
      calls.push(["save", payload]);
      current = settings(atlasGrant());
      return { diaryAccess: { enabled: true, role: "director" } };
    },
    async verifyAtlasSso(owner) {
      calls.push(["sso", owner.id]);
      return { role: "director", school: "Школа Атлас", redirectChainVerified: true };
    },
    async logoutAll() { calls.push("logout"); },
  };

  const result = await activateAtlasOwnerAccess(client);
  assert.deepEqual(result, {
    status: "accepted",
    mutation: "created",
    ownerGrant: "director",
    atlasSso: "verified",
  });
  assert.deepEqual(calls[2], ["save", {
    action: "saveOwnerDiaryAccess",
    systemId: "SYS-SCHOOL-ATLAS",
    enabled: true,
    diaryRole: "director",
    expectedAccessVersion: 7,
    expectedUpdatedAt: "2026-09-11T00:00:00.000Z",
  }]);
  assert.equal(calls.at(-1), "logout");
});

test("an already-active director grant is idempotent", async () => {
  let saves = 0;
  const client = {
    async login() { return { userId: "USR-OWNER", isSystemOwner: true, mustChangePassword: false }; },
    async settings() { return settings(atlasGrant()); },
    async saveOwnerAtlasAccess() { saves += 1; },
    async verifyAtlasSso() { return { role: "director", school: "Школа Атлас", redirectChainVerified: true }; },
    async logoutAll() {},
  };
  const result = await activateAtlasOwnerAccess(client);
  assert.equal(result.mutation, "already-active");
  assert.equal(saves, 0);
});

test("a conflicting existing Atlas role is never overwritten", async () => {
  let saves = 0;
  let verified = 0;
  let loggedOut = 0;
  const client = {
    async login() { return { userId: "USR-OWNER", isSystemOwner: true, mustChangePassword: false }; },
    async settings() { return settings(atlasGrant("deputy")); },
    async saveOwnerAtlasAccess() { saves += 1; },
    async verifyAtlasSso() { verified += 1; },
    async logoutAll() { loggedOut += 1; },
  };
  await assert.rejects(() => activateAtlasOwnerAccess(client), /ATLAS_OWNER_GRANT_CONFLICT/);
  assert.equal(saves, 0);
  assert.equal(verified, 0);
  assert.equal(loggedOut, 1);
});

test("non-owner authentication fails closed", async () => {
  let settingsCalls = 0;
  const client = {
    async login() { return { userId: "USR-EMPLOYEE", isSystemOwner: false, mustChangePassword: false }; },
    async settings() { settingsCalls += 1; },
    async logoutAll() {},
  };
  await assert.rejects(() => activateAtlasOwnerAccess(client), /CANONICAL_OWNER_REQUIRED/);
  assert.equal(settingsCalls, 0);
});

test("grant without a complete Atlas SSO result is rejected", async () => {
  const client = {
    async login() { return { userId: "USR-OWNER", isSystemOwner: true, mustChangePassword: false }; },
    async settings() { return settings(atlasGrant()); },
    async verifyAtlasSso() { return { role: "director", school: "Школа Атлас", redirectChainVerified: false }; },
    async logoutAll() {},
  };
  await assert.rejects(() => activateAtlasOwnerAccess(client), /ATLAS_SSO_NOT_VERIFIED/);
});
