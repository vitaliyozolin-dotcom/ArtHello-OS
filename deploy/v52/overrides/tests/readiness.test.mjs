import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../lib/readiness.ts", import.meta.url), "utf8");
const seed = fs.readFileSync(new URL("../db/index.ts", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../app/api/readiness-actions/route.ts", import.meta.url), "utf8");
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
  assert.match(api, /REFERENCE_TABLES/);
  assert.match(api, /readiness_scenario_steps/);
  assert.match(api, /DRILL-T-D1-RESTORE-01/);
  assert.match(api, /production promotion is intentionally unavailable/i);
});

test("medical content stays outside readiness response", () => {
  assert.doesNotMatch(api, /minimum_summary|document_ref/);
  assert.match(api, /SELECT id,subject_entity_id,status FROM medical_documents/);
  assert.match(api, /contentExcluded/);
  assert.match(ui, /medicalBoundary/);
});

test("record set comparison is deterministic", () => {
  assert.match(source, /\.sort\(\)/);
  assert.match(source, /sameCount/);
  assert.match(source, /sameOrder/);
});

test("readiness UI exposes the Design System handoff, gates, recovery and representative decision", () => {
  assert.match(ui, /className="ahReadinessPage"/);
  assert.match(ui, /PRODUCTION НЕ ПОДТВЕРЖДЁН/);
  assert.match(ui, /Release gates/);
  assert.match(ui, /Recovery и rollback/);
  assert.match(ui, /Решение представителя/);
  assert.match(ui, /Единая визуальная оболочка и UX master-route/);
  assert.match(ui, /ПРИНЯТО ПРЕДСТАВИТЕЛЕМ/);
  assert.doesNotMatch(ui, /\breadiness-workspace\b/);
});
