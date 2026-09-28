import test from 'node:test';
import assert from 'node:assert/strict';
import { permitsEnrollment, educationConditionKey, makeEducationCondition } from '../lib/education-conditions.ts';
const approved = makeEducationCondition({childId:'CH-TEST',remoteBranchId:'8',enabled:true,actor:'owner-test',now:'2026-09-29T00:00:00Z'});
test('explicit tuition exemption retains an enrolled open customer',()=>{
  assert.equal(permitsEnrollment('open',approved,'CH-TEST','8'),true);
});
test('open or lead status alone never enrolls or grants tuition exemption',()=>{
  for(const status of ['open','lead','unknown','completed','']) assert.equal(permitsEnrollment(status,null,'CH-TEST','8'),false);
  assert.equal(permitsEnrollment('lead',approved,'CH-TEST','8'),false);
});
test('condition is bound to exact child and branch, and requires provenance',()=>{
  for(const condition of [null,{},true,{...approved,actor:''},{...approved,enrollment:'inactive'},{...approved,tuition:'paid'}]) assert.equal(permitsEnrollment('open',condition,'CH-TEST','8'),false);
  assert.equal(permitsEnrollment('open',approved,'OTHER','8'),false);
  assert.equal(permitsEnrollment('open',approved,'CH-TEST','9'),false);
});
test('ordinary source enrollment remains unchanged; revocation removes only exception',()=>{
  const revoked=makeEducationCondition({childId:'CH-TEST',remoteBranchId:'8',enabled:false,actor:'owner-test',now:'2026-09-30T00:00:00Z'});
  assert.equal(permitsEnrollment('open',revoked,'CH-TEST','8'),false);
  for(const status of ['active','unverified']) assert.equal(permitsEnrollment(status,null,'CH-TEST','8'),true);
});
test('durable state key is independent from source snapshot and different per branch',()=>{
  assert.equal(educationConditionKey('CH-TEST','8'),'education_conditions:CH-TEST:8');
  assert.notEqual(educationConditionKey('CH-TEST','8'),educationConditionKey('CH-TEST','9'));
  assert.equal(approved.scope,'tuition_only');
  assert.equal(approved.effectiveFrom,'2026-09-29T00:00:00Z');
});
