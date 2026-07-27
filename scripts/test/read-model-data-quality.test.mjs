import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const exporter = await readFile(
  new URL("../src/export-sites-read-model-sandbox.ts", import.meta.url),
  "utf8",
);
const ownerUi = await readFile(
  new URL("../../sites-control/main.js", import.meta.url),
  "utf8",
);
const alfaAudit = await readFile(
  new URL("../src/audit-alfacrm-sandbox.ts", import.meta.url),
  "utf8",
);

test("payroll source rejections remain visible and excluded from money totals", () => {
  assert.match(exporter, /rejectedSourceRows:\s*rejectedPayrollSourceRows/);
  assert.match(exporter, /rejectedRowsExcludedFromMoneyTotals:\s*true/);
  assert.match(ownerUi, /payroll\?\.counts\?\.rejectedSourceRows/);
  assert.match(ownerUi, /строк источника отклонено/);
});

test("AlfaCRM audit reports an interrupted running scope explicitly", () => {
  assert.match(alfaAudit, /running:\s*latestBatchId/);
  assert.match(alfaAudit, /AND status = 'running'/);
  assert.match(alfaAudit, /byStatusAndEntity:\s*scopeRunsByStatusAndEntity/);
});

test("owner read-model keeps AlfaCRM identities and joins branch-scoped", () => {
  assert.match(exporter, /stableId\("student", row\.branch_id, row\.id\)/);
  assert.match(exporter, /stableId\("group", row\.branch_id, row\.id\)/);
  assert.match(exporter, /stableId\("teacher", row\.branch_id, row\.id\)/);
  assert.match(exporter, /stableId\("lesson", row\.branch_id, row\.id\)/);
  assert.match(exporter, /stableId\("payment", row\.branch_id, row\.id\)/);
  assert.match(exporter, /attendance\.branch_crm_id = student\.branch_crm_id/);
  assert.match(exporter, /teacher\.branch_crm_id = lesson\.branch_crm_id/);
  assert.match(
    exporter,
    /left_student\.branch_crm_id = candidate\.left_student_branch_crm_id/,
  );
});

test("terminal AlfaCRM export exposes source linkage issues instead of hiding them", () => {
  assert.match(exporter, /ALFACRM_SCOPE_COMPLETION_REQUIRED/);
  assert.match(exporter, /latestAlpha\?\.mode === "full_sandbox_read_only"/);
  assert.match(
    exporter,
    /scopeInventoryComplete:\s*alphaScopeInventoryComplete/,
  );
  assert.match(exporter, /linkageIssues:\s*alphaLinkageIssues/);
  assert.match(exporter, /attendanceWithoutStudent/);
  assert.match(
    exporter,
    /status:\s*alphaRowsExportable && alphaLinkageIssues > 0/,
  );
  assert.match(ownerUi, /alfa\?\.details\?\.linkageIssues/);
  assert.match(ownerUi, /Подключено · есть расхождения/);
  assert.match(ownerUi, /данные не скрыты и не исправлены догадками/);
});

test("verified payroll can publish while partial AlfaCRM remains aggregate-only", () => {
  assert.match(exporter, /ARTHELLO_ALLOW_PARTIAL_ALFA_AGGREGATE/);
  assert.match(exporter, /"owner_authorized_payroll_only"/);
  assert.match(
    exporter,
    /alpha_students:\s*alphaRowsExportable \? students : \[\]/,
  );
  assert.match(exporter, /partialAlfaRowsPublished:\s*false/);
  assert.match(ownerUi, /операционные строки пока не опубликованы/);
  assert.match(ownerUi, /Агрегаты сохранены для диагностики/);
});
