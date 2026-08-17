import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const artifactRoot = fileURLToPath(new URL("../", import.meta.url));
const data = JSON.parse(
  readFileSync(
    `${artifactRoot}src/features/front-office/control-center-preview-data.json`,
    "utf8",
  ),
);
const workspace = readFileSync(
  `${artifactRoot}src/features/front-office/control-center-preview-workspace.tsx`,
  "utf8",
);
const contract = readFileSync(
  `${artifactRoot}src/features/front-office/preview-contract.ts`,
  "utf8",
);
const page = readFileSync(`${artifactRoot}src/pages/front-office.tsx`, "utf8");

test("control center starts with fail-closed ARTHELLO configuration", () => {
  assert.equal(data.projectId, "ARTHELLO");
  assert.equal(data.currentMode, "DRAFT_ONLY");
  assert.equal(data.realChannelsEnabled, false);
  assert.equal(data.externalActionsEnabled, false);
  assert.deepEqual(data.approvedActions, []);
  assert.ok(
    data.requiredConfiguration.some(
      (item) => item.key === "APPROVED_ACTIONS" && item.value === "EMPTY",
    ),
  );
});

test("all mandatory roles remain explicitly unassigned", () => {
  const requiredRoles = new Set([
    "SUPPORT_OWNER_ROLE",
    "DUTY_MANAGER_ROLE",
    "FINANCE_ESCALATION_ROLE",
    "LEGAL_ESCALATION_ROLE",
    "SAFETY_ESCALATION_ROLE",
    "KNOWLEDGE_OWNER_ROLE",
  ]);
  assert.equal(data.roles.length, requiredRoles.size);

  for (const role of data.roles) {
    assert.ok(requiredRoles.has(role.key));
    assert.equal(role.assigned, false);
    assert.equal(role.value, "Не назначен");
  }
});

test("SLA matrix contains P0-P4 proposals but activates none", () => {
  assert.deepEqual(
    data.sla.map((item) => item.priority),
    ["P0", "P1", "P2", "P3", "P4"],
  );

  for (const item of data.sla) {
    assert.equal(item.proposal, true);
    assert.equal(item.activated, false);
    assert.ok(item.escalationRole.endsWith("_ROLE"));
  }
});

test("autonomy cannot advance beyond DRAFT_ONLY", () => {
  const currentLevels = data.autonomyLevels.filter(
    (level) => level.status === "CURRENT",
  );
  assert.equal(currentLevels.length, 1);
  assert.equal(currentLevels[0].key, "DRAFT_ONLY");

  for (const key of ["AUTO_LOW_RISK", "LIMITED_ACTIONS"]) {
    const level = data.autonomyLevels.find((item) => item.key === key);
    assert.equal(level.status, "LOCKED");
  }

  const fullAutonomy = data.autonomyLevels.find(
    (item) => item.key === "FULL_AUTONOMY",
  );
  assert.equal(fullAutonomy.status, "PROHIBITED");
});

test("all automatic shutdown triggers are armed", () => {
  assert.equal(data.killSwitches.length, 8);
  assert.ok(data.killSwitches.every((trigger) => trigger.armed));
  assert.ok(
    data.killSwitches.every((trigger) =>
      ["DRAFT_ONLY", "SHUTDOWN"].includes(trigger.targetMode),
    ),
  );

  const criticalKeys = new Set([
    "CROSS_PROJECT_LEAK",
    "PERSONAL_DATA_DISCLOSURE",
    "WRONG_CUSTOMER_PROFILE",
    "UNAUTHORIZED_FINANCIAL_ACTION",
    "MISSED_CHILD_SAFETY_ESCALATION",
  ]);
  for (const key of criticalKeys) {
    const trigger = data.killSwitches.find((item) => item.key === key);
    assert.equal(trigger.severity, "CRITICAL");
    assert.equal(trigger.targetMode, "SHUTDOWN");
  }
});

test("real-channel readiness remains blocked by missing configuration", () => {
  const keys = new Set(
    data.requiredConfiguration.map((configuration) => configuration.key),
  );
  const mandatoryKeys = [
    "PROJECT_ID",
    "MODE",
    "SUPPORTED_CHANNELS",
    "BUSINESS_HOURS",
    "TIMEZONE",
    "SUPPORT_OWNER_ROLE",
    "DUTY_MANAGER_ROLE",
    "FINANCE_ESCALATION_ROLE",
    "LEGAL_ESCALATION_ROLE",
    "SAFETY_ESCALATION_ROLE",
    "APPROVED_ACTIONS",
    "FORBIDDEN_ACTIONS",
    "SLA_MATRIX",
    "REFUND_POLICY_ID",
    "CANCELLATION_POLICY_ID",
    "DISCOUNT_LIMIT",
    "COMPENSATION_MATRIX",
    "IDENTITY_VERIFICATION_POLICY",
    "DATA_RETENTION_POLICY",
    "EMERGENCY_PLAYBOOK",
    "KNOWLEDGE_BASE_VERSION",
    "SOURCE_OF_TRUTH_MAP",
  ];
  for (const key of mandatoryKeys) assert.ok(keys.has(key));

  const blockers = data.requiredConfiguration.filter((item) => item.blocking);
  assert.ok(blockers.length >= 18);
  assert.ok(
    blockers.every((item) =>
      ["MISSING", "PROPOSAL", "SAFE_DEFAULT"].includes(item.status),
    ),
  );
});

test("AI opt-out preserves the manual workflow", () => {
  assert.equal(data.processContract.optOut.available, true);
  assert.match(data.processContract.optOut.withoutAi, /Ручной поиск/);
  assert.match(data.processContract.optOut.stoppedProcessing, /AI-retrieval/);
  assert.match(
    data.processContract.optOut.reenable,
    /явным решением владельца/,
  );
});

test("control center UI exposes no persistence or activation path", () => {
  const previewSources = `${workspace}\n${page}`;
  assert.doesNotMatch(previewSources, /\bfetch\s*\(/);
  assert.doesNotMatch(previewSources, /\buseQuery\s*\(/);
  assert.doesNotMatch(previewSources, /@workspace\/api-client-react/);
  assert.doesNotMatch(previewSources, /\blocalStorage\b/);
  assert.match(workspace, /Сохранение отключено/);
  assert.match(workspace, /Активация SLA отключена/);
  assert.match(workspace, /Назначение роли отключено/);
  assert.match(workspace, /Смена режима отключена/);
  assert.match(page, /ControlCenterPreviewWorkspace/);
  assert.match(contract, /configurationWrites:\s*false/);
  assert.match(contract, /policyWrites:\s*false/);
  assert.match(contract, /roleAssignments:\s*false/);
  assert.match(contract, /slaActivation:\s*false/);
  assert.match(contract, /approvedActionsCount:\s*0/);
  assert.match(contract, /realChannelsEnabled:\s*false/);
  assert.match(contract, /killSwitchPreviewOnly:\s*true/);
});
