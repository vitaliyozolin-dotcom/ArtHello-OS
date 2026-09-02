import { and, desc, eq, gte, like } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import {
  auditEvents,
  medicalAccessGrants,
  medicalActions,
  medicalCases,
  medicalDocuments,
  medicalIncidents,
  medicalRestrictions,
} from "../../../db/schema";
import { medicalAccess, medicalExpiry } from "../../../lib/medical";
import { getRequestUser } from "../../../lib/request-user";

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });

  try {
    await ensureCoreTables();
    const db = getDb();
    const role = request.headers.get("x-arthello-role") ?? "";
    const asOf = new Date().toISOString().slice(0, 10);
    const [grant] = await db.select().from(medicalAccessGrants)
      .where(and(
        eq(medicalAccessGrants.principalRef, `ROLE:${role}`),
        eq(medicalAccessGrants.scope, "MEDICAL_FULL_SYNTHETIC"),
        eq(medicalAccessGrants.status, "Активен"),
        gte(medicalAccessGrants.validUntil, asOf),
      ))
      .limit(1);

    if (!medicalAccess(role, grant, asOf)) {
      await db.insert(auditEvents).values({
        actor,
        action: "medical.access_denied",
        entityType: "medical_scope",
        entityId: `ROLE:${role || "UNKNOWN"}`,
        payload: JSON.stringify({ scope: "NONE", reason: "separate_grant_required" }),
      });
      return Response.json({ error: "Медицинские данные скрыты. Нужен отдельный действующий допуск." }, { status: 403 });
    }

    await db.insert(auditEvents).values({
      actor,
      action: "medical.records_viewed",
      entityType: "medical_scope",
      entityId: grant.id,
      payload: JSON.stringify({ scope: grant.scope, fields: "minimum-necessary", purpose: "workspace-view" }),
    });

    const [documents, restrictions, cases, incidents, actions, audit] = await Promise.all([
      db.select().from(medicalDocuments),
      db.select().from(medicalRestrictions),
      db.select().from(medicalCases),
      db.select().from(medicalIncidents),
      db.select().from(medicalActions),
      db.select().from(auditEvents).where(like(auditEvents.action, "medical.%")).orderBy(desc(auditEvents.id)).limit(30),
    ]);

    return Response.json({
      documents: documents.map((item) => ({ ...item, expiryBand: medicalExpiry(item.validUntil, asOf) })),
      restrictions,
      cases,
      incidents,
      actions,
      audit: audit.map((item) => ({
        id: item.id,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        createdAt: item.createdAt,
      })),
      summary: {
        documents: documents.length,
        expiring: documents.filter((item) => medicalExpiry(item.validUntil, asOf) === "Истекает").length,
        activeRestrictions: restrictions.filter((item) => item.status === "Активно").length,
        openCases: cases.filter((item) => item.status !== "Закрыт").length,
        pendingActions: actions.filter((item) => item.status !== "Выполнено").length,
      },
      boundary: "Только синтетические обезличенные записи. Реальные медицинские файлы не загружены; защищённое медицинское хранилище не подключено. Данные исключены из общих отчётов.",
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error && error.message.includes("D1 binding")
        ? "Защищённая база ещё не подключена"
        : "Не удалось открыть медицинский контур",
    }, { status: 503 });
  }
}
