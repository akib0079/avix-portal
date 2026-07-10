import { z } from "zod";

export const timeEntrySchema = z.object({
  // "YYYY-MM-DD" from a date input
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  hours: z
    .number({ message: "Enter hours worked" })
    .positive("Enter hours worked")
    .max(999.99),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type TimeEntryInput = z.infer<typeof timeEntrySchema>;
