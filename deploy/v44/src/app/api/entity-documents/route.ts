import { eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, entities, entityDocuments } from "../../../db/schema";
import { getRequestUser } from "../../../lib/request-user";

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const entityId = clean(body.entityId, 24).toUpperCase();
    const title = clean(body.title, 160);
    const documentType = clean(body.documentType, 80);
    const status = clean(body.status, 40) || "На проверке";
    const validUntil = clean(body.validUntil, 20);
    const source = clean(body.source, 60).toUpperCase() || "MANUAL";
    if (!entityId || title.length < 3 || !documentType) return Response.json({ error: "Заполните обязательные поля" }, { status: 400 });
    if (!new Set(["Актуален", "На проверке", "Истекает", "Нет файла"]).has(status)) return Response.json({ error: "Некорректный статус документа" }, { status: 400 });
    if (!new Set(["MANUAL", "XLSX_MASKED"]).has(source)) return Response.json({ error: "Разрешены ручной ввод и подтверждённый XLSX" }, { status: 400 });
    const db = getDb();
    const [entity] = await db.select().from(entities).where(eq(entities.id, entityId)).limit(1);
    if (!entity || entity.status === "Объединена") return Response.json({ error: "Карточка недоступна" }, { status: 404 });
    const [document] = await db.insert(entityDocuments).values({ entityId, title, documentType, status, validUntil, source, createdBy: actor }).returning();
    await db.insert(auditEvents).values({ actor, action: "entity.document_linked", entityType: "entity", entityId, payload: JSON.stringify({ documentId: document.id, title, documentType, status }) });
    return Response.json({ document }, { status: 201 });
  } catch {
    return Response.json({ error: "Не удалось связать документ" }, { status: 503 });
  }
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
