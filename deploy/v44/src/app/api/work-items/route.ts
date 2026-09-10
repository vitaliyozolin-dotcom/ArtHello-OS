import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import {
  auditEvents, documentVersions, entities, escalations, notifications, obligations,
  taskApprovals, taskChecklist, taskComments, taskDocuments, tasks, taskWatchers, workflowDocuments,
} from "../../../db/schema";
import { getRequestUser } from "../../../lib/request-user";

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const id = Number(new URL(request.url).searchParams.get("id") || 0);
    if (id) return detail(db, id);

    const [taskRows, notificationRows, escalationRows, documentRows, obligationRows, employeeRows, pendingApprovals] = await Promise.all([
      db.select().from(tasks).orderBy(desc(tasks.priority), asc(tasks.dueDate), desc(tasks.id)).limit(200),
      db.select().from(notifications).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(100),
      db.select().from(escalations).orderBy(desc(escalations.createdAt), desc(escalations.id)).limit(100),
      db.select().from(workflowDocuments).orderBy(asc(workflowDocuments.validUntil), asc(workflowDocuments.id)).limit(100),
      db.select().from(obligations).orderBy(asc(obligations.dueDate), asc(obligations.id)).limit(100),
      db.select().from(entities).where(eq(entities.entityType, "Сотрудник")).orderBy(asc(entities.displayName)).limit(100),
      db.select().from(taskApprovals).where(eq(taskApprovals.status, "Ожидает")).limit(200),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    return Response.json({
      tasks: taskRows,
      notifications: notificationRows,
      escalations: escalationRows,
      documents: documentRows,
      obligations: obligationRows,
      assignees: employeeRows.filter((row) => row.status !== "Объединена"),
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

async function detail(db: ReturnType<typeof getDb>, id: number) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return Response.json({ error: "Задача не найдена" }, { status: 404 });
  const [subtasks, watchers, checklist, comments, approvals, linked, history, employeeRows] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.parentTaskId, id)).orderBy(asc(tasks.createdAt)),
    db.select().from(taskWatchers).where(eq(taskWatchers.taskId, id)).orderBy(asc(taskWatchers.createdAt)),
    db.select().from(taskChecklist).where(eq(taskChecklist.taskId, id)).orderBy(asc(taskChecklist.id)),
    db.select().from(taskComments).where(eq(taskComments.taskId, id)).orderBy(desc(taskComments.createdAt), desc(taskComments.id)).limit(100),
    db.select().from(taskApprovals).where(eq(taskApprovals.taskId, id)).orderBy(asc(taskApprovals.id)),
    db.select().from(taskDocuments).where(eq(taskDocuments.taskId, id)),
    db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "task"), eq(auditEvents.entityId, String(id)))).orderBy(desc(auditEvents.createdAt), desc(auditEvents.id)).limit(100),
    db.select().from(entities).where(eq(entities.entityType, "Сотрудник")).orderBy(asc(entities.displayName)),
  ]);
  const documentIds = linked.map((item) => item.documentId);
  const linkedDocuments = documentIds.length ? await db.select().from(workflowDocuments).where(inArray(workflowDocuments.id, documentIds)) : [];
  const versions = documentIds.length ? await db.select().from(documentVersions).where(inArray(documentVersions.documentId, documentIds)).orderBy(desc(documentVersions.version)) : [];
  const watcherIds = watchers.map((item) => item.entityId).filter((item) => !item.startsWith("ROLE:"));
  const watcherEntities = watcherIds.length ? await db.select().from(entities).where(inArray(entities.id, watcherIds)) : [];
  const [parent] = task.parentTaskId ? await db.select().from(tasks).where(eq(tasks.id, task.parentTaskId)).limit(1) : [];
  return Response.json({
    task,
    parent: parent || null,
    subtasks,
    watchers: watchers.map((watcher) => ({ ...watcher, entity: watcherEntities.find((entity) => entity.id === watcher.entityId) || null })),
    checklist,
    comments,
    approvals,
    documents: linkedDocuments.map((document) => ({ ...document, versions: versions.filter((version) => version.documentId === document.id) })),
    history,
    assignees: employeeRows.filter((row) => row.status !== "Объединена"),
  });
}
