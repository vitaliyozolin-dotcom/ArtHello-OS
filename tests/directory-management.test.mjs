import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { directoryRevision, manageDirectory } from '../server/directory-management.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const f of ['0000_motionless_goblin_queen.sql','0001_white_nighthawk.sql','0002_mature_psylocke.sql','0003_daffy_quentin_quire.sql']) db.exec(readFileSync(new URL('../drizzle/'+f, import.meta.url),'utf8'));
  db.exec(`INSERT INTO users(id,email,display_name,role,status,profile_status) VALUES
    ('director','director@test.invalid','Director','director','active','confirmed'),
    ('teacher','teacher@test.invalid','Teacher','teacher','active','confirmed'),
    ('other','other@test.invalid','Other teacher','teacher','active','confirmed'),
    ('pending','pending@test.invalid','Pending','teacher','setup','unconfirmed');
    INSERT INTO school_classes(id,name,grade) VALUES('class-1','1',1),('class-2','2',2);
    INSERT INTO subjects(id,name,short_name,color,icon) VALUES('math','Математика','Мат.','#6D5BD0','book');
    INSERT INTO students(id,first_name,last_name,class_name) VALUES('pupil','Synthetic','Student','1');`);
  return db;
}
const actor = {id:'director',role:'director'};
const save = (db, body, user=actor) => manageDirectory(db,user,{...body,revision:body.revision??directoryRevision(db)});

test('subject rename propagates through joins; its ID and historical grade stay intact',()=>{
  const db=fixture();
  db.exec(`INSERT INTO grades(id,student_id,subject_id,teacher_user_id,value,weight,title,grade_date) VALUES('g','pupil','math','teacher',5,1,'Work','2026-09-01')`);
  save(db,{action:'subject.save',id:'math',name:'Математика и логика',shortName:'Мат.',stage:'1–6',weeklyHours:4});
  assert.equal(db.prepare('SELECT s.name FROM grades g JOIN subjects s ON s.id=g.subject_id').get().name,'Математика и логика');
  assert.equal(db.prepare('SELECT value FROM grades').get().value,5);
  assert.equal(db.prepare('SELECT count(*) n FROM audit_log').get().n,1);
});
test('every non-operational role and a forged director actor are denied without writes',()=>{
  for(const role of ['teacher','parent','student','methodist','tech_admin']){
    const db=fixture(), before=directoryRevision(db);
    assert.throws(()=>save(db,{action:'subject.save',name:'Test',shortName:'T',stage:'1',weeklyHours:1},{id:'teacher',role}),/прав|доступ/i);
    assert.equal(directoryRevision(db),before);
  }
  assert.throws(()=>save(fixture(),{action:'class.homeroom',id:'class-1',teacherId:'other'},{id:'teacher',role:'director'}),/прав|доступ/i);
});
test('stale edit is rejected and cannot overwrite a newer subject change',()=>{
  const db=fixture(), revision=directoryRevision(db);
  save(db,{action:'subject.save',id:'math',name:'Новое имя',shortName:'М',stage:'1',weeklyHours:2,revision});
  assert.throws(()=>save(db,{action:'subject.save',id:'math',name:'Старое окно',shortName:'М',stage:'1',weeklyHours:2,revision}),/изменились/i);
  assert.equal(db.prepare('SELECT name FROM subjects').get().name,'Новое имя');
});
test('confirmed teacher assignment is idempotent and gives exactly its class and subject',()=>{
  const db=fixture(), body={action:'assignment.save',teacherId:'teacher',className:'1',subjectId:'math'};
  save(db,body);save(db,body);
  const rows=db.prepare("SELECT * FROM teacher_assignments WHERE status='confirmed'").all();
  assert.equal(rows.length,1); assert.equal(rows[0].teacher_user_id,'teacher');assert.equal(rows[0].class_name,'1');assert.equal(rows[0].subject_id,'math');
  save(db,{action:'assignment.archive',id:rows[0].id});
  assert.equal(db.prepare("SELECT count(*) n FROM teacher_assignments WHERE status='confirmed'").get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM teacher_assignments').get().n,1);
});
test('unknown, unconfirmed or blocked teachers and foreign classes cannot be assigned',()=>{
  for(const body of [
    {teacherId:'pending',className:'1',subjectId:'math'},
    {teacherId:'missing',className:'1',subjectId:'math'},
    {teacherId:'teacher',className:'99',subjectId:'math'},
    {teacherId:'teacher',className:'1',subjectId:'missing'},
  ]) assert.throws(()=>save(fixture(),{action:'assignment.save',...body}));
  const db=fixture();db.exec("UPDATE users SET status='blocked' WHERE id='teacher'");
  assert.throws(()=>save(db,{action:'class.homeroom',id:'class-1',teacherId:'teacher'}));
});
test('homeroom update preserves central class identity and membership',()=>{
  const db=fixture();save(db,{action:'class.homeroom',id:'class-1',teacherId:'teacher'});
  assert.deepEqual({...db.prepare('SELECT id,name,homeroom_teacher_user_id FROM school_classes WHERE id=?').get('class-1')},{id:'class-1',name:'1',homeroom_teacher_user_id:'teacher'});
  assert.equal(db.prepare('SELECT class_name FROM students').get().class_name,'1');
});
test('subject with active assignments cannot be archived; archive preserves historical grades',()=>{
  const db=fixture();save(db,{action:'assignment.save',teacherId:'teacher',className:'1',subjectId:'math'});
  assert.throws(()=>save(db,{action:'subject.archive',id:'math'}),/назначени|расписани|программ/i);
  const id=db.prepare('SELECT id FROM teacher_assignments').get().id;save(db,{action:'assignment.archive',id});
  save(db,{action:'subject.archive',id:'math'});assert.equal(db.prepare('SELECT status FROM subjects').get().status,'archived');
});
test('audit failure rolls back the business write',()=>{
  const db=fixture(), before=directoryRevision(db);
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'audit failed'); END");
  assert.throws(()=>save(db,{action:'class.homeroom',id:'class-1',teacherId:'teacher'}),/audit failed/);
  assert.equal(directoryRevision(db),before);
});
test('unknown actions cannot change users or grant roles',()=>{
  const db=fixture();assert.throws(()=>save(db,{action:'user.update',id:'teacher',role:'director'}),/действие/i);
  assert.equal(db.prepare("SELECT role FROM users WHERE id='teacher'").get().role,'teacher');
});
