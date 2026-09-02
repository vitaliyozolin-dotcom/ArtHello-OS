export type TaskAccessContext = {
  actor: string;
  apiRole: string;
  appUserId: string;
  appUserName: string;
};

export type TaskAccessRow = {
  id: number;
  createdByUserId: string;
  createdBy: string;
  assigneeEntityId: string;
};

export type TaskWatcherRow = { entityId: string };

export type TaskAccessDecision = {
  canView: boolean;
  canManage: boolean;
  canComment: boolean;
  canApprove: boolean;
};

export type ScopedTaskResult<T extends TaskAccessRow = TaskAccessRow> =
  | { state: "missing" }
  | { state: "hidden" }
  | { state: "visible"; task: T };

const TASK_MANAGER_ROLES = new Set(["OWNER", "DIRECTOR"]);

/**
 * Tasks have their own row-level policy in addition to the coarse proxy rule.
 * A role watcher is an explicit grant stored on that task, not a global role
 * shortcut. Unknown or missing principals always fail closed.
 */
export function taskAccessDecision(
  context: TaskAccessContext,
  task: TaskAccessRow,
  watchers: TaskWatcherRow[] = [],
): TaskAccessDecision {
  const manager = isTaskManager(context);
  const created = samePrincipal(task.createdByUserId, context.appUserId);
  const assigned = samePrincipal(task.assigneeEntityId, context.appUserId);
  const watched = watchers.some((watcher) => taskRecipientPrincipals(context)
    .some((principal) => samePrincipal(watcher.entityId, principal)));
  const canManage = manager || created || assigned;
  const canView = canManage || watched;
  return {
    canView,
    canManage,
    canComment: canView,
    canApprove: manager,
  };
}

export function isTaskManager(context: Pick<TaskAccessContext, "apiRole">) {
  return TASK_MANAGER_ROLES.has(context.apiRole.trim().toUpperCase());
}

export function taskRecipientPrincipals(context: TaskAccessContext) {
  const values = [
    context.appUserId.trim(),
    context.apiRole.trim() ? `ROLE:${context.apiRole.trim().toUpperCase()}` : "",
  ];
  return values.filter((value, index) => value && values.findIndex((candidate) => samePrincipal(candidate, value)) === index);
}

/**
 * Only global task managers may attach a user-created task to a system source
 * or create a system task kind. Other users always create a manual task, even
 * if the client sends forged provenance fields.
 */
export function resolveTaskProvenance(
  context: TaskAccessContext,
  requestedSourceType: unknown,
  requestedSourceId: unknown,
  requestedKind: unknown,
) {
  const requested = {
    sourceType: cleanPrincipal(requestedSourceType) || "Ручная задача",
    sourceId: cleanPrincipal(requestedSourceId) || "MANUAL",
    kind: cleanPrincipal(requestedKind) || "Задача",
  };
  if (isTaskManager(context)) return requested;
  return {
    sourceType: "Ручная задача",
    sourceId: "MANUAL",
    kind: requested.kind === "Поручение" ? "Поручение" : "Задача",
  };
}

export function scopedAutomationTaskResponse<T extends TaskAccessRow>(result: ScopedTaskResult<T>) {
  if (result.state === "visible") return Response.json({ task: result.task, reused: true });
  if (result.state === "hidden") {
    return Response.json({ error: "Связанная задача уже существует" }, { status: 409 });
  }
  return null;
}

/**
 * Domain records may retain a task foreign key even when that task is outside
 * the caller's row scope. Redact that key so the UI neither leaks a foreign
 * task id nor renders a dead link to an inaccessible task.
 */
export function redactHiddenTaskReferences<T extends { relatedTaskId: number | null }>(
  rows: T[],
  visibleTasks: Array<{ id: number }>,
) {
  const visibleTaskIds = new Set(visibleTasks.map((task) => task.id));
  return rows.map((row) => row.relatedTaskId !== null && !visibleTaskIds.has(row.relatedTaskId)
    ? { ...row, relatedTaskId: null }
    : row);
}

export function resolveTaskAssignment(
  context: TaskAccessContext,
  requestedAssigneeEntityId: unknown,
  requestedOwner: unknown = "",
):
  | { ok: true; assigneeEntityId: string; owner: string }
  | { ok: false; status: 403; error: string } {
  const requestedAssignee = cleanPrincipal(requestedAssigneeEntityId).toUpperCase();
  if (isTaskManager(context)) {
    return {
      ok: true,
      assigneeEntityId: requestedAssignee,
      owner: typeof requestedOwner === "string" ? requestedOwner.trim() : "",
    };
  }
  if (requestedAssignee && !samePrincipal(requestedAssignee, context.appUserId)) {
    return { ok: false, status: 403, error: "Можно создавать задачи только для себя" };
  }
  return {
    ok: true,
    assigneeEntityId: context.appUserId.trim().toUpperCase(),
    owner: context.appUserName.trim(),
  };
}

export function samePrincipal(left: unknown, right: unknown) {
  const normalizedLeft = cleanPrincipal(left).toLocaleLowerCase("en-US");
  const normalizedRight = cleanPrincipal(right).toLocaleLowerCase("en-US");
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function cleanPrincipal(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
