import test from "node:test";
import assert from "node:assert/strict";
import { replaceSavedFamily } from "../lib/family-list-refresh.ts";
import { operationsForPnlLine } from "../lib/finance-pnl-drilldown.ts";

test("saving an edited family updates its existing row without replacing or reordering the list", () => {
  const before = [{ id: "F-1", displayName: "Первая" }, { id: "F-2", displayName: "Вторая" }, { id: "F-3", displayName: "Третья" }];
  const after = replaceSavedFamily(before, { id: "F-2", displayName: "Исправленная" });
  assert.deepEqual(after.map(row => row.id), ["F-1", "F-2", "F-3"]);
  assert.equal(after[1].displayName, "Исправленная");
  assert.equal(before[1].displayName, "Вторая");
});

test("P&L article drilldown contains all and only linked operations for the selected period", () => {
  const operations = [
    { id: "OP-1", period: "2026-09", amountMinor: 1200 },
    { id: "OP-2", period: "2026-09", amountMinor: 2300 },
    { id: "OP-3", period: "2026-08", amountMinor: 9900 },
    { id: "OP-4", period: "2026-09", amountMinor: 4800 },
  ];
  const rows = operationsForPnlLine(operations, ["OP-2", "OP-1", "OP-2", "OP-3", "MISSING"], "2026-09");
  assert.deepEqual(rows.map(row => row.id), ["OP-2", "OP-1"]);
  assert.equal(rows.reduce((sum, row) => sum + row.amountMinor, 0), 3500);
  assert.deepEqual(operationsForPnlLine(operations, [], "2026-09"), []);
});
