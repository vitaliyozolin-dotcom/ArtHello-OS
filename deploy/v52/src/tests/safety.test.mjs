import test from"node:test";import assert from"node:assert/strict";import{nextSafetyCheck,faultSla,canPaySafetyRepair,safetyReadiness}from"../lib/safety.ts";
test("next safety check is based on repair completion",()=>assert.equal(nextSafetyCheck("2026-08-20T15:30:00Z",31),"2026-09-20"));
test("high fault SLA becomes overdue after eight hours",()=>assert.equal(faultSla("Высокая","2026-08-20T08:00:00Z","2026-08-20T17:00:01Z","В работе"),"Просрочено"));
test("repair cannot be paid without a completion act",()=>assert.equal(canPaySafetyRepair({status:"Завершён",actDocumentId:"",result:"Контрольный тест пройден"}),false));
test("safety readiness is derived from checks and open faults",()=>assert.deepEqual(safetyReadiness([{status:"Завершена",result:"Неисправность"},{status:"Завершена",result:"Соответствует"},{status:"Запланирована",result:"Ожидает"}],[{status:"Устранена"},{status:"В работе"}]),{completed:2,failed:1,openFaults:1,readinessPercent:67}));
