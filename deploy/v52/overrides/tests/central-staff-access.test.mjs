import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("app/api/settings/route.ts", "utf8");
const sync = readFileSync("lib/staff-access-sync.ts", "utf8");
const schema = readFileSync("db/schema.ts", "utf8");
const ui = readFileSync("app/components/SettingsWorkspace.tsx", "utf8");

test("ArtHello OS stores branch and system access for one employee", () => {
  assert.match(schema, /userSystemAccess/);
  assert.match(schema, /accessSyncEvents/);
  assert.match(route, /systemIds/);
  assert.match(route, /diaryRole/);
  assert.match(route, /branchIds/);
});

test("staff lifecycle is centralized", () => {
  assert.match(route, /action === "blockUser"/);
  assert.match(route, /action === "restoreUser"/);
  assert.match(route, /action === "resetPassword"/);
  assert.match(route, /prepareExistingStaffEvent/);
  assert.match(route, /accessOutboxInsert/);
  assert.match(ui, /Завершить входы/);
  assert.match(ui, /Заблокировать/);
});

test("diary synchronization is signed and failure is durable", () => {
  assert.match(sync, /SCHOOL_DIARY_SYNC_URL/);
  assert.match(sync, /CENTRAL_ACCESS_SECRET/);
  assert.match(sync, /crypto\.subtle\.sign/);
  assert.match(sync, /Ожидает подключения/);
  assert.match(sync, /Ошибка синхронизации/);
  assert.match(sync, /claimAccessSyncEvent/);
  assert.match(sync, /accessRevision/);
});
