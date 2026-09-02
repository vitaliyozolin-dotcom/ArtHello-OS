import { and, desc, eq, sql } from "drizzle-orm";
import { ensureCoreTables, getDb, getSystemDataMode } from "../../../db";
import { auditEvents, entities, notifications, taskApprovals, taskChecklist, tasks, taskWatchers } from "../../../db/schema";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { isTaskManager, resolveTaskAssignment, resolveTaskProvenance, taskAccessDecision } from "../../../lib/task-access";
import { taskVisibilityCondition } from "../../../lib/task-access-query";
import { getNextTaskStatus, nextRecurrenceDate } from "../../../lib/workflow";

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
    const mode = await getSystemDataMode();
    const db = getDb();
    const visibility = taskVisibilityCondition(context);
    const storedRows = visibility
      ? await db.select().from(tasks).where(visibility).orderBy(desc(tasks.createdAt), desc(tasks.id)).limit(100)
      : await db.select().from(tasks).orderBy(desc(tasks.createdAt), desc(tasks.id)).limit(100);
    const rows = mode === "source_only"
      ? storedRows.filter((row) => !row.createdBy.startsWith("system-"))
      : storedRows;
    return Response.json({ tasks: rows });
  } catch (error) {
    return databaseError(error);
  }
}

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
    const title = clean(body.title, 180);
    const requestedOwner = clean(body.owner, 120);
    const dueDate = clean(body.dueDate, 20);
    const priority = clean(body.priority, 24) || "Средний";
    const description = clean(body.description, 1200);
    const assignment = resolveTaskAssignment(context, clean(body.assigneeEntityId, 40), requestedOwner);
    if (!assignment.ok) return Response.json({ error: assignment.error }, { status: assignment.status });
    const { assigneeEntityId, owner } = assignment;
    const { sourceType, sourceId, kind } = resolveTaskProvenance(
      context,
      clean(body.sourceType, 80),
      clean(body.sourceId, 80),
      clean(body.kind, 40),
    );
    const recurrenceRule = clean(body.recurrenceRule, 40);
    const parentTaskId = body.parentTaskId ? Number(body.parentTaskId) : null;
    const requiresApproval = parseBoolean(body.requiresApproval);
    if (title.length < 4) return Response.json({ error: "Опишите задачу минимум четырьмя символами" }, { status: 400 });
    if (!owner) return Response.json({ error: "Укажите ответственного" }, { status: 400 });
    if (!new Set(["Высокий", "Средний", "Низкий"]).has(priority)) return Response.json({ error: "Некорректный приоритет" }, { status: 400 });
    if (!new Set(["Задача", "Поручение", "Автозадача"]).has(kind)) return Response.json({ error: "Некорректный тип работы" }, { status: 400 });
    if (recurrenceRule && !new Set(["Каждую неделю", "Каждый месяц"]).has(recurrenceRule)) return Response.json({ error: "Некорректное правило повтора" }, { status: 400 });
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return Response.json({ error: "Некорректный срок" }, { status: 400 });

    const db = getDb();
    if (assigneeEntityId && isTaskManager(context)) {
      const [assignee] = await db.select().from(entities).where(eq(entities.id, assigneeEntityId)).limit(1);
      if (!assignee || assignee.status === "Объединена") return Response.json({ error: "Ответственный не найден в едином справочнике" }, { status: 409 });
    }
    if (parentTaskId) {
      const [parent] = await db.select().from(tasks).where(eq(tasks.id, parentTaskId)).limit(1);
      if (!parent) return Response.json({ error: "Родительская задача не найдена" }, { status: 409 });
      const watcherRows = await db.select({ entityId: taskWatchers.entityId }).from(taskWatchers).where(eq(taskWatchers.taskId, parentTaskId));
      const access = taskAccessDecision(context, parent, watcherRows);
      if (!access.canView) return Response.json({ error: "Родительская задача не найдена" }, { status: 404 });
      if (!access.canManage) return Response.json({ error: "Нет прав создавать подзадачу" }, { status: 403 });
    }
    const [task] = await db.insert(tasks).values({
      title, owner, dueDate, priority, sourceType, sourceId, description, assigneeEntityId,
      parentTaskId, kind, recurrenceRule, requiresApproval,
      createdByUserId: context.appUserId,
      createdBy: actor,
    }).returning();
    if (requiresApproval) await db.insert(taskApprovals).values({ taskId: task.id, stepName: "Решение руководителя" });
    await db.insert(auditEvents).values({ actor, action: "task.created", entityType: "task", entityId: String(task.id), payload: JSON.stringify({ sourceType, sourceId, assigneeEntityId, parentTaskId, kind, recurrenceRule, requiresApproval }) });
    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return databaseError(error);
  }
}

