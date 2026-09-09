export const taskStatuses = ["Входящие", "Запланировано", "В работе", "На проверке", "Выполнено"] as const;

export function getNextTaskStatus(status: string) {
  return taskStatuses[taskStatuses.indexOf(status as typeof taskStatuses[number]) + 1] || "";
}

export function nextRecurrenceDate(value: string, rule: string, fallback = new Date()) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(fallback);
  if (rule === "Каждую неделю") base.setUTCDate(base.getUTCDate() + 7);
  else if (rule === "Каждый месяц") base.setUTCMonth(base.getUTCMonth() + 1);
  else return "";
  return base.toISOString().slice(0, 10);
}

export function mayCompleteProcess(input: { incompleteChecklist: number; incompleteSubtasks: number; requiresApproval: boolean; approvalStatus: string }) {
  if (input.incompleteChecklist > 0) return { allowed: false, reason: "Сначала завершите чек-лист" };
  if (input.incompleteSubtasks > 0) return { allowed: false, reason: "Сначала завершите подзадачи" };
  if (input.requiresApproval && input.approvalStatus !== "Согласовано") return { allowed: false, reason: "Результат должен согласовать руководитель" };
  return { allowed: true, reason: "" };
}
