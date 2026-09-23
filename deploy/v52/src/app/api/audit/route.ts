import { and, desc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents } from "../../../db/schema";
import { getRequestUser } from "../../../lib/request-user";
import { getAuthenticatedRequestContext, isCanonicalOwnerContext } from "../../../lib/production-auth";

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const context = await getAuthenticatedRequestContext(request);
  if (!context || !isCanonicalOwnerContext(context)) return Response.json({ error: "Журнал доступен только владельцу" }, { status: 403 });

  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType")?.trim().slice(0, 80) || "";
  const entityId = url.searchParams.get("entityId")?.trim().slice(0, 80) || "";
  if (!entityType || !entityId) return Response.json({ error: "Укажите сущность" }, { status: 400 });

  try {
    await ensureCoreTables();
    const events = await getDb().select().from(auditEvents)
      .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(100);
    return Response.json({ events });
  } catch {
    return Response.json({ error: "История временно недоступна" }, { status: 503 });
  }
}
