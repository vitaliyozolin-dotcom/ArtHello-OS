import assert from 'node:assert/strict';
import test from 'node:test';
import { synchronize, classMappings } from '../../deploy/alfa_sync.mjs';

function options(branchId) {
  const count=branchId==='BR-SCHOOL'?6:4;
  return {branchId,groups:Array.from({length:count},(_,i)=>({id:`group-${i+1}`,name:`${i+1}-А класс 2026-2027`})),
    classes:branchId==='BR-SCHOOL'?Array.from({length:6},(_,i)=>({id:`class-${i+1}`,name:`${i+1} класс`,grade:i+1})):[]};
}
function fixture(change=()=>{}) {
  let previews=0;const calls=[];
  return {calls,login:async()=>({userId:'USR-OWNER',isSystemOwner:true,mustChangePassword:false}),logoutAll:async()=>calls.push({action:'logout'}),
    json:async(method,origin,path,body={})=>{
      calls.push(body);let result;
      if(method==='GET') result={canManageCredentials:true,credentialStored:true,importEnabled:true,state:{connected:true,endpoint:'https://arthellonew.s20.online',branchMappings:{2:'BR-LISTVENNAYA',6:'BR-KINDERGARTEN',8:'BR-SCHOOL',9:'BR-NEBO',10:'BR-ATLAS-SCHOOL'}}};
      if(body.action==='previewCustomers') result={customerPreview:{unknown:1,duplicates:0,foreignBranch:0,includedAssignments:839,byBranch:{2:{review:1}},comparison:{reviewIds:['deferred'],archiveIds:previews++?[]:['old'],newSourceKeys:[],moves:[]}}};
      if(body.action==='previewLegacyMigration') result={legacyMigration:{complete:true}};
      if(body.action==='previewModule') result={previewToken:`token-${body.module}`,count:body.module==='families'?839:10,deferredCount:body.module==='families'?1:0};
      if(body.action==='importModule') result={complete:true,accepted:body.module==='families'?839:10,rejected:0,deferredCount:body.module==='families'?1:0,state:{modules:{[body.module]:{status:'imported'}}}};
      if(body.action==='readDiaryDirectoryOptions') result={diaryOptions:options(body.branchId)};
      if(['previewDiaryDirectory','applyDiaryDirectory'].includes(body.action)) result={diaryDirectory:{token:'diary-token',applied:body.action==='applyDiaryDirectory',students:30,families:30,classes:body.branchId==='BR-SCHOOL'?6:4,teachers:4,archived:0}};
      change(body,result);return result;
    }};
}
test('sync uses staged owner APIs, defers one customer and verifies both repeated diary receipts',async()=>{
  const client=fixture();const result=await synchronize(client);
  assert.equal(result.status,'synchronized-except-deferred-record');
  assert.equal(result.modules.families.deferred,1);
  assert.deepEqual(client.calls.filter(c=>c.action==='importModule').map(c=>c.module),['families','staff','groups']);
  assert.equal(client.calls.filter(c=>c.action==='applyDiaryDirectory').length,4);
  assert.equal(client.calls.at(-1).action,'logout');
  assert.equal(client.calls.find(c=>c.action==='importModule').deferMissingStatusBranch,'2');
});
test('unexpected source exclusions prevent all import mutations',async()=>{
  const client=fixture((body,result)=>{if(body.action==='previewCustomers')result.customerPreview.unknown=2;});
  await assert.rejects(()=>synchronize(client),/SOURCE_REVIEW_DRIFT/);
  assert.equal(client.calls.some(c=>c.action==='importModule'),false);
  assert.equal(client.calls.at(-1).action,'logout');
});
test('partial import stops before dependent imports and diary transfer',async()=>{
  const client=fixture((body,result)=>{if(body.action==='importModule')result.rejected=1;});
  await assert.rejects(()=>synchronize(client),/MODULE_IMPORT_UNCONFIRMED/);
  assert.equal(client.calls.filter(c=>c.action==='importModule').length,1);
  assert.equal(client.calls.some(c=>c.action==='applyDiaryDirectory'),false);
});
test('existing School classes are explicitly preserved; ambiguous grades fail closed',()=>{
  const input=options('BR-SCHOOL');
  assert.equal(classMappings('BR-SCHOOL',input)[0].localId,'class-1');
  assert.equal(classMappings('BR-SCHOOL',input)[0].name,'1 класс');
  input.groups.push({id:'duplicate',name:'1-Б класс 2026-2027'});
  assert.throws(()=>classMappings('BR-SCHOOL',input),/CLASS_AMBIGUOUS/);
});

test('failed staff preview reports exact stage and never begins staff import',async()=>{
  const client=fixture((body)=>{if(body.action==='previewModule'&&body.module==='staff')throw Error('HTTP_502');});
  const progress=[];
  await assert.rejects(()=>synchronize(client,p=>progress.push(p)),/HTTP_502/);
  assert.deepEqual(progress.at(-1),{stage:'module-preview',module:'staff'});
  assert.equal(client.calls.some(c=>c.action==='importModule'&&c.module==='staff'),false);
});

test('audit HTTP errors retain their status even if gateway returned HTML',async(t)=>{
  const {AuditClient}=await import('../../deploy/alfa_reconciliation_audit.mjs');
  const client=new AuditClient('test','synthetic-password-only');
  t.mock.method(globalThis,'fetch',async()=>new Response('<html>gateway</html>',{status:502}));
  await assert.rejects(()=>client.json('POST','https://arthello-188-225-38-55.sslip.io','/api/integrations/alfacrm',{}),/HTTP_502/);
});

test('audit transport preserves the normal logout redirect',async(t)=>{
  const {AuditClient}=await import('../../deploy/alfa_reconciliation_audit.mjs');
  const client=new AuditClient('test','synthetic-password-only');
  t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:303,headers:{location:'/login'}}));
  await client.logoutAll();
});


test('empty teacher delivery cannot be reported as a completed school synchronization',async()=>{
  const client=fixture((body,result)=>{if(body.action==='previewDiaryDirectory')result.diaryDirectory.teachers=0;});
  await assert.rejects(()=>synchronize(client),/DIARY_PREVIEW_UNCONFIRMED/);
  assert.equal(client.calls.some(c=>c.action==='applyDiaryDirectory'),false);
});