export async function PATCH(request: Request) {
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
    const id = Number(body.id);
    const status = clean(body.status, 40);
    const expectedUpdatedAt = clean(body.expectedUpdatedAt, 80);
    const result = clean(body.result, 1200);
    const resultEvidence = clean(body.resultEvidence, 400);
    if (!Number.isInteger(id) || id < 1 || !status || !expectedUpdatedAt) {
      return Response.json({ error: "Некорректные параметры изменения задачи" }, { status: 400 });
    }

    const db = getDb();
    const [current] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!current) return Response.json({ error: "Задача не найдена" }, { status: 404 });
    const watcherRows = await db.select({ entityId: taskWatchers.entityId }).from(taskWatchers).where(eq(taskWatchers.taskId, id));
    const access = taskAccessDecision(context, current, watcherRows);
    if (!access.canView) return Response.json({ error: "Задача не найдена" }, { status: 404 });
    if (!access.canManage) return Response.json({ error: "Нет прав изменять эту задачу" }, { status: 403 });
    const nextStatus = getNextTaskStatus(current.status);
    if (status !== nextStatus) {
      return Response.json({ error: `Допустимый следующий статус: ${nextStatus || "переходов нет"}` }, { status: 409 });
    }

    if (status === "На проверке" && result.length < 8) {
      return Response.json({ error: "Перед проверкой опишите результат минимум восемью символами" }, { status: 409 });
    }
    if (status === "Выполнено") {
      const incompleteChecklist = await db.select().from(taskChecklist).where(and(eq(taskChecklist.taskId, id), eq(taskChecklist.isDone, false))).limit(1);
      if (incompleteChecklist.length) return Response.json({ error: "Сначала завершите чек-лист" }, { status: 409 });
      // Completion integrity applies to every child, including one that the
      // caller cannot inspect. For a non-manager keep the response generic so
      // this check does not disclose another user's task structure.
      const incompleteChildren = await db.select({ id: tasks.id }).from(tasks)
        .where(and(eq(tasks.parentTaskId, id), sql`${tasks.status} <> 'Выполнено'`)).limit(1);
      if (incompleteChildren.length) {
        return Response.json({
          error: isTaskManager(context) ? "Сначала завершите подзадачи" : "Задачу пока нельзя завершить",
        }, { status: 409 });
      }
      if (current.requiresApproval) {
        const approval = await db.select().from(taskApprovals).where(and(eq(taskApprovals.taskId, id), eq(taskApprovals.status, "Согласовано"))).limit(1);
        if (!approval.length) return Response.json({ error: "Результат должен согласовать руководитель" }, { status: 409 });
      }
    }

    const updated = await db.update(tasks)
      .set({
        status,
        result: status === "На проверке" ? result : current.result,
        resultEvidence: status === "На проверке" ? resultEvidence : current.resultEvidence,
        completedAt: status === "Выполнено" ? sql`CURRENT_TIMESTAMP` : current.completedAt,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(tasks.id, id), eq(tasks.updatedAt, expectedUpdatedAt)))
      .returning();
    if (updated.length === 0) {
      return Response.json({ error: "Задача уже была изменена. Обновите список." }, { status: 409 });
    }
    await db.insert(auditEvents).values({
      actor,
      action: "task.status_changed",
      entityType: "task",
      entityId: String(id),
      payload: JSON.stringify({ from: current.status, to: status }),
    });
    const notificationRecipient = current.assigneeEntityId || current.createdByUserId;
    if (notificationRecipient) {
      await db.insert(notifications).values({
        recipientEntityId: notificationRecipient,
        notificationType: "Статус задачи",
        title: `${current.title}: ${status}`,
        body: status === "На проверке" ? "Результат передан на подтверждение." : `Статус изменён: ${current.status} → ${status}.`,
        sourceType: "task",
        sourceId: String(id),
      });
    }
    if (status === "Выполнено" && current.recurrenceRule) {
      const nextDueDate = nextRecurrenceDate(current.dueDate, current.recurrenceRule);
      const [nextTask] = await db.insert(tasks).values({
        title: current.title, owner: current.owner, dueDate: nextDueDate, priority: current.priority,
        sourceType: "Повторяющаяся задача", sourceId: `TASK:${id}`, description: current.description,
        assigneeEntityId: current.assigneeEntityId, kind: current.kind, recurrenceRule: current.recurrenceRule,
        requiresApproval: current.requiresApproval,
        createdByUserId: context.appUserId,
        createdBy: actor,
      }).returning();
      if (current.requiresApproval) await db.insert(taskApprovals).values({ taskId: nextTask.id, stepName: "Решение руководителя" });
      await db.insert(auditEvents).values({ actor: "system-automation", action: "task.recurrence_created", entityType: "task", entityId: String(nextTask.id), payload: JSON.stringify({ previousTaskId: id, recurrenceRule: current.recurrenceRule }) });
    }
    return Response.json({ task: updated[0] });
  } catch (error) {
    return databaseError(error);
  }
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseBoolean(value: unknown) {
  return value === true || value === "true" || value === "on" || value === 1;
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Ошибка базы данных";
  const unavailable = message.includes("no such table") || message.includes("D1 binding");
  return Response.json({ error: unavailable ? "Хранилище задач ещё не подготовлено" : "Не удалось выполнить операцию" }, { status: 503 });
}
