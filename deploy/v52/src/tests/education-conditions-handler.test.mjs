import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { educationConditionKey,makeEducationCondition,permitsEnrollment } from '../lib/education-conditions.ts';
const source=stripTypeScriptTypes(readFileSync(new URL('../lib/education-conditions-handler.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function fixture({owner=true,authenticated=true,csrf=true,origin=true,failAudit=false}={}) {
  const sql=new DatabaseSync(':memory:');
  sql.exec("CREATE TABLE entity_links(from_entity_id TEXT,to_entity_id TEXT); INSERT INTO entity_links VALUES('F-TEST','CH-TEST'); CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT,updated_at TEXT); CREATE TABLE audit_events(actor TEXT,action TEXT,entity_type TEXT,entity_id TEXT,payload TEXT); CREATE TABLE alfacrm_raw_observations(id TEXT,payload TEXT); INSERT INTO alfacrm_raw_observations VALUES('OBS','{}'); CREATE TABLE alfacrm_current_records(module TEXT,remote_branch_id TEXT,record_id TEXT,active INTEGER,observation_id TEXT); INSERT INTO alfacrm_current_records VALUES('families','8','123',1,'OBS');");
  const cards=[{id:'F-TEST',entityType:'Семья',status:'Активна'},{id:'CH-TEST',entityType:'Ребёнок',status:'Активна',scope:'Test school',metadata:JSON.stringify({remoteBranchId:'8',alfaCustomerId:'123',customerLifecycle:'open'})}];
  const db={prepare(query){return{bind(...args){return{first:async()=>sql.prepare(query).get(...args)??null,all:async()=>({results:sql.prepare(query).all(...args)}),run:()=>{if(failAudit&&query.includes('INSERT INTO audit_events'))throw new Error('audit failed');return sql.prepare(query).run(...args);}};}};},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>s.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  const index={cards,canonical:id=>id,members:id=>[id]};
  const deps={env:{DB:db},ensureCoreTables:async()=>{},readIdentityIndex:async()=>index,serializeIdentityMutation:fn=>fn(),getAuthenticatedRequestContext:async()=>authenticated?{actor:'test-owner'}:null,isCanonicalOwnerContext:()=>owner,verifyAuthenticatedRequestCsrf:()=>{if(!csrf)throw new Error('csrf');},hasTrustedMutationOrigin:()=>origin,educationConditionKey,makeEducationCondition,permitsEnrollment};
  const handler=new Function(...Object.keys(deps),`${source}\nreturn handleEducationConditions;`)(...Object.values(deps));
  const body={action:'education-conditions',familyId:'F-TEST',childId:'CH-TEST',enabled:true};
  const request=new Request('https://school.example.test/api/families');
  return {sql,cards,index,body,request,handler,count:()=>sql.prepare('SELECT count(*) AS n FROM system_runtime_state').get().n};
}
test('owner saves condition and audit atomically; repeated same decision is idempotent',async()=>{
  const f=fixture();assert.equal((await f.handler(f.request,f.body)).status,200);assert.equal(f.count(),1);
  assert.equal((await f.handler(f.request,f.body)).status,200);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM audit_events').get().n,1);
  const stored=JSON.parse(f.sql.prepare('SELECT state_value FROM system_runtime_state').get().state_value);
  assert.equal(permitsEnrollment('open',stored,'CH-TEST','8'),true);
  f.cards[1].metadata=JSON.stringify({remoteBranchId:'8',alfaCustomerId:'123',customerLifecycle:'open',freshImport:true});
  const read=new Request('https://school.example.test/api/families?action=education-conditions&familyId=F-TEST&childId=CH-TEST');
  assert.equal((await (await f.handler(read)).json()).enabled,true);
});
test('missing session, non-owner, bad csrf and untrusted origin cannot save',async()=>{
  for(const [options,status] of [[{authenticated:false},401],[{owner:false},403],[{csrf:false},403],[{origin:false},403]]){
    const f=fixture(options);assert.equal((await f.handler(f.request,f.body)).status,status);assert.equal(f.count(),0);
  }
});
test('unrelated, inactive, ambiguous and absent source cards are rejected',async()=>{
  for(const mutate of [f=>f.sql.exec('DELETE FROM entity_links'),f=>{f.cards[1].status='Архив';},f=>{f.index.members=()=>['CH-TEST','OTHER'];},f=>f.sql.exec('UPDATE alfacrm_current_records SET active=0'),f=>{f.cards[1].metadata='{}';}]){
    const f=fixture();mutate(f);assert.equal((await f.handler(f.request,f.body)).status,409);assert.equal(f.count(),0);
  }
});
test('audit failure rolls back the condition; no partial permission or money change',async()=>{
  const f=fixture({failAudit:true});assert.equal((await f.handler(f.request,f.body)).status,503);assert.equal(f.count(),0);
});
test('revocation is explicit and audited without deleting history',async()=>{
  const f=fixture();await f.handler(f.request,f.body);
  assert.equal((await f.handler(f.request,{...f.body,enabled:false})).status,200);
  const stored=JSON.parse(f.sql.prepare('SELECT state_value FROM system_runtime_state').get().state_value);
  assert.equal(permitsEnrollment('open',stored,'CH-TEST','8'),false);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM audit_events').get().n,2);
});
