import { inArray } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, entities, entityLinks } from "../../../db/schema";
import { relationTypes } from "../../../lib/registry";
import { getRequestUser } from "../../../lib/request-user";

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const fromEntityId = clean(body.fromEntityId, 24).toUpperCase();
    const toEntityId = clean(body.toEntityId, 24).toUpperCase();
    const relationType = clean(body.relationType, 80);
    if (!fromEntityId || !toEntityId || fromEntityId === toEntityId) return Response.json({ error: "Выберите две разные карточки" }, { status: 400 });
    if (!new Set<string>(relationTypes).has(relationType)) return Response.json({ error: "Некорректный тип связи" }, { status: 400 });
    const db = getDb();
    const found = await db.select().from(entities).where(inArray(entities.id, [fromEntityId, toEntityId]));
    if (found.length !== 2 || found.some((entity) => entity.status === "Объединена")) return Response.json({ error: "Одна из карточек недоступна" }, { status: 404 });
    const [link] = await db.insert(entityLinks).values({ fromEntityId, toEntityId, relationType, createdBy: actor }).returning();
    await db.insert(auditEvents).values({ actor, action: "entity.relation_added", entityType: "entity", entityId: fromEntityId, payload: JSON.stringify({ toEntityId, relationType }) });
    await db.insert(auditEvents).values({ actor, action: "entity.relation_added", entityType: "entity", entityId: toEntityId, payload: JSON.stringify({ fromEntityId, relationType }) });
    return Response.json({ link }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? `${error.message} ${error.cause || ""}` : "";
    if (message.includes("UNIQUE constraint failed")) return Response.json({ error: "Такая связь уже существует" }, { status: 409 });
    return Response.json({ error: "Не удалось создать связь" }, { status: 503 });
  }
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
