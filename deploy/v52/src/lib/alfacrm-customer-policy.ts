/** Names must be resolved from the source account's status dictionary, never guessed from numeric IDs. */
export type CustomerPolicy = {
  include: boolean;
  lifecycle: 'active' | 'open' | 'unverified' | 'lead' | 'excluded' | 'review';
  attendance: 'single' | 'unspecified';
  destination: 'clients' | 'leads' | 'none';
};

export function customerPolicy(status: unknown): CustomerPolicy {
  const name = typeof status === 'string' ? status.trim() : '';
  const base = { attendance: 'unspecified' as const };
  if (name === 'Активен' || name === 'Активен ШКОЛА') return { ...base, include: true, lifecycle: 'active', destination: 'clients' };
  if (name === 'Открыто') return { ...base, include: true, lifecycle: 'open', destination: 'clients' };
  if (name === 'Разовое посещение') return { include: true, lifecycle: 'unverified', attendance: 'single', destination: 'clients' };
  if (name === 'Запись') return { ...base, include: true, lifecycle: 'lead', destination: 'leads' };
  if (name === 'Пробное занятие' || name === 'Завершил') return { ...base, include: false, lifecycle: 'excluded', destination: 'none' };
  return { ...base, include: false, lifecycle: 'review', destination: 'none' };
}

export type PreviewCustomer = {
  id: string;
  branch: string;
  status: unknown;
  branchIds?: string[];
};

export function resolveCustomerStatuses(records: readonly Record<string, unknown>[], dictionary: readonly Record<string, unknown>[]) {
  const names = new Map<string, string>();
  for (const entry of dictionary) {
    const id = String(entry.id ?? '');
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!/^[1-9]\d*$/.test(id) || !name || names.has(id)) throw new Error('Справочник статусов AlfaCRM не подтверждён');
    names.set(id, name);
  }
  return records.map(record => ({ record, statusName: names.get(String(record.study_status_id ?? '')) ?? null }));
}

/** Pure source preview. It neither writes data nor represents an OS migration plan. */
export function previewCustomers(rows: readonly PreviewCustomer[], branches: readonly string[], snapshot: { complete: boolean }) {
  const byBranch: Record<string, { observed: number; included: number; active: number; open: number; single: number; leads: number; excluded: number; review: number }> = {};
  for (const branch of branches) byBranch[branch] = { observed: 0, included: 0, active: 0, open: 0, single: 0, leads: 0, excluded: 0, review: 0 };
  const seen = new Set<string>();
  const memberships = new Map<string, Set<string>>();
  const schoolAssignments: { id: string; branch: string }[] = [];
  let unknown = 0, duplicates = 0, foreignBranch = 0, excludedStatus = 0, includedAssignments = 0;
  for (const row of rows) {
    const bucket = byBranch[row.branch];
    if (!bucket || !/^[1-9]\d*$/.test(row.id) || !Array.isArray(row.branchIds)
      || !row.branchIds.every(id => typeof id === 'string' && /^[1-9]\d*$/.test(id))) { unknown++; continue; }
    bucket.observed++;
    const key = `${row.branch}:${row.id}`;
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    if (!row.branchIds.includes(row.branch)) { foreignBranch++; continue; }
    const policy = customerPolicy(row.status);
    if (policy.lifecycle === 'review') { unknown++; bucket.review++; continue; }
    if (!policy.include) { excludedStatus++; bucket.excluded++; continue; }
    bucket.included++;
    includedAssignments++;
    if (policy.lifecycle === 'active') bucket.active++;
    if (policy.lifecycle === 'open') bucket.open++;
    if (policy.attendance === 'single') bucket.single++;
    if (policy.destination === 'leads') bucket.leads++;
    if (typeof row.status === 'string' && row.status.trim() === 'Активен ШКОЛА') schoolAssignments.push({ id: row.id, branch: row.branch });
    const memberBranches = memberships.get(row.id) ?? new Set<string>();
    memberBranches.add(row.branch);
    memberships.set(row.id, memberBranches);
  }
  const intersections = [...memberships].filter(([, ids]) => ids.size > 1)
    .map(([id, ids]) => ({ id, branches: [...ids].sort() })).sort((a, b) => a.id.localeCompare(b.id));
  return {
    byBranch, includedAssignments, uniqueIncludedCustomerIds: memberships.size,
    excludedStatus, foreignBranch, unknown, duplicates, intersections, schoolAssignments,
    // A source report cannot justify cleanup while scope, status or routing is unresolved.
    readyForReconciliation: branches.length > 0 && snapshot.complete && unknown === 0 && duplicates === 0 && schoolAssignments.length === 0,
  };
}
