import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("finance API and UI require an explicit branch and do not offer a consolidated report", () => {
  const route = read("../app/api/finance/route.ts");
  const workspace = read("../app/components/FinanceWorkspace.tsx");
  const shell = read("../app/components/ArtHelloShell.tsx");
  const dashboard = read("../app/components/OwnerDashboard.tsx");
  assert.match(route, /requireFinanceBranch\(new URL\(request\.url\)\.searchParams\.get\("branchId"\)\)/);
  assert.match(route, /scopeFinanceOperations\(branchEligibleOperations, requestedBranchId\)/);
  assert.match(route, /reviewOperations = canReviewUnassigned/);
  assert.match(route, /!operation\.objectEntityId && operation\.operationDate >= FINANCE_ACCOUNTING_START_DATE/);
  assert.match(route, /classificationPermissions/);
  assert.match(route, /общий остаток юрлица не включён/);
  assert.match(workspace, /Общий отчёт пока отключён/);
  assert.match(workspace, /branchId: selectedBranch/);
  assert.match(workspace, /Требует разбора/);
  assert.match(workspace, /data\.classificationPermissions\.canEdit/);
  assert.match(shell, /selectedBranch=\{selectedBranch\}/);
  assert.match(shell, /next === "finance" && selectedBranch === "ALL" && branches\[0\]/);
  assert.match(shell, /changeBranch\(branches\[0\]\.id\)/);
  assert.match(shell, /next === "ALL" && window\.location\.hash === "#finance"/);
  assert.match(shell, /setSelectedBranch\(selected\)/);
  assert.match(dashboard, /объединённый финансовый отчёт пока отключён/);
  assert.match(dashboard, /new URLSearchParams\(\{ branchId: selectedBranch \}\)/);
});

test("Tochka import enforces the accounting start and applies only fixed automatic rules", () => {
  const database = read("../db/index.ts");
  const actions = read("../app/api/finance-actions/route.ts");
  const route = read("../app/api/finance/route.ts");
  assert.match(database, /transaction\.operationDate < FINANCE_ACCOUNTING_START_DATE/);
  assert.match(database, /isAutoAllocationCatalogReady\(articleCatalog\)/);
  assert.match(database, /classifyFinanceOperation\(\{/);
  assert.match(database, /cashflow_article,pnl_article,report_class,accrual_period/);
  assert.match(actions, /Справочник зафиксирован/);
  assert.match(actions, /isDisposableFinanceFixture\(\)/);
  assert.match(route, /ARTHELLO_PUBLIC_ORIGIN === "https:\/\/finance\.ci\.invalid"/);
  assert.match(actions, /canManageBranch\(context, targetBranchId\)/);
  assert.match(actions, /Выберите доступный активный филиал/);
});
