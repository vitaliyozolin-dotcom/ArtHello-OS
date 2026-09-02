import { and, eq, sql } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, entities, notifications, taskApprovals, taskChecklist, taskComments, taskDocuments, tasks, taskWatchers, workflowDocuments } from "../../../db/schema";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { isTaskManager, samePrincipal, taskAccessDecision } from "../../../lib/task-access";

export async function POST(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const actor = context.actor;
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const action = clean(body.action, 40);
    const taskId = Number(body.taskId);
    if (!Number.isInteger(taskId) || taskId < 1) return Response.json({ error: "Некорректная задача" }, { status: 400 });
    const db = getDb();
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) return Response.json({ error: "Задача не найдена" }, { status: 404 });
    const watcherRows = await db.select({ entityId: taskWatchers.entityId }).from(taskWatchers).where(eq(taskWatchers.taskId, taskId));
    const access = taskAccessDecision(context, task, watcherRows);
    if (!access.canView) return Response.json({ error: "Задача не найдена" }, { status: 404 });

    if (action === "comment") {
      if (!access.canComment) return Response.json({ error: "Нет прав комментировать эту задачу" }, { status: 403 });
      const value = clean(body.body, 1200);
      if (value.length < 2) return Response.json({ error: "Введите комментарий" }, { status: 400 });
      const [comment] = await db.insert(taskComments).values({ taskId, body: value, createdBy: actor }).returning();
      await audit(db, actor, taskId, "task.comment_added", { commentId: comment.id });
      return Response.json({ ok: true });
    }
    if (action === "watcher") {
      if (!access.canManage) return Response.json({ error: "Нет прав менять участников этой задачи" }, { status: 403 });
      const entityId = clean(body.entityId, 40).toUpperCase();
      if (!entityId) return Response.json({ error: "Выберите наблюдателя" }, { status: 400 });
      if (entityId.startsWith("ROLE:") && !isTaskManager(context)) {
        return Response.json({ error: "Только руководитель может добавить роль в наблюдатели" }, { status: 403 });
      }
      if (!entityId.startsWith("ROLE:") && !samePrincipal(entityId, context.appUserId)) {
        const [entity] = await db.select({ id: entities.id, status: entities.status }).from(entities).where(eq(entities.id, entityId)).limit(1);
        if (!entity || entity.status === "Объединена") return Response.json({ error: "Наблюдатель не найден" }, { status: 404 });
      }
      await db.insert(taskWatchers).values({ taskId, entityId, createdBy: actor });
      await audit(db, actor, taskId, "task.watcher_added", { entityId });
      return Response.json({ ok: true });
    }
    if (action === "checklist_add") {
      if (!access.canManage) return Response.json({ error: "Нет прав менять чек-лист этой задачи" }, { status: 403 });
      const title = clean(body.title, 180);
      if (title.length < 3) return Response.json({ error: "Опишите пункт чек-листа" }, { status: 400 });
      const [item] = await db.insert(taskChecklist).values({ taskId, title, createdBy: actor }).returning();
      await audit(db, actor, taskId, "task.checklist_added", { checklistId: item.id, title });
      return Response.json({ ok: true });
    }
    if (action === "checklist_toggle") {
      if (!access.canManage) return Response.json({ error: "Нет прав менять чек-лист этой задачи" }, { status: 403 });
      const checklistId = Number(body.checklistId);
      const isDone = body.isDone === true;
      const changed = await db.update(taskChecklist).set({ isDone, updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(taskChecklist.id, checklistId), eq(taskChecklist.taskId, taskId))).returning();
      if (!changed.length) return Response.json({ error: "Пункт не найден" }, { status: 404 });
      await audit(db, actor, taskId, "task.checklist_changed", { checklistId, isDone });
      return Response.json({ ok: true });
    }
    if (action === "approval") {
      if (!new Set(["OWNER", "DIRECTOR"]).has(context.apiRole) || !access.canApprove) {
        return Response.json({ error: "Недостаточно прав для решения согласования" }, { status: 403 });
      }
      if (task.status !== "На проверке") return Response.json({ error: "Согласование доступно после передачи результата на проверку" }, { status: 409 });
      const status = clean(body.status, 40);
      const comment = clean(body.comment, 400);
      if (!new Set(["Согласовано", "Отклонено"]).has(status)) return Response.json({ error: "Некорректное решение" }, { status: 400 });
      if (status === "Отклонено" && comment.length < 8) return Response.json({ error: "Для отклонения нужен комментарий" }, { status: 400 });
      const changed = await db.update(taskApprovals).set({ status, decidedBy: actor, comment, updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(taskApprovals.taskId, taskId), eq(taskApprovals.status, "Ожидает"))).returning();
      if (!changed.length) return Response.json({ error: "Ожидающее согласование не найдено" }, { status: 409 });
      await audit(db, actor, taskId, "task.approval_decided", { status, comment });
      const notificationRecipient = task.assigneeEntityId || task.createdByUserId;
      if (notificationRecipient) {
        await db.insert(notifications).values({ recipientEntityId: notificationRecipient, notificationType: "Согласование", title: `${task.title}: ${status}`, body: comment || "Решение руководителя сохранено.", sourceType: "task", sourceId: String(taskId) });
      }
      return Response.json({ ok: true });
    }
    if (action === "document_link") {
      if (!access.canManage) return Response.json({ error: "Нет прав связывать документы с этой задачей" }, { status: 403 });
      const documentId = clean(body.documentId, 40).toUpperCase();
      const [document] = await db.select().from(workflowDocuments).where(eq(workflowDocuments.id, documentId)).limit(1);
      if (!document) return Response.json({ error: "Документ не найден" }, { status: 404 });
      if (!isTaskManager(context) && !samePrincipal(document.ownerEntityId, context.appUserId)) {
        return Response.json({ error: "Документ не найден" }, { status: 404 });
      }
      await db.insert(taskDocuments).values({ taskId, documentId, createdBy: actor });
      await audit(db, actor, taskId, "task.document_linked", { documentId });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed")) return Response.json({ error: "Эта связь уже существует" }, { status: 409 });
    return Response.json({ error: "Действие не выполнено" }, { status: 503 });
  }
}

async function audit(db: ReturnType<typeof getDb>, actor: string, taskId: number, action: string, payload: Record<string, unknown>) {
  await db.insert(auditEvents).values({ actor, action, entityType: "task", entityId: String(taskId), payload: JSON.stringify(payload) });
}

function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
