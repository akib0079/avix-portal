/**
 * How an edit writes an invoice's lines.
 *
 * A save used to delete every line and insert the form's again. A line made
 * by "Bill work" is linked to the work it bills (the milestone on the line,
 * the hours pointing at it), so every edit, even a typo fixed in the notes,
 * unlinked that work and "Bill work" offered it again. Now a line that bills
 * tracked work is updated in place and keeps its links. Every other line is
 * replaced as before, which is one statement however many lines there are.
 * A linked line the edit removed is deleted, and frees its work.
 *
 * Only ids of the invoice's own linked lines are honoured: anything else the
 * form sends is a new line.
 *
 * Dependency-free so the tests can reach it.
 */
export function itemWrites<T extends { id?: string }>(
  items: T[],
  linkedIds: ReadonlySet<string>,
): {
  /** Saved lines kept in place, at their new position. */
  update: { id: string; index: number; item: T }[];
  create: { index: number; item: T }[];
  /** Every line not in here is deleted. */
  keepIds: string[];
} {
  const update: { id: string; index: number; item: T }[] = [];
  const create: { index: number; item: T }[] = [];
  const kept = new Set<string>();
  items.forEach((item, index) => {
    if (item.id && linkedIds.has(item.id) && !kept.has(item.id)) {
      kept.add(item.id);
      update.push({ id: item.id, index, item });
    } else {
      create.push({ index, item });
    }
  });
  return { update, create, keepIds: [...kept] };
}

/** A kept line as it is saved, or as the edit has it now. */
type LineState = {
  description: string;
  descriptionRich?: unknown;
  qty: number | { toString(): string };
  rate: number | { toString(): string };
  sortOrder: number;
};

/**
 * Whether an edit changes a kept line. Only changed lines are written, so a
 * save that leaves them alone (a note, a date, the status) doesn't rewrite
 * every line of an invoice made by Bill work. Amounts compare to the cent, as
 * they are stored, and the formatting key by key: jsonb doesn't keep the
 * order the editor wrote its keys in.
 */
export function lineChanged(saved: LineState, next: LineState): boolean {
  return (
    saved.description !== next.description ||
    saved.sortOrder !== next.sortOrder ||
    inCents(saved.qty) !== inCents(next.qty) ||
    inCents(saved.rate) !== inCents(next.rate) ||
    canonicalJson(saved.descriptionRich) !== canonicalJson(next.descriptionRich)
  );
}

function inCents(value: number | { toString(): string }): number {
  return Math.round(Number(value) * 100);
}

/** JSON with every object's keys sorted, so equal documents read the same. */
function canonicalJson(value: unknown): string {
  const sorted = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sorted);
    if (!node || typeof node !== "object") return node;
    const record = node as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sorted(record[key])]),
    );
  };
  return JSON.stringify(sorted(value ?? null));
}
