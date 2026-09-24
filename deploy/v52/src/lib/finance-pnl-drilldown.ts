/** Resolve the complete article membership without including another period or duplicate ID. */
export function operationsForPnlLine<T extends { id: string; period: string }>(operations: T[], operationIds: string[], period: string): T[] {
  const byId = new Map(operations.filter((operation) => operation.period === period).map((operation) => [operation.id, operation]));
  return [...new Set(operationIds)].flatMap((id) => {
    const operation = byId.get(id);
    return operation ? [operation] : [];
  });
}
