import { eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, contentPlanItems, contentPublications, contentRecommendations, tasks } from "../../../db/schema";
import { getRequestUser } from "../../../lib/request-user";

const contentRoles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "MARKETING"]);
const formats = new Set(["Пост", "Карусель", "Короткое видео", "Видео", "Лонгрид"]);

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!contentRoles.has(role)) return Response.json({ error: "Недостаточно прав для изменения контент-плана" }, { status: 403 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const action = clean(body.action, 60);
    if (action === "createPlanItem") return createPlanItem(actor, body);
    if (action === "publishItem") return publishItem(actor, body);
    if (action === "createRecommendationTask") return createRecommendationTask(actor, body);
    return Response.json({ error: "Неизвестное действие контента" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Действие не выполнено" }, { status: 500 });
  }
}

async function createPlanItem(actor: string, body: Record<string, unknown>) {
  const scheduledAt = clean(body.scheduledAt, 40);
  const accountId = clean(body.accountId, 80);
  const authorEntityId = clean(body.authorEntityId, 80);
  const format = clean(body.format, 40);
  const topic = clean(body.topic, 180);
  const brief = clean(body.brief, 600);
  if (!scheduledAt || !accountId || !authorEntityId || !formats.has(format) || topic.length < 5 || brief.length < 10) return Response.json({ error: "Заполните дату, канал, автора, формат, тему и содержательный бриф" }, { status: 400 });
  const id = `PLAN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const db = getDb();
  const [item] = await db.insert(contentPlanItems).values({ id, scheduledAt, accountId, authorEntityId, format, topic, brief, offerId: clean(body.offerId, 80), campaignId: clean(body.campaignId, 80), status: "Черновик", createdBy: actor }).returning();
  await db.insert(auditEvents).values({ actor, action: "content.plan_created", entityType: "content_plan_item", entityId: id, payload: JSON.stringify({ accountId, format, topic }) });
  return Response.json({ item }, { status: 201 });
}

async function publishItem(actor: string, body: Record<string, unknown>) {
  const planItemId = clean(body.planItemId, 80);
  const publicationRef = clean(body.publicationRef, 160);
  if (publicationRef.length < 6) return Response.json({ error: "Укажите ссылку или ID опубликованного материала" }, { status: 400 });
  const db = getDb();
  const [item] = await db.select().from(contentPlanItems).where(eq(contentPlanItems.id, planItemId)).limit(1);
  if (!item) return Response.json({ error: "Пункт контент-плана не найден" }, { status: 404 });
  const [existing] = await db.select().from(contentPublications).where(eq(contentPublications.planItemId, planItemId)).limit(1);
  if (existing) return Response.json({ publication: existing, reused: true });
  const id = `PUB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const [publication] = await db.insert(contentPublications).values({ id, planItemId, publishedAt: new Date().toISOString(), publicationRef, reach: 0, views: 0, reactions: 0, clicks: 0, leads: 0, contracts: 0, revenueMinor: 0, sourceType: "MANUAL_TEST", dataQuality: "Метрики ещё не получены; публикация подтверждена вручную" }).returning();
  await db.update(contentPlanItems).set({ status: "Опубликовано", updatedAt: new Date().toISOString() }).where(eq(contentPlanItems.id, planItemId));
  await db.insert(auditEvents).values({ actor, action: "content.published", entityType: "content_publication", entityId: id, payload: JSON.stringify({ planItemId, publicationRef }) });
  return Response.json({ publication }, { status: 201 });
}

async function createRecommendationTask(actor: string, body: Record<string, unknown>) {
  const recommendationId = clean(body.recommendationId, 80);
  const db = getDb();
  const [recommendation] = await db.select().from(contentRecommendations).where(eq(contentRecommendations.id, recommendationId)).limit(1);
  if (!recommendation) return Response.json({ error: "Рекомендация не найдена" }, { status: 404 });
  const automationKey = `CONTENT_RECOMMENDATION:${recommendation.id}`;
  const [existing] = await db.select().from(tasks).where(eq(tasks.automationKey, automationKey)).limit(1);
  if (existing) return Response.json({ task: existing, reused: true });
  const [task] = await db.insert(tasks).values({ title: recommendation.recommendation, owner: "Контент-редактор", dueDate: "2026-08-28", priority: recommendation.signalType === "Выручка" ? "Средний" : "Высокий", status: "Входящие", sourceType: "Рекомендация контента", sourceId: recommendation.id, description: `${recommendation.evidence}. Проверить гипотезу на следующей публикации и сохранить бизнес-результат.`, assigneeEntityId: "EMP-T-CONTENT-001", kind: "Автозадача", automationKey, createdBy: actor }).returning();
  await db.update(contentRecommendations).set({ status: "В работе", relatedTaskId: task.id, updatedAt: new Date().toISOString() }).where(eq(contentRecommendations.id, recommendationId));
  await db.insert(auditEvents).values({ actor, action: "content.recommendation_task_created", entityType: "content_recommendation", entityId: recommendationId, payload: JSON.stringify({ taskId: task.id }) });
  return Response.json({ task }, { status: 201 });
}

function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
