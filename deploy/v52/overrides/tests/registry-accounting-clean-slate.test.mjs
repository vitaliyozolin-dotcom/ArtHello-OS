import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registryUrl = new URL("../app/components/RegistryWorkspace.tsx", import.meta.url);
const entitiesApiUrl = new URL("../app/api/entities/route.ts", import.meta.url);
const accountingUrl = new URL("../app/components/AccountingWorkspace.tsx", import.meta.url);
const accountingApiUrl = new URL("../app/api/accounting/route.ts", import.meta.url);
const accountingActionsUrl = new URL("../app/api/accounting-actions/route.ts", import.meta.url);

test("manual registry cards receive a production ID from the API", async () => {
  const [registry, api] = await Promise.all([readFile(registryUrl, "utf8"), readFile(entitiesApiUrl, "utf8")]);
  assert.match(registry, /name="sourceSystem" value="MANUAL"/);
  assert.match(registry, /ID назначит система/);
  assert.doesNotMatch(registry, /name="id"/);
  assert.doesNotMatch(registry, /XLSX_MASKED|Проект T-|pattern="[^"]*-T-/);
  assert.match(api, /requestedId \|\| createEntityId\(entityType\)/);
  assert.match(api, /crypto\.randomUUID\(\)/);
});

test("empty accounting supports real manual document creation", async () => {
  const [workspace, api, actions] = await Promise.all([readFile(accountingUrl, "utf8"), readFile(accountingApiUrl, "utf8"), readFile(accountingActionsUrl, "utf8")]);
  for (const field of ["documentType", "number", "documentDate", "counterpartyEntityId", "contractId", "amountRub"]) {
    assert.match(workspace, new RegExp(`name="${field}"`));
  }
  assert.match(workspace, /Добавить первый документ/);
  assert.match(workspace, /rublesToMinorUnits\(values\.amountRub\)/);
  assert.match(workspace, /currentAccountingPeriod\(\)/);
  assert.match(workspace, /data\.counterparties/);
  assert.match(api, /filterAccountingCounterparties\(entityRows\)/);
  assert.match(actions, /ACC-DOC-\$\{crypto\.randomUUID\(\)/);
  assert.match(actions, /sourceType:"MANUAL"/);
  assert.doesNotMatch(workspace, /NEW-T|SUP-T|DOG-T|ТЕСТОВАЯ ПЕРВИЧКА|тестовой карточке|2026-08/);
});
