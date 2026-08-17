import test from "node:test";
import assert from "node:assert/strict";
import {
  FRONT_OFFICE_MODE,
  FRONT_OFFICE_PROJECT_ID,
  assertInternalMessageType,
  assertLeadStageTransition,
  assertSyntheticWriteAllowed,
  canTransitionLeadStage,
  safeLimit,
  stageRequiresNextAction,
} from "../src/lib/front-office-policy.ts";

test("front office is pinned to ArtHello and DRAFT_ONLY", () => {
  assert.equal(FRONT_OFFICE_PROJECT_ID, "ARTHELLO");
  assert.equal(FRONT_OFFICE_MODE, "DRAFT_ONLY");
});

test("lead stages only move forward or to LOST", () => {
  assert.equal(canTransitionLeadStage("NEW", "QUALIFIED"), true);
  assert.equal(canTransitionLeadStage("QUALIFIED", "PROGRAM_MATCHED"), true);
  assert.equal(
    canTransitionLeadStage("PROGRAM_MATCHED", "TRIAL_REQUESTED"),
    true,
  );
  assert.equal(canTransitionLeadStage("TRIAL_CONFIRMED", "WON"), true);
  assert.equal(canTransitionLeadStage("QUALIFIED", "LOST"), true);
  assert.equal(canTransitionLeadStage("TRIAL_CONFIRMED", "NEW"), false);
  assert.equal(canTransitionLeadStage("WON", "QUALIFIED"), false);
  assert.throws(
    () => assertLeadStageTransition("TRIAL_CONFIRMED", "NEW"),
    /Недопустимый переход/,
  );
});

test("internal alpha refuses writes to non-synthetic records", () => {
  assert.doesNotThrow(() => assertSyntheticWriteAllowed({ isSynthetic: true }));
  assert.throws(
    () => assertSyntheticWriteAllowed({ isSynthetic: false }),
    /только синтетических/,
  );
});

test("message surface accepts only internal notes and AI drafts", () => {
  assert.doesNotThrow(() => assertInternalMessageType("internal_note"));
  assert.doesNotThrow(() => assertInternalMessageType("ai_draft"));
  assert.throws(
    () => assertInternalMessageType("outbound"),
    /Исходящие сообщения отключены/,
  );
});

test("active stages require a next action", () => {
  assert.equal(stageRequiresNextAction("NEW"), true);
  assert.equal(stageRequiresNextAction("TRIAL_CONFIRMED"), true);
  assert.equal(stageRequiresNextAction("WON"), false);
  assert.equal(stageRequiresNextAction("LOST"), false);
});

test("limits are bounded", () => {
  assert.equal(safeLimit(undefined), 100);
  assert.equal(safeLimit("-1"), 100);
  assert.equal(safeLimit("25"), 25);
  assert.equal(safeLimit("10000"), 200);
});
