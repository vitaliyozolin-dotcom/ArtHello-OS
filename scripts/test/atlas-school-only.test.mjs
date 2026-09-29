import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { applyAtlasSchoolOnly } from '../../deploy/atlas_school_only.mjs';
import { parseAtlasSchoolOnly, sourceCustomerAllowed } from '../../deploy/v52/src/lib/atlas-school-source.ts';
function fixture(count=32) {
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT NOT NULL,updated_at TEXT);
    CREATE TABLE entities(id TEXT PRIMARY KEY,entity_type TEXT,display_name TEXT,status TEXT,source_system TEXT,source_record_id TEXT,data_quality TEXT,scope TEXT,metadata TEXT,created_by TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE entity_merges(survivor_id TEXT,duplicate_id TEXT);
    CREATE TABLE entity_links(from_entity_id TEXT,to_entity_id TEXT,relation_type TEXT);
    CREATE TABLE education_students(id TEXT PRIMARY KEY,child_entity_id TEXT,family_entity_id TEXT,group_id TEXT,status TEXT);
    CREATE TABLE education_groups(id TEXT PRIMARY KEY,unit_entity_id TEXT);
    CREATE TABLE audit_events(actor TEXT,action TEXT,entity_type TEXT,entity_id TEXT,payload TEXT);
    CREATE TABLE alfacrm_raw_observations(id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE alfacrm_current_records(remote_branch_id TEXT,module TEXT,record_id TEXT,observation_id TEXT,active INTEGER);
    CREATE TABLE alfacrm_customer_balances(customer_id TEXT,remote_branch_id TEXT,balance_minor INTEGER);
    CREATE TABLE financial_operations(id TEXT PRIMARY KEY,amount_minor INTEGER);
  `);
  db.prepare('INSERT INTO system_runtime_state VALUES(?,?,?)').run('alfacrm_connector:v1',JSON.stringify({endpoint:'https://arthellonew.s20.online',branchMappings:{'6':'BR-KINDERGARTEN','10':'BR-ATLAS-SCHOOL'}}),'');
  db.exec("INSERT INTO education_groups VALUES('garden','BR-KINDERGARTEN'),('school','BR-ATLAS-SCHOOL'); INSERT INTO financial_operations VALUES('old',12345);");
  for(let n=1;n<=count;n++) add(db,n);
  return db;
}
function add(db,n) {
  for(const branch of ['6','10']) {
    const scope=branch==='6'?'Атлас — садик':'Атлас — школа', id=String(n), source=branch+':'+id;
    db.prepare('INSERT INTO alfacrm_raw_observations VALUES(?,?)').run(source,JSON.stringify({id,branch_ids:[6,10]}));
    db.prepare('INSERT INTO alfacrm_current_records VALUES(?,?,?,?,1)').run(branch,'families',id,source);
    db.prepare('INSERT INTO alfacrm_customer_balances VALUES(?,?,?)').run(id,branch,n*100);
    for(const kind of ['Семья','Ребёнок','Клиент']) {
      const card=kind+':'+source, root=kind+':6:'+id;
      db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(card,kind,'name'+id,branch==='6'?'Активна':'Объединена','ALFACRM',source,'Проверено',scope,JSON.stringify({remoteBranchId:branch,localBranchId:branch==='6'?'BR-KINDERGARTEN':'BR-ATLAS-SCHOOL',alfaCustomerId:id,identitySourceStatus:'Активна',alfaStatusName:'Активен'}),'owner','','');
      if(branch==='10') db.prepare('INSERT INTO entity_merges VALUES(?,?)').run(root,card);
    }
  }
  for(const group of ['garden','school']) db.prepare('INSERT INTO education_students VALUES(?,?,?,?,?)').run(group+n,'Ребёнок:6:'+n,'Семья:6:'+n,group,'Активен');
}
test('fixed 32, school-only, historical data unchanged and repeat cannot include a new overlap',async()=>{
  const db=fixture(), result=await applyAtlasSchoolOnly(db);
  assert.equal(result.schoolOnly,32); assert.equal(result.historyUnchanged,true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM education_students WHERE group_id='garden' AND status='Активен'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM education_students WHERE group_id='school' AND status='Активен'").get().n,32);
  assert.equal(db.prepare('SELECT amount_minor FROM financial_operations').get().amount_minor,12345);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entities').get().n,192);
  const rule=parseAtlasSchoolOnly(db.prepare("SELECT state_value FROM system_runtime_state WHERE state_key='alfacrm_atlas_school_only:v1'").get().state_value);
  assert.equal(sourceCustomerAllowed(rule,'6','1'),false); assert.equal(sourceCustomerAllowed(rule,'10','1'),true);
  assert.equal(sourceCustomerAllowed(rule,'8','1'),false);
  add(db,33); assert.equal(sourceCustomerAllowed(rule,'6','33'),true);
  await applyAtlasSchoolOnly(db);
  assert.equal(db.prepare("SELECT active FROM alfacrm_current_records WHERE remote_branch_id='6' AND record_id='33'").get().active,1);
  assert.equal((await applyAtlasSchoolOnly(db,{readOnly:true})).schoolOnly,32);
});
test('wrong roster size and missing identity refuse without partial mutations',async()=>{
  for(const count of [31,33]) {
    const db=fixture(count); await assert.rejects(applyAtlasSchoolOnly(db),/EXACT_32/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM system_runtime_state WHERE state_key='alfacrm_atlas_school_only:v1'").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM education_students WHERE group_id='garden' AND status='Активен'").get().n,count);
  }
  const db=fixture(); db.exec("DELETE FROM entity_merges WHERE duplicate_id='Семья:10:3'");
  await assert.rejects(applyAtlasSchoolOnly(db),/CONFIRMED_ALIAS/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM alfacrm_current_records WHERE remote_branch_id='6' AND active=1").get().n,32);
});
test('audit-write refusal rolls back roster and rule',async()=>{
  const db=fixture(); db.exec("CREATE TRIGGER deny_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'audit failure'); END;");
  await assert.rejects(applyAtlasSchoolOnly(db),/audit failure/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM alfacrm_current_records WHERE remote_branch_id='6' AND active=1").get().n,32);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM system_runtime_state WHERE state_key='alfacrm_atlas_school_only:v1'").get().n,0);
});
test('malformed persisted rule fails closed',()=>{
  assert.throws(()=>parseAtlasSchoolOnly(JSON.stringify({version:1,endpoint:'https://arthellonew.s20.online',customerIds:['1']})),/RULE_INVALID/);
});
