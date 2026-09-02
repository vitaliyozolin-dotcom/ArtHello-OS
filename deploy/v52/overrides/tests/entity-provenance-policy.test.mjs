import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  editedEntityDataQuality,
  entityDataState,
  entityNeedsReview,
  initialEntityDataQuality,
  isManualEntitySource,
  manualEntityNormalization,
  needsExternalReviewEvidence,
} from "../lib/entity-provenance.ts";

test("manual sources created in any product workspace are trusted provenance, not a self-review", () => {
  for (const sourceSystem of ["MANUAL", "manual", "MANUAL_SALES"]) {
    assert.equal(isManualEntitySource(sourceSystem), true);
    assert.equal(initialEntityDataQuality(sourceSystem), "Проверено");
    assert.equal(entityDataState({ sourceSystem, dataQuality: "На проверке" }), "Создано вручную");
    assert.equal(entityNeedsReview({ sourceSystem, dataQuality: "Ручной ввод" }), false);
  }

  assert.equal(isManualEntitySource("CSV_IMPORT"), false);
  assert.equal(initialEntityDataQuality("CSV_IMPORT"), "На проверке");
});

test("imports and integrations stay in review until reconciled with evidence", () => {
  for (const sourceSystem of ["CSV_IMPORT", "XLSX_ODDS", "BANK_TOCHKA"]) {
    const record = { sourceSystem, dataQuality: "Ожидает сопоставления" };
    assert.equal(entityDataState(record), "На проверке");
    assert.equal(entityNeedsReview(record), true);
    assert.equal(needsExternalReviewEvidence(record, "Проверено", false), true);
    assert.equal(editedEntityDataQuality(record, "Проверено", false), "Проверено");
  }

  assert.equal(entityDataState({ sourceSystem: "CSV_IMPORT", dataQuality: "Проверено" }), "Проверено");
  assert.equal(entityNeedsReview({ sourceSystem: "CSV_IMPORT", dataQuality: "Проверено" }), false);
});

test("duplicates and recorded conflicts cannot be downgraded by the generic manual editor", () => {
  const manual = { sourceSystem: "MANUAL", dataQuality: "Проверено" };
  const recordedConflict = { sourceSystem: "MANUAL_SALES", dataQuality: "Требует сверки" };

  assert.equal(entityDataState(manual, true), "Требует сверки");
  assert.equal(entityNeedsReview(manual, true), true);
  assert.equal(editedEntityDataQuality(manual, "Создано вручную", true), "Требует сверки");
  assert.equal(editedEntityDataQuality(recordedConflict, "Создано вручную", false), "Требует сверки");
  assert.equal(needsExternalReviewEvidence(manual, "Проверено", false), false);
});

test("migration v2 upgrades legacy manual rows without touching duplicates or real conflicts", () => {
  assert.deepEqual(
    manualEntityNormalization({ sourceSystem: "MANUAL", dataQuality: "На проверке", status: "На проверке" }, false),
    { dataQuality: "Проверено", status: "Активна" },
  );
  assert.deepEqual(
    manualEntityNormalization({ sourceSystem: "MANUAL", dataQuality: "Проверено", status: "На проверке" }, false, "На оформлении"),
    { dataQuality: "Проверено", status: "На оформлении" },
  );
  assert.deepEqual(
    manualEntityNormalization({ sourceSystem: "MANUAL_SALES", dataQuality: "Ручной ввод", status: "На квалификации" }, false),
    { dataQuality: "Проверено", status: "На квалификации" },
  );
  assert.equal(manualEntityNormalization({ sourceSystem: "MANUAL", dataQuality: "На проверке", status: "На проверке" }, true), null);
  assert.equal(manualEntityNormalization({ sourceSystem: "MANUAL", dataQuality: "Требует сверки", status: "На проверке" }, false), null);
  assert.equal(manualEntityNormalization({ sourceSystem: "CSV_IMPORT", dataQuality: "На проверке", status: "На проверке" }, false), null);
});

test("every production producer persists manual entity provenance consistently", async () => {
  const [hr, sales, legalPatch, migration, mergeApi] = await Promise.all([
    readFile(new URL("../app/api/hr-actions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sales-actions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/patch-system-content-legal.mjs", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/entity-merge/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(hr, /sourceSystem:"MANUAL"[\s\S]*?dataQuality:"Проверено"/);
  assert.match(hr, /provenance:"Создано вручную",dataQuality:"Проверено",operationalStatus:/);
  assert.doesNotMatch(hr, /sourceSystem:"MANUAL"[\s\S]{0,120}?dataQuality:"На проверке"/);
  assert.match(sales, /sourceSystem: "MANUAL_SALES"[\s\S]*?dataQuality: "Проверено"/);
  assert.match(sales, /contactProvenance: "Создано вручную", contactDataQuality: "Проверено"/);
  assert.match(legalPatch, /sourceSystem: \"MANUAL\"[\s\S]*?dataQuality: \"Проверено\"/);
  assert.doesNotMatch(legalPatch, /dataQuality: \"Ручной ввод · требует проверки\"/);
  assert.match(migration, /manual-entity-provenance-v2/);
  assert.match(migration, /source_system\) GLOB 'MANUAL_\*'/);
  assert.match(migration, /duplicateCounts\.get\(entityDuplicateKey\(row\)\)/);
  assert.match(mergeApi, /isManualEntitySource\(survivor\.sourceSystem\)[\s\S]*?"Проверено"/);
  assert.match(mergeApi, /dataQualityFrom: survivor\.dataQuality, dataQualityTo: resolvedDataQuality/);
});
