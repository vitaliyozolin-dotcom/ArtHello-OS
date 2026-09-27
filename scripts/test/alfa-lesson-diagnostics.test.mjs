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


test('time diagnostics identify clocks, dated values and invalid ranges without printing values',()=>{
 const r=audit.summarizeLessonFields([{time_from:'09:30:00',time_to:'24:00:00'}, {time_from:'2026-09-27 09:00:00'}, {start_time:'09:30:00.000'}, {time_from:'PRIVATE_TIME'}]);
 assert.equal(r.times.time_from.clock,1);assert.equal(r.times.time_from.dateTime,1);
 assert.equal(r.times.time_from.fractionalClock,1);assert.equal(r.times.time_from.other,1);
 assert.equal(r.times.time_to.clockOutOfRange,1);assert.ok(!JSON.stringify(r).includes('PRIVATE_TIME'));
});

test('effective links follow singular and nested importer fallbacks',()=>{
 const r=audit.summarizeLessonFields([{group_id:0,teacher:{id:7},customer_id:'PRIVATE_ID'},
  {group:{id:3},teacher_id:0,customer_ids:[]}, {group_ids:null,group_id:4}]);
 assert.equal(r.effective.group_ids.invalidRows,2);
 assert.equal(r.effective.group_ids.singularRows,2);
 assert.equal(r.effective.teacher_ids.invalidIds,1);
 assert.equal(r.effective.customer_ids.invalidIds,1);
 assert.ok(!JSON.stringify(r).includes('PRIVATE_ID'));
});
test('approved legacy databases produce unavailable evidence instead of audit failure or zero counts',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA query_only=ON');
 const r=audit.storedLessonDiagnostics(db,{});
 assert.equal(r.status,'unavailable');assert.equal(r.reason,'LESSON_DIAGNOSTIC_SCHEMA_UNAVAILABLE');
 assert.equal(r.facts,undefined);db.close();
});
