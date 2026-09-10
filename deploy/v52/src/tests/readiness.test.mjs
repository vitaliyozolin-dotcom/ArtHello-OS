import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = fs.readFileSync(new URL("../lib/readiness.ts", import.meta.url), "utf8");
const seed = fs.readFileSync(new URL("../db/index.ts", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../app/api/readiness-actions/route.ts", import.meta.url), "utf8");
const readApi = fs.readFileSync(new URL("../app/api/readiness/route.ts", import.meta.url), "utf8");
const acceptanceApi = fs.readFileSync(new URL("../app/api/acceptance/route.ts", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../app/components/ReadinessWorkspace.tsx", import.meta.url), "utf8");

test("scenario requires every step", () => {
  assert.match(source, /steps\.length>0&&steps\.every/);
  assert.match(source, /passedStates\.has/);
});

test("production requires all gates and explicit approval", () => {
  assert.match(source, /explicitApproval&&requiredGatesPassed/);
  assert.match(seed, /GATE-T-BACKUP/);
  assert.match(seed, /GATE-T-INTEGRATIONS/);
  assert.match(seed, /GATE-T-APPROVAL/);
});

test("all ten master scenarios are seeded", () => {
  for (let number = 1; number <= 10; number += 1) {
    assert.match(seed, new RegExp(`SCN-T-${String(number).padStart(2, "0")}`));
  }
  assert.match(seed, /От объявления до прибыли/);
  assert.match(seed, /Защищённый медицинский случай/);
});

test("readiness runner checks D1 references and does not fake recovery", () => {
  assert.match(api, /REFERENCE_SOURCES/);
  assert.match(api, /REFERENCE_LOOKUPS/);
  assert.match(api, /getAuthenticatedRequestContext/);
  assert.match(api, /verifyAuthenticatedRequestCsrf/);
  assert.match(api, /readiness_scenario_steps/);
  assert.match(api, /DRILL-T-D1-RESTORE-01/);
  assert.match(api, /Выпуск выполняется только после отдельного решения собственника/);
  assert.doesNotMatch(`${api}\n${readApi}`, /SELECT\s+\*/i);
  assert.doesNotMatch(api, /for\s*\(const value of Object\.values\(row\)\)/);
});

test("readiness run claims its blocking gate and publishes one atomic result", () => {
  assert.match(api, /claimReadinessRun/);
  assert.match(api, /SET status='Проверяется'/);
  assert.match(api, /status='Заблокировано'/);
  assert.match(api, /stepPublication\(stepUpdates, startedAt\)/);
  assert.match(api, /scenarioPublication\(scenarioUpdates, startedAt\)/);
  assert.match(api, /const publicationResults = await env\.DB\.batch\(\[/);
  assert.match(api, /WHERE id=\? AND status='Проверяется' AND updated_at=\?/);
  assert.doesNotMatch(api, /UPDATE readiness_scenario_steps[^;]+\.run\(\)/s);
  assert.doesNotMatch(api, /UPDATE readiness_scenarios[^;]+\.run\(\)/s);
});

test("readiness gate compare-and-set rejects a parallel runner", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE release_gates (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    required INTEGER NOT NULL,
    evidence TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  database.prepare("INSERT INTO release_gates VALUES (?,?,?,?,?)")
    .run("GATE-T-SCENARIOS", "Ожидает запуск", 1, "Ожидает", "2026-09-03T00:00:00.000Z");
  const claim = database.prepare(`UPDATE release_gates
    SET status='Проверяется',evidence='Идёт повторная проверка; выпуск временно заблокирован',updated_at=?
    WHERE id=? AND required=1 AND (status<>'Проверяется' OR updated_at<?)
    RETURNING id`);
  const firstToken = "2026-09-03T01:00:00.000Z";
  assert.equal(claim.get(firstToken, "GATE-T-SCENARIOS", "2026-09-03T00:55:00.000Z")?.id, "GATE-T-SCENARIOS");
  assert.equal(
    claim.get("2026-09-03T01:00:01.000Z", "GATE-T-SCENARIOS", "2026-09-03T00:55:01.000Z"),
    undefined,
    "the second runner must not acquire a live gate lease",
  );
  assert.equal(
    claim.get("2026-09-03T01:06:00.000Z", "GATE-T-SCENARIOS", "2026-09-03T01:01:00.000Z")?.id,
    "GATE-T-SCENARIOS",
    "an abandoned lease can be recovered after the timeout",
  );
  database.close();
});

test("medical content stays outside readiness response", () => {
  assert.doesNotMatch(api, /minimum_summary|document_ref/);
  assert.match(api, /medical_documents:\s*\["id",\s*"status"\]/);
  assert.match(api, /contentExcluded/);
  assert.match(api, /row\.status\s*===\s*"Действует"/);
  assert.match(api, /row\.status\s*===\s*"Закрыт"/);
  assert.match(ui, /medicalBoundary/);
  assert.match(readApi, /getAuthenticatedRequestContext/);
  assert.match(readApi, /step\.check_type !== "PROTECTED"/);
  assert.match(readApi, /delete publicStep\.entity_id/);
  assert.match(readApi, /protected_reference_withheld/);
});

test("record set comparison is deterministic", () => {
  assert.match(source, /\.sort\(\)/);
  assert.match(source, /sameCount/);
  assert.match(source, /sameOrder/);
});

test("readiness UI exposes the Design System handoff, gates, recovery and owner decision", () => {
  assert.match(ui, /className="ahReadinessPage"/);
  assert.match(ui, /РАБОЧИЙ ВЫПУСК НЕ ПОДТВЕРЖДЁН/);
  assert.match(ui, /Условия выпуска/);
  assert.match(ui, /Восстановление/);
  assert.match(ui, /Решение собственника/);
  assert.match(ui, /ПОДТВЕРЖДЕНО СОБСТВЕННИКОМ/);
  assert.doesNotMatch(ui, /\breadiness-workspace\b/);
});

test("system check approval is owner-only, gated, CSRF protected and atomic", () => {
  assert.match(acceptanceApi, /getAuthenticatedRequestContext/);
  assert.match(acceptanceApi, /verifyAuthenticatedRequestCsrf/);
  assert.match(acceptanceApi, /isSystemOwner/);
  assert.match(acceptanceApi, /requiredGatesPassed/);
  assert.match(acceptanceApi, /approvalGate/);
  assert.match(acceptanceApi, /await\s+database\(\)\.batch\(writes\)/);
  assert.match(acceptanceApi, /NOT EXISTS \(SELECT 1 FROM release_gates WHERE required=1 AND id<>\? AND status<>'Пройдено'\)/);
  assert.match(acceptanceApi, /gateWrite\?\.meta\?\.changes === 1/);
  assert.match(acceptanceApi, /acceptance\.recorded/);
  assert.match(acceptanceApi, /GATE-T-APPROVAL/);
  assert.match(ui, /title="Проверка системы"/);
  assert.match(ui, /Зачем это нужно/);
  assert.match(ui, /data\.summary\.prerequisitesReady/);
  assert.match(ui, /x-csrf-token/);
});

test("owner confirmation loses the race when a prerequisite starts rechecking", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE release_gates (id TEXT PRIMARY KEY,status TEXT NOT NULL,required INTEGER NOT NULL);
    CREATE TABLE acceptance_decisions (stage TEXT,verdict TEXT,comment TEXT,actor TEXT,created_at TEXT);
    INSERT INTO release_gates VALUES ('GATE-T-SCENARIOS','Пройдено',1),('GATE-T-APPROVAL','Ожидает',1);`);
  const preflightReady = database.prepare(`SELECT NOT EXISTS (
    SELECT 1 FROM release_gates WHERE required=1 AND id<>'GATE-T-APPROVAL' AND status<>'Пройдено'
  ) AS ready`).get();
  assert.equal(preflightReady.ready, 1);

  database.prepare("UPDATE release_gates SET status='Проверяется' WHERE id='GATE-T-SCENARIOS'").run();
  const guardedInsert = database.prepare(`INSERT INTO acceptance_decisions (stage,verdict,comment,actor,created_at)
    SELECT ?,?,?,?,?
    WHERE EXISTS (SELECT 1 FROM release_gates WHERE id=? AND required=1)
      AND NOT EXISTS (SELECT 1 FROM release_gates WHERE required=1 AND id<>? AND status<>'Пройдено')`);
  const result = guardedInsert.run(
    "Проверка системы",
    "ПОДТВЕРЖДЕНО СОБСТВЕННИКОМ",
    "Проверено владельцем",
    "Собственник",
    "2026-09-03T01:00:00.000Z",
    "GATE-T-APPROVAL",
    "GATE-T-APPROVAL",
  );
  assert.equal(result.changes, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM acceptance_decisions").get().count, 0);
  database.close();
});

test("readiness evidence is human readable and rejects fabricated control markers", () => {
  assert.match(source, /manualEvidence/);
  assert.match(source, /length\s*<\s*8/);
  assert.match(source, /CONTROL:EVIDENCE/);
  assert.match(ui, /Сценарий №/);
  assert.match(ui, /Проверка №/);
  assert.doesNotMatch(ui, /\{scenario\.id\}\s*·\s*\{scenario\.owner_entity_id\}/);
  assert.doesNotMatch(ui, /\{step\.entity_id\}/);
});

test("readiness routes do not expose internal exception text", () => {
  assert.doesNotMatch(api, /error instanceof Error \? error\.message/);
  assert.match(api, /console\.error\("Readiness action failed"/);
  assert.match(readApi, /console\.error\("Readiness data load failed"/);
  assert.match(acceptanceApi, /console\.error\("Acceptance storage operation failed"/);
});
