import { z } from "zod";

export const messageSchema = z.object({
  projectId: z.string().min(1),
  body: z.unknown(),
});

export type MessageInput = z.infer<typeof messageSchema>;
