import { and, asc, eq, sql } from "drizzle-orm";
import { ensureCoreTables, getDb, getSystemDataMode } from "../../../db";
import { auditEvents, entities } from "../../../db/schema";
import { entityPrefixes, entityTypes } from "../../../lib/registry";
import { getRequestUser } from "../../../lib/request-user";

const entityTypeSet = new Set<string>(entityTypes);

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const url = new URL(request.url);
    const type = url.searchParams.get("type")?.trim() || "";
    const q = url.searchParams.get("q")?.trim().toLocaleLowerCase("ru-RU") || "";
    const quality = url.searchParams.get("quality")?.trim() || "";
    const mode = await getSystemDataMode();
    const storedRows = await getDb().select().from(entities).orderBy(asc(entities.entityType), asc(entities.displayName)).limit(500);
    const allRows = mode === "source_only"
      ? storedRows.filter((row) => !row.sourceSystem.startsWith("SYNTHETIC"))
      : storedRows;
    const rows = allRows.filter((row) => {
      if (row.status === "Объединена" && !q) return false;
      if (type && entityTypeSet.has(type) && row.entityType !== type) return false;
      if (quality && row.dataQuality !== quality) return false;
      if (!q) return true;
      return [row.id, row.displayName, row.sourceRecordId, row.scope, row.sourceSystem]
        .some((value) => value.toLocaleLowerCase("ru-RU").includes(q));
    });
    const duplicateKeys = new Map<string, number>();
    allRows.filter((row) => row.status !== "Объединена").forEach((row) => {
      const key = `${row.entityType}:${normalize(row.displayName)}`;
      duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
    });
    return Response.json({
      entities: rows,
      typeCounts: Object.fromEntries(entityTypes.map((item) => [
        item,
        allRows.filter((row) => row.status !== "Объединена" && row.entityType === item).length,
      ])),
      stats: {
        total: allRows.filter((row) => row.status !== "Объединена").length,
        needsReview: allRows.filter((row) => row.status !== "Объединена" && row.dataQuality !== "Проверено").length,
        duplicateGroups: [...duplicateKeys.values()].filter((count) => count > 1).length,
        sources: new Set(allRows.map((row) => row.sourceSystem)).size,
      },
      entityTypes,
    });
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
    const requestedId = clean(body.id, 24).toUpperCase();
    const entityType = clean(body.entityType, 40);
    const displayName = clean(body.displayName, 180);
    const sourceSystem = clean(body.sourceSystem, 40).toUpperCase();
    const id = requestedId || createEntityId(entityType);
    const sourceRecordId = clean(body.sourceRecordId, 100) || `MANUAL:${id}`;
    const scope = clean(body.scope, 140);
    if (!/^[A-Z]{2,8}-T-[0-9]{3,6}$/.test(id)) return Response.json({ error: "ID должен иметь формат FAM-T-105" }, { status: 400 });
    if (!entityTypeSet.has(entityType)) return Response.json({ error: "Некорректный тип карточки" }, { status: 400 });
    if (displayName.length < 3 || !sourceRecordId || !scope) return Response.json({ error: "Заполните обязательные поля" }, { status: 400 });
    if (!new Set(["SYNTHETIC", "MANUAL", "XLSX_MASKED"]).has(sourceSystem)) return Response.json({ error: "Источник не разрешён в тестовом контуре" }, { status: 400 });

    const db = getDb();
    const [sameName] = await db.select().from(entities).where(and(
      eq(entities.entityType, entityType),
      sql`lower(${entities.displayName}) = lower(${displayName})`,
      sql`${entities.status} <> 'Объединена'`,
    )).limit(1);
    if (sameName) return Response.json({ error: `Возможный дубль: ${sameName.id} · ${sameName.displayName}` }, { status: 409 });
    const [entity] = await db.insert(entities).values({ id, entityType, displayName, sourceSystem, sourceRecordId, scope, createdBy: actor }).returning();
    await db.insert(auditEvents).values({ actor, action: "entity.created", entityType: "entity", entityId: id, payload: JSON.stringify({ entityType, sourceSystem, sourceRecordId }) });
    return Response.json({ entity }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
    if (`${message}\n${cause}`.includes("UNIQUE constraint failed")) return Response.json({ error: "Такая карточка или запись источника уже существует" }, { status: 409 });
    return databaseError(error);
  }
}

export async function PATCH(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const id = clean(body.id, 24).toUpperCase();
    const displayName = clean(body.displayName, 180);
    const scope = clean(body.scope, 140);
    const dataQuality = clean(body.dataQuality, 40);
    const status = clean(body.status, 40);
    const expectedUpdatedAt = clean(body.expectedUpdatedAt, 80);
    if (!id || displayName.length < 3 || !scope || !expectedUpdatedAt) return Response.json({ error: "Заполните обязательные поля" }, { status: 400 });
    if (!new Set(["Проверено", "Требует сверки", "На проверке", "Тестовые данные"]).has(dataQuality)) return Response.json({ error: "Некорректное качество данных" }, { status: 400 });
    if (!new Set(["Активна", "Архив", "На проверке"]).has(status)) return Response.json({ error: "Некорректный статус" }, { status: 400 });
    const db = getDb();
    const [current] = await db.select().from(entities).where(eq(entities.id, id)).limit(1);
    if (!current) return Response.json({ error: "Карточка не найдена" }, { status: 404 });
    if (current.status === "Объединена") return Response.json({ error: "Объединённую карточку нельзя редактировать" }, { status: 409 });
    const updated = await db.update(entities).set({ displayName, scope, dataQuality, status, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(entities.id, id), eq(entities.updatedAt, expectedUpdatedAt))).returning();
    if (updated.length === 0) return Response.json({ error: "Карточка уже изменена. Обновите данные." }, { status: 409 });
    await db.insert(auditEvents).values({ actor, action: "entity.updated", entityType: "entity", entityId: id, payload: JSON.stringify({ displayName, scope, dataQuality, status }) });
    return Response.json({ entity: updated[0] });
  } catch (error) {
    return databaseError(error);
  }
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalize(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]/gi, "");
}

function createEntityId(entityType: string) {
  const prefix = entityPrefixes[entityType] || "ENT";
  return `${prefix}-T-${Date.now().toString().slice(-6)}`;
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const unavailable = message.includes("no such table") || message.includes("D1 binding");
  return Response.json({ error: unavailable ? "Единый справочник ещё не подготовлен" : "Не удалось выполнить операцию" }, { status: 503 });
}
