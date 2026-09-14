import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("D179 keeps one bank register and opens every bank row in a compact operation card", () => {
  const workspace = read("../app/components/FinanceWorkspace.tsx");
  const bank = workspace.slice(workspace.indexOf('{tab === "bank"'), workspace.indexOf('{tab === "articles"'));
  const cardStart = workspace.indexOf('{(selected || selectedBank)');
  const renderedDrawer = workspace.slice(cardStart, workspace.indexOf("</PageContainer>", cardStart));

  assert.doesNotMatch(workspace, /<div className="ahFinanceBoundary">/);
  assert.doesNotMatch(workspace, /<p className="ahFinanceBankBoundary">/);
  assert.match(workspace, /data-d179-marker="D179_FINANCE_COMPACT_OPERATION_CARD"/);
  assert.match(bank, /<button type="button" key=\{operation\.id\} className="ahFinanceBankHistoryRow" onClick=\{\(\) => openBankOperation\(operation\)\}/);
  assert.match(renderedDrawer, /ahFinanceOperationCard/);
  assert.match(renderedDrawer, /aria-label="Закрыть"/);
  assert.match(renderedDrawer, /ahFinanceOperationComments/);
  assert.match(renderedDrawer, /placeholder="Добавить комментарий…"/);
  assert.doesNotMatch(renderedDrawer, /Доказательная цепочка|Аналитики|Цепочка происхождения/);
  assert.doesNotMatch(workspace, /Legacy evidence-heavy drawer|<EntityPanel\b/);
});

test("D179 stores signed comments as append-only audit events without changing bank facts", () => {
  const action = read("../app/api/finance-actions/route.ts");
  const route = read("../app/api/finance/route.ts");

  assert.match(action, /action === "addOperationComment"/);
  assert.match(action, /action: "finance\.operation_commented"/);
  assert.match(action, /actor: context\.actor/);
  assert.match(action, /author: context\.appUserName/);
  assert.match(action, /entityType: targetType === "bank" \? "bank_transaction" : "financial_operation"/);
  assert.doesNotMatch(action.slice(action.indexOf("async function addOperationComment"), action.indexOf("async function classifyOperation")), /update\(bankTransactions\)|delete\(bankTransactions\)/);
  assert.match(route, /operationComments/);
  assert.match(route, /author: comment\.author \|\| row\.actor/);
});

test("D179 removes the duplicate home ledger and keeps a compact link to the canonical bank history", () => {
  const dashboard = read("../app/components/OwnerDashboard.tsx");
  const block = dashboard.slice(dashboard.indexOf('if (widget.id === "operations")'), dashboard.indexOf("return null;", dashboard.indexOf('if (widget.id === "operations")')));
  const styles = read("../app/components/FinanceWorkspace.ds.css");

  assert.match(block, /Полная история хранится только в «Деньгах»/);
  assert.match(block, /Открыть историю/);
  assert.doesNotMatch(block, /<table|selectedRow|operation-preview/);
  assert.match(styles, /\.ahFinanceOperationCard \{ width: min\(560px/);
  assert.match(styles, /\.ahFinanceBankHistoryRow, \.ahFinanceAllocationRow \{ width: 100%; border: 0;/);
});

test("D179 keeps allocation as an action queue and DDS as a classified aggregate, not another register", () => {
  const workspace = read("../app/components/FinanceWorkspace.tsx");
  const route = read("../app/api/finance/route.ts");
  const allocation = workspace.slice(workspace.indexOf('{tab === "register"'), workspace.indexOf('{tab === "cashflow"'));
  const cashflow = workspace.slice(workspace.indexOf('{tab === "cashflow"'), workspace.indexOf('{tab === "pnl"'));

  assert.match(allocation, /Операции для разнесения/);
  assert.match(workspace, /\.filter\(\(operation\) => !operationArticle\(operation\)\)/);
  assert.match(allocation, /ahFinanceAllocationList/);
  assert.doesNotMatch(allocation, /finance-table-wrap|<table/);
  assert.doesNotMatch(allocation, /article:/);
  assert.match(cashflow, /РАЗНЕСЁННЫЕ ОПЕРАЦИИ/);
  assert.doesNotMatch(cashflow, /setArticleFilter|Открыть реестр/);
  assert.match(route, /const cashOperations = operations[\s\S]*?\.filter\(\(operation\) => Boolean\(operation\.cashflowArticle/);
});
