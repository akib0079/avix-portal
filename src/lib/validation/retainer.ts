import { z } from "zod";

export const retainerSchema = z.object({
  title: z.string().trim().min(1, "Name the plan (e.g. Monthly maintenance)").max(160),
  clientId: z.string().min(1, "Pick a client"),
  // "none" = not tied to a project
  projectId: z.string().min(1),
  amount: z
    .number({ message: "Enter the monthly amount" })
    .positive("Amount must be greater than zero")
    .max(9999999),
  // Capped at 28 so it exists in every month.
  dayOfMonth: z.number().int().min(1).max(28),
  active: z.boolean(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type RetainerInput = z.infer<typeof retainerSchema>;
