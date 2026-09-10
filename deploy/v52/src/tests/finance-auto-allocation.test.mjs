import test from "node:test";
import assert from "node:assert/strict";
import { classifyFinanceOperation } from "../lib/finance-auto-allocation.ts";

const base = {
  legalEntityName: "ООО «АртХелло»",
  operationDate: "2026-09-01",
  direction: "Поступление",
  currency: "RUB",
  description: "Оплата за обучение в школе Атлас",
};

test("однозначное поступление школы Атлас разносится по филиалу и двум статьям", () => {
  assert.deepEqual(classifyFinanceOperation(base), {
    objectEntityId: "BR-ATLAS-SCHOOL",
    cashflowArticle: "Оплата школы",
    pnlArticle: "Выручка школы",
    reportClass: "Доходы ОПиУ",
    accrualPeriod: "2026-09",
    status: "Разнесено автоматически",
  });
});

test("однозначное поступление садика Атлас разносится отдельно от школы", () => {
  assert.equal(classifyFinanceOperation({ ...base, description: "Оплата за детский сад Атлас" })?.objectEntityId, "BR-KINDERGARTEN");
});

test("до даты старта, по другому юрлицу, расходу или неоднозначному тексту автоправило не работает", () => {
  assert.equal(classifyFinanceOperation({ ...base, operationDate: "2026-08-31" }), null);
  assert.equal(classifyFinanceOperation({ ...base, legalEntityName: "ООО Другое" }), null);
  assert.equal(classifyFinanceOperation({ ...base, direction: "Списание" }), null);
  assert.equal(classifyFinanceOperation({ ...base, description: "Оплата Атлас" }), null);
  assert.equal(classifyFinanceOperation({ ...base, description: "Оплата школы и детского сада Атлас" }), null);
});

