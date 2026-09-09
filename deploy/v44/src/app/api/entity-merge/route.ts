import { and, eq, inArray, sql } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, entities, entityMerges } from "../../../db/schema";
import { getRequestUser } from "../../../lib/request-user";

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const survivorId = clean(body.survivorId, 24).toUpperCase();
    const duplicateId = clean(body.duplicateId, 24).toUpperCase();
    const reason = clean(body.reason, 240);
    if (!survivorId || !duplicateId || survivorId === duplicateId || reason.length < 8) return Response.json({ error: "Укажите дубль и причину объединения" }, { status: 400 });
    const db = getDb();
    const cards = await db.select().from(entities).where(inArray(entities.id, [survivorId, duplicateId]));
    if (cards.length !== 2) return Response.json({ error: "Одна из карточек не найдена" }, { status: 404 });
    const survivor = cards.find((card) => card.id === survivorId)!;
    const duplicate = cards.find((card) => card.id === duplicateId)!;
    if (survivor.entityType !== duplicate.entityType) return Response.json({ error: "Объединять можно только карточки одного типа" }, { status: 409 });
    if (survivor.status === "Объединена" || duplicate.status === "Объединена") return Response.json({ error: "Одна из карточек уже объединена" }, { status: 409 });
    const [merge] = await db.insert(entityMerges).values({ survivorId, duplicateId, reason, createdBy: actor }).returning();
    await db.update(entities).set({ status: "Объединена", updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(entities.id, duplicateId), eq(entities.status, duplicate.status)));
    await db.insert(auditEvents).values({ actor, action: "entity.merge_survivor", entityType: "entity", entityId: survivorId, payload: JSON.stringify({ duplicateId, reason }) });
    await db.insert(auditEvents).values({ actor, action: "entity.merged", entityType: "entity", entityId: duplicateId, payload: JSON.stringify({ survivorId, reason }) });
    return Response.json({ merge });
  } catch (error) {
    const message = error instanceof Error ? `${error.message} ${error.cause || ""}` : "";
    if (message.includes("UNIQUE constraint failed")) return Response.json({ error: "Эта карточка уже была объединена" }, { status: 409 });
    return Response.json({ error: "Не удалось объединить карточки" }, { status: 503 });
  }
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
