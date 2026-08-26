import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("production access screen describes the live authorization flow", () => {
  const source = read("../app/components/AccessWorkspace.tsx");

  assert.match(source, /Рабочий контур доступа/);
  assert.match(source, /Права проверяются сервером при каждом запросе/);
  assert.doesNotMatch(source, /Тестовый контур|В тесте — через ChatGPT|нужен отдельный сервис авторизации/);
});

test("operational APIs derive cross-module chains from stored rows", () => {
  const routePaths = [
    "../app/api/legal/route.ts",
    "../app/api/safety/route.ts",
    "../app/api/food/route.ts",
    "../app/api/accounting/route.ts",
    "../app/api/strategy/route.ts",
  ];
  const sources = routePaths.map(read).join("\n");

  assert.doesNotMatch(sources, /FAM-T-|EMP-T-|DOG-T-|FIN-TEST|OBJ-T-|LCON-T-|STR-PRJ-T|SAFE-(?:SYS|EQ|CHK|FLT|REP)-T|SYNTHETIC_[A-Z_]+_TEST/);
  assert.match(read("../app/api/legal/route.ts"), /const contract = contracts\[0\]/);
  assert.match(read("../app/api/safety/route.ts"), /linkedPaymentIds/);
  assert.match(read("../app/api/food/route.ts"), /projectIds\.has\(item\.projectEntityId\)/);
  assert.match(read("../app/api/accounting/route.ts"), /const anchor = documents\.find/);
  assert.match(read("../app/api/strategy/route.ts"), /const project = projects\[0\]/);
});

test("production actions cannot recreate demo identities or fixed demo records", () => {
  const paths = [
    "../app/api/procurement-actions/route.ts",
    "../app/api/safety-actions/route.ts",
    "../app/api/strategy-actions/route.ts",
    "../app/api/content-actions/route.ts",
    "../app/api/legal-actions/route.ts",
  ];
  const sources = paths.map(read).join("\n");

  assert.doesNotMatch(sources, /EMP-T-|FAM-T-|DOG-T-|FIN-TEST|OBJ-T-|STR-PRJ-T|SAFE-SYS-T|MANUAL_TEST|2026-08-2\d|2026-09-/);
  assert.match(sources, /isDemoReference/);
  assert.match(read("../app/api/content-actions/route.ts"), /sourceType: "MANUAL"/);
  assert.match(read("../app/api/procurement-actions/route.ts"), /requesterEntityId/);
  assert.match(read("../app/api/safety-actions/route.ts"), /system\.objectEntityId !== objectId/);
  assert.match(read("../app/api/strategy-actions/route.ts"), /strategyProjects/);
});

test("manual entities receive stable production IDs and source semantics", () => {
  const source = read("../app/api/entities/route.ts");

  assert.match(source, /crypto\.randomUUID/);
  assert.match(source, /"MANUAL", "CSV_IMPORT", "XLSX_IMPORT", "API_IMPORT"/);
  assert.doesNotMatch(source, /FAM-T-105|`\$\{prefix\}-T-|SYNTHETIC", "MANUAL/);
});

test("content source policy distinguishes stored and empty data without test claims", () => {
  const source = read("../app/api/content/route.ts");

  assert.match(source, /"STORED" : "EMPTY"/);
  assert.doesNotMatch(source, /SYNTHETIC_TEST|Все метрики и публикации синтетические/);
});
