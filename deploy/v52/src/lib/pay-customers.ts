import { buildIdentityIndex, type IdentityMerge } from './entity-identity.ts';
import { educationConditionKey, permitsEnrollment } from './education-conditions.ts';

type Card = { id: string; entityType: string; displayName: string; status: string; metadata: string; dataQuality: string };
type Link = { fromId: string; toId: string; relation: string };
type CurrentSource = { remoteBranchId: string; recordId: string };
type Condition = { key: string; value: string };
type ReadDatabase = { prepare: (query: string) => { all: <T>() => Promise<{ results: T[] }> } };
export type PayCustomer = {
  familyId: string; studentPersonId: string; studentCrmId: string; studentName: string;
  payerPersonId: string | null; payerName: string; payerPhone: string; payerEmail: string;
  remoteBranchId: string; tuitionExempt: boolean;
};
function metadata(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const sourceId = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
  ? String(value) : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : '';
const normalize = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Read-only projection. Names and contact matches never establish identity. */
export function buildPayCustomers(input: {
  cards: Card[]; links: Link[]; merges: IdentityMerge[]; current: CurrentSource[];
  conditions: Condition[]; branchId: string; query: string; studentPersonId?: string;
}): PayCustomer[] {
  const index = buildIdentityIndex(input.cards, input.merges);
  const cards = new Map(input.cards.map(card => [card.id, card]));
  const current = new Set(input.current.map(row => row.remoteBranchId + ':' + row.recordId));
  const conditions = new Map(input.conditions.map(row => [row.key, metadata(row.value)]));
  const candidates = new Map<string, PayCustomer[]>();
  const isActive = (card: Card) => {
    const root = cards.get(index.canonical(card.id))!;
    const meta = metadata(card.metadata);
    return root.status === 'Активна' && metadata(root.metadata).localArchive !== true
      && meta.localArchive !== true && (meta.identitySourceStatus ?? card.status) === 'Активна';
  };
  for (const child of input.cards.filter(card => card.entityType === 'Ребёнок')) {
    const meta = metadata(child.metadata);
    const remoteBranchId = sourceId(meta.remoteBranchId);
    const studentCrmId = sourceId(meta.alfaCustomerId);
    if (meta.localBranchId !== input.branchId || !isActive(child) || !remoteBranchId || !studentCrmId
      || !current.has(remoteBranchId + ':' + studentCrmId)) continue;
    const studentPersonId = index.canonical(child.id);
    const condition = conditions.get(educationConditionKey(studentPersonId, remoteBranchId));
    const tuitionExempt = permitsEnrollment('open', condition, studentPersonId, remoteBranchId);
    if (!permitsEnrollment(text(meta.customerLifecycle), condition, studentPersonId, remoteBranchId)) continue;
    const families = input.links.filter(link => link.toId === child.id && link.relation === 'Семья → ребёнок')
      .map(link => cards.get(link.fromId)).filter((card): card is Card => !!card && card.entityType === 'Семья' && isActive(card)
        && metadata(card.metadata).localBranchId === input.branchId);
    const familyIds = new Set(families.map(card => index.canonical(card.id)));
    if (familyIds.size !== 1) continue;
    const familyId = [...familyIds][0];
    const sourceFamilies = new Set(families.map(card => card.id));
    const parents = input.links.filter(link => sourceFamilies.has(link.fromId) && link.relation === 'Клиентская карточка семьи')
      .map(link => cards.get(link.toId)).filter((card): card is Card => !!card && card.entityType === 'Клиент' && isActive(card)
        && metadata(card.metadata).localBranchId === input.branchId
        && card.dataQuality === 'Импортировано из AlfaCRM' && !!text(metadata(card.metadata).guardianName));
    // Do not choose a payer or contact when more than one source card qualifies.
    const parent = parents.length === 1 ? parents[0] : undefined;
    const parentMeta = parent ? metadata(parent.metadata) : {};
    const row: PayCustomer = {
      familyId, studentPersonId, studentCrmId,
      studentName: cards.get(studentPersonId)!.displayName,
      payerPersonId: parent ? index.canonical(parent.id) : null,
      payerName: parent ? cards.get(index.canonical(parent.id))!.displayName : '',
      payerPhone: text(parentMeta.phone), payerEmail: text(parentMeta.email),
      remoteBranchId, tuitionExempt,
    };
    candidates.set(studentPersonId, [...(candidates.get(studentPersonId) ?? []), row]);
  }
  const tokens = normalize(input.query.slice(0, 200)).split(' ').filter(Boolean);
  return [...candidates.values()].flatMap(rows => rows.length === 1 ? rows : [])
    .filter(row => !input.studentPersonId || row.studentPersonId === input.studentPersonId)
    .filter(row => {
      const searchable = normalize([row.studentName, row.payerName, row.payerPhone, row.payerEmail, row.studentCrmId].join(' '));
      return tokens.every(token => searchable.includes(token));
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'ru') || a.studentPersonId.localeCompare(b.studentPersonId))
    .slice(0, 50);
}

export async function loadPayCustomers(db: ReadDatabase, branchId: string, query: string, studentPersonId?: string) {
  const branches = await db.prepare("SELECT id FROM organization_branches WHERE status IN ('Active','Активен','Активна')").all<{ id: string }>();
  if (!branches.results.some(branch => branch.id === branchId)) return [];
  const [cards, links, merges, current, conditions] = await Promise.all([
    db.prepare('SELECT id,entity_type AS entityType,display_name AS displayName,status,metadata,data_quality AS dataQuality FROM entities').all<Card>(),
    db.prepare("SELECT from_entity_id AS fromId,to_entity_id AS toId,relation_type AS relation FROM entity_links WHERE relation_type IN ('Семья → ребёнок','Клиентская карточка семьи')").all<Link>(),
    db.prepare('SELECT survivor_id AS survivorId,duplicate_id AS duplicateId FROM entity_merges').all<IdentityMerge>(),
    db.prepare("SELECT remote_branch_id AS remoteBranchId,record_id AS recordId FROM alfacrm_current_records WHERE module='families' AND active=1").all<CurrentSource>(),
    db.prepare("SELECT state_key AS key,state_value AS value FROM system_runtime_state WHERE state_key LIKE 'education_conditions:%'").all<Condition>(),
  ]);
  return buildPayCustomers({ cards: cards.results, links: links.results, merges: merges.results,
    current: current.results, conditions: conditions.results, branchId, query, studentPersonId });
}
