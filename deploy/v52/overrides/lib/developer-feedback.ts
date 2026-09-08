import { developerFeedbackColumns, developerFeedbackSchema } from './developer-feedback-schema';

export const feedbackKinds = { bug: 'Ошибка', suggestion: 'Предложение' } as const;
export const feedbackStatuses = { new: 'Новое', reviewing: 'На рассмотрении', planned: 'Запланировано', done: 'Готово', declined: 'Отклонено' } as const;
export type FeedbackStatus = keyof typeof feedbackStatuses;
export type FeedbackRecord = {
  id: number; author_user_id: string; author_name: string; kind: keyof typeof feedbackKinds;
  title: string; body: string; module_id: string; status: FeedbackStatus;
  revision: number; created_at: string; updated_at: string;
};
type Result = { meta: { changes?: number } };
export interface FeedbackStatement {
  bind(...values: unknown[]): FeedbackStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<Result>;
}
export interface FeedbackDatabase {
  prepare(sql: string): FeedbackStatement;
  batch(statements: FeedbackStatement[]): Promise<Result[]>;
}
export type FeedbackActor = { userId: string; name: string; owner: boolean };
const columns = 'id,author_user_id,author_name,kind,title,body,module_id,status,revision,created_at,updated_at';
const schemaPromises = new WeakMap<FeedbackDatabase, Promise<void>>();

export async function ensureDeveloperFeedbackTables(db: FeedbackDatabase) {
  let promise = schemaPromises.get(db);
  if (!promise) {
    promise = (async () => {
      await db.batch(developerFeedbackSchema.map((statement) => db.prepare(statement)));
      for (const [table, required] of Object.entries(developerFeedbackColumns)) {
        const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
        if (!required.every((column) => results.some((row) => row.name === column))) {
          throw new Error('Developer feedback schema is incomplete');
        }
      }
    })().catch((error) => { schemaPromises.delete(db); throw error; });
    schemaPromises.set(db, promise);
  }
  await promise;
}

export function parseFeedbackSubmission(value: unknown, knownModules: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['action','submissionId','kind','title','body','moduleId'].includes(key))) return null;
  if (record.action !== 'create' || (record.kind !== 'bug' && record.kind !== 'suggestion')) return null;
  if (typeof record.submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.submissionId)) return null;
  if (typeof record.title !== 'string' || typeof record.body !== 'string') return null;
  const title = record.title.trim(), body = record.body.trim();
  if (!title || title.length > 160 || !body || body.length > 6000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(title + body)) return null;
  if (typeof record.moduleId !== 'string' || (record.moduleId !== '' && !knownModules.includes(record.moduleId))) return null;
  return { submissionId: record.submissionId, kind: record.kind, title, body, moduleId: record.moduleId };
}

export async function listFeedback(db: FeedbackDatabase, actor: FeedbackActor, all: boolean, before = 0) {
  if (all && !actor.owner) throw new Error('Feedback scope denied');
  const predicates: string[] = [], bindings: unknown[] = [];
  if (!all) { predicates.push('author_user_id = ?'); bindings.push(actor.userId); }
  if (before) { predicates.push('id < ?'); bindings.push(before); }
  const where = predicates.length ? ` WHERE ${predicates.join(' AND ')}` : '';
  const { results } = await db.prepare(`SELECT ${columns} FROM developer_feedback${where} ORDER BY id DESC LIMIT 51`).bind(...bindings).all<FeedbackRecord>();
  const items = results.slice(0, 50);
  return { items, nextBefore: results.length > 50 ? items[items.length - 1].id : null };
}

export async function createFeedback(db: FeedbackDatabase, actor: FeedbackActor, value: NonNullable<ReturnType<typeof parseFeedbackSubmission>>) {
  const now = new Date().toISOString();
  // Both creation and its first audit event commit atomically. A lost HTTP response
  // is safely retried using the same author-scoped submission UUID.
  await db.batch([
    db.prepare(`INSERT INTO developer_feedback (submission_id,author_user_id,author_name,kind,title,body,module_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(author_user_id,submission_id) DO NOTHING`)
      .bind(value.submissionId, actor.userId, actor.name, value.kind, value.title, value.body, value.moduleId, now, now),
    db.prepare(`INSERT INTO developer_feedback_events (feedback_id,revision,actor_user_id,status,created_at)
      SELECT id,1,author_user_id,'new',created_at FROM developer_feedback WHERE author_user_id=? AND submission_id=?
      ON CONFLICT(feedback_id,revision) DO NOTHING`).bind(actor.userId, value.submissionId),
  ]);
  const row = await db.prepare(`SELECT ${columns} FROM developer_feedback WHERE author_user_id=? AND submission_id=?`)
    .bind(actor.userId, value.submissionId).first<FeedbackRecord>();
  if (!row) throw new Error('Feedback insert did not persist');
  if (row.title !== value.title || row.body !== value.body || row.kind !== value.kind || row.module_id !== value.moduleId) return null;
  return row;
}

export async function updateFeedbackStatus(db: FeedbackDatabase, actor: FeedbackActor, id: number, revision: number, status: FeedbackStatus) {
  if (!actor.owner) throw new Error('Feedback status denied');
  const now = new Date().toISOString();
  const result = await db.batch([
    db.prepare(`INSERT INTO developer_feedback_events (feedback_id,revision,actor_user_id,status,created_at)
      SELECT id,revision+1,?,?,? FROM developer_feedback WHERE id=? AND revision=? AND status<>?`)
      .bind(actor.userId, status, now, id, revision, status),
    db.prepare(`UPDATE developer_feedback SET status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status<>?`)
      .bind(status, now, id, revision, status),
  ]);
  const row = await db.prepare(`SELECT ${columns} FROM developer_feedback WHERE id=?`).bind(id).first<FeedbackRecord>();
  if (!row) return { kind: 'missing' as const };
  if (!result[1].meta.changes && (row.revision !== revision || row.status !== status)) return { kind: 'conflict' as const };
  return { kind: 'saved' as const, item: row };
}
