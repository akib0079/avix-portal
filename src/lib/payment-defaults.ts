import type { PaymentRegion } from "@prisma/client";
import type { PaymentField } from "@/lib/validation/payment";

/**
 * The agency's real bank-transfer details, used to seed the PaymentAccount
 * table on first boot. Editable afterwards from the admin Settings page.
 */

const RECIPIENT = "716 2 Middle Monipur, Mirpur 2, Dhaka 1216, Bangladesh";

export const defaultPaymentAccounts: {
  title: string;
  region: PaymentRegion;
  holderName: string;
  bankName: string;
  bankNote: string;
  note: string;
  fields: PaymentField[];
}[] = [
  {
    title: "USA (USD) — ACH / Domestic wire",
    region: "US_ACH",
    holderName: "Md Akib Zawayed",
    bankName: "JPMorgan Chase Bank, N.A.",
    bankNote: "Bank based in the US · New York, NY",
    note: "For clients paying from the United States in USD.",
    fields: [
      { label: "Account number", value: "30000009776734" },
      { label: "Routing number", value: "028000024" },
      { label: "Account type", value: "Checking (Current)" },
      { label: "Recipient address", value: RECIPIENT },
    ],
  },
  {
    title: "International (SWIFT)",
    region: "INTERNATIONAL_SWIFT",
    holderName: "Md Akib Zawayed",
    bankName: "ClearBank",
    bankNote: "Bank based in the UK · 133 Houndsditch, London, EC3A 7BX",
    note: "For international clients paying by SWIFT transfer.",
    fields: [
      { label: "IBAN", value: "GB07CLRB04281226799669" },
      { label: "BIC / SWIFT", value: "CLRBGB22XXX" },
      { label: "Account type", value: "Checking (Current)" },
      { label: "Recipient address", value: RECIPIENT },
    ],
  },
  {
    title: "Europe (EUR) — SEPA",
    region: "EU_SEPA",
    holderName: "Md Akib Zawayed",
    bankName: "ClearBank",
    bankNote: "Bank based in the UK · 133 Houndsditch, London, EC3A 7BX",
    note: "For EU clients paying in EUR.",
    fields: [
      { label: "IBAN", value: "GB07CLRB04281226799669" },
      { label: "BIC / SWIFT", value: "CLRBGB22XXX" },
      { label: "Account number", value: "26799669" },
      { label: "Sort code", value: "042812" },
      { label: "Recipient address", value: RECIPIENT },
    ],
  },
];
