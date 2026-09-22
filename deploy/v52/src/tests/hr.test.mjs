import assert from "node:assert/strict"; import test from "node:test";
import { accessAllowed, candidateFunnel, nextCandidateStage, salaryRub } from "../lib/hr.ts";
test("candidate stage advances one gate at a time",()=>{assert.equal(nextCandidateStage("Интервью","Решение"),true);assert.equal(nextCandidateStage("Интервью","Оффер"),false)});
test("candidate funnel counts reached stages",()=>{const rows=[{stage:"Сотрудник"},{stage:"Интервью"},{stage:"Новый"}];assert.deepEqual(candidateFunnel(rows).slice(0,3).map(x=>x.count),[3,2,2])});
test("terminated employee never keeps access",()=>{assert.equal(accessAllowed("Уволен","Активен"),false);assert.equal(accessAllowed("Работает","Отозван"),false);assert.equal(accessAllowed("Работает","Активен"),true)});
test("salary keeps minor units at storage boundary",()=>assert.equal(salaryRub(9500000),95000));

test('staff archive excludes former employees while retaining current manual statuses', async () => {
  const { isArchivedEmployee } = await import('../lib/hr.ts');
  assert.equal(isArchivedEmployee('Неактивен в AlfaCRM'), true);
  assert.equal(isArchivedEmployee('Уволен'), true);
  assert.equal(isArchivedEmployee('Работает'), false);
  assert.equal(isArchivedEmployee('В отпуске'), false);
});
