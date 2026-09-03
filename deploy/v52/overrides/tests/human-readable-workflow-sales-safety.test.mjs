import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const sales = read("../app/components/SalesWorkspace.tsx");
const salesActions = read("../app/api/sales-actions/route.ts");
const safety = read("../app/components/SafetyWorkspace.tsx");
const safetyActions = read("../app/api/safety-actions/route.ts");
const workflow = read("../app/components/WorkflowWorkspace.tsx");
const workflowDocuments = read("../app/api/workflow-documents/route.ts");
const database = read("../db/index.ts");

test("sales shows readable lead and advertising labels while retaining raw UTM only as technical detail", () => {
  assert.match(sales, /recordLabel\("Лид", value\)/);
  assert.match(sales, /school_2026:\s*"Набор в школу 2026"/);
  assert.match(sales, /math_future:\s*"Будущее математики"/);
  assert.match(sales, /cpc:\s*"платная реклама"/);
  assert.match(sales, /<summary>Технические метки рекламы<\/summary>/);
  assert.doesNotMatch(sales, /<strong>\{lead\.id\}<\/strong>|<h2>\{selected\.id\}<\/h2>|CONSULT-T-014|VISIT-T-014/);
  assert.match(salesActions, /Следующий шаг:\s*\$\{recordLabel\("лид", lead\.id\)/);
});

test("safety cards and generated task titles do not expose storage identifiers", () => {
  assert.match(safety, /recordLabel\("Неисправность", fault\.id\)/);
  assert.match(safety, /taskRecordLabel\(fault\.relatedTaskId\)/);
  assert.match(safety, /recordLabel\("Ремонт", repair\.id\)/);
  assert.doesNotMatch(safety, />TSK-\{fault\.relatedTaskId\}|\{repair\.id\}<small>|placeholder="ID акта/);
  assert.match(safetyActions, /Устранить неисправность:\s*\$\{fault\.description\}/);
  assert.doesNotMatch(safetyActions, /Устранить неисправность · \$\{fault\.equipmentId\}/);
});

test("workflow uses human task and document numbers and generates technical document ids server-side", () => {
  assert.match(workflow, /taskRecordLabel\(task\.id\)/);
  assert.match(workflow, /recordLabel\(document\.documentType \|\| "Документ", document\.id\)/);
  assert.match(workflow, /Неизменяемая запись/);
  assert.doesNotMatch(workflow, /Append-only|Стабильный ID|>DOC<|>TSK-/);
  assert.match(workflowDocuments, /requestedId \|\| `DOC-M-\$\{crypto\.randomUUID\(\)/);
  assert.match(workflowDocuments, /reference: "Добавлено вручную"/);
  assert.doesNotMatch(workflowDocuments, /reference: `MANUAL:\$\{id\}:v1`/);
});

test("seed display copy is readable and legacy updates are exact and idempotent", () => {
  assert.match(database, /Переход по объявлению «Будущее математики»/);
  assert.match(database, /summary='Переход по объявлению math_future'/);
  assert.match(database, /title='Продлить или закрыть договор DOG-T-2026-044'/);
  assert.match(database, /evidence='Акт проверки SAFE-CHECK-ACT-T-090: обрыв шлейфа 4'/);
  assert.match(database, /source_b='Точка \/ Т‑Банк · нет данных'/);
  assert.match(database, /source_b='Точка \/ Альфа-Банк · нет данных'/);
  assert.match(database, /AND created_by='system-sales-seed' AND display_name='Менеджер T-01 · продажи'/);
  assert.match(database, /AND created_by='system-sales-seed' AND source_ref='LEAD-T-014 → ACR-CLIENT-T-014'/);
  assert.match(database, /AND created_by='system-safety-seed' AND title='Устранить неисправность · SAFE-EQ-T-001'/);
  assert.match(database, /AND created_by='system-safety-seed' AND result_evidence='ACT-SAFE-T-031'/);
});
