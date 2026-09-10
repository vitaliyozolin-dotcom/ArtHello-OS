import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiUrl = new URL("../app/api/entities/route.ts", import.meta.url);
const registryUrl = new URL("../app/components/RegistryWorkspace.tsx", import.meta.url);
const dbUrl = new URL("../db/index.ts", import.meta.url);
const policyUrl = new URL("../lib/entity-provenance.ts", import.meta.url);

test("manual cards carry trustworthy provenance instead of an automatic review flag", async () => {
  const [api, registry, db, policy] = await Promise.all([
    readFile(apiUrl, "utf8"),
    readFile(registryUrl, "utf8"),
    readFile(dbUrl, "utf8"),
    readFile(policyUrl, "utf8"),
  ]);

  assert.match(api, /initialEntityDataQuality\(sourceSystem\)/);
  assert.match(api, /providedSourceRecordId \|\| \(isManualEntitySource\(sourceSystem\) \? `MANUAL:\$\{id\}` : ""\)/);
  assert.match(api, /dataQuality, scope, createdBy: actor/);
  assert.match(policy, /isManualEntitySource\(entity\.sourceSystem\)[\s\S]*?return "Создано вручную"/);
  assert.match(db, /entity\.provenance_normalized/);
  assert.match(db, /manual-entity-provenance-v2/);
  assert.match(db, /manualEntityNormalization/);
  assert.match(registry, /источник записи — пользователь; статус карточки и доступ управляются отдельно/);
  assert.match(registry, /isManualEntitySource\(source\) \? "Ручной ввод"/);
  assert.match(registry, /отдельная самопроверка не нужна/);
  assert.doesNotMatch(registry, />Качество</);
});

test("review counters and labels are limited to actual reconciliation states", async () => {
  const [api, registry, policy] = await Promise.all([
    readFile(apiUrl, "utf8"),
    readFile(registryUrl, "utf8"),
    readFile(policyUrl, "utf8"),
  ]);

  assert.match(api, /reviewStates = new Set\(\["Требует сверки", "На проверке"\]\)/);
  assert.match(api, /reviewStates\.has\(row\.dataQuality\)/);
  assert.doesNotMatch(api, /row\.dataQuality !== "Проверено"/);
  assert.match(policy, /entity\.dataQuality === "Проверено" \? "Проверено" : "На проверке"/);
  assert.match(registry, /label="Нужна сверка"/);
  assert.match(registry, /только импорт, интеграция или конфликт/);
  assert.match(registry, /сверяет владелец карточки или назначенный ответственный с фиксацией основания/);
  assert.match(registry, /name="reviewEvidence" required minLength=\{8\}/);
  assert.match(api, /Укажите основание сверки внешнего источника/);
});

test("duplicate conflicts cannot be presented or edited as trusted manual data", async () => {
  const [api, registry, db, policy] = await Promise.all([
    readFile(apiUrl, "utf8"),
    readFile(registryUrl, "utf8"),
    readFile(dbUrl, "utf8"),
    readFile(policyUrl, "utf8"),
  ]);

  assert.match(api, /duplicateKeys\.get\(entityDuplicateKey\(entity\)\)/);
  assert.match(api, /editedEntityDataQuality\(current, requestedDataQuality, hasDuplicate\)/);
  assert.match(policy, /if \(hasDuplicate\) return "Требует сверки"/);
  assert.match(policy, /entity\.dataQuality === "Требует сверки" \? "Требует сверки" : "Проверено"/);
  assert.match(registry, /Конфликт снимается только после объединения или разведения дублей/);
  assert.match(db, /duplicateCounts\.get\(entityDuplicateKey\(row\)\)/);
});
