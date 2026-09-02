import { and, asc, desc, eq, inArray, ne, or } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import {
  auditEvents, documentVersions, entities, escalations, notifications, obligations,
  taskApprovals, taskChecklist, taskComments, taskDocuments, tasks, taskWatchers, workflowDocuments,
} from "../../../db/schema";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import {
  isTaskManager, samePrincipal, taskAccessDecision, taskRecipientPrincipals,
  type TaskAccessContext,
} from "../../../lib/task-access";
import { taskVisibilityCondition } from "../../../lib/task-access-query";

type Db = ReturnType<typeof getDb>;

export async function GET(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });

  try {
    await ensureCoreTables();
    const db = getDb();
    const id = Number(new URL(request.url).searchParams.get("id") || 0);
    if (id) return detail(db, id, context);

    const visibility = taskVisibilityCondition(context);
    const taskRows = visibility
      ? await db.select().from(tasks).where(visibility).orderBy(desc(tasks.priority), asc(tasks.dueDate), desc(tasks.id)).limit(200)
      : await db.select().from(tasks).orderBy(desc(tasks.priority), asc(tasks.dueDate), desc(tasks.id)).limit(200);
    const taskIds = taskRows.map((task) => task.id);
    const [notificationRows, escalationRows, documentRows, obligationRows, employeeRows, pendingApprovals] = await Promise.all([
      scopedNotifications(db, context, taskIds),
      scopedEscalations(db, context, taskIds),
      scopedDocuments(db, context, taskIds),
      scopedObligations(db, context, taskIds),
      scopedAssignees(db, context),
      scopedPendingApprovals(db, context, taskIds),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    return Response.json({
      tasks: taskRows,
      notifications: notificationRows,
      escalations: escalationRows,
      documents: documentRows,
      obligations: obligationRows,
      assignees: employeeRows,
      permissions: {
        canManageAll: isTaskManager(context),
        canApprove: isTaskManager(context),
        canManageDocuments: canManageWorkflowDocuments(context),
      },
      stats: {
        open: taskRows.filter((task) => task.status !== "Выполнено").length,
        overdue: taskRows.filter((task) => task.status !== "Выполнено" && task.dueDate && task.dueDate < today).length,
        waitingApproval: pendingApprovals.filter((approval) => taskRows.find((task) => task.id === approval.taskId)?.status === "На проверке").length,
        escalations: escalationRows.filter((item) => item.status === "Открыта").length,
      },
    });
  } catch {
    return Response.json({ error: "Не удалось загрузить рабочие процессы" }, { status: 503 });
  }
}

async function detail(db: Db, id: number, context: TaskAccessContext) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return Response.json({ error: "Задача не найдена" }, { status: 404 });

  const watcherRows = await db.select().from(taskWatchers).where(eq(taskWatchers.taskId, id)).orderBy(asc(taskWatchers.createdAt));
  const access = taskAccessDecision(context, task, watcherRows);
  if (!access.canView) return Response.json({ error: "Задача не найдена" }, { status: 404 });

  const visibility = taskVisibilityCondition(context);
  const subtasksPromise = visibility
    ? db.select().from(tasks).where(and(eq(tasks.parentTaskId, id), visibility)).orderBy(asc(tasks.createdAt))
    : db.select().from(tasks).where(eq(tasks.parentTaskId, id)).orderBy(asc(tasks.createdAt));
  const visibleWatchers = isTaskManager(context)
    ? watcherRows
    : watcherRows.filter((watcher) => taskRecipientPrincipals(context).some((principal) => samePrincipal(watcher.entityId, principal)));

  const [subtasks, checklist, comments, approvals, linked, history, employeeRows] = await Promise.all([
    subtasksPromise,
    db.select().from(taskChecklist).where(eq(taskChecklist.taskId, id)).orderBy(asc(taskChecklist.id)),
    db.select().from(taskComments).where(eq(taskComments.taskId, id)).orderBy(desc(taskComments.createdAt), desc(taskComments.id)).limit(100),
    db.select().from(taskApprovals).where(eq(taskApprovals.taskId, id)).orderBy(asc(taskApprovals.id)),
    db.select().from(taskDocuments).where(eq(taskDocuments.taskId, id)),
    db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "task"), eq(auditEvents.entityId, String(id)))).orderBy(desc(auditEvents.createdAt), desc(auditEvents.id)).limit(100),
    scopedAssignees(db, context),
  ]);
  const documentIds = linked.map((item) => item.documentId);
  const linkedDocuments = documentIds.length ? await db.select().from(workflowDocuments).where(inArray(workflowDocuments.id, documentIds)) : [];
  const versions = documentIds.length ? await db.select().from(documentVersions).where(inArray(documentVersions.documentId, documentIds)).orderBy(desc(documentVersions.version)) : [];
  const watcherIds = visibleWatchers.map((item) => item.entityId).filter((item) => !item.startsWith("ROLE:"));
  const watcherEntities = watcherIds.length
    ? await db.select().from(entities).where(inArray(entities.id, watcherIds))
    : [];
  const [parent] = task.parentTaskId
    ? visibility
      ? await db.select().from(tasks).where(and(eq(tasks.id, task.parentTaskId), visibility)).limit(1)
      : await db.select().from(tasks).where(eq(tasks.id, task.parentTaskId)).limit(1)
    : [];
  return Response.json({
    task,
    parent: parent || null,
    subtasks,
    watchers: visibleWatchers.map((watcher) => ({ ...watcher, entity: watcherEntities.find((entity) => entity.id === watcher.entityId) || null })),
    checklist,
    comments,
    approvals,
    documents: linkedDocuments.map((document) => ({ ...document, versions: versions.filter((version) => version.documentId === document.id) })),
    history,
    assignees: employeeRows,
    permissions: access,
  });
}

