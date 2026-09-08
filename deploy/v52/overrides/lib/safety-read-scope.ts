type Row = { id: string };
type System = Row & { objectEntityId: string; responsibleEntityId: string };
type Equipment = Row & { systemId: string; contractorId: string };
type Check = Row & { equipmentId: string; objectEntityId: string; responsibleEntityId: string };
type Fault = Row & { checkId: string; equipmentId: string; relatedTaskId: number | null };
type Repair = Row & { faultId: string; contractorId: string; paymentOperationId: string };
type NextCheck = Row & { equipmentId: string; sourceRepairId: string; responsibleEntityId: string };
type Incident = Row & { objectEntityId: string; systemId: string };
type GuardShift = Row & { objectEntityId: string; employeeEntityId: string };
type Task = { id: number; sourceType: string; sourceId: string; automationKey: string | null };
type SafetyReadRows = {
  systems: System[]; equipment: Equipment[]; checks: Check[]; faults: Fault[];
  repairs: Repair[]; nextChecks: NextCheck[]; incidents: Incident[]; guardShifts: GuardShift[];
  entityRows: Array<{ id: string; displayName: string }>; operations: Row[]; allTasks: Task[];
};

/** null retains existing native-role behavior. An empty set exposes no branch data. */
export function filterAssignedSafetyRows<T extends SafetyReadRows>(branchIds: ReadonlySet<string> | null, rows: T): T {
  if (branchIds === null) return rows;
  // Object references are identifiers, never guessed from a similar branch name.
  const systems = rows.systems.filter((row) => branchIds.has(row.objectEntityId));
  const systemsById = new Map(systems.map((row) => [row.id, row]));
  const equipment = rows.equipment.filter((row) => systemsById.has(row.systemId));
  const equipmentById = new Map(equipment.map((row) => [row.id, row]));
  const checks = rows.checks.filter((row) => {
    const item = equipmentById.get(row.equipmentId);
    return branchIds.has(row.objectEntityId) && item
      && systemsById.get(item.systemId)?.objectEntityId === row.objectEntityId;
  });
  const checksById = new Map(checks.map((row) => [row.id, row]));
  const faults = rows.faults.filter((row) => equipmentById.has(row.equipmentId)
    && checksById.get(row.checkId)?.equipmentId === row.equipmentId);
  const faultsById = new Map(faults.map((row) => [row.id, row]));
  // A safety checkbox is not a legal-entity grant to the financial register.
  const repairs = rows.repairs.filter((row) => faultsById.has(row.faultId))
    .map((row) => ({ ...row, paymentOperationId: '' }));
  const repairsById = new Map(repairs.map((row) => [row.id, row]));
  const nextChecks = rows.nextChecks.filter((row) => {
    const repair = repairsById.get(row.sourceRepairId);
    return repair && equipmentById.has(row.equipmentId)
      && faultsById.get(repair.faultId)?.equipmentId === row.equipmentId;
  });
  const incidents = rows.incidents.filter((row) => branchIds.has(row.objectEntityId)
    && systemsById.get(row.systemId)?.objectEntityId === row.objectEntityId);
  const guardShifts = rows.guardShifts.filter((row) => branchIds.has(row.objectEntityId));
  const allTasks = rows.allTasks.filter((row) => {
    const fault = faultsById.get(row.sourceId);
    return row.sourceType === 'Неисправность безопасности' && fault
      && (fault.relatedTaskId === null || fault.relatedTaskId === row.id)
      && (!row.automationKey || row.automationKey === `SAFETY_FAULT:${fault.id}`);
  });
  const names = new Set([
    ...systems.flatMap((row) => [row.objectEntityId, row.responsibleEntityId]),
    ...equipment.map((row) => row.contractorId),
    ...checks.map((row) => row.responsibleEntityId),
    ...repairs.map((row) => row.contractorId),
    ...nextChecks.map((row) => row.responsibleEntityId),
    ...guardShifts.map((row) => row.employeeEntityId),
  ].filter(Boolean));
  return { ...rows, systems, equipment, checks, faults, repairs, nextChecks, incidents, guardShifts,
    allTasks, operations: [], entityRows: rows.entityRows.filter((row) => names.has(row.id)) } as T;
}
