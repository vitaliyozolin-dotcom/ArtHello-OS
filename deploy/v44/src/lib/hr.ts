export const candidateStages = ["Новый", "Скрининг", "Интервью", "Решение", "Оффер", "Оформление", "Сотрудник"] as const;

export function nextCandidateStage(current: string, target: string) {
  const from = candidateStages.indexOf(current as typeof candidateStages[number]);
  const to = candidateStages.indexOf(target as typeof candidateStages[number]);
  return from >= 0 && to === from + 1;
}

export function candidateFunnel(rows: Array<{ stage: string }>) {
  return candidateStages.map((stage, index) => ({
    stage,
    count: rows.filter((row) => {
      const reached = candidateStages.indexOf(row.stage as typeof candidateStages[number]);
      return reached >= index;
    }).length,
  }));
}

export function accessAllowed(employeeStatus: string, accessStatus: string) {
  return employeeStatus === "Работает" && accessStatus === "Активен";
}

export function salaryRub(minor: number) { return Math.round(minor / 100); }
