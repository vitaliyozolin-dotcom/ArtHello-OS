import { desc } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { acceptanceDecisions, auditEvents } from "../../../db/schema";
import { getRequestUser } from "../../../lib/request-user";

const verdicts = new Set(["ПРИНЯТО ПРЕДСТАВИТЕЛЕМ", "ОТКЛОНЕНО ПРЕДСТАВИТЕЛЕМ"]);

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const decisions = await getDb().select().from(acceptanceDecisions).orderBy(desc(acceptanceDecisions.id)).limit(30);
    return Response.json({ decisions });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const stage = clean(body.stage, 140);
    const verdict = clean(body.verdict, 60);
    const comment = clean(body.comment, 1000);
    if (!stage || !verdicts.has(verdict)) return Response.json({ error: "Некорректное решение" }, { status: 400 });
    if (verdict.includes("ОТКЛОНЕНО") && comment.length < 8) return Response.json({ error: "Для отклонения нужен конкретный комментарий" }, { status: 400 });

    const db = getDb();
    const [decision] = await db.insert(acceptanceDecisions).values({ stage, verdict, comment, actor }).returning();
    await db.insert(auditEvents).values({ actor, action: "acceptance.recorded", entityType: "acceptance", entityId: String(decision.id), payload: JSON.stringify({ stage, verdict }) });
    return Response.json({ decision }, { status: 201 });
  } catch (error) {
    return databaseError(error);
  }
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Ошибка базы данных";
  const unavailable = message.includes("no such table") || message.includes("D1 binding");
  return Response.json({ error: unavailable ? "Журнал приёмки ещё не подготовлен" : "Не удалось выполнить операцию" }, { status: 503 });
}
