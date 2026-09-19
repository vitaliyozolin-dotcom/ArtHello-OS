import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { applyDirectorySnapshot, directoryStudentIsManaged } from '../server/directory-snapshot.mjs';
import { directoryRequest } from '../server/directory-transport.mjs';
import { createHmac } from 'node:crypto';

function fixture(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  sql.exec(`CREATE TABLE students(id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, class_name TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE school_classes(id TEXT PRIMARY KEY, name TEXT UNIQUE, grade INTEGER, status TEXT, updated_at TEXT);
    CREATE TABLE users(id TEXT PRIMARY KEY, status TEXT, role TEXT, password_hash TEXT);
    INSERT INTO users VALUES('manual-teacher','active','teacher','keep');`);
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
  assert.deepEqual(sql.prepare('SELECT * FROM users').all(),before);
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
