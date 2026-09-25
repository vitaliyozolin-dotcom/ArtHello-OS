import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTransportProbe, summarizeLessonLinks, summarizePayPage } from '../../.github/scripts/alfa-source-audit.mjs';

test('transport probe emits fixed codes and never teacher response bodies', async()=>{
  assert.deepEqual(await summarizeTransportProbe(Response.json({items:[{name:'private'}]})),{status:200,ok:true});
  assert.deepEqual(await summarizeTransportProbe(Response.json({error:'upstream_response_too_large'},{status:502,headers:{'x-arthello-upstream-error':'unavailable'}})),{status:502,ok:false,reason:'upstream_response_too_large'});
  assert.deepEqual(await summarizeTransportProbe(Response.json({error:'upstream_response_too_large'},{status:502})),{status:502,ok:false,reason:'unclassified'});
  assert.deepEqual(await summarizeTransportProbe(Response.json({error:'invalid_request'},{status:400})),{status:400,ok:false,reason:'unclassified'});
  const unknown=await summarizeTransportProbe(Response.json({error:'private secret',detail:'private'},{status:502}));
  assert.deepEqual(unknown,{status:502,ok:false,reason:'unclassified'});
  assert.doesNotMatch(JSON.stringify(unknown),/private|secret/);
});

test('lesson audit distinguishes individual lessons from unknown groups without printing pupil data',()=>{
  const records=[
    {id:1,lesson_type_id:7,customer_ids:[91],note:'private child'},
    {id:2,lesson_type_id:7,group_ids:[],customer_ids:[],note:'private child'},
    {id:3,group_ids:[5],note:'private child'},
    {id:4,group_ids:[6],note:'private child'},
  ];
  const result=summarizeLessonLinks(records,[{id:5}]);
  assert.equal(result.withoutGroupWithCustomers,1);
  assert.equal(result.withoutGroupWithoutCustomers,1);
  assert.equal(result.withCurrentGroup,1);
  assert.deepEqual(result.unknownGroupIds,{'6':1});
  assert.doesNotMatch(JSON.stringify(result),/private|child|91/);
});

test('payment audit identifies out-of-period source rows and keeps amounts private',()=>{
  const result=summarizePayPage({total:123348,items:[
    {document_date:'2026.08.31',pay_type_id:5,currency:'rub',income:999999},
    {document_date:'2026.09.01',pay_type_id:12,currency:'rub',income:12345},
    {document_date:'25.09.2026',pay_type_id:5,currency:'rub',income:10},
  ]},'2026-09-01','2026-09-24');
  assert.deepEqual({before:result.before,inRange:result.inRange,after:result.after}, {before:1,inRange:1,after:1});
  assert.equal(result.total,123348);
  assert.doesNotMatch(JSON.stringify(result),/999999|12345|2026.08.31/);
});
