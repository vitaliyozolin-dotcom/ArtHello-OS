type Row = Record<string, unknown>;
type Tables = Record<"goals" | "kpis" | "initiatives" | "projects" | "events" | "participants" | "results" | "deviations" | "allTasks", Row[]>;

export function scopeStrategyRows<T extends Tables>(tables: T, branchIds: ReadonlySet<string>): T {
  const goals = tables.goals.filter((row) => typeof row.unitEntityId === "string" && branchIds.has(row.unitEntityId));
  const goalIds = new Set(goals.map((row) => row.id));
  const kpis = tables.kpis.filter((row) => goalIds.has(row.goalId));
  const kpiById = new Map(kpis.map((row) => [row.id, row]));
  const initiatives = tables.initiatives.filter((row) => goalIds.has(row.goalId) && kpiById.get(row.kpiId)?.goalId === row.goalId);
  const initiativeById = new Map(initiatives.map((row) => [row.id, row]));
  const projects = tables.projects.filter((row) => goalIds.has(row.goalId) && initiativeById.get(row.initiativeId)?.goalId === row.goalId)
    .map((row): Row => ({ ...row, budgetId: "" }));
  const projectById = new Map(projects.map((row) => [row.id, row]));
  const events = tables.events.filter((row) => projectById.has(row.projectId));
  const eventById = new Map(events.map((row) => [row.id, row]));
  const participants = tables.participants.filter((row) => eventById.has(row.eventId));
  const results = tables.results.filter((row) => projectById.has(row.projectId)
    && (!row.eventId || eventById.get(row.eventId)?.projectId === row.projectId));
  const deviations = tables.deviations.filter((row) => projectById.has(row.projectId)
    && kpiById.get(row.kpiId)?.goalId === projectById.get(row.projectId)?.goalId);
  const deviationById = new Map(deviations.map((row) => [row.id, row]));
  const allTasks = tables.allTasks.filter((row) => (row.sourceType === "Проект" && projectById.has(row.sourceId))
    || (row.sourceType === "Отклонение KPI" && deviationById.get(row.sourceId)?.relatedTaskId === row.id));
  return { ...tables, goals, kpis, initiatives, projects, events, participants, results, deviations, allTasks } as T;
}
