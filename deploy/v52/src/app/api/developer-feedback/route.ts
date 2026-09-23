import { env } from 'cloudflare:workers';
import { moduleCatalog } from '../../../data/test-snapshot';
import { ensureCoreTables } from '../../../db';
import { canAccessApi } from '../../../lib/access-policy';
import {
  createFeedback, ensureDeveloperFeedbackTables, feedbackStatuses, listFeedback,
  parseFeedbackSubmission, updateFeedbackStatus, type FeedbackActor, type FeedbackStatus,
} from '../../../lib/developer-feedback';
import {
  getAuthenticatedRequestContext, isCanonicalOwnerContext, verifyAuthenticatedRequestCsrf,
} from '../../../lib/production-auth';
import { hasTrustedMutationOrigin } from '../../../lib/request-security';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 4_300_000;
const knownModules = moduleCatalog.map((module) => module.id);

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'private, no-store, max-age=0' } });
}

async function authenticate(request: Request) {
  try {
    const context = await getAuthenticatedRequestContext(request);
    if (!context) return response({ error: 'Требуется вход' }, 401);
    if (context.auth.user.mustChangePassword || !canAccessApi(context.auth.user, '/api/developer-feedback', request.method)) {
      return response({ error: 'Нет доступа' }, 403);
    }
    if (request.method !== 'GET') {
      const publicOrigin = (env as unknown as { ARTHELLO_PUBLIC_ORIGIN?: string }).ARTHELLO_PUBLIC_ORIGIN ?? '';
      if (!hasTrustedMutationOrigin(request, publicOrigin)) return response({ error: 'Источник запроса не совпадает' }, 403);
      try { verifyAuthenticatedRequestCsrf(request, context); }
      catch { return response({ error: 'Защитная сессия устарела. Войдите заново.' }, 403); }
    }
    return { userId: context.appUserId, name: context.appUserName, owner: isCanonicalOwnerContext(context) } satisfies FeedbackActor;
  } catch { return response({ error: 'Сервис авторизации временно недоступен' }, 503); }
}

export async function GET(request: Request) {
  const actor = await authenticate(request);
  if (actor instanceof Response) return actor;
  const query = new URL(request.url).searchParams;
  const imageId = query.get('image');
  if (imageId !== null) {
    if (!/^[1-9][0-9]*$/.test(imageId) || !Number.isSafeInteger(Number(imageId))) return response({ error: 'Некорректное вложение' }, 400);
    try {
      await ensureCoreTables(); await ensureDeveloperFeedbackTables(env.DB);
      const image = await env.DB.prepare(`SELECT i.image_base64,i.mime_type FROM developer_feedback_images i
        JOIN developer_feedback f ON f.id=i.feedback_id WHERE i.id=? AND (f.author_user_id=? OR ?=1)`)
        .bind(Number(imageId), actor.userId, actor.owner ? 1 : 0).first<{ image_base64: string; mime_type: string }>();
      if (!image) return response({ error: 'Вложение не найдено' }, 404);
      const bytes = Uint8Array.from(atob(image.image_base64), (char) => char.charCodeAt(0));
      return new Response(bytes, { headers: { 'content-type': image.mime_type, 'content-disposition': 'inline', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' } });
    } catch { return response({ error: 'Не удалось загрузить вложение' }, 503); }
  }
  const scope = query.get('scope') ?? 'mine';
  if (scope !== 'mine' && scope !== 'all') return response({ error: 'Неизвестный список обращений' }, 400);
  if (scope === 'all' && !actor.owner) return response({ error: 'Все обращения доступны только собственнику' }, 403);
  const cursor = query.get('before');
  if (cursor !== null && (!/^[1-9][0-9]*$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) return response({ error: 'Некорректная страница' }, 400);
  try {
    await ensureCoreTables();
    await ensureDeveloperFeedbackTables(env.DB);
    return response({ ...await listFeedback(env.DB, actor, scope === 'all', Number(cursor ?? 0)), canManage: actor.owner });
  } catch { return response({ error: 'Не удалось загрузить обращения. Повторите попытку.' }, 503); }
}

export async function POST(request: Request) {
  const actor = await authenticate(request);
  if (actor instanceof Response) return actor;
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return response({ error: 'Обращение слишком большое' }, 413);
  let value: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return response({ error: 'Обращение слишком большое' }, 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return response({ error: 'Некорректное обращение' }, 400);
    if (new TextEncoder().encode(raw).byteLength > 26000 && !Array.isArray((parsed as Record<string, unknown>).images)) return response({ error: 'Обращение слишком большое' }, 413);
    value = parsed as Record<string, unknown>;
  } catch { return response({ error: 'Некорректный JSON' }, 400); }
  if (value.action === 'setStatus' && !actor.owner) return response({ error: 'Статус меняет только собственник' }, 403);
  const submission = value.action === 'create' ? parseFeedbackSubmission(value, knownModules) : null;
  if (value.action === 'create' && !submission) return response({ error: 'Проверьте тип, тему и описание обращения' }, 400);
  if (value.action === 'setStatus') {
    if (Object.keys(value).some((key) => !['action','id','revision','status'].includes(key)) ||
      !Number.isSafeInteger(value.id) || Number(value.id) <= 0 || !Number.isSafeInteger(value.revision) || Number(value.revision) <= 0 ||
      typeof value.status !== 'string' || !Object.hasOwn(feedbackStatuses, value.status)) {
      return response({ error: 'Некорректный статус обращения' }, 400);
    }
  } else if (!submission) return response({ error: 'Неизвестное действие' }, 400);
  try {
    await ensureCoreTables();
    await ensureDeveloperFeedbackTables(env.DB);
    if (submission) {
      const item = await createFeedback(env.DB, actor, submission);
      return item ? response({ item }, 201) : response({ error: 'Этот запрос уже сохранён с другим содержимым' }, 409);
    }
    const result = await updateFeedbackStatus(env.DB, actor, Number(value.id), Number(value.revision), value.status as FeedbackStatus);
    if (result.kind === 'missing') return response({ error: 'Обращение не найдено' }, 404);
    if (result.kind === 'conflict') return response({ error: 'Обращение уже изменено. Обновите список.' }, 409);
    return response({ item: result.item });
  } catch { return response({ error: 'Не удалось сохранить обращение. Повторите попытку.' }, 503); }
}
