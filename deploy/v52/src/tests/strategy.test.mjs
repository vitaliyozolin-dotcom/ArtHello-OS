import test from"node:test";import assert from"node:assert/strict";import{kpiState,projectBudget,eventPortfolio,canCloseStrategyDeviation}from"../lib/strategy.ts";
test("KPI distinguishes current and forecast recovery",()=>assert.deepEqual(kpiState(70,64,71),{variance:-6,forecastVariance:1,status:"Восстановится"}));
test("project budget reports minor-unit utilization",()=>assert.deepEqual(projectBudget(120000000,85000000),{remainingMinor:35000000,utilizationPercent:71,status:"В бюджете"}));
test("calendar separates past and future events",()=>assert.deepEqual(eventPortfolio([{status:"Проведено",feedbackScore:86},{status:"Запланировано",feedbackScore:0}]),{past:1,future:1,feedbackAverage:86}));
test("deviation needs evidence and explicit decision",()=>{assert.equal(canCloseStrategyDeviation("Проверено по EVENT-T-0824","Продолжить пилот"),true);assert.equal(canCloseStrategyDeviation("нет","Продолжить пилот"),false)});
