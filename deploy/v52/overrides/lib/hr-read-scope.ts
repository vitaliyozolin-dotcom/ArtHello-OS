type Row = Record<string, unknown>;
export type HrReadTables = Record<"vacancyRows" | "candidateRows" | "interviewRows" | "employeeRows" | "onboardingRows" | "developmentRows" | "rewardRows" | "accessRows" | "rawEntityRows" | "documentRows" | "operationRows" | "branchRows", Row[]>;
type Scope = { unrestrictedOwner: boolean; allowedBranchIds: readonly string[] };

function metadata(row: Row | undefined): Row {
  if (typeof row?.metadata !== "string") return {};
  try {
    const value = JSON.parse(row.metadata);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

/** Branch identities are exact stored IDs or unique active branch names. */
export function scopeHrReadTables<T extends HrReadTables>(tables: T, scope: Scope): T {
  if (scope.unrestrictedOwner) return tables;
  const active = tables.branchRows.filter((row) => row.status === "Активен");
  const allowed = new Set(active.filter((row) => scope.allowedBranchIds.includes(String(row.id))).map((row) => String(row.id)));
  const activeIds = new Set(active.map((row) => String(row.id)));
  const resolveUnit = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return "";
    const unit = value.trim();
    if (activeIds.has(unit)) return unit;
    const matches = active.filter((row) => row.name === unit);
    return matches.length === 1 ? String(matches[0].id) : "";
  };
  const entities = new Map(tables.rawEntityRows.map((row) => [String(row.id), row]));
  const employeeBranchIds = (row: Row): string[] => {
    const profile = metadata(entities.get(String(row.id)));
    // A present malformed/unknown assignment must not fall back to a broad unit label.
    if (Object.hasOwn(profile, "branchIds")) {
      return Array.isArray(profile.branchIds) && profile.branchIds.length > 0
        && profile.branchIds.every((id) => typeof id === "string" && allowed.has(id))
        ? [...new Set(profile.branchIds as string[])] : [];
    }
    const id = resolveUnit(row.unit);
    return id && allowed.has(id) ? [id] : [];
  };
  const vacancyRows = tables.vacancyRows.filter((row) => allowed.has(resolveUnit(row.unit)));
  const vacancyIds = new Set(vacancyRows.map((row) => row.id));
  const candidateRows = tables.candidateRows.filter((row) => vacancyIds.has(row.vacancyId));
  const candidateIds = new Set(candidateRows.map((row) => row.id));
  const interviewRows = tables.interviewRows.filter((row) => candidateIds.has(row.candidateId));
  const employeeRows = tables.employeeRows.filter((row) => employeeBranchIds(row).length > 0).map((row): Row => ({
    ...row,
    candidateId: candidateIds.has(row.candidateId) ? row.candidateId : "",
    // A workflow document has no independent branch/legal-entity authority.
    contractId: "",
  }));
  const employeeIds = new Set(employeeRows.map((row) => row.id));
  const relatedEntityIds = new Set([
    ...employeeIds,
    ...candidateRows.map((row) => row.entityId),
    ...interviewRows.map((row) => row.interviewerEntityId),
  ].filter(Boolean));
  const rawEntityRows = tables.rawEntityRows.filter((row) => relatedEntityIds.has(row.id)).map((row) => {
    const profile = metadata(row);
    // Explicit allowlist: metadata is not a general-purpose disclosure channel.
    const employee = employeeRows.find((item) => item.id === row.id);
    const ids = employee ? employeeBranchIds(employee) : [];
    const names = active.filter((branch) => ids.includes(String(branch.id))).map((branch) => String(branch.name));
    const safeProfile = employee ? {
      ...Object.fromEntries(["contact", "position", "employmentType"].filter((key) => typeof profile[key] === "string").map((key) => [key, String(profile[key]).slice(0, 200)])),
      branchIds: ids, branches: names, branch: names.join(", "),
    } : {};
    return { ...row, metadata: JSON.stringify(safeProfile) };
  });
  return {
    ...tables, vacancyRows, candidateRows, interviewRows, employeeRows, rawEntityRows,
    onboardingRows: tables.onboardingRows.filter((row) => employeeIds.has(row.employeeId)),
    developmentRows: tables.developmentRows.filter((row) => employeeIds.has(row.employeeId)),
    rewardRows: tables.rewardRows.filter((row) => employeeIds.has(row.employeeId)),
    accessRows: tables.accessRows.filter((row) => employeeIds.has(row.employeeId)),
    // A matching employee alone does not authorize financial/legal records.
    operationRows: [], documentRows: [],
    branchRows: active.filter((row) => allowed.has(String(row.id))),
  } as T;
}
