import assert from "node:assert/strict";
import test from "node:test";
import { humanFormulaLabel, humanPeriodLabel, humanReferenceLabel, humanSourceList, humanTechnicalText, humanVersionLabel, recordLabel, recordNumber, recordSequence, taskRecordLabel } from "../lib/record-labels.ts";

test("task labels show at least four digits for task IDs and legacy references", () => {
  for (const [id, expected] of [
    [1, "Задача №0001"],
    [9, "Задача №0009"],
    [10, "Задача №0010"],
    [42, "Задача №0042"],
    [801, "Задача №0801"],
    [999, "Задача №0999"],
    [1000, "Задача №1000"],
    [9999, "Задача №9999"],
    ["TSK-0042", "Задача №0042"],
    ["TASK-801", "Задача №0801"],
  ]) {
    assert.equal(taskRecordLabel(id), expected);
  }
});

test("linked task references keep the same padded label in readable text", () => {
  assert.equal(humanReferenceLabel("TSK-0042"), "Задача №0042");
  assert.equal(humanReferenceLabel("TASK-801"), "Задача №0801");
  assert.equal(humanTechnicalText("Создана TSK-0042"), "Создана Задача №0042");
});

test("operational records receive stable human labels without exposing storage keys", () => {
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
