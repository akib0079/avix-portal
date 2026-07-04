import { z } from "zod";

export const paymentRegionValues = [
  "US_ACH",
  "INTERNATIONAL_SWIFT",
  "EU_SEPA",
] as const;

export const paymentFieldSchema = z.object({
  label: z.string().trim().min(1, "Field label is required").max(60),
  value: z.string().trim().min(1, "Field value is required").max(120),
});

export const paymentAccountSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(80),
  region: z.enum(paymentRegionValues),
  holderName: z.string().trim().min(1, "Account holder is required").max(120),
  bankName: z.string().trim().min(1, "Bank name is required").max(120),
  bankNote: z.string().trim().max(200).optional().or(z.literal("")),
  note: z.string().trim().max(300).optional().or(z.literal("")),
  isActive: z.boolean(),
  fields: z
    .array(paymentFieldSchema)
    .min(1, "Add at least one field")
    .max(12, "Too many fields"),
});

export type PaymentAccountInput = z.infer<typeof paymentAccountSchema>;
export type PaymentField = z.infer<typeof paymentFieldSchema>;

export const paymentRegionLabels: Record<
  (typeof paymentRegionValues)[number],
  string
> = {
  US_ACH: "USA · ACH",
  INTERNATIONAL_SWIFT: "International · SWIFT",
  EU_SEPA: "Europe · SEPA",
};
