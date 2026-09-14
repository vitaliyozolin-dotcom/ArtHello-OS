export function filterAccessibleBranches<T extends { id: string }>(
  branches: readonly T[],
  access: readonly { branchId: string }[],
  isAdministrative: boolean,
): T[] {
  if (isAdministrative) return [...branches];
  const granted = new Set(
    access.map(({ branchId }) => branchId).filter(Boolean),
  );
  return branches.filter(({ id }) => granted.has(id));
}
