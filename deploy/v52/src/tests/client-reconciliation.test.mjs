import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {REVIEW_KEY,applyReview,reviewPreview,reviewTargets} from '../lib/client-reconciliation.ts';
import {entityDataState} from '../lib/entity-provenance.ts';
import {familyCardState} from '../lib/family-card-state.ts';
const card=(id,entityType='Ребёнок',status='Активна')=>({id,entityType,status,displayName:id,sourceSystem:'ALFACRM',sourceRecordId:id,scope:'school',metadata:'{}',dataQuality:'На проверке',updatedAt:'2026-09-29'});
const cards=[card('F','Семья'),card('C'),card('P','Клиент'),card('A','Ребёнок','Архив'),card('EMP','Сотрудник'),card('LEAD','Клиент')];
const links=[{fromEntityId:'F',toEntityId:'C',relationType:'child'},{fromEntityId:'F',toEntityId:'P',relationType:'parent'},{fromEntityId:'F',toEntityId:'A',relationType:'child'}];
test('current linked customers only; archive, employee and unrelated lead remain outside approval',()=>assert.deepEqual(reviewTargets(cards,links).map(c=>c.id),['C','F','P']));
test('explicit owner evidence clears review without merging; unchanged source refresh retains acceptance',async()=>{
 const preview=await reviewPreview(cards,links);const receipt={version:1,actor:'owner',at:'2026-09-29T17:00:00Z',reason:'Owner accepted roster',signatures:preview.signatures};
 const updated=await applyReview(cards.map(c=>({...c,updatedAt:'later',dataQuality:'Требует сверки',metadata:'{"lastImportAt":"later"}'})),links,receipt);
 assert.equal(entityDataState(updated[0],true),'Проверено');assert.equal(familyCardState(updated[0],{hasDuplicate:true}).issues.length,0);assert.equal(updated[3].status,'Архив');assert.equal(updated[3].ownerReconciled,undefined);
});
test('identity, source status, new name collision and relationship changes invalidate approval',async()=>{
 const p=await reviewPreview(cards,links),r={version:1,actor:'owner',at:'2026-09-29T17:00:00Z',reason:'Accepted roster',signatures:p.signatures};
 for(const change of [{displayName:'Changed'},{scope:'other'},{metadata:'{"customerLifecycle":"finished"}'},{sourceRecordId:'new'},{status:'Архив'}])assert.equal((await applyReview(cards.map(c=>c.id==='C'?{...c,...change}:c),links,r)).find(c=>c.id==='C').ownerReconciled,change.status==='Архив'?undefined:false);
 assert.equal((await applyReview([...cards,{...card('D'),displayName:'C'}],links,r)).find(c=>c.id==='C').ownerReconciled,false);
 assert.equal((await applyReview(cards,[],r)).find(c=>c.id==='C').ownerReconciled,false);
});
const source=stripTypeScriptTypes(readFileSync(new URL('../lib/client-reconciliation-handler.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function fixture({owner=true,authenticated=true,csrf=true,origin=true,failAudit=false}={}){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE entities(id TEXT PRIMARY KEY,entity_type TEXT,display_name TEXT,source_system TEXT,source_record_id TEXT,scope TEXT,status TEXT,metadata TEXT,data_quality TEXT,updated_at TEXT);CREATE TABLE entity_links(from_entity_id TEXT,to_entity_id TEXT,relation_type TEXT);CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT NOT NULL,updated_at TEXT);CREATE TABLE audit_events(actor TEXT,action TEXT,entity_type TEXT,entity_id TEXT,payload TEXT);');
 for(const c of cards)sql.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?,?,?,?)').run(c.id,c.entityType,c.displayName,c.sourceSystem,c.sourceRecordId,c.scope,c.status,c.metadata,c.dataQuality,c.updatedAt);
 for(const l of links)sql.prepare('INSERT INTO entity_links VALUES(?,?,?)').run(l.fromEntityId,l.toEntityId,l.relationType);
 const db={prepare(query){let args=[];const stmt={bind(...v){args=v;return stmt;},first:async()=>sql.prepare(query).get(...args)??null,all:async()=>({results:sql.prepare(query).all(...args)}),run:()=>{if(failAudit&&query.includes('INSERT INTO audit_events'))throw Error('audit');return sql.prepare(query).run(...args);}};return stmt;},async batch(stmts){sql.exec('BEGIN');try{const out=stmts.map(s=>s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const deps={env:{DB:db},ensureCoreTables:async()=>{},serializeIdentityMutation:fn=>fn(),getAuthenticatedRequestContext:async()=>authenticated?{actor:'owner'}:null,isCanonicalOwnerContext:()=>owner,verifyAuthenticatedRequestCsrf:()=>{if(!csrf)throw Error();},hasTrustedMutationOrigin:()=>origin,REVIEW_KEY,applyReview,reviewPreview};
 const handler=new Function(...Object.keys(deps),`${source}\nreturn handleClientReconciliation;`)(...Object.values(deps));return{sql,handler,request:new Request('https://school.test/api/families'),count:()=>sql.prepare('SELECT count(*) n FROM audit_events').get().n};
}
test('owner confirms exact snapshot atomically and keeps archive/history/other entities',async()=>{const f=fixture();const p=await(await f.handler(f.request)).json();const result=await f.handler(f.request,{token:p.token,reason:'Owner accepted current roster'});assert.equal(result.status,200);assert.equal(f.count(),3);assert.equal(f.sql.prepare("SELECT data_quality FROM entities WHERE id='C'").get().data_quality,'Проверено');assert.equal(f.sql.prepare("SELECT status FROM entities WHERE id='A'").get().status,'Архив');assert.equal(f.sql.prepare("SELECT data_quality FROM entities WHERE id='LEAD'").get().data_quality,'На проверке');});
test('session, owner, origin and CSRF fail closed',async()=>{for(const [options,status] of [[{authenticated:false},401],[{owner:false},403],[{csrf:false},403],[{origin:false},403]]){const f=fixture(options);assert.equal((await f.handler(f.request,{token:'x',reason:'Owner approval'})).status,status);assert.equal(f.count(),0);}});
test('stale preview refuses all writes',async()=>{const f=fixture();const p=await(await f.handler(f.request)).json();f.sql.exec("UPDATE entities SET display_name='changed' WHERE id='C'");assert.equal((await f.handler(f.request,{token:p.token,reason:'Owner approval'})).status,409);assert.equal(f.count(),0);});
test('audit failure rolls back every status and receipt',async()=>{const f=fixture({failAudit:true});const p=await(await f.handler(f.request)).json();assert.equal((await f.handler(f.request,{token:p.token,reason:'Owner approval'})).status,503);assert.equal(f.count(),0);assert.equal(f.sql.prepare('SELECT count(*) n FROM system_runtime_state').get().n,0);assert.equal(f.sql.prepare("SELECT data_quality FROM entities WHERE id='C'").get().data_quality,'На проверке');});

test('invalidated receipt cannot inherit stored verified quality',async()=>{const p=await reviewPreview(cards,links);const r={version:1,actor:'owner',at:'2026-09-29T17:00:00Z',reason:'Accepted roster',signatures:p.signatures};const changed=cards.map(c=>({...c,dataQuality:'Проверено',displayName:c.id==='C'?'Changed':c.displayName}));assert.equal((await applyReview(changed,links,r)).find(c=>c.id==='C').dataQuality,'На проверке');assert.notEqual((await reviewPreview(cards,[])).token,p.token);});
