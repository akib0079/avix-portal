/**
 * When the first v49 boot pass ran (lib/work-backfill.ts, FIRST_PASS_KEY).
 * It is written once and never changes, so the first value read is kept for
 * the life of the process; until the row exists (a fresh database before the
 * boot pass) it is read again on every call. Pure: the caller supplies the
 * read and where to keep the value, so it is tested (first-pass.test.ts).
 */
export type FirstPassSlot = { value?: string };

export function firstPassReader(
  read: () => Promise<string | null>,
  slot: FirstPassSlot,
): () => Promise<Date | null> {
  return async () => {
    if (slot.value === undefined) {
      const value = await read();
      if (value == null) return null;
      slot.value = value;
    }
    return new Date(slot.value);
  };
}
