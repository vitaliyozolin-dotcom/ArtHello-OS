import { and, asc, eq, sql } from "drizzle-orm";
import { ensureCoreTables, getDb, getSystemDataMode } from "../../../db";
import { auditEvents, entities } from "../../../db/schema";
import {
  editedEntityDataQuality,
  entityDataState,
  entityDuplicateKey,
  initialEntityDataQuality,
  isManualEntitySource,
  needsExternalReviewEvidence,
  normalizeEntityIdentityName,
} from "../../../lib/entity-provenance";
import { entityPrefixes, entityTypes } from "../../../lib/registry";
import { getRequestUser } from "../../../lib/request-user";

const entityTypeSet = new Set<string>(entityTypes);
const reviewStates = new Set(["Требует сверки", "На проверке"]);

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
    const duplicateKeys = new Map<string, number>();
    allRows.filter((row) => row.status !== "Объединена").forEach((row) => {
      const key = entityDuplicateKey(row);
      duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
    });
    const displayRows = allRows.map((row) => ({
      ...row,
      dataQuality: dataStateFor(row, duplicateKeys),
    }));
    const rows = displayRows.filter((row) => {
      if (row.status === "Объединена" && !q) return false;
      if (type && entityTypeSet.has(type) && row.entityType !== type) return false;
      if (quality && row.dataQuality !== quality) return false;
      if (!q) return true;
      return [row.id, row.displayName, row.sourceRecordId, row.scope, row.sourceSystem]
        .some((value) => value.toLocaleLowerCase("ru-RU").includes(q));
    });
    return Response.json({
      entities: rows,
      typeCounts: Object.fromEntries(entityTypes.map((item) => [
        item,
        displayRows.filter((row) => row.status !== "Объединена" && row.entityType === item).length,
      ])),
      stats: {
        total: displayRows.filter((row) => row.status !== "Объединена").length,
        needsReview: displayRows.filter((row) => row.status !== "Объединена" && reviewStates.has(row.dataQuality)).length,
        duplicateGroups: [...duplicateKeys.values()].filter((count) => count > 1).length,
        sources: new Set(displayRows.map((row) => row.sourceSystem)).size,
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
    const requestedId = clean(body.id, 48).toUpperCase();
    const entityType = clean(body.entityType, 40);
    const displayName = clean(body.displayName, 180);
    const sourceSystem = clean(body.sourceSystem, 40).toUpperCase() || "MANUAL";
    const id = requestedId || createEntityId(entityType);
    const providedSourceRecordId = clean(body.sourceRecordId, 100);
    const sourceRecordId = providedSourceRecordId || (isManualEntitySource(sourceSystem) ? `MANUAL:${id}` : "");
    const scope = clean(body.scope, 140);
    if (!/^[A-Z][A-Z0-9]{1,15}-[A-Z0-9][A-Z0-9-]{5,39}$/.test(id)) return Response.json({ error: "ID должен состоять из латинских букв, цифр и дефисов" }, { status: 400 });
    if (!entityTypeSet.has(entityType)) return Response.json({ error: "Некорректный тип карточки" }, { status: 400 });
    if (displayName.length < 3 || !sourceRecordId || !scope) return Response.json({ error: "Заполните обязательные поля" }, { status: 400 });
    if (!new Set(["MANUAL", "CSV_IMPORT", "XLSX_IMPORT", "API_IMPORT"]).has(sourceSystem)) return Response.json({ error: "Источник записи не поддерживается" }, { status: 400 });
    // Manual provenance is presented separately in the registry. Persisting it
    // as trusted keeps existing access rules compatible without pretending an
    // external source was reconciled.
    const dataQuality = initialEntityDataQuality(sourceSystem);

    const db = getDb();
    const sameTypeCards = await db.select({ id: entities.id, displayName: entities.displayName }).from(entities).where(and(
      eq(entities.entityType, entityType),
      sql`${entities.status} <> 'Объединена'`,
    ));
    const sameName = sameTypeCards.find((candidate) => normalizeEntityIdentityName(candidate.displayName) === normalizeEntityIdentityName(displayName));
    if (sameName) return Response.json({ error: `Возможный дубль: ${sameName.id} · ${sameName.displayName}` }, { status: 409 });
    const [entity] = await db.insert(entities).values({ id, entityType, displayName, sourceSystem, sourceRecordId, dataQuality, scope, createdBy: actor }).returning();
    await db.insert(auditEvents).values({ actor, action: "entity.created", entityType: "entity", entityId: id, payload: JSON.stringify({ entityType, sourceSystem, sourceRecordId, dataQuality, provenance: isManualEntitySource(sourceSystem) ? "Создано вручную" : "Внешний источник" }) });
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
    const requestedDataQuality = clean(body.dataQuality, 40);
    const reviewEvidence = clean(body.reviewEvidence, 500);
    const status = clean(body.status, 40);
    const expectedUpdatedAt = clean(body.expectedUpdatedAt, 80);
    if (!id || displayName.length < 3 || !scope || !expectedUpdatedAt) return Response.json({ error: "Заполните обязательные поля" }, { status: 400 });
    if (!new Set(["Создано вручную", "Проверено", "Требует сверки", "На проверке"]).has(requestedDataQuality)) return Response.json({ error: "Некорректное состояние данных" }, { status: 400 });
    const db = getDb();
    const [current] = await db.select().from(entities).where(eq(entities.id, id)).limit(1);
    if (!current) return Response.json({ error: "Карточка не найдена" }, { status: 404 });
    if (current.status === "Объединена") return Response.json({ error: "Объединённую карточку нельзя редактировать" }, { status: 409 });
    if (!new Set(["Активна", "Архив", "На проверке", current.status]).has(status)) return Response.json({ error: "Некорректный статус" }, { status: 400 });
    const possibleDuplicates = await db.select({ id: entities.id, displayName: entities.displayName }).from(entities).where(and(
      eq(entities.entityType, current.entityType),
      sql`${entities.id} <> ${id}`,
      sql`${entities.status} <> 'Объединена'`,
    ));
    const duplicateMatch = possibleDuplicates.find((candidate) => normalizeEntityIdentityName(candidate.displayName) === normalizeEntityIdentityName(displayName));
    const hasDuplicate = Boolean(duplicateMatch);
    if (needsExternalReviewEvidence(current, requestedDataQuality, hasDuplicate) && reviewEvidence.length < 8) {
      return Response.json({ error: "Укажите основание сверки внешнего источника" }, { status: 400 });
    }
    const dataQuality = editedEntityDataQuality(current, requestedDataQuality, hasDuplicate);
    const updated = await db.update(entities).set({ displayName, scope, dataQuality, status, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(entities.id, id), eq(entities.updatedAt, expectedUpdatedAt))).returning();
    if (updated.length === 0) return Response.json({ error: "Карточка уже изменена. Обновите данные." }, { status: 409 });
    await db.insert(auditEvents).values({ actor, action: "entity.updated", entityType: "entity", entityId: id, payload: JSON.stringify({ displayName, scope, dataQuality, status, duplicateId: duplicateMatch?.id || "", reviewEvidence }) });
    return Response.json({ entity: updated[0] });
  } catch (error) {
    return databaseError(error);
  }
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function dataStateFor(
  entity: { entityType: string; displayName: string; sourceSystem: string; dataQuality: string },
  duplicateKeys: Map<string, number>,
) {
  return entityDataState(entity, (duplicateKeys.get(entityDuplicateKey(entity)) ?? 0) > 1);
}

function createEntityId(entityType: string) {
  const prefix = entityPrefixes[entityType] || "ENT";
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const unavailable = message.includes("no such table") || message.includes("D1 binding");
  return Response.json({ error: unavailable ? "Единый справочник ещё не подготовлен" : "Не удалось выполнить операцию" }, { status: 503 });
}
