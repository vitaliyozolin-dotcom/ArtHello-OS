import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentityIndex } from '../lib/entity-identity.ts';
const card = (id, entityType = 'Ребёнок') => ({ id, entityType });
test('confirmed aliases resolve transitively; siblings and roles stay separate', () => {
  const index = buildIdentityIndex([card('A'), card('B'), card('C'), card('SIBLING'), card('EMP', 'Сотрудник')], [
    { duplicateId: 'C', survivorId: 'B' }, { duplicateId: 'B', survivorId: 'A' },
  ]);
  assert.equal(index.canonical('C'), 'A');
  assert.deepEqual(index.members('C').sort(), ['A', 'B', 'C']);
  assert.equal(index.canonical('SIBLING'), 'SIBLING');
  assert.equal(index.canonical('EMP'), 'EMP');
});
test('identity graph rejects cycles, missing cards, mixed types and ambiguous aliases', () => {
  for (const merges of [
    [{ duplicateId: 'A', survivorId: 'B' }, { duplicateId: 'B', survivorId: 'A' }],
    [{ duplicateId: 'A', survivorId: 'MISSING' }],
    [{ duplicateId: 'A', survivorId: 'EMP' }],
    [{ duplicateId: 'A', survivorId: 'B' }, { duplicateId: 'A', survivorId: 'C' }],
  ]) assert.throws(() => buildIdentityIndex([card('A'), card('B'), card('C'), card('EMP', 'Сотрудник')], merges));
});

import { scopeHrReadTables } from '../lib/hr-read-scope.ts';
test('canonical employee is visible in each assigned branch without disclosing the other branch',()=>{
 const tables=Object.fromEntries(['vacancyRows','candidateRows','interviewRows','employeeRows','onboardingRows','developmentRows','rewardRows','accessRows','rawEntityRows','documentRows','operationRows','branchRows'].map(key=>[key,[]]));
 tables.employeeRows=[{id:'EMP',unit:'School',contractId:'PRIVATE'}];
 tables.branchRows=[{id:'A',name:'School',status:'Активен'},{id:'B',name:'Atlas',status:'Активен'}];
 tables.rawEntityRows=[{id:'EMP',metadata:JSON.stringify({branchAssignments:[{localBranchId:'A',active:true},{localBranchId:'B',active:true}]})}];
 const visible=scopeHrReadTables(tables,{unrestrictedOwner:false,allowedBranchIds:['B']});
 assert.equal(visible.employeeRows.length,1);
 assert.equal(visible.employeeRows[0].unit,'Atlas');
 assert.equal(visible.employeeRows[0].contractId,'');
 assert.deepEqual(JSON.parse(visible.rawEntityRows[0].metadata).branchIds,['B']);
});
