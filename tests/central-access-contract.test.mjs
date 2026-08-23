import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const syncRoute = readFileSync("app/api/internal/staff-sync/route.ts", "utf8");
const schoolRoute = readFileSync("app/api/school/route.ts", "utf8");
const interfaceSource = readFileSync("app/school-app.tsx", "utf8");
const migration = readFileSync("drizzle/0005_central_staff_access.sql", "utf8");

test("staff access is accepted only through signed central events", () => {
  assert.match(syncRoute, /CENTRAL_ACCESS_SECRET/);
  assert.match(syncRoute, /x-arthello-signature/);
  assert.match(syncRoute, /timingSafeEqual/);
  assert.match(syncRoute, /5 \* 60 \* 1000/);
  assert.match(syncRoute, /central_access_version/);
});

test("central block and password reset revoke existing sessions", () => {
  assert.match(syncRoute, /DELETE FROM auth_sessions WHERE user_id = \?/);
  assert.match(syncRoute, /password_state = 'reset_required'/);
  assert.match(syncRoute, /status = \?/);
  assert.match(syncRoute, /createCredentialToken/);
});

test("local management cannot create or reset staff credentials", () => {
  assert.match(schoolRoute, /centralDirectoryActions/);
  assert.match(schoolRoute, /Дневник принимает подписанную проекцию/);
  assert.doesNotMatch(interfaceSource, /<option value="teacher">Учитель<\/option>/);
  assert.match(interfaceSource, /Сотрудники, семьи, родители, ученики и классы создаются один раз — в ArtHello OS/);
});

test("local user records retain the central identity without changing teaching assignments", () => {
  assert.match(migration, /central_user_id/);
  assert.match(migration, /identity_source/);
  assert.match(migration, /central_access_events/);
  assert.doesNotMatch(syncRoute, /teacher_assignments/);
});
