/** Keep the visible list (and its scroll anchor) intact after editing one card. */
export function replaceSavedFamily<T extends { id: string }>(current: T[], saved: T): T[] {
  return current.map((family) => family.id === saved.id ? saved : family);
}
