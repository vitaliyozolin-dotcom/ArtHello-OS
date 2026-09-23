import { buildIdentityIndex } from "../../../lib/entity-identity";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, entities, entityDocuments, entityLinks, entityMerges } from "../../../db/schema";
import { moduleUsage } from "../../../lib/registry";
import { getRequestUser } from "../../../lib/request-user";
import { getAuthenticatedRequestContext, isCanonicalOwnerContext } from "../../../lib/production-auth";

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id")?.trim().toUpperCase() || "";
  if (!id) return Response.json({ error: "Укажите ID карточки" }, { status: 400 });

  try {
    await ensureCoreTables();
    const db = getDb();
    let [entity] = await db.select().from(entities).where(eq(entities.id, id)).limit(1);
    if (!entity) return Response.json({ error: "Карточка не найдена" }, { status: 404 });

    const merges = await db.select().from(entityMerges);
    const allCards = await db.select().from(entities);
    const identities = buildIdentityIndex(allCards, merges);
    const canonicalId = identities.canonical(id);
    const mergedIds = identities.members(id);
    entity = allCards.find(card => card.id === canonicalId)!;
    const links = await db.select().from(entityLinks).where(or(inArray(entityLinks.fromEntityId, mergedIds), inArray(entityLinks.toEntityId, mergedIds)));
    const peerIds = [...new Set(links.flatMap((link) => [link.fromEntityId, link.toEntityId]).filter((peerId) => !mergedIds.includes(peerId)))];
    const peers = peerIds.length ? await db.select().from(entities).where(inArray(entities.id, peerIds)) : [];
    const peerMap = new Map(peers.map((peer) => [peer.id, peer]));
    const documents = await db.select().from(entityDocuments).where(inArray(entityDocuments.entityId, mergedIds)).orderBy(desc(entityDocuments.createdAt), desc(entityDocuments.id));
    const context = await getAuthenticatedRequestContext(request);
    const history = context && isCanonicalOwnerContext(context) ? await db.select().from(auditEvents).where(and(
      eq(auditEvents.entityType, "entity"),
      inArray(auditEvents.entityId, mergedIds),
    )).orderBy(desc(auditEvents.createdAt), desc(auditEvents.id)).limit(100) : [];
    const duplicateCandidates = await db.select().from(entities).where(eq(entities.entityType, entity.entityType));
    const relationCandidates = await db.select().from(entities);

    return Response.json({
      entity,
      canonicalId,
      mergedCards: merges.filter((merge) => mergedIds.includes(merge.duplicateId)),
      relations: links.map((link) => {
        const outgoing = mergedIds.includes(link.fromEntityId);
        const peerId = outgoing ? link.toEntityId : link.fromEntityId;
        return { ...link, direction: outgoing ? "Исходящая" : "Входящая", peer: peerMap.get(peerId) || null };
      }),
      documents,
      history,
      usages: moduleUsage[entity.entityType] || ["Единый реестр", "Задачи", "Документы", "Аудит"],
      duplicateCandidates: duplicateCandidates.filter((candidate) => candidate.id !== id && candidate.status !== "Объединена"),
      relationCandidates: relationCandidates.filter((candidate) => candidate.id !== id && candidate.status !== "Объединена"),
    });
  } catch {
    return Response.json({ error: "Не удалось загрузить карточку" }, { status: 503 });
  }
}
