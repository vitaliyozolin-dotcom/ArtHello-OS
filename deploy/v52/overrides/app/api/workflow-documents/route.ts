import { desc, eq, sql } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, documentVersions, obligations, workflowDocuments } from "../../../db/schema";
import { getRequestUser } from "../../../lib/request-user";

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const documents = await db.select().from(workflowDocuments).orderBy(desc(workflowDocuments.updatedAt));
    const versions = await db.select().from(documentVersions).orderBy(desc(documentVersions.version));
    const obligationRows = await db.select().from(obligations).orderBy(desc(obligations.dueDate));
    return Response.json({ documents, versions, obligations: obligationRows });
  } catch { return Response.json({ error: "Документы недоступны" }, { status: 503 }); }
}

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const action = clean(body.action, 20) || "create";
    const db = getDb();
    if (action === "version") {
      const documentId = clean(body.documentId, 40).toUpperCase();
      const note = clean(body.note, 400);
      const reference = clean(body.reference, 200);
      const [document] = await db.select().from(workflowDocuments).where(eq(workflowDocuments.id, documentId)).limit(1);
      if (!document) return Response.json({ error: "Документ не найден" }, { status: 404 });
      const version = document.currentVersion + 1;
      await db.insert(documentVersions).values({ documentId, version, note, reference, createdBy: actor });
      await db.update(workflowDocuments).set({ currentVersion: version, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(workflowDocuments.id, documentId));
      await db.insert(auditEvents).values({ actor, action: "document.version_added", entityType: "document", entityId: documentId, payload: JSON.stringify({ version, note, reference }) });
      return Response.json({ version });
    }
    const requestedId = clean(body.id, 40).toUpperCase();
    const id = requestedId || `DOC-M-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    const title = clean(body.title, 180);
    const documentType = clean(body.documentType, 80);
    const validUntil = clean(body.validUntil, 20);
    const ownerEntityId = clean(body.ownerEntityId, 40).toUpperCase();
    const obligationTitle = clean(body.obligationTitle, 180);
    if ((requestedId && !/^[A-ZА-Я0-9-]{5,40}$/.test(requestedId)) || title.length < 3 || documentType.length < 3) return Response.json({ error: "Заполните реквизиты документа" }, { status: 400 });
    if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return Response.json({ error: "Некорректный срок" }, { status: 400 });
    await db.insert(workflowDocuments).values({ id, title, documentType, validUntil, ownerEntityId, source: "MANUAL", createdBy: actor });
    await db.insert(documentVersions).values({ documentId: id, version: 1, note: "Первая версия", reference: "Добавлено вручную", createdBy: actor });
    if (obligationTitle && validUntil && ownerEntityId) await db.insert(obligations).values({ documentId: id, title: obligationTitle, dueDate: validUntil, ownerEntityId, createdBy: actor });
    await db.insert(auditEvents).values({ actor, action: "document.created", entityType: "document", entityId: id, payload: JSON.stringify({ documentType, validUntil, ownerEntityId, obligationTitle }) });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed")) return Response.json({ error: "Документ с таким номером уже существует" }, { status: 409 });
    return Response.json({ error: "Документ не сохранён" }, { status: 503 });
  }
}

function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
