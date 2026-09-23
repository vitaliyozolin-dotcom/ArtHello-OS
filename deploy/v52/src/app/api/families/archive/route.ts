import { env } from 'cloudflare:workers';
import { serializeIdentityMutation } from '../../../../lib/entity-identity';
import { readIdentityIndex } from '../../../../lib/entity-identity-db';
import { ensureCoreTables } from '../../../../db';
import { canAccessModule } from '../../../../lib/access-policy';
import { getAuthenticatedRequestContext, verifyAuthenticatedRequestCsrf } from '../../../../lib/production-auth';
import { hasTrustedMutationOrigin } from '../../../../lib/request-security';
import { alfaBranchDisposition } from '../../../../lib/alfacrm-import';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function POST(request: Request) {
  try {
    const origin = (env as unknown as { ARTHELLO_PUBLIC_ORIGIN?: string }).ARTHELLO_PUBLIC_ORIGIN ?? '';
    if (!hasTrustedMutationOrigin(request, origin)) return reply({ error: 'Источник запроса отклонён' }, 403);
    const context = await getAuthenticatedRequestContext(request);
    if (!context) return reply({ error: 'Требуется вход' }, 401);
    const user = context.auth.user;
    const owner = context.apiRole === 'OWNER' && user.isSystemOwner;
    if ((!owner && !['DIRECTOR', 'ADMIN', 'SALES'].includes(context.apiRole)) || !canAccessModule({
      apiRole: context.apiRole, isSystemOwner: user.isSystemOwner, canAccessMedical: user.canAccessMedical, allowedModules: user.allowedModules,
    }, 'clients')) return reply({ error: 'Нет прав на изменение семей' }, 403);
    try { verifyAuthenticatedRequestCsrf(request, context); } catch { return reply({ error: 'Обновите защитную сессию' }, 403); }
    const body = await request.json() as { familyId?: unknown; archive?: unknown };
    if (typeof body.familyId !== 'string' || !body.familyId || body.familyId.length > 80 || typeof body.archive !== 'boolean') return reply({ error: 'Укажите семью и действие' }, 400);
    return await serializeIdentityMutation(async () => {
    await ensureCoreTables();
    const family = await env.DB.prepare("SELECT id,status,source_system,scope,metadata FROM entities WHERE id=? AND entity_type='Семья'")
      .bind(body.familyId).first<{ id: string; status: string; source_system: string; scope: string; metadata: string }>();
    if (!family) return reply({ error: 'Семья не найдена' }, 404);
    if (family.status === 'Объединена') return reply({ error: 'Объединённая карточка недоступна для этого действия' }, 409);
    const identities = await readIdentityIndex(env.DB);
    const familyIds = identities.members(family.id);
    const familyCards = identities.cards.filter(card => familyIds.includes(card.id));
    // Non-owner permissions come from current server grants, not a client branch name.
    if (!owner && !user.isAdministrative) {
      const grants = (await env.DB.prepare(`SELECT b.name FROM user_branch_access a JOIN organization_branches b ON b.id=a.branch_id
        WHERE a.user_id=? AND b.status='Активен'`).bind(context.appUserId).all<{name:string}>()).results;
      if (familyCards.some(card => !grants.some(grant => grant.name === card.scope))) return reply({ error: 'Нужны права на все филиалы семьи' }, 403);
    }
    if (!body.archive && family.source_system === 'ALFACRM') {
      let confirmed = false;
      for (const card of familyCards) {
        let meta: Record<string, unknown>; try { meta = JSON.parse(card.metadata); } catch { continue; }
        const raw = await env.DB.prepare(`SELECT o.payload FROM alfacrm_current_records c JOIN alfacrm_raw_observations o ON o.id=c.observation_id
          WHERE c.module='families' AND c.remote_branch_id=? AND c.record_id=? AND c.active=1`)
          .bind(String(meta.remoteBranchId ?? ''), String(meta.alfaCustomerId ?? '')).first<{ payload: string }>();
        let item: Record<string, unknown> = {}; try { item = JSON.parse(raw?.payload ?? '{}'); } catch { continue; }
        if (alfaBranchDisposition('families', { remoteBranchId: String(meta.remoteBranchId ?? ''), item }) === 'accepted') confirmed = true;
      }
      if (!confirmed) return reply({ error: 'AlfaCRM не подтверждает действующую семью. Сначала повторите синхронизацию.' }, 409);
    }
    const status = body.archive ? 'Архив' : 'Активна';
    const now = new Date().toISOString();
    const statements = familyIds.map(id => env.DB.prepare(`UPDATE entities SET status=CASE WHEN status='Объединена' THEN status ELSE ? END,metadata=json_set(COALESCE(NULLIF(metadata,''),'{}'),'$.localArchive',json(?)),updated_at=? WHERE id=?`)
      .bind(status, JSON.stringify(body.archive), now, id));
    if (body.archive) for (const id of familyIds) statements.push(env.DB.prepare("UPDATE education_students SET status='Архив' WHERE family_entity_id=?").bind(id));
    statements.push(env.DB.prepare("INSERT INTO audit_events(actor,action,entity_type,entity_id,payload) VALUES(?,?,'entity',?,?)")
      .bind(context.actor, body.archive ? 'family.archived' : 'family.restored', family.id, JSON.stringify({ before: family.status, after: status, localArchive: body.archive })));
    await env.DB.batch(statements);
    return reply({ familyId: family.id, status });
    });
  } catch { return reply({ error: 'Не удалось изменить архив семьи. Данные не удалены.' }, 503); }
}
