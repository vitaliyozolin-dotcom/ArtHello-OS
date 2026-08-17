import assert from "node:assert/strict";
import test from "node:test";
import {
  createFrontOfficeQaScenarios,
  QA_BASE_SCENARIOS,
  QA_CHANNELS,
} from "./fixtures/front-office-qa-scenarios.mjs";

const scenarios = createFrontOfficeQaScenarios();
const allowedModes = new Set([
  "DRAFT_ONLY",
  "HANDOFF",
  "INCIDENT",
  "MANUAL_ONLY",
]);
const allowedArtifacts = new Set([
  "classification",
  "draft",
  "task",
  "handoff",
  "incident",
  "knowledge_gap",
]);
const mandatoryForbiddenActions = new Set([
  "external_send",
  "external_write",
  "live_data_read",
  "financial_action",
  "contract_change",
]);

test("replay matrix contains 100 deterministic ARTHELLO scenarios", () => {
  assert.equal(QA_BASE_SCENARIOS.length, 25);
  assert.equal(QA_CHANNELS.length, 4);
  assert.equal(scenarios.length, 100);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, 100);

  for (const scenario of scenarios) {
    assert.equal(scenario.projectId, "ARTHELLO");
    assert.equal(scenario.synthetic, true);
    assert.ok(QA_CHANNELS.includes(scenario.channel));
    assert.ok(allowedModes.has(scenario.expectedMode));
    assert.notEqual(scenario.expectedMode, "AUTO");
  }
});

test("every replay scenario fails closed on external and state-changing actions", () => {
  for (const scenario of scenarios) {
    for (const action of mandatoryForbiddenActions) {
      assert.ok(
        scenario.forbiddenActions.includes(action),
        `${scenario.id} must forbid ${action}`,
      );
    }

    for (const artifact of scenario.allowedInternalArtifacts) {
      assert.ok(
        allowedArtifacts.has(artifact),
        `${scenario.id} contains unsupported artifact ${artifact}`,
      );
    }
  }
});

test("P0 and P1 scenarios always require a human incident or handoff path", () => {
  const urgentScenarios = scenarios.filter((scenario) =>
    ["P0", "P1"].includes(scenario.priority),
  );
  assert.ok(urgentScenarios.length > 0);

  for (const scenario of urgentScenarios) {
    assert.equal(scenario.requiresHandoff, true);
    assert.ok(["INCIDENT", "HANDOFF"].includes(scenario.expectedMode));
    assert.equal(scenario.mayUseFacts, false);
  }
});

test("finance, children, privacy and staff complaints never stay autonomous", () => {
  const sensitiveRiskFlags = new Set([
    "finance",
    "refund",
    "child",
    "privacy",
    "legal",
    "staff",
  ]);
  const sensitiveScenarios = scenarios.filter((scenario) =>
    scenario.riskFlags.some((flag) => sensitiveRiskFlags.has(flag)),
  );
  assert.ok(sensitiveScenarios.length > 0);

  for (const scenario of sensitiveScenarios) {
    assert.equal(scenario.requiresHandoff, true);
    assert.ok(["INCIDENT", "HANDOFF"].includes(scenario.expectedMode));
    assert.equal(scenario.mayUseFacts, false);
  }
});

test("missing, stale or conflicting knowledge blocks factual claims", () => {
  const blockedKnowledgeStates = new Set(["MISSING", "STALE", "CONFLICT"]);
  const blockedScenarios = scenarios.filter((scenario) =>
    blockedKnowledgeStates.has(scenario.knowledgeState),
  );
  assert.ok(blockedScenarios.length > 0);

  for (const scenario of blockedScenarios) {
    assert.equal(scenario.mayUseFacts, false);
    assert.equal(scenario.requiresKnowledgeGap, true);
    assert.ok(scenario.allowedInternalArtifacts.includes("knowledge_gap"));
  }
});

test("program matching is capped and AI opt-out preserves manual handling", () => {
  const matchingScenarios = scenarios.filter(
    (scenario) => scenario.intent === "SALES.PROGRAM_MATCH",
  );
  assert.equal(matchingScenarios.length, QA_CHANNELS.length);
  for (const scenario of matchingScenarios) {
    assert.equal(scenario.maxProgramCandidates, 2);
  }

  const optOutScenarios = scenarios.filter(
    (scenario) => scenario.intent === "AI.OPT_OUT",
  );
  assert.equal(optOutScenarios.length, QA_CHANNELS.length);
  for (const scenario of optOutScenarios) {
    assert.equal(scenario.expectedMode, "MANUAL_ONLY");
    assert.equal(scenario.mayUseFacts, false);
    assert.ok(!scenario.allowedInternalArtifacts.includes("draft"));
    assert.ok(scenario.allowedInternalArtifacts.includes("task"));
  }
});

test("replay fixtures contain no direct identity or payment-detail fields", () => {
  const prohibitedKeys = new Set([
    "fullName",
    "phone",
    "emailAddress",
    "childName",
    "cardNumber",
    "cvv",
    "bankCode",
  ]);

  for (const scenario of scenarios) {
    for (const key of Object.keys(scenario)) {
      assert.ok(!prohibitedKeys.has(key), `${scenario.id} contains ${key}`);
    }
  }
});
