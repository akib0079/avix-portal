/**
 * Read-state rules for an open message thread. Dependency-free so the client
 * thread and its tests share it.
 */

type ReadableMessage = {
  senderRole: "ADMIN" | "CLIENT";
  readByAdminAt: string | null;
  readByClientAt: string | null;
};

/**
 * True when messages that just landed in an open thread give the viewer
 * something to mark read: one from the other side that the viewer's side
 * hasn't read yet. Your own send, or older pages loaded from history, used to
 * fire markThreadRead anyway: two round trips that matched no rows, then a
 * badge refetch and, on the Messages pages, a page refresh.
 */
export function shouldMarkRead(
  fresh: readonly ReadableMessage[],
  viewerRole: "ADMIN" | "CLIENT",
): boolean {
  const field = viewerRole === "ADMIN" ? "readByAdminAt" : "readByClientAt";
  return fresh.some((m) => m.senderRole !== viewerRole && !m[field]);
}
