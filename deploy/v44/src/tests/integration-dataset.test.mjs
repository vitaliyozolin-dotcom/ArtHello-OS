import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("integration workspace requires an explicit import scope and exposes no demo restore controls", async () => {
  const workspace = await readFile(new URL("../app/components/IntegrationWorkspace.tsx", import.meta.url), "utf8");
  const actions = await readFile(new URL("../app/api/integration-actions/route.ts", import.meta.url), "utf8");

  assert.match(workspace, /Какие данные получать/);
  assert.match(workspace, /dataScopes/);
  assert.match(workspace, /Семьи/);
  assert.match(workspace, /Операции по счетам/);
  assert.doesNotMatch(workspace, /Добавить тестовые данные/);
  assert.doesNotMatch(actions, /action === "addTestData"/);
  assert.doesNotMatch(actions, /action === "restoreTestMode"/);
});

test("core initialization uses a durable schema marker instead of reseeding on every request", async () => {
  const database = await readFile(new URL("../db/index.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0020_foamy_the_twelve.sql", import.meta.url), "utf8");
  const health = await readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8");

  assert.match(database, /CORE_SCHEMA_VERSION/);
  assert.match(database, /system_runtime_state/);
  assert.match(database, /coreTablesPromise/);
  assert.match(database, /SYSTEM_DEMO_PURGE_VERSION/);
  assert.match(database, /ensureSourceOnlyCleanup/);
  assert.match(database, /ON CONFLICT\(id\) DO NOTHING/);
  assert.match(migration, /CREATE TABLE `organization_branches`/);
  assert.match(migration, /CREATE TABLE `app_users`/);
  assert.match(health, /integrationTestData/);
  assert.match(health, /conflicts: testData\.conflicts/);
  assert.match(health, /cache-control/);
  assert.doesNotMatch(health, /getRequestUser/);
});
