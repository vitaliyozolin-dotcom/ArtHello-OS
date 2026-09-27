import test from 'node:test';
import assert from 'node:assert/strict';
import * as audit from '../../.github/scripts/alfa-source-audit.mjs';
test('lesson diagnostics distinguish missing, null, invalid and duplicate references without identifiers',()=>{
 const rows=[{}, {group_ids:null,customer_ids:[],teacher_ids:[2,'2'],name:'PRIVATE_NAME'},
  {group_ids:'PRIVATE_ID',customer_ids:[{id:4}],teacher_ids:[0,null,{},'secret']},
  {group_ids:[8],customer_id:9,teacher_id:null}];
 const result=audit.summarizeLessonFields(rows);
 assert.equal(result.rows,4);
 assert.deepEqual(result.fields.group_ids,{missing:1,null:1,nonArray:1,empty:0,present:1,invalidIds:0,duplicates:0});
 assert.equal(result.fields.teacher_ids.duplicates,1);
 assert.equal(result.fields.teacher_ids.invalidIds,4);
 assert.equal(result.fields.customer_ids.present,1);
 assert.ok(!/PRIVATE|secret/.test(JSON.stringify(result)));
 assert.deepEqual(rows[1].teacher_ids,[2,'2']);
});


test('stored diagnostics read failed batch evidence without writing or leaking payloads',async()=>{
 const {DatabaseSync}=await import('node:sqlite'); const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE alfacrm_current_records(remote_branch_id,module,record_id,observation_id,active); CREATE TABLE alfacrm_raw_observations(id,payload,observed_at,module,batch_id,remote_branch_id); CREATE TABLE alfacrm_import_batches(module,status,created_at,id); CREATE TABLE alfacrm_lesson_facts(remote_branch_id,observed_at,teacher_ids,customer_ids);");
 db.prepare("INSERT INTO alfacrm_raw_observations VALUES (?,?,?,'lessons','batch','8')").run('observation',JSON.stringify({teacher_ids:null,name:'PRIVATE_NAME'}),'2026-09-27T20:57:00.000Z');
 db.exec("INSERT INTO alfacrm_current_records VALUES ('8','lessons','source','observation',1); INSERT INTO alfacrm_import_batches VALUES ('lessons','projecting','2026-09-27T20:57:00.000Z','batch'); PRAGMA query_only=ON");
 const report=audit.storedLessonDiagnostics(db,{branchMappings:{8:'BR-SCHOOL'}});
 assert.equal(report.byBranch['8'].fields.teacher_ids.null,1);
 assert.equal(report.batches[0].status,'projecting');
 assert.deepEqual(report.facts,[]);
 assert.ok(!/PRIVATE|observation|source"/.test(JSON.stringify(report.byBranch)));
 db.close();
});
