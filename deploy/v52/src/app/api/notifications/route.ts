import { and, eq, inArray, sql } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { notifications } from "../../../db/schema";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { isTaskManager, taskRecipientPrincipals } from "../../../lib/task-access";
import { selectVisibleTasks } from "../../../lib/task-access-query";

export async function PATCH(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Некорректное уведомление" }, { status: 400 });
    const notificationAccess = isTaskManager(context)
      ? eq(notifications.id, id)
      : and(
        eq(notifications.id, id),
        inArray(notifications.recipientEntityId, taskRecipientPrincipals(context)),
      );
    const db = getDb();
    const [candidate] = await db.select().from(notifications).where(notificationAccess).limit(1);
    if (!candidate) return Response.json({ error: "Уведомление не найдено" }, { status: 404 });
    if (!isTaskManager(context) && candidate.sourceType === "task") {
      const taskId = Number(candidate.sourceId);
      const visibleTasks = Number.isInteger(taskId) && taskId > 0 ? await selectVisibleTasks(db, context) : [];
      if (!visibleTasks.some((task) => task.id === taskId)) {
        return Response.json({ error: "Уведомление не найдено" }, { status: 404 });
      }
    }
    const changed = await db.update(notifications)
      .set({ status: "Прочитано", readAt: sql`CURRENT_TIMESTAMP` })
      .where(notificationAccess).returning();
    if (!changed.length) return Response.json({ error: "Уведомление не найдено" }, { status: 404 });
    return Response.json({ notification: changed[0] });
  } catch { return Response.json({ error: "Уведомление не обновлено" }, { status: 503 }); }
}
