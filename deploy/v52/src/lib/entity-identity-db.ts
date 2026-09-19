import { buildIdentityIndex, type IdentityMerge } from './entity-identity.ts';
export type IdentityRecord = {
  id: string; entityType: string; status: string; scope: string; metadata: string;
};
export function identityMetadata(text: string): Record<string, unknown> {
  try { const value = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
export async function readIdentityIndex(db: D1Database) {
  const cards = (await db.prepare('SELECT id,entity_type AS entityType,status,scope,metadata FROM entities').all<IdentityRecord>()).results;
  const merges = (await db.prepare('SELECT survivor_id AS survivorId,duplicate_id AS duplicateId FROM entity_merges').all<IdentityMerge>()).results;
  return { cards, merges, ...buildIdentityIndex(cards, merges) };
}

/** Keep source cards and all historical references; project confirmed aliases into current education. */
export function identityProjectionStatements(db: D1Database, cards: IdentityRecord[], merges: IdentityMerge[]) {
  const index = buildIdentityIndex(cards, merges);
  const byId = new Map(cards.map(card => [card.id, card]));
  const statements: D1PreparedStatement[] = [];
  for (const root of cards.filter(card => index.canonical(card.id) === card.id)) {
    const ids = index.members(root.id);
    if (ids.length < 2) continue;
    const localArchive = root.entityType === 'Семья' && ids.some(id => identityMetadata(byId.get(id)!.metadata).localArchive === true);
    const branches = ids.map(id => {
      const card = byId.get(id)!; const meta = identityMetadata(card.metadata);
      return { sourceEntityId: id, scope: card.scope, localBranchId: meta.localBranchId ?? '',
        remoteBranchId: meta.remoteBranchId ?? '',
        customerLifecycle: meta.customerLifecycle ?? null, alfaStatusName: meta.alfaStatusName ?? null,
        attendanceFormat: meta.attendanceFormat ?? null,
        active: !localArchive && meta.localArchive !== true && (meta.identitySourceStatus ?? card.status) === 'Активна' };
    });
    const meta = identityMetadata(root.metadata);
    const status = localArchive || meta.localArchive === true ? 'Архив' : branches.some(branch => branch.active) ? 'Активна' : 'Архив';
    statements.push(db.prepare("UPDATE entities SET status=?,metadata=json_set(metadata,'$.canonicalId',?,'$.branchAssignments',json(?)),updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(status, root.id, JSON.stringify(branches), root.id));
    if (localArchive) statements.push(db.prepare("UPDATE entities SET metadata=json_set(metadata,'$.localArchive',json('true')) WHERE id=?").bind(root.id));
    for (const id of ids.filter(id => id !== root.id)) {
      statements.push(db.prepare("UPDATE entities SET status='Объединена',metadata=json_set(metadata,'$.canonicalId',?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(root.id, id));
      if (root.entityType === 'Сотрудник') {
        for (const [table, column] of [['education_groups','teacher_entity_id'],['education_lessons','teacher_entity_id'],['education_lessons','substitute_entity_id']]) {
          statements.push(db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).bind(root.id, id));
        }
      }
      if (root.entityType === 'Семья' || root.entityType === 'Ребёнок') {
        const column = root.entityType === 'Семья' ? 'family_entity_id' : 'child_entity_id';
        statements.push(db.prepare(`UPDATE education_students SET ${column}=? WHERE ${column}=?`).bind(root.id, id));
      }
    }
    if (root.entityType === 'Сотрудник') statements.push(db.prepare('UPDATE hr_employees SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .bind(status === 'Активна' ? 'Работает' : 'Неактивен в AlfaCRM', root.id));
    if (root.entityType === 'Семья' || root.entityType === 'Ребёнок') {
      const column = root.entityType === 'Семья' ? 'family_entity_id' : 'child_entity_id';
      if (status === 'Архив') statements.push(db.prepare(`UPDATE education_students SET status='Архив' WHERE ${column}=?`).bind(root.id));
    }
  }
  // Keep enrollment IDs for attendance/history; only one current assignment per person/group.
  const children = cards.filter(card => card.entityType === 'Ребёнок' && index.members(card.id).length > 1).map(card => index.canonical(card.id));
  if (children.length) statements.push(db.prepare(`UPDATE education_students SET status='Архив' WHERE status='Активен' AND id IN (
    SELECT id FROM (SELECT id,ROW_NUMBER() OVER (PARTITION BY child_entity_id,group_id ORDER BY id) AS position
      FROM education_students WHERE status='Активен' AND child_entity_id IN (${children.map(() => '?').join(',')})) WHERE position>1)`).bind(...children));
  return statements;
}
export async function refreshIdentityProjections(db: D1Database) {
  const { cards, merges } = await readIdentityIndex(db);
  if (merges.length) await db.batch(identityProjectionStatements(db, cards, merges));
}

/** Existing directory grants still carry source IDs; never silently rekey their principals. */
export async function identityHasAccessBindings(db: D1Database, ids: string[]) {
  const encoded = JSON.stringify(ids);
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('family_system_access','hr_accesses','app_users')").all<{name:string}>()).results;
  if (tables.some(table => table.name === 'family_system_access')) {
    const family = await db.prepare(`SELECT 1 AS found FROM family_system_access WHERE
      family_entity_id IN (SELECT value FROM json_each(?)) OR principal_entity_id IN (SELECT value FROM json_each(?)) OR
      family_entity_id IN (SELECT from_entity_id FROM entity_links WHERE to_entity_id IN (SELECT value FROM json_each(?))) LIMIT 1`)
      .bind(encoded, encoded, encoded).first();
    if (family) return true;
  }
  if (tables.some(table => table.name === 'app_users')) {
    if (await db.prepare('SELECT 1 AS found FROM app_users WHERE id IN (SELECT value FROM json_each(?)) LIMIT 1').bind(encoded).first()) return true;
  }
  if (tables.some(table => table.name === 'hr_accesses')) {
    if (await db.prepare('SELECT 1 AS found FROM hr_accesses WHERE employee_id IN (SELECT value FROM json_each(?)) LIMIT 1').bind(encoded).first()) return true;
  }
  return false;
}
