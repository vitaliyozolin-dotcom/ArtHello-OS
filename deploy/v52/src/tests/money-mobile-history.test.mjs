import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relative) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("D177 presents one compact bank summary and compact account rows", async () => {
  const [workspace, styles] = await Promise.all([
    source("../app/components/FinanceWorkspace.tsx"),
    source("../app/components/FinanceWorkspace.ds.css"),
  ]);

  assert.match(workspace, /data-d177-marker="D177_MONEY_MOBILE_HISTORY"/);
  assert.match(workspace, /className="ahFinancePulse"/);
  assert.doesNotMatch(workspace, /className="ahFinanceKpis"/);
  assert.match(workspace, /className="ahFinanceBankMark"/);
  assert.match(workspace, /className="ahFinanceBankAccountBalance"/);
  assert.match(styles, /\.ahFinancePulse \{[\s\S]*?grid-template-areas: "head head" "main facts";/);
  assert.match(styles, /\.ahFinanceBankGrid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(styles, /@media \(max-width: 767px\) \{[\s\S]*?\.ahFinanceBankGrid, \.ahFinanceBankSyncList \{ grid-template-columns: 1fr; \}/);
});

test("D177 replaces the wide bank table with a date-grouped responsive history", async () => {
  const [workspace, styles] = await Promise.all([
    source("../app/components/FinanceWorkspace.tsx"),
    source("../app/components/FinanceWorkspace.ds.css"),
  ]);
  const start = workspace.indexOf('{tab === "bank"');
  const end = workspace.indexOf('{tab === "articles"', start);
  const bankWorkspace = workspace.slice(start, end);

  assert.ok(start >= 0 && end > start, "bank workspace must remain present");
  assert.match(bankWorkspace, /bankOperationGroups\.map/);
  assert.match(bankWorkspace, /ahFinanceBankHistoryGroup/);
  assert.match(bankWorkspace, /ahFinanceBankHistoryRow/);
  assert.doesNotMatch(bankWorkspace, /finance-table-wrap|<table/);
  assert.match(styles, /\.ahFinanceBankHistoryRow \{ display: grid; grid-template-columns: 38px minmax\(0, 1fr\) max-content;/);
  assert.match(styles, /\.ahFinanceBankHistoryCopy > span \{[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(styles, /\.ahFinanceBankHistoryGroup \{[\s\S]*?content-visibility: auto;/);
});
