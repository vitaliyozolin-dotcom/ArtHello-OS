import assert from "node:assert/strict";
import test from "node:test";
import { humanFormulaLabel, humanPeriodLabel, humanReferenceLabel, humanSourceList, humanTechnicalText, humanVersionLabel, recordLabel, recordNumber, recordSequence, taskRecordLabel } from "../lib/record-labels.ts";

test("operational records receive stable human labels without exposing storage keys", () => {
  assert.equal(taskRecordLabel(1), "Задача №1");
  assert.equal(taskRecordLabel("TSK-0042"), "Задача №42");
  assert.equal(recordLabel("Договор", "DOG-T-2026-044"), "Договор №0044");
  assert.equal(recordNumber("SAFE-031/26"), "№0031");
  assert.equal(recordNumber("FOOD-0821"), "№0821");
  assert.equal(recordSequence("dbf891aa-opaque"), recordSequence("dbf891aa-opaque"));
  assert.doesNotMatch(recordNumber("dbf891aa-opaque"), /dbf|opaque/i);
});

test("periods, formulas, sources and technical rule versions are readable", () => {
  assert.equal(humanPeriodLabel("2026-Q3"), "3 квартал 2026");
  assert.equal(humanPeriodLabel("2026-08"), "август 2026");
  assert.equal(humanFormulaLabel("SUM(payment amount) по family_id"), "Сумма подтверждённых оплат семьи");
  assert.equal(humanFormulaLabel("COUNT(status=Работает)"), "Число работающих сотрудников");
  assert.equal(humanSourceList("client_lifecycles,financial_operations"), "Карточки семей · Финансовые операции");
  assert.equal(humanSourceList("food_shipments,food_production,food_shifts"), "Отгрузки кухни · Производство кухни · Смены кухни");
  assert.equal(humanVersionLabel("rules-v0.1"), "Правила проверены человеком");
  assert.equal(humanReferenceLabel("SAFE-031/26"), "Проверка №0031");
  assert.equal(humanTechnicalText("Оплата FOOD-0821 · 2026-Q3"), "Оплата Запись №0821 · 3 квартал 2026");
  assert.equal(humanTechnicalText("API и CRM не подключены"), "подключение и система продаж не подключены");
  assert.equal(humanFormulaLabel("SUM(amount) WHERE family_id = value"), "Расчёт по утверждённым данным");
});
