import { env } from 'cloudflare:workers';
import { ensureCoreTables } from '../../../db';
import { isManualEntitySource } from '../../../lib/entity-provenance';
import { canAccessApi } from '../../../lib/access-policy';
import { getAuthenticatedRequestContext, verifyAuthenticatedRequestCsrf, isCanonicalOwnerContext } from '../../../lib/production-auth';
import { hasTrustedMutationOrigin } from '../../../lib/request-security';
import { serializeIdentityMutation } from '../../../lib/entity-identity';
import { readIdentityIndex, identityMetadata, identityProjectionStatements, identityHasAccessBindings } from '../../../lib/entity-identity-db';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(request: Request) {
  try {
    const origin = (env as unknown as { ARTHELLO_PUBLIC_ORIGIN?: string }).ARTHELLO_PUBLIC_ORIGIN ?? '';
    if (!hasTrustedMutationOrigin(request, origin)) return reply({ error: 'Источник запроса отклонён' }, 403);
    const context = await getAuthenticatedRequestContext(request);
    if (!context) return reply({ error: 'Требуется вход' }, 401);
    if (!canAccessApi(context.auth.user, '/api/entity-merge', 'POST')
      || (context.apiRole === 'OWNER' && !isCanonicalOwnerContext(context))) return reply({ error: 'Нет права подтверждать идентичность' }, 403);
    try { verifyAuthenticatedRequestCsrf(request, context); } catch { return reply({ error: 'Обновите защитную сессию' }, 403); }
    const body = await request.json() as Record<string, unknown>;
    const survivorId = clean(body.survivorId, 80).toUpperCase();
    const duplicateId = clean(body.duplicateId, 80).toUpperCase();
    const reason = clean(body.reason, 240);
    if (!survivorId || !duplicateId || survivorId === duplicateId || reason.length < 8) return reply({ error: 'Укажите дубль и основание подтверждения' }, 400);
    return await serializeIdentityMutation(async () => {
      await ensureCoreTables();
      const db = env.DB;
      const identities = await readIdentityIndex(db);
      const survivorCard = identities.cards.find(card => card.id === survivorId);
      const duplicate = identities.cards.find(card => card.id === duplicateId);
      if (!survivorCard || !duplicate) return reply({ error: 'Одна из карточек не найдена' }, 404);
      if (identities.canonical(survivorId) !== survivorId || identities.canonical(duplicateId) !== duplicateId) return reply({ error: 'Выберите основные карточки вместо старых ссылок' }, 409);
      if (survivorCard.entityType !== duplicate.entityType) return reply({ error: 'Семья, ребёнок, представитель и сотрудник подтверждаются отдельно' }, 409);
      if (!['Семья', 'Клиент', 'Ребёнок', 'Сотрудник'].includes(survivorCard.entityType)) return reply({ error: 'Единая идентификация доступна для семей и людей' }, 409);
      const affectedIds = [...identities.members(survivorId), ...identities.members(duplicateId)];
      if (!isCanonicalOwnerContext(context)) {
        const grants = (await db.prepare(`SELECT b.name FROM user_branch_access a JOIN organization_branches b ON b.id=a.branch_id
          WHERE a.user_id=? AND b.status='Активен'`).bind(context.appUserId).all<{ name: string }>()).results;
        if (identities.cards.some(card => affectedIds.includes(card.id) && !grants.some(grant => grant.name === card.scope))) return reply({ error: 'Нужны права на все филиалы подтверждаемых карточек' }, 403);
      }
      if (await identityHasAccessBindings(db, affectedIds)) return reply({ error: 'У карточек уже есть связанные доступы. Сначала требуется согласовать перенос идентификаторов в дневниках; доступы не изменены.' }, 409);
      const survivor = await db.prepare('SELECT source_system AS sourceSystem,data_quality AS dataQuality FROM entities WHERE id=?').bind(survivorId).first<{ sourceSystem: string; dataQuality: string }>();
      if (!survivor) return reply({ error: 'Карточка не найдена' }, 404);
      const resolvedDataQuality = isManualEntitySource(survivor.sourceSystem)
        ? "Проверено" : survivor.dataQuality === "Проверено" ? "Проверено" : "На проверке";
      const merge = { survivorId, duplicateId, reason, createdBy: context.actor };
      const plannedCards = identities.cards.map(card => affectedIds.includes(card.id) ? {
        ...card, metadata: JSON.stringify({ ...identityMetadata(card.metadata),
          identitySourceStatus: identityMetadata(card.metadata).identitySourceStatus ?? card.status }),
      } : card);
      const statements = [db.prepare('INSERT INTO entity_merges(survivor_id,duplicate_id,reason,created_by) VALUES(?,?,?,?)').bind(survivorId, duplicateId, reason, context.actor)];
      for (const card of plannedCards.filter(card => affectedIds.includes(card.id))) statements.push(db.prepare('UPDATE entities SET metadata=? WHERE id=?').bind(card.metadata, card.id));
      statements.push(...identityProjectionStatements(db, plannedCards, [...identities.merges, merge]));
      statements.push(db.prepare('UPDATE entities SET data_quality=? WHERE id=?').bind(resolvedDataQuality, survivorId));
      for (const [id, action] of [[survivorId, 'entity.merge_survivor'], [duplicateId, 'entity.merged']]) statements.push(db.prepare("INSERT INTO audit_events(actor,action,entity_type,entity_id,payload) VALUES(?,?,'entity',?,?)")
        .bind(context.actor, action, id, JSON.stringify({ survivorId, duplicateId, reason, affectedIds,
          dataQualityFrom: survivor.dataQuality, dataQualityTo: resolvedDataQuality })));
      // All projections and the immutable alias decision commit or roll back together.
      await db.batch(statements);
      return reply({ merge, canonicalId: survivorId, sourceEntityIds: affectedIds });
    });
  } catch { return reply({ error: 'Не удалось подтвердить идентичность. Проверьте связи карточек; изменения не применены.' }, 503); }
}
function clean(value: unknown, max: number) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
