import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const seed = readFileSync(new URL("../db/index.ts", import.meta.url), "utf8");
const ui = readFileSync(new URL("../app/components/AnalyticsWorkspace.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/api/analytics/route.ts", import.meta.url), "utf8");
const actions = readFileSync(new URL("../app/api/analytics-actions/route.ts", import.meta.url), "utf8");

test("all thirteen AI scenarios have separate process contracts", () => {
  for (const id of ["PAYMENTS", "LTV", "CHURN", "CASH-GAP", "ANOMALY", "BONUS", "CONTENT", "TRENDS", "METHODS", "HR-RISK", "SUPPLIER", "MISSING-DOCS", "EARLY-SIGNALS"]) {
    assert.match(seed, new RegExp(`AI-CONTRACT-${id}`));
  }
  assert.match(seed, /Не изменять финансовый факт/);
  assert.match(seed, /не увольнять/);
  assert.match(seed, /не ставить диагнозы/);
});

test("contract UI exposes opt-out, fallback, history and human owner", () => {
  for (const label of ["Ответственный человек", "Как отказаться", "Без ИИ продолжит работать", "Перестанет обрабатываться", "Исторические данные", "Влияние отказа"]) {
    assert.match(ui, new RegExp(label));
  }
  assert.match(ui, /решение всегда.*человеком/i);
});

test("analytics repairs a non-empty demo mode and never dereferences a missing contract", () => {
  assert.match(seed, /export async function ensureAnalyticsDemoBootstrap/);
  assert.match(seed, /status\.metrics >= 10 && status\.contracts >= 13 && status\.signals >= 12 && status\.runs >= 6/);
  assert.ok((seed.match(/await ensureAnalyticsDemoBootstrap\(\)/g) ?? []).length >= 1);
  assert.match(seed, /if \(await getSystemDataMode\(\) === "empty"\) return before/);
  assert.match(api, /getSystemDataMode\(\)!=="empty"/);
  assert.match(actions, /const dataMode = await getSystemDataMode\(\)/);
  assert.match(actions, /dataMode !== "empty"/);
  assert.match(actions, /dataMode === "empty"/);
  assert.match(ui, /data\.contracts\.find[\s\S]*?\?\?\s*data\.contracts\[0\]/);
  assert.match(ui, /contract\s*\?/);
  assert.match(ui, /Подключить источники/);
});
