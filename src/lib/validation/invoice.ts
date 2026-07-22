import { z } from "zod";

export const invoiceStatusValues = ["ASSIGNED", "SENT", "IN_REVIEW", "PAID"] as const;

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, "Describe this line item").max(200),
  qty: z.number().min(0.01, "Qty must be positive").max(9999),
  rate: z.number().min(0).max(9999999),
});

export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;

export const invoiceSchema = z.object({
  /** Optional line items; when present the server recomputes amount = Σ qty×rate. */
  items: z.array(invoiceItemSchema).max(50).optional(),
  clientId: z.string().min(1, "Select a client"),
  // "none" = not linked to a project
  projectId: z.string().min(1),
  // With line items the amount is derived (callers pass 0); without items the
  // superRefine below demands a positive value.
  amount: z.number({ message: "Enter an amount" }).min(0).max(9999999, "Amount is too large"),
  status: z.enum(invoiceStatusValues),
  issueDate: z.string().min(1, "Issue date is required"),
  dueDate: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  // External file link (Drive/Dropbox); empty string = none
  pdfExternalUrl: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), {
      message: "Link must start with http(s)://",
    })
    .optional()
    .or(z.literal("")),
}).superRefine((val, ctx) => {
  if ((!val.items || val.items.length === 0) && val.amount <= 0) {
    ctx.addIssue({
      code: "custom",
      path: ["amount"],
      message: "Enter an amount (or add line items)",
    });
  }
});

export type InvoiceInput = z.infer<typeof invoiceSchema>;
