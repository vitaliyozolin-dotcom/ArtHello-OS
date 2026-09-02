import { or, sql } from "drizzle-orm";

import type { getDb } from "../db";
import { tasks, taskWatchers } from "../db/schema";
import {
  isTaskManager,
  taskAccessDecision,
  type ScopedTaskResult,
  type TaskAccessContext,
} from "./task-access";

export { redactHiddenTaskReferences, scopedAutomationTaskResponse } from "./task-access";

type Db = ReturnType<typeof getDb>;

/** Database predicate shared by every task list and relationship query. */
export function taskVisibilityCondition(context: TaskAccessContext) {
  if (isTaskManager(context)) return undefined;
  const userPrincipal = context.appUserId.trim();
  // Authenticated contexts normally always contain a stable app-user id. Keep
  // the row policy fail-closed if a damaged/legacy session ever omits it: an
  // empty principal must not match legacy tasks whose owner id is also empty.
  if (!userPrincipal) return sql<boolean>`0 = 1`;
  const rolePrincipal = context.apiRole.trim() ? `ROLE:${context.apiRole.trim().toUpperCase()}` : "ROLE:UNKNOWN";
  return or(
    sql<boolean>`lower(${tasks.createdByUserId}) = lower(${userPrincipal})`,
    sql<boolean>`lower(${tasks.assigneeEntityId}) = lower(${userPrincipal})`,
    sql<boolean>`exists (
      select 1 from ${taskWatchers}
      where ${taskWatchers.taskId} = ${tasks.id}
        and (
          lower(${taskWatchers.entityId}) = lower(${userPrincipal})
          or lower(${taskWatchers.entityId}) = lower(${rolePrincipal})
        )
    )`,
  );
}

/** Shared task list for domain endpoints that embed task rows in their payload. */
export function selectVisibleTasks(db: Db, context: TaskAccessContext) {
  const visibility = taskVisibilityCondition(context);
  return visibility
    ? db.select().from(tasks).where(visibility)
    : db.select().from(tasks);
}

/**
 * Automation keys are global and unique. A caller must distinguish a missing
 * row from an existing row it cannot see: the latter may not be returned or
 * recreated under another user's identity.
 */
export async function findScopedAutomationTask(
  db: Db,
  context: TaskAccessContext,
  automationKey: string,
): Promise<ScopedTaskResult<typeof tasks.$inferSelect>> {
  const [task] = await db.select().from(tasks).where(sql`${tasks.automationKey} = ${automationKey}`).limit(1);
  if (!task) return { state: "missing" };
  if (isTaskManager(context)) return { state: "visible", task };
  const watchers = await db.select({ entityId: taskWatchers.entityId })
    .from(taskWatchers)
    .where(sql`${taskWatchers.taskId} = ${task.id}`);
  return taskAccessDecision(context, task, watchers).canView
    ? { state: "visible", task }
    : { state: "hidden" };
}
