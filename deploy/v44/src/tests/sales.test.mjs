import assert from "node:assert/strict";
import test from "node:test";
import { buildFunnel, nextSalesStage, riskExplanation, scoreCampaigns } from "../lib/sales.ts";

test("sales funnel counts every reached stage", () => {
  const funnel = buildFunnel([
    { stage: "Платёж", status: "Активен" },
    { stage: "Договор", status: "Активен" },
    { stage: "Заявка", status: "Активен" },
  ]);
  assert.deepEqual(funnel.map((row) => row.reached), [3, 3, 2, 2, 2, 1, 1]);
  assert.equal(funnel.at(-1).conversionPercent, 100);
});

test("sales stages only advance by one step", () => {
  assert.equal(nextSalesStage("Консультация"), "Посещение");
  assert.equal(nextSalesStage("Платёж"), null);
  assert.equal(nextSalesStage("Неизвестно"), null);
});

test("campaign score keeps contracts, payments and revenue together", () => {
  const leads = [
    { id: "L1", campaignId: "C1", stage: "Платёж" },
    { id: "L2", campaignId: "C1", stage: "Заявка" },
  ];
  const [campaign] = scoreCampaigns(leads, { L1: 8500000 }, (lead) => lead.id);
  assert.deepEqual(campaign, { campaignId: "C1", leads: 2, contracts: 1, payments: 1, revenueMinor: 8500000 });
});

test("risk is explainable and never framed as an automatic decision", () => {
  const risk = riskExplanation(72, ["Есть просрочка", "Нет ответа 12 дней"]);
  assert.equal(risk.band, "Высокий");
  assert.equal(risk.factors.length, 2);
  assert.match(risk.disclaimer, /не автоматическое решение/);
});
