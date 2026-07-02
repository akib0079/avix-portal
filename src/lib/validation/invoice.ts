import { z } from "zod";

export const invoiceStatusValues = ["ASSIGNED", "SENT", "IN_REVIEW", "PAID"] as const;

export const invoiceSchema = z.object({
  clientId: z.string().min(1, "Select a client"),
  // "none" = not linked to a project
  projectId: z.string().min(1),
  amount: z
    .number({ message: "Enter an amount" })
    .positive("Amount must be greater than zero")
    .max(9999999, "Amount is too large"),
  status: z.enum(invoiceStatusValues),
  issueDate: z.string().min(1, "Issue date is required"),
  dueDate: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type InvoiceInput = z.infer<typeof invoiceSchema>;
