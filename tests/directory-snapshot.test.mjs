import { schoolSchedule } from '../server/school-schedule-data.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { applyDirectorySnapshot, directoryStudentIsManaged } from '../server/directory-snapshot.mjs';
import { directoryRequest } from '../server/directory-transport.mjs';
import { createHmac } from 'node:crypto';

function fixture(t) {
  const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON'); t.after(() => sql.close());
  sql.exec(`CREATE TABLE students(id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, class_name TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE school_classes(id TEXT PRIMARY KEY, name TEXT UNIQUE, grade INTEGER, status TEXT, updated_at TEXT);
    CREATE TABLE users(id TEXT PRIMARY KEY, status TEXT, role TEXT, password_hash TEXT,
      email TEXT UNIQUE,display_name TEXT,profile_status TEXT DEFAULT 'confirmed',notes TEXT DEFAULT '',
      password_state TEXT DEFAULT 'pending',central_user_id TEXT,identity_source TEXT DEFAULT 'school_diary',central_access_version INTEGER DEFAULT 0,updated_at TEXT);
    INSERT INTO users(id,status,role,password_hash,display_name) VALUES('manual-teacher','active','teacher','keep','Тест Педагог');`);
  const migration = readFileSync(new URL('../drizzle/0010_central_directory.sql', import.meta.url), 'utf8').replaceAll('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ');
  sql.exec(migration); sql.exec(migration);
  const stmt = (query, values=[]) => ({bind(...v){return stmt(query,v)}, async first(){return sql.prepare(query).get(...values)??null}, async all(){return {results:sql.prepare(query).all(...values)}}, async run(){return sql.prepare(query).run(...values)}});
  const db={prepare:stmt,async batch(items){sql.exec('BEGIN IMMEDIATE');try{for(const item of items)await item.run();sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');throw e}}};
  return {sql,db};
}
const snapshot = () => ({version:1,sequence:1,complete:true,classes:[{id:'group-1',name:'1А',grade:1}],families:[{id:'family-1'}],students:[{id:'child-1',firstName:'Тест',lastName:'Ученик',classId:'group-1',familyId:'family-1'}],teachers:[{id:'teacher-1',displayName:'Тест Педагог'}]});

test('preview is read-only; repeated application preserves IDs and never grants access',async t=>{
  const {sql,db}=fixture(t), s=snapshot();
  const before=sql.prepare('SELECT * FROM users').all();
  await applyDirectorySnapshot(db,s,false);
  assert.equal(sql.prepare('SELECT count(*) n FROM students').get().n,0);
  for(let i=0;i<2;i++)await applyDirectorySnapshot(db,s,true);
  assert.equal(sql.prepare('SELECT count(*) n FROM students').get().n,1);
  assert.equal(sql.prepare('SELECT class_name FROM students').get().class_name,'1А');
  assert.deepEqual(sql.prepare("SELECT * FROM users WHERE id='manual-teacher'").all(),before);
  const profile=sql.prepare("SELECT * FROM users WHERE identity_source='central_directory'").get();
  assert.ok(profile, 'Imported teacher must be visible as a pending profile');
  assert.equal(profile.status,'setup'); assert.equal(profile.password_hash,null);
  assert.equal(profile.password_state,'pending'); assert.equal(profile.central_user_id,null);
  assert.equal(profile.central_access_version,0); assert.equal(profile.profile_status,'unconfirmed');
  assert.match(profile.notes,/сопостав/);
  assert.equal(sql.prepare("SELECT count(*) n FROM users WHERE identity_source='central_directory'").get().n,1);
  assert.equal(sql.prepare("SELECT local_id FROM central_directory_links WHERE kind='teacher'").get().local_id,profile.id);
  assert.equal(sql.prepare("SELECT count(*) n FROM central_directory_links WHERE kind='teacher'").get().n,1);
  assert.equal(await directoryStudentIsManaged(db,'child-1','family-1'),true);
  await assert.rejects(()=>directoryStudentIsManaged(db,'child-1','foreign-family'));
  assert.equal(await directoryStudentIsManaged(db,'legacy-child','family-1'),false);
});
test('reject incomplete snapshots, duplicate identities, missing family/class and stale or changed replay',async t=>{
  const {sql,db}=fixture(t);
  for(const edit of [s=>s.complete=false,s=>s.students.push({...s.students[0]}),s=>s.families=[],s=>s.classes=[]]){const s=snapshot();edit(s);await assert.rejects(()=>applyDirectorySnapshot(db,s,true));}
  assert.equal(sql.prepare('SELECT count(*) n FROM students').get().n,0);
  await applyDirectorySnapshot(db,snapshot(),true);
  const changed=snapshot();changed.students[0].firstName='Другой';
  await assert.rejects(()=>applyDirectorySnapshot(db,changed,true));
  await assert.rejects(()=>applyDirectorySnapshot(db,{...snapshot(),sequence:0},true));
});
test('archive only owned pupils and protect manual records and class bindings',async t=>{
  const {sql,db}=fixture(t);
  sql.exec("INSERT INTO students VALUES('manual','Имя','Фамилия','2А','active','before'); INSERT INTO school_classes VALUES('manual-class','1А',1,'active','before')");
  await assert.rejects(()=>applyDirectorySnapshot(db,snapshot(),true));
  const s=snapshot();s.classes[0].localId='manual-class';
  await applyDirectorySnapshot(db,s,true);
  await applyDirectorySnapshot(db,{...s,sequence:2,students:[]},true);
  assert.equal(sql.prepare("SELECT status FROM students WHERE id='child-1'").get().status,'archived');
  assert.equal(sql.prepare("SELECT status FROM students WHERE id='manual'").get().status,'active');
  assert.equal(sql.prepare("SELECT count(*) n FROM school_classes").get().n,1);
  await assert.rejects(()=>directoryStudentIsManaged(db,'child-1','family-1'));
});

test('signed transport rejects foreign schools and invalid signatures before opening database',async t=>{
  const {db}=fixture(t);let opened=0;
  const config={systemId:'school',branchId:'branch',secret:'test-only-secret-12345678901234567890',openDatabase:async()=>{opened++;return db}};
  const request=(body,valid=true)=>{
    const text=JSON.stringify(body),timestamp=String(Math.floor(Date.now()/1000));
    const signature=valid?createHmac('sha256',config.secret).update(`${timestamp}.${text}`).digest('hex'):'0'.repeat(64);
    return new Request('https://diary.test/api/internal/directory-sync',{method:'POST',body:text,headers:{'x-arthello-timestamp':timestamp,'x-arthello-signature':signature}});
  };
  const body={systemId:'school',branchId:'branch',action:'apply',snapshot:snapshot()};
  assert.equal((await directoryRequest(request(body,false),config)).status,401);
  assert.equal((await directoryRequest(request({...body,branchId:'foreign'}),config)).status,400);
  assert.equal(opened,0);
  assert.equal((await directoryRequest(request(body),config)).status,200);
});

test('database failure rolls back pupils, classes and links together',async t=>{
  const {sql,db}=fixture(t);
  sql.exec("CREATE TRIGGER reject_directory_teacher BEFORE INSERT ON central_directory_links WHEN NEW.kind='teacher' BEGIN SELECT RAISE(ABORT,'simulated write failure'); END");
  await assert.rejects(()=>applyDirectorySnapshot(db,snapshot(),true));
  for(const table of ['students','school_classes','central_directory_links','central_directory_state']) assert.equal(sql.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
});

test('a concurrent newer snapshot prevents application of a stale plan',async t=>{
  const {sql,db}=fixture(t), batch=db.batch;
  db.batch=async rows=>{
    sql.prepare("INSERT INTO central_directory_state VALUES('primary',2,'concurrent')").run();
    return batch(rows);
  };
  await assert.rejects(()=>applyDirectorySnapshot(db,snapshot(),true));
  assert.equal(sql.prepare("SELECT sequence FROM central_directory_state").get().sequence,2);
  assert.equal(sql.prepare('SELECT count(*) n FROM students').get().n,0);
});

test('source-owned setup profiles archive on departure and return without altering manual accounts',async t=>{
  const {sql,db}=fixture(t);await applyDirectorySnapshot(db,snapshot(),true);
  await applyDirectorySnapshot(db,{...snapshot(),sequence:2,teachers:[]},true);
  assert.equal(sql.prepare("SELECT status FROM users WHERE identity_source='central_directory'").get().status,'archived');
  assert.equal(sql.prepare("SELECT status FROM users WHERE id='manual-teacher'").get().status,'active');
  await applyDirectorySnapshot(db,{...snapshot(),sequence:3},true);
  assert.equal(sql.prepare("SELECT status FROM users WHERE identity_source='central_directory'").get().status,'setup');
});

function timetableFixture(t) {
  const f=fixture(t);f.sql.exec(`
    CREATE TABLE subjects(id TEXT PRIMARY KEY,status TEXT,name TEXT,short_name TEXT,color TEXT,icon TEXT,stage TEXT,weekly_hours INTEGER);
    CREATE TABLE teacher_assignments(id TEXT PRIMARY KEY,teacher_user_id TEXT,class_name TEXT,subject_id TEXT,status TEXT);
    CREATE TABLE lessons(id TEXT PRIMARY KEY,class_name TEXT,weekday INTEGER,starts_at TEXT,ends_at TEXT,subject_id TEXT REFERENCES subjects(id),teacher_user_id TEXT REFERENCES users(id),display_label TEXT,group_name TEXT,room TEXT NOT NULL,status TEXT,note TEXT);
    CREATE TABLE schedule_imports(id TEXT PRIMARY KEY,academic_year TEXT NOT NULL,source_file_name TEXT NOT NULL,source_sha256 TEXT UNIQUE NOT NULL,lesson_count INTEGER NOT NULL);
    CREATE TABLE grades(id TEXT); CREATE TABLE attendance(id TEXT); CREATE TABLE homework(id TEXT); CREATE TABLE teacher_comments(id TEXT); CREATE TABLE program_topic_sessions(id TEXT);
    INSERT INTO users(id,display_name,role,status,profile_status) VALUES('confirmed-setup','Тест Подтверждённый','teacher','setup','confirmed');
    INSERT INTO teacher_assignments VALUES('math-2','confirmed-setup','2А','math','confirmed');
  `);
  for(const id of new Set(schoolSchedule.lessons.map(l=>l.subjectId))) f.sql.prepare("INSERT INTO subjects(id,status) VALUES(?,'active')").run(id);
  const s=snapshot();s.classes=Array.from({length:6},(_,i)=>({id:'group-'+(i+1),name:(i+1)+'А',grade:i+1}));s.schedule=schoolSchedule;
  return {...f,s};
}
test('approved school timetable imports 184 slots atomically, uses confirmed setup teachers and preserves later manual edits',async t=>{
  const {sql,db,s}=timetableFixture(t),context={systemId:'SYS-SCHOOL-1-11',branchId:'BR-SCHOOL'};
  const preview=await applyDirectorySnapshot(db,s,false,context);
  assert.equal(preview.scheduleLessons,184);assert.ok(preview.unassignedLessons>0);
  assert.equal(sql.prepare('SELECT count(*) n FROM lessons').get().n,0);
  const receipt=await applyDirectorySnapshot(db,s,true,context);assert.equal(receipt.scheduleLessons,184);
  assert.equal(sql.prepare('SELECT count(*) n FROM lessons').get().n,184);
  assert.ok(sql.prepare("SELECT count(*) n FROM lessons WHERE teacher_user_id='confirmed-setup'").get().n>0);
  assert.equal(sql.prepare('SELECT count(*) n FROM attendance').get().n,0);
  sql.prepare("UPDATE lessons SET note='manual correction' WHERE id=?").run(schoolSchedule.lessons[0].id);
  await applyDirectorySnapshot(db,{...s,sequence:2},true,context);
  assert.equal(sql.prepare('SELECT count(*) n FROM lessons').get().n,184);
  assert.equal(sql.prepare('SELECT note FROM lessons WHERE id=?').get(schoolSchedule.lessons[0].id).note,'manual correction');
});
test('foreign school, changed source, missing subjects and an existing journal block the whole import',async t=>{
  const {sql,db,s}=timetableFixture(t),context={systemId:'SYS-SCHOOL-1-11',branchId:'BR-SCHOOL'};
  await assert.rejects(()=>applyDirectorySnapshot(db,s,true,{systemId:'SYS-SCHOOL-ATLAS',branchId:'BR-ATLAS-SCHOOL'}));
  const changed=structuredClone(s);changed.schedule.lessons[0].startsAt='00:00';
  await assert.rejects(()=>applyDirectorySnapshot(db,changed,true,context));
  sql.exec("UPDATE subjects SET status='archived' WHERE id='math'");
  await assert.rejects(()=>applyDirectorySnapshot(db,s,true,context));
  sql.exec("UPDATE subjects SET status='active'; INSERT INTO grades VALUES('existing-grade')");
  await assert.rejects(()=>applyDirectorySnapshot(db,s,true,context));
  for(const table of ['lessons','schedule_imports','students','central_directory_state']) assert.equal(sql.prepare('SELECT count(*) n FROM '+table).get().n,0);
});
test('a late timetable write failure rolls back teacher profiles and the full directory',async t=>{
  const {sql,db,s}=timetableFixture(t);
  sql.exec("CREATE TRIGGER fail_schedule BEFORE INSERT ON lessons BEGIN SELECT RAISE(ABORT,'fixture'); END");
  await assert.rejects(()=>applyDirectorySnapshot(db,s,true,{systemId:'SYS-SCHOOL-1-11',branchId:'BR-SCHOOL'}));
  for(const table of ['lessons','schedule_imports','students','central_directory_links','central_directory_state']) assert.equal(sql.prepare('SELECT count(*) n FROM '+table).get().n,0);
  assert.equal(sql.prepare("SELECT count(*) n FROM users WHERE identity_source='central_directory'").get().n,0);
});

test('biology is introduced with the approved timetable even before the first dashboard visit',async t=>{
 const {sql,db,s}=timetableFixture(t);sql.exec("DELETE FROM subjects WHERE id='biology'");
 await applyDirectorySnapshot(db,s,false,{systemId:'SYS-SCHOOL-1-11',branchId:'BR-SCHOOL'});
 assert.equal(sql.prepare("SELECT id FROM subjects WHERE id='biology'").get(),undefined);
 await applyDirectorySnapshot(db,s,true,{systemId:'SYS-SCHOOL-1-11',branchId:'BR-SCHOOL'});
 assert.equal(sql.prepare("SELECT status FROM subjects WHERE id='biology'").get().status,'active');
});

test('a teacher cannot be silently double-booked across simultaneous classes',async t=>{
 const {sql,db,s}=timetableFixture(t);
 sql.exec("INSERT INTO teacher_assignments VALUES('math-3','confirmed-setup','3А','math','confirmed')");
 const result=await applyDirectorySnapshot(db,s,true,{systemId:'SYS-SCHOOL-1-11',branchId:'BR-SCHOOL'});
 assert.equal(result.scheduleLessons,184);
 const rows=sql.prepare("SELECT * FROM lessons WHERE teacher_user_id='confirmed-setup'").all();
 for(const a of rows)for(const b of rows)if(a.id!==b.id&&a.weekday===b.weekday)assert.ok(a.ends_at<=b.starts_at||b.ends_at<=a.starts_at);
 assert.ok(sql.prepare("SELECT count(*) n FROM lessons WHERE note LIKE '%Пересечение уроков%' AND teacher_user_id IS NULL").get().n>0);
});
test('a concurrent journal write blocks first import inside the transaction',async t=>{
 const {sql,db,s}=timetableFixture(t),batch=db.batch;
 db.batch=async items=>{sql.exec("INSERT INTO attendance VALUES('concurrent')");return batch(items)};
 await assert.rejects(()=>applyDirectorySnapshot(db,s,true,{systemId:'SYS-SCHOOL-1-11',branchId:'BR-SCHOOL'}));
 assert.equal(sql.prepare('SELECT count(*) n FROM lessons').get().n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM central_directory_links').get().n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM attendance').get().n,1);
});