async function scopedNotifications(db: Db, context: TaskAccessContext, taskIds: number[]) {
  if (isTaskManager(context)) {
    return db.select().from(notifications).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(100);
  }
  const visibleTaskSources = taskIds.map(String);
  const sourceAccess = visibleTaskSources.length
    ? or(ne(notifications.sourceType, "task"), inArray(notifications.sourceId, visibleTaskSources))
    : ne(notifications.sourceType, "task");
  return db.select().from(notifications)
    .where(and(
      inArray(notifications.recipientEntityId, taskRecipientPrincipals(context)),
      sourceAccess,
    ))
    .orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(100);
}

async function scopedEscalations(db: Db, context: TaskAccessContext, taskIds: number[]) {
  if (isTaskManager(context)) {
    return db.select().from(escalations).orderBy(desc(escalations.createdAt), desc(escalations.id)).limit(100);
  }
  if (!taskIds.length) return [] as Array<typeof escalations.$inferSelect>;
  return db.select().from(escalations)
    .where(and(
      inArray(escalations.taskId, taskIds),
      inArray(escalations.recipientEntityId, taskRecipientPrincipals(context)),
    ))
    .orderBy(desc(escalations.createdAt), desc(escalations.id)).limit(100);
}

async function scopedDocuments(db: Db, context: TaskAccessContext, taskIds: number[]) {
  if (isTaskManager(context)) {
    return db.select().from(workflowDocuments).orderBy(asc(workflowDocuments.validUntil), asc(workflowDocuments.id)).limit(100);
  }
  const links = taskIds.length
    ? await db.select({ documentId: taskDocuments.documentId }).from(taskDocuments).where(inArray(taskDocuments.taskId, taskIds))
    : [];
  const linkedIds = [...new Set(links.map((item) => item.documentId))];
  const access = linkedIds.length
    ? or(
      inArray(workflowDocuments.id, linkedIds),
      eq(workflowDocuments.ownerEntityId, context.appUserId),
    )
    : eq(workflowDocuments.ownerEntityId, context.appUserId);
  return db.select().from(workflowDocuments).where(access).orderBy(asc(workflowDocuments.validUntil), asc(workflowDocuments.id)).limit(100);
}

async function scopedObligations(db: Db, context: TaskAccessContext, taskIds: number[]) {
  if (isTaskManager(context)) {
    return db.select().from(obligations).orderBy(asc(obligations.dueDate), asc(obligations.id)).limit(100);
  }
  const documents = await scopedDocuments(db, context, taskIds);
  const documentIds = documents.map((document) => document.id);
  const access = documentIds.length
    ? or(
      inArray(obligations.documentId, documentIds),
      eq(obligations.ownerEntityId, context.appUserId),
    )
    : eq(obligations.ownerEntityId, context.appUserId);
  return db.select().from(obligations).where(access).orderBy(asc(obligations.dueDate), asc(obligations.id)).limit(100);
}

async function scopedAssignees(db: Db, context: TaskAccessContext) {
  if (isTaskManager(context)) {
    const rows = await db.select({ id: entities.id, displayName: entities.displayName, status: entities.status })
      .from(entities).where(eq(entities.entityType, "Сотрудник")).orderBy(asc(entities.displayName)).limit(100);
    return rows.filter((row) => row.status !== "Объединена").map(({ id, displayName }) => ({ id, displayName }));
  }
  const [employee] = await db.select({ id: entities.id, displayName: entities.displayName, status: entities.status })
    .from(entities).where(and(eq(entities.id, context.appUserId), eq(entities.entityType, "Сотрудник"))).limit(1);
  if (employee && employee.status !== "Объединена") return [{ id: employee.id, displayName: employee.displayName }];
  return [{ id: context.appUserId, displayName: context.appUserName }];
}

async function scopedPendingApprovals(db: Db, context: TaskAccessContext, taskIds: number[]) {
  if (isTaskManager(context)) return db.select().from(taskApprovals).where(eq(taskApprovals.status, "Ожидает")).limit(200);
  if (!taskIds.length) return [] as Array<typeof taskApprovals.$inferSelect>;
  return db.select().from(taskApprovals)
    .where(and(eq(taskApprovals.status, "Ожидает"), inArray(taskApprovals.taskId, taskIds))).limit(200);
}

function canManageWorkflowDocuments(context: TaskAccessContext) {
  return new Set(["OWNER", "DIRECTOR", "ADMIN", "HR", "LEGAL", "ACCOUNTING", "PROCUREMENT"]).has(context.apiRole);
}
