import test from 'node:test';
import assert from 'node:assert/strict';
import {audit,summarizePreview,classifyAlfaApiFailure} from '../../deploy/alfa_reconciliation_audit.mjs';
test('failure diagnostics disclose only fixed reasons, never API text',()=>{
  assert.equal(classifyAlfaApiFailure(502,{error:'AlfaCRM повторила страницу. Полнота загрузки не подтверждена; изменения не применены.'}),'ALFA_REPEATED_PAGE');
  assert.equal(classifyAlfaApiFailure(502,{error:'AlfaCRM не выполнила чтение данных (429).'}),'ALFA_UPSTREAM_HTTP_429');
  assert.equal(classifyAlfaApiFailure(502,{error:'private person token secret'}),'HTTP_502');
  assert.equal(classifyAlfaApiFailure(502,{error:'AlfaCRM не выполнила чтение данных (private).'}),'HTTP_502');
  assert.equal(classifyAlfaApiFailure(502,null),'HTTP_502');
  for(const [message,code] of [
    ['AlfaCRM не вернула корректный список записей. Изменения не применены.','ALFA_INVALID_LIST'],
    ['AlfaCRM вернула некорректное количество записей.','ALFA_INVALID_TOTAL'],
    ['Серверный канал AlfaCRM не настроен. Подключение не изменено.','ALFA_TRANSPORT_NOT_CONFIGURED'],
    ['AlfaCRM перенаправила запрос. Проверьте адрес аккаунта; данные доступа на другой адрес не отправлялись.','ALFA_REDIRECT'],
  ]) assert.equal(classifyAlfaApiFailure(502,{error:message}),code);
});
test('public reconciliation counts never include customer identifiers or upstream names',()=>{
  const report=summarizePreview({customerPreview:{byBranch:{'6':{active:3,phone:'private'}},intersections:[{id:'private',branches:['6','8']}],schoolAssignments:[{id:'private'}],comparison:{archiveIds:['private'],moves:[{name:'private'}]},raw:'private'}});
  assert.equal(report.byBranch['6'].active,3); assert.equal(report.intersectionCustomers,1);
  assert.equal(report.comparison.archiveIds,1); assert.doesNotMatch(JSON.stringify(report),/private/);
});
test('audit restricts requests to previews and checks both diaries after a failed source preview',async()=>{
  const calls=[];let loggedOut=false;
  const result=await audit({login:async()=>({userId:'USR-OWNER',isSystemOwner:true,mustChangePassword:false}),logoutAll:async()=>{loggedOut=true;},json:async(method,origin,path,body)=>{
    calls.push(body?.action??method);
    if(method==='GET') return {canManageCredentials:true,credentialStored:true,state:{endpoint:'https://arthellonew.s20.online',branchMappings:{'6':'BR-KINDERGARTEN'}}};
    if(body.action==='previewCustomers') throw Error('HTTP_409');
    if(body.action==='previewLegacyMigration') return {legacyMigration:{count:100,complete:false,token:'private'}};
    if(body.action==='previewModule') { assert.equal(body.module,'staff'); throw Error('ALFA_UPSTREAM_HTTP_429'); }
    return {diaryOptions:{classes:[],groups:[]}};
  }});
  assert.deepEqual(calls,['GET','previewCustomers','previewLegacyMigration','readDiaryDirectoryOptions','readDiaryDirectoryOptions']);
  assert.equal(loggedOut,true);assert.equal(result.checks.customers.status,'blocked');assert.equal(result.checks['BR-SCHOOL'].status,'verified');assert.equal(result.businessDataChanged,false);
  assert.equal(result.checks.staffStored.reason,'STORED_STAFF_EVIDENCE_UNCONFIRMED');
});

test('staff audit reads stored evidence with autosync enabled without creating an import preview',async()=>{
 const calls=[];
 const result=await audit({login:async()=>({userId:'USR-OWNER',isSystemOwner:true,mustChangePassword:false}),logoutAll:async()=>{},json:async(method,origin,path,body)=>{
  calls.push({method,path,action:body?.action});
  if(method==='GET')return {canManageCredentials:true,credentialStored:true,state:{endpoint:'https://arthellonew.s20.online',autosync:{enabled:true}},scopeAudit:{modules:{staff:{observed:3,accepted:2,uniqueCustomers:1,foreignBranch:0,inactive:1,unknown:0,complete:true,byBranch:{'6':1,'10':1,private:99},lastObservedAt:'2026-09-26T17:00:00.000Z',private:'private name'}}}};
  if(body.action==='previewModule')throw Error('IMPORT_PREVIEW_MUST_NOT_RUN');
  if(body.action==='previewCustomers')throw Error('HTTP_409');
  if(body.action==='previewLegacyMigration')return {legacyMigration:{count:0,complete:true}};
  return {diaryOptions:{classes:[],groups:[]}};
 }});
 assert.equal(calls[0].path,'/api/integrations/alfacrm?scopeAudit=1');
 assert.equal(calls.some(c=>c.action==='previewModule'),false);
 assert.equal(result.checks.staffStored.status,'verified');
 assert.equal(result.checks.staffStored.uniqueSourceTeacherIds,1);
 assert.equal(result.checks.staffStored.accepted,2);
 assert.equal(result.checks.staffStored.source,'stored-observations');
 assert.equal(result.connector.autosyncEnabled,true);
 assert.doesNotMatch(JSON.stringify(result),/private/);
});
