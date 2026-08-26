import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const db = read("../db/index.ts");
const analytics = read("../app/api/analytics/route.ts");
const analyticsActions = read("../app/api/analytics-actions/route.ts");

test("empty is a durable system data mode", () => {
  assert.match(db, /export type SystemDataMode = "test" \| "source_only" \| "empty"/);
  assert.match(db, /row\?\.state_value === "test" \|\| row\?\.state_value === "empty"/);
  assert.match(db, /const mode = await getSystemDataMode\(\)/);
  assert.match(db, /if \(mode === "empty"\) return/);
});

test("core initialization repairs schema without restoring business data in empty mode", () => {
  assert.match(db, /await initializeCoreTables\(\);\s*if \(mode !== "empty"\) await seedInitialDemoData\(\)/);
  assert.match(db, /async function initializeCoreTables\(\)/);
  assert.match(db, /async function seedInitialDemoData\(\) \{\s*await seedRegistry\(\)/);
  assert.match(db, /const hasAllCoreTables =/);
  assert.match(db, /marker\?\.state_value !== CORE_SCHEMA_VERSION \|\| !hasAllCoreTables/);
});

test("derived and analytics bootstraps cannot repopulate empty mode", () => {
  assert.match(db, /async function ensurePaymentDerivedCounterparties\(\) \{\s*if \(await getSystemDataMode\(\) === "empty"\) return/);
  assert.match(db, /async function ensureFinanceEntityLinksBootstrap\(\) \{\s*if \(await getSystemDataMode\(\) === "empty"\) return/);
  assert.match(db, /async function ensureIntegrationDemoBootstrap\(\) \{\s*if \(await getSystemDataMode\(\) === "empty"\) return/);
  assert.match(db, /export async function ensureAnalyticsDemoBootstrap[\s\S]*?if \(await getSystemDataMode\(\) === "empty"\) return before/);
  assert.match(analytics, /if\(await getSystemDataMode\(\)!=="empty"\)await ensureAnalyticsDemoBootstrap\(\)/);
  assert.match(analyticsActions, /if\(await getSystemDataMode\(\)!=="empty"\)await ensureAnalyticsDemoBootstrap\(\)/);
});
