import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { auditDiary } from '../../deploy/diary-data-audit.mjs';

test('diary audit distinguishes accepted directory from assignments and lessons without leaking content',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE school_classes(name TEXT,status TEXT);
    CREATE TABLE students(status TEXT);
    CREATE TABLE users(id TEXT,role TEXT,status TEXT,display_name TEXT);
    CREATE TABLE teacher_assignments(status TEXT);
    CREATE TABLE lessons(class_name TEXT,status TEXT,teacher_user_id TEXT);
    CREATE TABLE central_directory_links(kind TEXT,active INTEGER);
    INSERT INTO school_classes VALUES('1','active');
    INSERT INTO users VALUES('T1','teacher','active','PRIVATE NAME'),('T2','teacher','inactive','PRIVATE NAME');
    INSERT INTO lessons VALUES('1','scheduled',NULL),('1','scheduled','T1'),('missing','scheduled','T2'),('1','archived',NULL);
    INSERT INTO central_directory_links VALUES('teacher',1),('teacher',1),('teacher',0);
    INSERT INTO teacher_assignments VALUES('confirmed'),('needs_confirmation');`);
  const before=db.prepare('SELECT total_changes() n').get().n;
  const result=auditDiary(db);
  assert.equal(result.teachers,1);assert.equal(result.directory.teacher,2);
  assert.equal(result.lessons,3);assert.equal(result.lessonsWithoutTeacher,1);
  assert.equal(result.lessonsWithInactiveTeacher,1);assert.equal(result.lessonsWithoutClass,1);
  assert.equal(result.confirmedAssignments,1);assert.equal(result.teacherAssignments,2);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
});
