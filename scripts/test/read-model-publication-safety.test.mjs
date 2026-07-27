import assert from "node:assert/strict";
import test from "node:test";
import { validatePublicationSafety } from "../src/read-model-publication-safety.ts";

const alphaDatasets = {
  alpha_branches: [],
  alpha_students: [],
  family_candidates: [],
  alpha_groups: [],
  alpha_teachers: [],
  alpha_teacher_rates: [],
  alpha_lessons: [],
  alpha_payments: [],
};

function safePayload(overrides = {}) {
  return {
    dataMode: "owner_only_verified_payroll_partial_alfa_aggregate",
    datasets: {
      employees: [],
      ...alphaDatasets,
      sync_status: [
        {
          source: "alfacrm",
          status: "partial",
          data_mode: "partial_aggregate_no_rows",
          details_json: JSON.stringify({
            terminalGatePassed: false,
            operationalRowsPublished: false,
          }),
        },
      ],
    },
    safety: {
      containsPersonalData: true,
      containsBankSecrets: false,
      sourceSecretsIncluded: false,
      ownerOnlyDestinationRequired: true,
      moneyStorageMode: "integer_minor_units",
      moneyScale: 2,
      sourceToMinorReconciliation: { mismatches: 0 },
      legacyRealColumnsAuthoritative: false,
      financialCalculationsEnabled: false,
      payrollRulesActivated: false,
      taxRulesActivated: false,
      teacherPayrollLinksActivated: false,
      lessonCategoryAuthoritative: false,
      automaticFamilyMerge: false,
      partialAlfaRowsPublished: false,
      alfaTerminalGatePassed: false,
    },
    ...overrides,
  };
}

function terminalPayload(overrides = {}) {
  const payload = safePayload({
    dataMode: "owner_only_real_sources",
  });
  payload.safety.alfaTerminalGatePassed = true;
  payload.datasets.sync_status[0] = {
    source: "alfacrm",
    status: "completed",
    data_mode: "real_read_only_terminal",
    details_json: JSON.stringify({
      batchMode: "full_sandbox_read_only",
      batchStatus: "completed",
      entitiesRequested: 12,
      entitiesSucceeded: 12,
      entitiesFailed: 0,
      scopeRuns: 12,
      scopeInventoryComplete: true,
      terminalGatePassed: true,
      operationalRowsPublished: true,
      quality: { incompleteScopes: 0 },
    }),
  };
  return {
    ...payload,
    ...overrides,
  };
}

test("verified payroll may publish with aggregate-only partial AlfaCRM", () => {
  assert.doesNotThrow(() => validatePublicationSafety(safePayload()));
});

test("partial publication rejects every operational AlfaCRM row", () => {
  const payload = safePayload();
  payload.datasets.alpha_students = [{ id: "must-not-publish" }];
  assert.throws(
    () => validatePublicationSafety(payload),
    /PARTIAL_ALFA_DATASET_MUST_BE_EMPTY_alpha_students/,
  );
});

test("partial publication requires explicit fail-closed status evidence", () => {
  const payload = safePayload();
  payload.datasets.sync_status[0].details_json = JSON.stringify({
    terminalGatePassed: false,
    operationalRowsPublished: true,
  });
  assert.throws(
    () => validatePublicationSafety(payload),
    /PARTIAL_ALFA_STATUS_INVALID/,
  );
});

test("terminal owner-only payload requires complete AlfaCRM evidence", () => {
  assert.doesNotThrow(() => validatePublicationSafety(terminalPayload()));
});

test("changing only dataMode cannot bypass the AlfaCRM terminal gate", () => {
  const payload = safePayload({
    dataMode: "owner_only_real_sources",
  });
  assert.throws(
    () => validatePublicationSafety(payload),
    /ALFA_TERMINAL_GATE_REQUIRED/,
  );
});

test("terminal publication rejects incomplete scopes", () => {
  const payload = terminalPayload();
  const details = JSON.parse(payload.datasets.sync_status[0].details_json);
  details.quality.incompleteScopes = 1;
  payload.datasets.sync_status[0].details_json = JSON.stringify(details);
  assert.throws(
    () => validatePublicationSafety(payload),
    /ALFA_TERMINAL_STATUS_INVALID/,
  );
});

test("terminal publication rejects an incomplete source batch", () => {
  const payload = terminalPayload();
  const details = JSON.parse(payload.datasets.sync_status[0].details_json);
  details.batchStatus = "incomplete";
  payload.datasets.sync_status[0].details_json = JSON.stringify(details);
  assert.throws(
    () => validatePublicationSafety(payload),
    /ALFA_TERMINAL_STATUS_INVALID/,
  );
});

test("completed incremental discovery cannot become a terminal AlfaCRM snapshot", () => {
  const payload = terminalPayload();
  const details = JSON.parse(payload.datasets.sync_status[0].details_json);
  details.batchMode = "incremental_discovery_read_only";
  payload.datasets.sync_status[0].details_json = JSON.stringify(details);
  assert.throws(
    () => validatePublicationSafety(payload),
    /ALFA_TERMINAL_STATUS_INVALID/,
  );
});

test("terminal publication requires the complete source scope inventory", () => {
  const payload = terminalPayload();
  const details = JSON.parse(payload.datasets.sync_status[0].details_json);
  details.entitiesSucceeded = 11;
  details.scopeInventoryComplete = false;
  payload.datasets.sync_status[0].details_json = JSON.stringify(details);
  assert.throws(
    () => validatePublicationSafety(payload),
    /ALFA_TERMINAL_STATUS_INVALID/,
  );
});
