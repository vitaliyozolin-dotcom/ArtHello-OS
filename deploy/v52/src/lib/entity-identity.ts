/** Confirmed identity aliases only. Names and contacts never establish identity. */
export type IdentityCard = { id: string; entityType: string };
export type IdentityMerge = { survivorId: string; duplicateId: string };
export function buildIdentityIndex(cards: readonly IdentityCard[], merges: readonly IdentityMerge[]) {
  const types = new Map(cards.map(card => [card.id, card.entityType]));
  const parents = new Map<string, string>();
  for (const merge of merges) {
    if (!types.has(merge.duplicateId) || !types.has(merge.survivorId)
      || types.get(merge.duplicateId) !== types.get(merge.survivorId)
      || parents.has(merge.duplicateId)) throw new Error('Invalid confirmed identity link');
    parents.set(merge.duplicateId, merge.survivorId);
  }
  const roots = new Map<string, string>();
  function canonical(id: string): string {
    if (!types.has(id)) throw new Error('Unknown identity');
    if (roots.has(id)) return roots.get(id)!;
    const path = new Set<string>();
    let current = id;
    while (parents.has(current)) {
      if (path.has(current)) throw new Error('Identity cycle');
      path.add(current); current = parents.get(current)!;
    }
    for (const member of path) roots.set(member, current);
    roots.set(id, current);
    return current;
  }
  const groups = new Map<string, string[]>();
  for (const card of cards) {
    const root = canonical(card.id);
    groups.set(root, [...(groups.get(root) ?? []), card.id]);
  }
  return { canonical, members: (id: string) => [...(groups.get(canonical(id)) ?? [])] };
}

/** The production runtime has one worker. Share this lock with AlfaCRM writes. */
let identityMutationTail: Promise<void> = Promise.resolve();
export async function serializeIdentityMutation<T>(action: () => Promise<T>): Promise<T> {
  const previous = identityMutationTail;
  let release!: () => void;
  identityMutationTail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await action(); } finally { release(); }
}
