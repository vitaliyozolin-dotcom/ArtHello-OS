import assert from "node:assert/strict"; import test from "node:test";
import { EDUCATION_BRANCHES, attendanceSummary, educationBranchId, educationScope, nextProgramVersion, parseEducationCsv, progressBand } from "../lib/education.ts";
test("attendance is calculated from recorded students",()=>assert.deepEqual(attendanceSummary([{attendanceStatus:"Присутствовал"},{attendanceStatus:"Отсутствовал"},{attendanceStatus:"Присутствовал"}]),{total:3,present:2,percent:67}));
test("education roles receive bounded scopes",()=>{assert.deepEqual(educationScope("TEACHER","EMP-T-032"),{kind:"teacher",id:"EMP-T-032"});assert.deepEqual(educationScope("PARENT","FAM-T-014"),{kind:"family",id:"FAM-T-014"});assert.deepEqual(educationScope("METHODIST",""),{kind:"all",id:""});assert.equal(educationScope("FINANCE","").kind,"none")});
test("progress remains a signal",()=>{assert.equal(progressBand(86),"Уверенно");assert.equal(progressBand(52),"Нужно наблюдение")});
test("program versions only increase",()=>assert.equal(nextProgramVersion(4),5));
test("legacy groups are assigned to a visible branch",()=>{assert.equal(educationBranchId("UNT-T-001"),"BR-SCHOOL");assert.equal(EDUCATION_BRANCHES.length,5)});
test("education CSV understands Russian headings and semicolon separators",()=>{const [row]=parseEducationCsv("тип;название;филиал;программа;педагог\nгруппа;3Б;BR-SCHOOL;PRG-1;EMP-1");assert.deepEqual(row,{type:"группа",name:"3Б",branchId:"BR-SCHOOL",programId:"PRG-1",teacherId:"EMP-1"})});
