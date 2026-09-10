import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  contractUtilization,
  isCautiousSignal,
  missingRequired,
  nextLegalVersion,
} from "../lib/legal.ts";

test("contract utilization exposes limit excess", () => assert.equal(contractUtilization(50000000, 54000000), 108));

test("required missing documents remain visible", () => assert.equal(missingRequired([
  { required: true, status: "Отсутствует" },
  { required: false, status: "Отсутствует" },
  { required: true, status: "Актуален" },
]), 1));

test("legal versions only append", () => assert.equal(nextLegalVersion(2), 3));

test("legal signals avoid accusations", () => {
  assert.equal(isCautiousSignal("Возможный конфликт · сигнал", "Требует проверки"), true);
  assert.equal(isCautiousSignal("Нарушитель", ""), false);
});

test("legal Design System registry is compact and filterable by party", async () => {
  const source = await readFile(new URL("../app/components/LegalWorkspace.tsx", import.meta.url), "utf8");
  for (const label of ["Клиенты", "Сотрудники", "Подрядчики и поставщики", "Аренда и партнёры", "Прочие"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /ahLegalRegistryTable/);
  assert.doesNotMatch(source, /legal-registry-table/);
  assert.match(source, /openDocuments/);
});
