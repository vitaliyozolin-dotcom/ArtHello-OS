type PublicationPayload = {
  dataMode?: unknown;
  datasets?: Record<string, unknown>;
  safety?: {
    containsPersonalData?: unknown;
    containsBankSecrets?: unknown;
    sourceSecretsIncluded?: unknown;
    ownerOnlyDestinationRequired?: unknown;
    moneyStorageMode?: unknown;
    moneyScale?: unknown;
    sourceToMinorReconciliation?: {
      mismatches?: unknown;
    };
    legacyRealColumnsAuthoritative?: unknown;
    financialCalculationsEnabled?: unknown;
    payrollRulesActivated?: unknown;
    taxRulesActivated?: unknown;
    teacherPayrollLinksActivated?: unknown;
    lessonCategoryAuthoritative?: unknown;
    automaticFamilyMerge?: unknown;
    partialAlfaRowsPublished?: unknown;
    alfaTerminalGatePassed?: unknown;
  };
};

const alphaOperationalDatasets = [
  "alpha_branches",
  "alpha_students",
  "family_candidates",
  "alpha_groups",
  "alpha_teachers",
  "alpha_teacher_rates",
  "alpha_lessons",
  "alpha_payments",
] as const;

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && !Array.isArray(parsed) && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function alfaSyncEvidence(datasets: Record<string, unknown>): {
  row: Record<string, unknown>;
  details: Record<string, unknown>;
} {
  const syncRows = datasets.sync_status;
  if (!Array.isArray(syncRows)) {
    throw new Error("ALFA_SYNC_STATUS_REQUIRED");
  }
  const alfaRows = syncRows.filter(
    (row) =>
      row &&
      !Array.isArray(row) &&
      typeof row === "object" &&
      (row as Record<string, unknown>).source === "alfacrm",
  ) as Record<string, unknown>[];
  const row = alfaRows[0];
  const details = parseJsonObject(row?.details_json);
  if (alfaRows.length !== 1 || !row || !details) {
    throw new Error("ALFA_SYNC_STATUS_INVALID");
  }
  return { row, details };
}

export function validatePublicationSafety(payload: PublicationPayload): void {
  const safety = payload.safety;
  if (
    !payload.datasets ||
    safety?.containsPersonalData !== true ||
    safety.containsBankSecrets !== false ||
    safety.sourceSecretsIncluded !== false ||
    safety.ownerOnlyDestinationRequired !== true ||
    safety.moneyStorageMode !== "integer_minor_units" ||
    safety.moneyScale !== 2 ||
    safety.sourceToMinorReconciliation?.mismatches !== 0 ||
    safety.legacyRealColumnsAuthoritative !== false ||
    safety.financialCalculationsEnabled !== false ||
    safety.payrollRulesActivated !== false ||
    safety.taxRulesActivated !== false ||
    safety.teacherPayrollLinksActivated !== false ||
    safety.lessonCategoryAuthoritative !== false ||
    safety.automaticFamilyMerge !== false
  ) {
    throw new Error("READ_MODEL_SAFETY_CONTRACT_INVALID");
  }

  if (payload.dataMode === "owner_only_real_sources") {
    if (
      safety.partialAlfaRowsPublished !== false ||
      safety.alfaTerminalGatePassed !== true
    ) {
      throw new Error("ALFA_TERMINAL_GATE_REQUIRED");
    }
    for (const dataset of alphaOperationalDatasets) {
      if (!Array.isArray(payload.datasets[dataset])) {
        throw new Error(`ALFA_TERMINAL_DATASET_REQUIRED_${dataset}`);
      }
    }
    const { row, details } = alfaSyncEvidence(payload.datasets);
    const quality =
      details.quality &&
      !Array.isArray(details.quality) &&
      typeof details.quality === "object"
        ? (details.quality as Record<string, unknown>)
        : null;
    if (
      !["completed", "attention"].includes(String(row.status)) ||
      row.data_mode !== "real_read_only_terminal" ||
      details.batchMode !== "full_sandbox_read_only" ||
      details.batchStatus !== "completed" ||
      typeof details.entitiesRequested !== "number" ||
      details.entitiesRequested <= 0 ||
      details.entitiesSucceeded !== details.entitiesRequested ||
      details.entitiesFailed !== 0 ||
      details.scopeRuns !== details.entitiesRequested ||
      details.scopeInventoryComplete !== true ||
      details.terminalGatePassed !== true ||
      details.operationalRowsPublished !== true ||
      quality?.incompleteScopes !== 0
    ) {
      throw new Error("ALFA_TERMINAL_STATUS_INVALID");
    }
    return;
  }
  if (
    payload.dataMode !== "owner_only_verified_payroll_partial_alfa_aggregate" ||
    safety.partialAlfaRowsPublished !== false ||
    safety.alfaTerminalGatePassed !== false
  ) {
    throw new Error("READ_MODEL_SAFETY_CONTRACT_INVALID");
  }

  for (const dataset of alphaOperationalDatasets) {
    const rows = payload.datasets[dataset];
    if (!Array.isArray(rows) || rows.length !== 0) {
      throw new Error(`PARTIAL_ALFA_DATASET_MUST_BE_EMPTY_${dataset}`);
    }
  }

  const { row: alfaStatus, details } = alfaSyncEvidence(payload.datasets);
  if (
    alfaStatus?.status !== "partial" ||
    alfaStatus.data_mode !== "partial_aggregate_no_rows" ||
    details?.terminalGatePassed !== false ||
    details.operationalRowsPublished !== false
  ) {
    throw new Error("PARTIAL_ALFA_STATUS_INVALID");
  }
}
