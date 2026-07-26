import { z } from "zod";

export const deliverableSchema = z.object({
  title: z.string().trim().min(1, "Give this deliverable a name").max(160),
  /** External link (Figma/Drive/etc); empty = an uploaded file is expected. */
  externalUrl: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), {
      message: "Enter a full link starting with http:// or https://",
    })
    .optional()
    .or(z.literal("")),
});

export type DeliverableInput = z.infer<typeof deliverableSchema>;
