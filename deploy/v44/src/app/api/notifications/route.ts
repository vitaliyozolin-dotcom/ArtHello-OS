import { eq, sql } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { notifications } from "../../../db/schema";
import { getRequestUser } from "../../../lib/request-user";

export async function PATCH(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Некорректное уведомление" }, { status: 400 });
    const changed = await getDb().update(notifications).set({ status: "Прочитано", readAt: sql`CURRENT_TIMESTAMP` }).where(eq(notifications.id, id)).returning();
    if (!changed.length) return Response.json({ error: "Уведомление не найдено" }, { status: 404 });
    return Response.json({ notification: changed[0] });
  } catch { return Response.json({ error: "Уведомление не обновлено" }, { status: 503 }); }
}
