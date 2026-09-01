import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [types, schema, api, app, broker, sso, staffSync, legacyLogin] =
  await Promise.all([
    read("../app/level-zero-types.ts"),
    read("../db/schema.ts"),
    read("../app/api/school/route.ts"),
    read("../app/school-app.tsx"),
    read("../server/identity-broker.ts"),
    read("../server/central-sso.ts"),
    read("../app/api/internal/staff-sync/route.ts"),
    read("../app/api/auth/login/route.ts"),
  ]);

test("methodist is a centrally managed staff role at every auth boundary", () => {
  for (const source of [types, schema, api, broker, sso, staffSync, legacyLogin]) {
    assert.match(source, /"methodist"/);
  }
  assert.match(types, /methodist: "Методист"/);
});

test("methodist has a separate curriculum scope, not leadership or operations", () => {
  assert.match(
    api,
    /const curriculumRoles = new Set<Role>\(\["director", "deputy", "methodist"\]\)/,
  );
  assert.match(
    api,
    /const leadershipRoles = new Set<Role>\(\["director", "deputy"\]\)/,
  );
  assert.match(
    api,
    /const operationalRoles = new Set<Role>\(\["director", "deputy", "admin"\]\)/,
  );
  assert.doesNotMatch(
    api,
    /const (?:leadershipRoles|operationalRoles)[^\n]*methodist/,
  );
});

test("methodist snapshot is limited to curriculum data and a contact-free teacher directory", () => {
  assert.match(api, /if \(viewer\.role === "methodist"\) return \[\];/);
  assert.match(
    api,
    /operationalRoles\.has\(viewer\.role\) \|\| viewer\.role === "methodist"/,
  );
  assert.equal(
    api.includes('viewer.role === "methodist"\n    ? ([`${homeworkSelect} WHERE 1 = 0`, []] as const)'),
    true,
  );
  assert.match(api, /FROM menu_days WHERE \$\{viewer\.role === "methodist" \? "1 = 0" : "1 = 1"\}/);
  assert.match(api, /viewer\.role === "methodist" \? "1 = 0" : "status != 'archived'"/);
  assert.match(api, /viewer\.role === "methodist" \|\| viewer\.role === "tech_admin"[\s\S]*?threadQuery \+= " AND 1 = 0"/);
  assert.match(api, /SELECT id, '' AS email, display_name AS displayName, role,[\s\S]*?FROM users WHERE role = 'teacher' AND status = 'active'/);
  assert.match(api, /viewer\.role === "methodist" \? "''" : "a\.notes"/);
  assert.match(api, /viewer\.role === "methodist"[\s\S]*?"WHERE a\.status = 'confirmed'"/);
  assert.match(api, /viewer\.role === "teacher" \|\| curriculumRoles\.has\(viewer\.role\)/);
});

test("methodist can review KTP but cannot approve, publish grades or edit schedule", () => {
  assert.match(api, /const curriculumActions = new Set<ActionKind>/);
  assert.match(api, /const methodistProgramTransitions: Record<string, string\[]>/);
  assert.match(api, /review: \["review", "changes_requested"\]/);
  assert.match(api, /availableProgramStatuses\(\s*actor\.role,/);
  assert.match(api, /Учитель заменяет XLSX только в черновике или после возврата на исправление/);
  assert.match(api, /Методист заменяет XLSX только пока программа остаётся черновиком/);
  assert.match(api, /const teacherProgramTransitions: Record<string, string\[]>/);
  assert.match(api, /draft: \["draft", "review"\]/);
  assert.match(api, /changes_requested: \["draft", "review"\]/);
  assert.match(api, /const leadershipProgramTransitions: Record<string, string\[]>/);
  assert.match(api, /approved: \["approved", "active", "archived", "changes_requested"\]/);
  assert.match(api, /teacherOnlyAction && effectiveRole !== "teacher"/);
  assert.match(api, /adminActions\.has\(action\) && !operationalRoles\.has\(actor\.role\)/);
  assert.match(app, /methodist: \[[\s\S]*?\{ id: "programs", label: "КТП" \}[\s\S]*?\{ id: "profile", label: "Профиль" \}/);
  assert.match(app, /snapshot\.viewer\.role === "methodist"\) return <MethodistDashboard/);
  assert.match(app, /const scheduleClassSelector = scheduleEditor \|\| methodistMode/);
  assert.match(app, /methodistMode \? " · методический просмотр"/);
  assert.match(app, /const canEditProgramStatus =/);
  assert.match(app, /canEditProgramStatus\(program\) \? <button/);
  assert.match(app, /const methodistProgramTransitions: Record<string, ProgramStatus\[]>/);
  assert.match(app, /programStatusOptions\.map\(\(status\) => <option/);
  assert.match(app, /canEditProgramTopic\(snapshot\.viewer\.role, selectedProgram\.status\)/);
});

test("changes requested requires a visible review comment with deterministic lifecycle", () => {
  assert.match(types, /reviewComment: string/);
  assert.match(api, /p\.review_comment AS reviewComment/);
  assert.match(api, /requestedStatus === "changes_requested" && !requestedReviewComment/);
  assert.match(api, /При возврате программы на исправление укажите замечание/);
  assert.match(
    api,
    /const nextReviewComment = requestedStatus === "changes_requested"[\s\S]*?\["approved", "active", "archived"\]\.includes\(requestedStatus\)[\s\S]*?existingProgram\?\.reviewComment/,
  );
  assert.match(api, /review_comment = excluded\.review_comment/);
  assert.match(api, /planned_lessons = excluded\.planned_lessons, review_comment = ''/);
  assert.match(app, /program\.reviewComment \? <div className="program-validation review-note"/);
  assert.match(app, /<strong>Замечание:<\/strong> \{program\.reviewComment\}/);
  assert.match(app, /name="reviewComment"[\s\S]*?Что именно нужно исправить в КТП/);
});

test("academic calendar periods are visible from the methodist calendar", () => {
  assert.match(app, /Неучебные периоды:/);
  assert.match(app, /snapshot\.academicCalendarPeriods\.map/);
});
