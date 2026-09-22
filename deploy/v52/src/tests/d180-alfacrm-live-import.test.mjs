import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { listEntities } from "../lib/entity-list.ts";
import { runChunkedAlfaImport, isCurrentAlfaStaffRecord } from "../lib/alfacrm-import.ts";
import { scheduleNoticeDismiss } from "../lib/notice-dismiss.ts";

function entity(id, entityType, displayName, dataQuality = "Импортировано из AlfaCRM") {
  return {
    id,
    entityType,
    displayName,
    status: "Активна",
    sourceSystem: "ALFACRM",
    sourceRecordId: id,
    dataQuality,
    scope: "Атлас",
    metadata: "{}",
  };
}

test("entity paging filters by type before applying the page boundary", () => {
  const rows = [
    ...Array.from({ length: 600 }, (_, index) => entity(`CLI-${index}`, "Клиент", `Клиент ${index}`)),
    entity("FAM-1", "Семья", "Семья Первая"),
    entity("FAM-2", "Семья", "Семья Вторая", "Проверено"),
    entity("FAM-3", "Семья", "Семья Третья"),
  ];

  const firstPage = listEntities(rows, {
    type: "Семья",
    q: "",
    quality: "",
    review: "",
    mode: "source_only",
    offset: 0,
    limit: 2,
  });

  assert.deepEqual(firstPage.entities.map((row) => row.id), ["FAM-1", "FAM-2"]);
  assert.deepEqual(firstPage.resultCounts, { total: 3, needsReview: 2, ready: 1 });
  assert.equal(firstPage.total, 3);

  const secondPage = listEntities(rows, {
    type: "Семья",
    q: "третья",
    quality: "",
    review: "needs_review",
    mode: "source_only",
    offset: 0,
    limit: 100,
  });
  assert.deepEqual(secondPage.entities.map((row) => row.id), ["FAM-3"]);
});

test("subscription chunks continue automatically until the server confirms completion", async () => {
  const cursors = [15, 30, 31];
  const progress = [];
  let calls = 0;
  const result = await runChunkedAlfaImport(async () => {
    const nextCursor = cursors[calls++];
    return { complete: nextCursor === 31, nextCursor, message: `Пакет ${nextCursor}` };
  }, (batch) => progress.push(batch.nextCursor));

  assert.equal(calls, 3);
  assert.equal(result.complete, true);
  assert.deepEqual(progress, [15, 30, 31]);
});

test("automatic continuation stops on an error or a cursor that does not advance", async () => {
  const failed = await runChunkedAlfaImport(async () => ({ error: "AlfaCRM недоступна" }));
  assert.equal(failed.error, "AlfaCRM недоступна");

  let rejectedCalls = 0;
  const rejected = await runChunkedAlfaImport(async () => {
    rejectedCalls += 1;
    return { complete: false, nextCursor: 15, rejected: 1, message: "Запись пропущена" };
  });
  assert.equal(rejected.rejected, 1);
  assert.equal(rejectedCalls, 1);

  let calls = 0;
  await assert.rejects(
    () => runChunkedAlfaImport(async () => ({ complete: false, nextCursor: calls++ ? 15 : 15 })),
    /не продвинулась/,
  );
  assert.equal(calls, 2);
});

test("staff import excludes explicitly inactive and already-ended teacher cards", () => {
  const today = new Date("2026-09-14T00:00:00.000Z");
  assert.equal(isCurrentAlfaStaffRecord({ id: 1, e_date: "2030-12-31" }, today), true);
  assert.equal(isCurrentAlfaStaffRecord({ id: 2 }, today), true, "removed=0 response remains usable when AlfaCRM omits lifecycle fields");
  assert.equal(isCurrentAlfaStaffRecord({ id: 3, e_date: "2026-09-13" }, today), false);
  assert.equal(isCurrentAlfaStaffRecord({ id: 4, is_active: 0 }, today), false);
  assert.equal(isCurrentAlfaStaffRecord({ id: 5, removed: 1 }, today), false);
});

test("notice dismissal is temporary and cancellation prevents a stale timer", async () => {
  let calls = 0;
  await new Promise((resolve) => {
    scheduleNoticeDismiss(() => { calls += 1; resolve(); }, 10);
  });
  assert.equal(calls, 1);

  const cancel = scheduleNoticeDismiss(() => { calls += 1; }, 10);
  cancel();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(calls, 1);
});

test("D180 production screens use the paged entity list, automatic importer and temporary notice", async () => {
  const [entitiesRoute, familyWorkspace, alfaRoute, wizard, shell] = await Promise.all([
    readFile(new URL("../app/api/entities/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/FamilyWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/integrations/alfacrm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AlfaCrmSetupWizard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ArtHelloShell.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(entitiesRoute, /listEntities\(storedRows/);
  assert.doesNotMatch(entitiesRoute, /orderBy\([^;]+\)\.limit\(500\)/);
  assert.match(familyWorkspace, /review","needs_review/);
  assert.match(familyWorkspace, /Показать ещё/);
  const validation = alfaRoute.indexOf("const projectionRows = currentProjectionRows(module, rows, deferredCustomer?.key)");
  const rawPersistence = alfaRoute.indexOf("upsertRawRecords(module, rows, batchId, deferredCustomer?.key)");
  const staffProjection = alfaRoute.indexOf("canonicalizeStaff(projectionRows", rawPersistence);
  const staffReconciliation = alfaRoute.indexOf("reconcileCurrentSnapshot(module, selectedBranches, projectionRows", staffProjection);
  assert.ok(validation > 0 && rawPersistence > validation && staffProjection > rawPersistence && staffReconciliation > staffProjection,
    "D188 validates branch evidence before writes, preserves every valid response row as immutable evidence, then projects and reconciles");
  assert.match(alfaRoute, /scopedAlfaRows\(module, rows\)/);
  assert.match(wizard, /runChunkedAlfaImport/);
  assert.match(wizard, /Загружаю автоматически/);
  assert.match(shell, /scheduleNoticeDismiss/);
});
