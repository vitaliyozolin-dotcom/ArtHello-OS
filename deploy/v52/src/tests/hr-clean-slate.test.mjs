import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("HR overview derives its chain from stored rows and hides demo records in empty mode", () => {
  const route = read("../app/api/hr/route.ts");

  assert.match(route, /getSystemDataMode/);
  assert.match(route, /mode!=="empty"/);
  assert.match(route, /const chainEmployee=employees\.find/);
  assert.match(route, /chain:\{vacancyId:chainVacancy\?\.id/);
  assert.doesNotMatch(route, /SYNTHETIC_HR_TEST|EMP-T|FIN-TEST|VAC-T|CANDREC-T/);
});

test("HR high-impact actions require an explicit employee and written basis", () => {
  const workspace = read("../app/components/HrWorkspace.tsx");

  assert.match(workspace, /function PersonnelEventForm/);
  assert.match(workspace, /function TerminationForm/);
  assert.match(workspace, /minLength=\{8\}/);
  assert.match(workspace, /disabled=\{!employeeId\|\|busy==="personnel-event"\}/);
  assert.match(workspace, /disabled=\{!employeeId\|\|busy==="terminate-employee"\}/);
  assert.doesNotMatch(workspace, /amountMinor:300000|reason:"Соглашение сторон"/);
});
