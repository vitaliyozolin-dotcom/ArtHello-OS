import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiaryDirectory } from '../lib/diary-directory.ts';

const groups=[{id:'G1',branchId:'BR-SCHOOL',status:'Активна',teacherId:'T1'},{id:'G2',branchId:'BR-ATLAS-SCHOOL',status:'Активна',teacherId:'T2'}];
const memberships=[{childId:'C1',familyId:'F1',groupId:'G1',displayName:'Фамилия Имя Отчество'},{childId:'C2',familyId:'F2',groupId:'G2',displayName:'Другой ученик'}];
const classes=[{id:'G1',name:'1А',grade:1,localId:'existing-1'}];
test('directory uses confirmed group and family IDs without sharing pupils across schools',()=>{
  const s=buildDiaryDirectory('BR-SCHOOL',1,classes,groups,memberships,[{id:'T1',displayName:'Учитель'}]);
  assert.equal(s.students.length,1);assert.equal(s.students[0].id,'C1');assert.equal(s.students[0].familyId,'F1');
  assert.equal(s.students[0].firstName,'Фамилия Имя Отчество');assert.equal(s.students[0].lastName,'');
  assert.deepEqual(s.teachers,[{id:'T1',displayName:'Учитель'}]);
});
test('duplicate memberships collapse; conflicting classes or families stop the snapshot',()=>{
  assert.equal(buildDiaryDirectory('BR-SCHOOL',1,classes,groups,[memberships[0],memberships[0]],[]).students.length,1);
  assert.throws(()=>buildDiaryDirectory('BR-SCHOOL',1,classes,groups,[memberships[0],{...memberships[0],familyId:'OTHER'}],[]));
  assert.throws(()=>buildDiaryDirectory('BR-SCHOOL',1,[{id:'G2',name:'2А',grade:2}],groups,memberships,[]));
  assert.throws(()=>buildDiaryDirectory('BR-SCHOOL',1,[],groups,memberships,[]));
});

test('school staff includes confirmed branch teachers without a group slot and respects archived assignments',()=>{
  const staff = [
    {id:'T3',displayName:'School specialist',metadata:JSON.stringify({localBranchId:'BR-SCHOOL'})},
    {id:'T4',displayName:'Atlas specialist',metadata:JSON.stringify({localBranchId:'BR-ATLAS-SCHOOL'})},
    {id:'T5',displayName:'Shared teacher',metadata:JSON.stringify({localBranchId:'BR-NURSERY',branchAssignments:[{localBranchId:'BR-SCHOOL',active:true},{localBranchId:'BR-NURSERY',active:true}]})},
    {id:'T1',displayName:'Departed school teacher',metadata:JSON.stringify({localBranchId:'BR-SCHOOL',branchAssignments:[{localBranchId:'BR-SCHOOL',active:false},{localBranchId:'BR-NURSERY',active:true}]})},
  ];
  assert.deepEqual(buildDiaryDirectory('BR-SCHOOL',1,classes,groups,memberships,staff).teachers.map(t=>t.id),['T3','T5']);
});
