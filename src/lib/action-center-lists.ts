/**
 * Pure list helpers for the client's Action Centre (src/lib/dal/portal-actions.ts).
 */

/**
 * The newest `cap` rows overall, from lists read per project (each newest
 * first, `cap + 1` long). The overall newest `cap + 1` are always among them,
 * so `more` is true exactly when the client has more than `cap` in all.
 */
export function newestCapped<T extends { createdAt: Date }>(
  rows: T[],
  cap: number,
): { list: T[]; more: boolean } {
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { list: sorted.slice(0, cap), more: sorted.length > cap };
}
