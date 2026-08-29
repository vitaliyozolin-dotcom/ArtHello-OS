import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("empty production UI does not expose synthetic fallback entities", () => {
  const sources = [
    "../app/components/ArtHelloShell.tsx",
    "../app/components/OwnerDashboard.tsx",
    "../app/components/SystemWorkspace.tsx",
    "../app/components/FinanceWorkspace.tsx",
    "../app/components/WorkflowWorkspace.tsx",
    "../app/components/SalesWorkspace.tsx",
    "../app/components/ContentWorkspace.tsx",
    "../app/components/EducationWorkspace.tsx",
    "../app/components/LegalWorkspace.tsx",
    "../app/components/AccountingWorkspace.tsx",
    "../app/api/education/route.ts",
    "../app/api/education-actions/route.ts",
    "../app/api/hr-actions/route.ts",
    "../data/test-snapshot.ts",
  ].map(read).join("\n");

  assert.doesNotMatch(sources, /FAM-T-|EMP-T-|DOG-T-|LEAD-T-|EVENT-T-|SUP-T-|SAFE-EQ-T-|Q-T-|SYNTHETIC/);
  assert.match(sources, /Данных пока нет/);
  assert.match(sources, /Реестр пуст/);
});

test("finance API derives totals and periods only from stored records", () => {
  const financeApi = read("../app/api/finance/route.ts");

  assert.doesNotMatch(financeApi, /sourceTotals/);
  assert.match(financeApi, /const periods = \[\.\.\.new Set/);
  assert.match(financeApi, /const openingBalanceMinor = 0/);
});

test("sales keeps its operating sections available before the first lead", () => {
  const sales = read("../app/components/SalesWorkspace.tsx");

  assert.doesNotMatch(sales, /if\s*\(\s*!\s*data\.leads\.length\s*\)\s*return/);
  assert.match(sales, /\bhasSalesData\b/);
  assert.match(sales, /Лидов и этапов пока нет/);
  assert.match(sales, /Сквозная цепочка пока не собрана/);
  assert.match(sales, /Добавить первый лид/);
  assert.match(sales, /onOpenIntegrations/);
  assert.match(sales, /action: "createLead"/);
  assert.match(sales, /function LeadCreateModal/);
  assert.match(sales, /chainLead\s*\?/);
  assert.doesNotMatch(sales, /acceptanceChainLeadId\)!|chainLifecycle[^\n]*!|chainAccrual[^\n]*!|chainPayment[^\n]*!/);
});

test("array-backed workspaces handle empty data before unsafe first-row access", () => {
  const food = read("../app/components/FoodWorkspace.tsx");
  assert.match(food, /data\.recipes\[0\]\s*\?\?/);
  assert.match(food, /\bhasFoodData\b/);
  assert.doesNotMatch(food, /if\s*\(\s*!\s*hasFoodData\s*\)\s*return\b/);

  const integration = read("../app/components/IntegrationWorkspace.tsx");
  assert.ok(integration.indexOf("if (!data.connections.length)") > -1, "IntegrationWorkspace has no empty guard");
  assert.ok(
    integration.indexOf("const current =") > integration.indexOf("if (!data.connections.length)"),
    "IntegrationWorkspace reads the first row before its empty guard",
  );

  const readiness = read("../app/components/ReadinessWorkspace.tsx");
  assert.match(readiness, /data\.scenarios\.find[\s\S]*?\?\?\s*data\.scenarios\[0\]/);
  assert.match(readiness, /\bhasReadinessData\b/);
  assert.doesNotMatch(readiness, /if\s*\(\s*!\s*hasReadinessData\s*\)\s*return\b/);
});

test("content and education use real records instead of demo identities", () => {
  const content = read("../app/components/ContentWorkspace.tsx");
  const education = [
    read("../app/components/EducationWorkspace.tsx"),
    read("../app/api/education/route.ts"),
    read("../app/api/education-actions/route.ts"),
  ].join("\n");

  assert.match(content, /Контент ещё не подключён/);
  assert.match(content, /Math\.max\(1,/);
  assert.doesNotMatch(content, /EMP-T-CONTENT|OFF-T-001|Тестовые данные|синтетический финансовый/);
  assert.doesNotMatch(education, /EMP-T-032|FAM-T-014|PRG-T-012|GRP-T-3A|LES-T-3A/);
});
