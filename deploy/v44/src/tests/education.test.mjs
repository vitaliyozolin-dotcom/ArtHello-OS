import assert from "node:assert/strict"; import test from "node:test";
import { attendanceSummary, educationScope, nextProgramVersion, progressBand } from "../lib/education.ts";
test("attendance is calculated from recorded students",()=>assert.deepEqual(attendanceSummary([{attendanceStatus:"Присутствовал"},{attendanceStatus:"Отсутствовал"},{attendanceStatus:"Присутствовал"}]),{total:3,present:2,percent:67}));
test("education roles receive bounded scopes",()=>{assert.deepEqual(educationScope("TEACHER","EMP-T-032"),{kind:"teacher",id:"EMP-T-032"});assert.deepEqual(educationScope("PARENT","FAM-T-014"),{kind:"family",id:"FAM-T-014"});assert.deepEqual(educationScope("METHODIST",""),{kind:"all",id:""});assert.equal(educationScope("FINANCE","").kind,"none")});
test("progress remains a signal",()=>{assert.equal(progressBand(86),"Уверенно");assert.equal(progressBand(52),"Нужно наблюдение")});
test("program versions only increase",()=>assert.equal(nextProgramVersion(4),5));
