import "server-only";
import { prisma } from "@/lib/prisma";
import { deleteUpload } from "@/lib/uploads";

/**
 * Per-user ceilings on editor image uploads.
 *
 * Every signed-in user can paste screenshots into chat, which is the point —
 * but it also means any account, including a client's, can write files to the
 * server's disk (or the Supabase bucket) in a loop. The type allowlist and the
 * 5 MB cap in src/lib/uploads.ts bound a *single* upload; nothing bounded the
 * hundredth one. These do.
 *
 * The counters come from the `image_uploads` table rather than an in-memory
 * map, so they survive a restart and stay correct across however many Node
 * processes the host decides to run.
 */

/** CLIENT ceilings. Team accounts get {@link TEAM_FACTOR}× these. */
export const IMAGE_QUOTA = {
  perMinute: 12,
  perDay: 200,
  bytesPerDay: 150 * 1024 * 1024, // 150 MB
} as const;

/**
 * Staff and admins run the agency from this tool — building a campaign or
 * writing a brief can legitimately mean a lot of screenshots in one sitting,
 * and locking the owner out of their own panel is a worse failure than a
 * slightly larger disk.
 */
const TEAM_FACTOR = 3;

export type QuotaVerdict =
  | { ok: true }
  | { ok: false; error: string; retryAfterSeconds: number };

/**
 * Whether `uploaderId` may store one more image of `incomingBytes`.
 *
 * Fails CLOSED: if the counters can't be read, the ImageUpload row that
 * follows a successful save wouldn't be writable either, and letting the
 * upload through would leave bytes on disk with nothing in the database
 * pointing at them.
 */
export async function checkImageQuota(
  uploaderId: string,
  incomingBytes: number,
  role: string,
): Promise<QuotaVerdict> {
  const factor = role === "CLIENT" ? 1 : TEAM_FACTOR;
  const maxPerMinute = IMAGE_QUOTA.perMinute * factor;
  const maxPerDay = IMAGE_QUOTA.perDay * factor;
  const maxBytesPerDay = IMAGE_QUOTA.bytesPerDay * factor;

  const now = Date.now();
  const minuteAgo = new Date(now - 60_000);
  const dayAgo = new Date(now - 24 * 60 * 60_000);

  let recent: number;
  let day: { _count: { _all: number }; _sum: { size: number | null } };
  try {
    [recent, day] = await Promise.all([
      prisma.imageUpload.count({
        where: { uploaderId, createdAt: { gte: minuteAgo } },
      }),
      prisma.imageUpload.aggregate({
        _count: { _all: true },
        _sum: { size: true },
        where: { uploaderId, createdAt: { gte: dayAgo } },
      }),
    ]);
  } catch (err) {
    console.error("[upload-quota] check failed:", (err as Error).message);
    return {
      ok: false,
      error: "Couldn't verify your upload allowance just now — please try again.",
      retryAfterSeconds: 30,
    };
  }

  if (recent >= maxPerMinute) {
    return {
      ok: false,
      error: "That's a lot of images at once — wait a minute and try again.",
      retryAfterSeconds: 60,
    };
  }

  if (day._count._all >= maxPerDay) {
    return {
      ok: false,
      error: `Daily image limit reached (${maxPerDay}). It resets 24 hours after your earliest upload.`,
      retryAfterSeconds: 3600,
    };
  }

  const usedBytes = day._sum.size ?? 0;
  if (usedBytes + incomingBytes > maxBytesPerDay) {
    return {
      ok: false,
      error: `Daily upload size limit reached (${Math.round(maxBytesPerDay / (1024 * 1024))} MB). It resets 24 hours after your earliest upload.`,
      retryAfterSeconds: 3600,
    };
  }

  return { ok: true };
}


/**
 * Second half of the check, run once the row exists.
 *
 * {@link checkImageQuota} reads counts that the pending upload is not yet part
 * of, so N requests arriving together all see the same pre-burst number and all
 * pass — the ceiling holds against a steady stream but not against a scripted
 * burst. This pass runs after the insert, when every racer is visible to every
 * other, and asks a question that has one answer regardless of arrival order:
 * how many of my own uploads sit *before* mine in the window?
 *
 * Ordering is (createdAt, id) — a total order every concurrent request agrees
 * on — so a burst of 100 converges on exactly the limit rather than all 100
 * rolling themselves back.
 *
 * Returns ok:true if the row may stay. Otherwise the row and its file are
 * removed before returning, and the caller should answer 429.
 */
export async function reconcileImageQuota(
  row: { id: string; uploaderId: string; fileName: string; size: number; createdAt: Date },
  role: string,
): Promise<QuotaVerdict> {
  const factor = role === "CLIENT" ? 1 : TEAM_FACTOR;
  const now = row.createdAt.getTime();
  const minuteAgo = new Date(now - 60_000);
  const dayAgo = new Date(now - 24 * 60 * 60_000);

  // "Strictly before me", by the same total order for every racer.
  //
  // The id tie-break is not decoration: Postgres now() is the TRANSACTION
  // timestamp, so a burst arriving on a pooled connection lands with byte-equal
  // createdAt values. Ordering on the timestamp alone leaves whole groups tied
  // and every member of a group counts zero predecessors. (Measured: a 40-way
  // burst produced three distinct timestamps, so 31 rows survived a limit of
  // 12.) The window bound must therefore stay OUT of the top level — an outer
  // `createdAt: { lt: row.createdAt }` ANDs with the OR and silently deletes
  // the tie-break branch, which is exactly how that measurement happened.
  const precedes = {
    uploaderId: row.uploaderId,
    OR: [
      { createdAt: { lt: row.createdAt } },
      { AND: [{ createdAt: row.createdAt }, { id: { lt: row.id } }] },
    ],
  };

  let overMessage: string | null = null;
  try {
    const [minuteBefore, dayBefore] = await Promise.all([
      prisma.imageUpload.count({
        where: { ...precedes, createdAt: { gte: minuteAgo } },
      }),
      prisma.imageUpload.aggregate({
        _count: { _all: true },
        _sum: { size: true },
        where: { ...precedes, createdAt: { gte: dayAgo } },
      }),
    ]);

    if (minuteBefore >= IMAGE_QUOTA.perMinute * factor) {
      overMessage = "That's a lot of images at once — wait a minute and try again.";
    } else if (dayBefore._count._all >= IMAGE_QUOTA.perDay * factor) {
      overMessage = `Daily image limit reached (${IMAGE_QUOTA.perDay * factor}).`;
    } else if ((dayBefore._sum.size ?? 0) + row.size > IMAGE_QUOTA.bytesPerDay * factor) {
      overMessage = `Daily upload size limit reached (${Math.round(
        (IMAGE_QUOTA.bytesPerDay * factor) / (1024 * 1024),
      )} MB).`;
    }
  } catch (err) {
    // The row is already committed and the pre-check passed, so the safe move
    // is to keep it — undoing on an unreadable count could delete a legitimate
    // upload. Worst case the burst ceiling is soft for one request.
    console.error("[upload-quota] reconcile failed:", (err as Error).message);
    return { ok: true };
  }

  if (!overMessage) return { ok: true };

  // Lost the race: undo this upload completely. Row first — an orphaned file is
  // inert, an orphaned row renders as a broken image.
  await prisma.imageUpload.delete({ where: { id: row.id } }).catch(() => {});
  await deleteUpload("images", row.fileName).catch(() => {});

  return { ok: false, error: overMessage, retryAfterSeconds: 60 };
}
