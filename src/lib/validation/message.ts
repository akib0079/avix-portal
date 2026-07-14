import { z } from "zod";

export const messageSchema = z.object({
  /** null/absent = the client's general thread (no project selected) */
  projectId: z.string().min(1).nullable().optional(),
  /** Required when an ADMIN posts into a thread; clients always use their own id. */
  clientId: z.string().min(1).optional(),
  body: z.unknown(),
});

export type MessageInput = z.infer<typeof messageSchema>;
