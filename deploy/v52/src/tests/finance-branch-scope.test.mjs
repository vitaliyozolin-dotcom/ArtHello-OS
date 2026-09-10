import test from "node:test";
import assert from "node:assert/strict";
import { FINANCE_ACCOUNTING_START_DATE, scopeFinanceOperations } from "../lib/finance-branch-scope.ts";

const operations = [
  { id: "old", operationDate: "2026-08-31", objectEntityId: "BR-ATLAS-SCHOOL" },
  { id: "school", operationDate: "2026-09-01", objectEntityId: "BR-ATLAS-SCHOOL" },
  { id: "garden", operationDate: "2026-09-02", objectEntityId: "BR-KINDERGARTEN" },
  { id: "unassigned", operationDate: "2026-09-03", objectEntityId: "" },
];

test("финансовый отчёт включает только выбранный филиал и даты с 1 сентября 2026", () => {
  assert.equal(FINANCE_ACCOUNTING_START_DATE, "2026-09-01");
  assert.deepEqual(scopeFinanceOperations(operations, "BR-ATLAS-SCHOOL").map((row) => row.id), ["school"]);
});

test("общий и пустой филиал запрещены", () => {
  assert.throws(() => scopeFinanceOperations(operations, "ALL"), /конкретный филиал/);
  assert.throws(() => scopeFinanceOperations(operations, ""), /конкретный филиал/);
});

