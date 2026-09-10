import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {validateAcademicYear, assertLessonDate} from '../lib/academic-config.mjs';
import {institution,assertInstitution,claimAtlasDatabase} from '../lib/institution.mjs';
import {buildScheduleSlots,allocateCurriculumRows} from '../lib/curriculum-import.mjs';
const year={id:'2026/27',startsOn:'2026-09-01',endsOn:'2027-05-31',periods:[]};
test('Atlas accepts only its own institution and school branch',()=>{
 assert.doesNotThrow(()=>assertInstitution(institution));
 for(const p of [{},{systemId:'SYS-SCHOOL-1-11',branchId:institution.branchId},{systemId:institution.systemId,branchId:'BR-KINDERGARTEN'}])assert.throws(()=>assertInstitution(p));
});
test('academic calendar rejects invalid dates, year mismatch and overlapping vacations',()=>{
 assert.deepEqual(validateAcademicYear(year),year);
 for(const p of [{...year,startsOn:'2026-02-30'},{...year,id:'2026/28'},{...year,endsOn:'2028-01-01'},{...year,periods:[{title:'a',startsOn:'2026-10-01',endsOn:'2026-10-10'},{title:'b',startsOn:'2026-10-10',endsOn:'2026-10-12'}]}])assert.throws(()=>validateAcademicYear(p));
});
test('date attendance validates actual weekday, student class and vacation',()=>{
 const l={className:'3А',weekday:1},s={className:'3А'};
 assert.doesNotThrow(()=>assertLessonDate(l,s,'2026-09-07',year,[]));
 for(const args of [[l,s,'2026-09-08',year,[]],[l,{className:'3Б'},'2026-09-07',year,[]],[l,s,'2025-09-01',year,[]],[l,s,'2026-09-07',year,[{startsOn:'2026-09-07',endsOn:'2026-09-07'}]]])assert.throws(()=>assertLessonDate(...args));
});
test('allocation follows Atlas calendar and reports deficit instead of dropping topics',()=>{
 const slots=buildScheduleSlots({startDate:'2026-09-01',endDate:'2026-09-30',lessons:[{id:'monday',weekday:1,startsAt:'09:00'}],periods:[{startsOn:'2026-09-14',endsOn:'2026-09-14'}]});
 assert.equal(slots.length,3);
 const allocated=allocateCurriculumRows([{sequence:1,topic:'Тема',hours:4,homework:''}],slots);
 assert.equal(allocated.unscheduledHours,1);assert.equal(allocated.scheduledHours,3);
});
test('dated attendance schema preserves consecutive weeks and enforces FK / unique dates',()=>{
 const db=new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON;CREATE TABLE lessons(id text primary key);CREATE TABLE students(id text primary key);CREATE TABLE users(id text primary key);');
 db.exec(readFileSync(new URL('../drizzle/0009_atlas_school.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO lessons VALUES('l');INSERT INTO students VALUES('s');INSERT INTO users VALUES('t');");
 const q=db.prepare('INSERT INTO attendance_by_date(id,lesson_id,student_id,lesson_date,status,marked_by_user_id) VALUES(?,?,?,?,?,?)');
 q.run('a','l','s','2026-09-07','present','t');q.run('b','l','s','2026-09-14','absent','t');
 assert.equal(db.prepare('SELECT count(*) n FROM attendance_by_date').get().n,2);
 assert.throws(()=>q.run('c','l','s','2026-09-07','present','t'));
 assert.throws(()=>q.run('d','l','foreign-child','2026-09-21','present','t'));
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);db.close();
});

test('database ownership guard refuses another school and unmarked existing data',()=>{
 for(const setup of ["CREATE TABLE students(id text)","CREATE TABLE diary_identity(id text,institution_id text);INSERT INTO diary_identity VALUES('primary','school-1-11')"]){const db=new DatabaseSync(':memory:');db.exec(setup);assert.throws(()=>claimAtlasDatabase(db));db.close();}
 const db=new DatabaseSync(':memory:');claimAtlasDatabase(db);claimAtlasDatabase(db);assert.equal(db.prepare('SELECT institution_id FROM diary_identity').get().institution_id,'atlas-school');db.close();
});
