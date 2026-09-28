import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { educationConditionKey,makeEducationCondition,permitsEnrollment } from '../lib/education-conditions.ts';
const route=readFileSync(new URL('../app/api/integrations/alfacrm/route.ts',import.meta.url),'utf8');
const source=stripTypeScriptTypes(route.slice(route.indexOf('async function syncMembershipsFromFamilyRaw('),route.indexOf('async function canonicalizeLessons(')));
test('real membership projector preserves exempt enrollment across repeated imports without enrolling other open records',async()=>{
  const sql=new DatabaseSync(':memory:');
  sql.exec("CREATE TABLE entities(id TEXT PRIMARY KEY,status TEXT); CREATE TABLE education_groups(id TEXT PRIMARY KEY,unit_entity_id TEXT,status TEXT); CREATE TABLE education_students(id TEXT PRIMARY KEY,child_entity_id TEXT,family_entity_id TEXT,group_id TEXT,cabinet_status TEXT,status TEXT); CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT); CREATE TABLE alfacrm_raw_observations(id TEXT,payload TEXT); CREATE TABLE alfacrm_current_records(module TEXT,remote_branch_id TEXT,record_id TEXT,observation_id TEXT,active INTEGER); CREATE TABLE proof_events(kind TEXT); INSERT INTO education_groups VALUES('G-1','BR-SCHOOL','Активна');");
  const cards=[];
  for(const id of ['101','102','103']){
    const childId=`CHD-A-8:${id}`,familyId=`FAM-A-8:student:${id}`;
    cards.push({id:childId,metadata:JSON.stringify({customerLifecycle:'open'})});
    sql.prepare("INSERT INTO entities VALUES(?,'Активна')").run(childId);sql.prepare("INSERT INTO entities VALUES(?,'Активна')").run(familyId);
    sql.prepare("INSERT INTO education_students VALUES(?,?,?,'G-1','Доступ не выдан','Активен')").run(`STU-A-8:${id}:1`,childId,familyId);
    sql.prepare('INSERT INTO alfacrm_raw_observations VALUES(?,?)').run(id,JSON.stringify({id,group_ids:['1']}));
    sql.prepare("INSERT INTO alfacrm_current_records VALUES('families','8',?,?,1)").run(id,id);
  }
  const condition=makeEducationCondition({childId:'CHD-A-8:101',remoteBranchId:'8',enabled:true,actor:'owner-test',now:'2026-09-29T00:00:00Z'});
  sql.prepare('INSERT INTO system_runtime_state VALUES(?,?)').run(educationConditionKey(condition.childId,'8'),JSON.stringify(condition));
  const prepare=(query,args=[])=>({bind:(...values)=>prepare(query,values),all:async()=>({results:sql.prepare(query).all(...args)}),run:()=>sql.prepare(query).run(...args)});
  const db={prepare,batch:async statements=>statements.map(statement=>statement.run())};
  const deps={env:{DB:db},readIdentityIndex:async()=>({cards,canonical:id=>id}),educationConditionKey,permitsEnrollment,shortHash:async value=>value,runBatches:async statements=>db.batch(statements),alfaBranchDisposition:()=> 'accepted',scalar:value=>String(value??''),groupIds:item=>item.group_ids,localGroupId:async()=> 'G-1',lineageStatement:()=>prepare("INSERT INTO proof_events VALUES('lineage')"),auditStatement:()=>prepare("INSERT INTO proof_events VALUES('audit')")};
  const sync=new Function(...Object.keys(deps),`${source}\nreturn syncMembershipsFromFamilyRaw;`)(...Object.values(deps));
  const state={branchMappings:{'8':'BR-SCHOOL'},modules:{families:{}}};
  for(let pass=0;pass<2;pass++){
    await sync(state,'owner-test');
    assert.deepEqual(sql.prepare("SELECT child_entity_id AS id FROM education_students WHERE status='Активен'").all().map(row=>row.id),['CHD-A-8:101']);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM education_students').get().n,3);
    assert.equal(sql.prepare('SELECT state_value FROM system_runtime_state').get().state_value,JSON.stringify(condition));
  }
  sql.exec("UPDATE education_groups SET status='Архив'");await sync(state,'owner-test');
  assert.equal(sql.prepare("SELECT count(*) AS n FROM education_students WHERE status='Активен'").get().n,0);
});
