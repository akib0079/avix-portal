import { z } from "zod";
import type { ProposalStatus } from "@prisma/client";
import { projectTypeValues } from "@/lib/validation/project";
import { currencyCodes } from "@/lib/currency";
import { SIGNATURE_DATA_URL_MAX } from "@/lib/signature-rules";

export const proposalStatusValues = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
] as const;

export const proposalStatusLabels: Record<ProposalStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
};

export const proposalItemSchema = z.object({
  description: z.string().trim().min(1, "Describe this line item").max(200),
  amount: z.number().min(0, "Amount can't be negative").max(9999999),
});

/** Step-2 invoice line (qty × rate, like the standalone invoice entry). */
export const proposalInvoiceItemSchema = z.object({
  description: z.string().trim().min(1, "Describe this line item").max(200),
  qty: z.number().min(0).max(100000),
  rate: z.number().min(0).max(9999999),
});

/** The full deposit/first invoice built alongside the proposal (step 2). */
export const proposalInvoiceSchema = z.object({
  title: z.string().trim().max(160).optional().or(z.literal("")),
  currency: z.enum(currencyCodes),
  paymentAccountId: z.string().optional().or(z.literal("")),
  invoiceNumber: z.string().trim().max(40).optional().or(z.literal("")),
  issueDate: z.string().min(1, "Issue date is required"),
  dueDate: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  billToCompany: z.string().trim().max(160).optional().or(z.literal("")),
  billToAddress: z.string().trim().max(300).optional().or(z.literal("")),
  billToEmail: z.string().trim().email("Enter a valid email").max(255).optional().or(z.literal("")),
  items: z.array(proposalInvoiceItemSchema).min(1, "Add at least one invoice line"),
});

/** Where the recipient comes from: an existing pipeline lead, or typed in by hand. */
export const proposalSourceValues = ["lead", "manual"] as const;

export const proposalSchema = z
  .object({
    source: z.enum(proposalSourceValues),
    // Required when source === "lead"
    leadId: z.string().optional().or(z.literal("")),
    // Required when source === "manual"
    recipientName: z.string().trim().max(160).optional().or(z.literal("")),
    recipientEmail: z
      .string()
      .trim()
      .email("Enter a valid email")
      .max(255)
      .optional()
      .or(z.literal("")),
    recipientCompany: z.string().trim().max(160).optional().or(z.literal("")),
    title: z.string().trim().min(1, "Title is required").max(160),
    intro: z.string().trim().max(5000).optional().or(z.literal("")),
    /** What the scope is priced in; the first invoice defaults to it. */
    currency: z.enum(currencyCodes),
    /** Payment terms, ownership, revisions, cancellation — plain text. */
    terms: z.string().trim().max(10000).optional().or(z.literal("")),
    projectType: z.enum(projectTypeValues),
    timelineWeeks: z.number().int().min(1).max(104).nullable().optional(),
    depositPercent: z.number().int().min(0).max(100),
    expiresInDays: z.number().int().min(1).max(120),
    /** Optional invoice document link (Drive/Dropbox). Upload is a separate file field. */
    invoicePdfExternalUrl: z
      .string()
      .trim()
      .max(1000)
      .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), {
        message: "Enter a full link starting with http:// or https://",
      })
      .optional()
      .or(z.literal("")),
    /** Set by the builder when the user clears an existing attachment. */
    removeInvoicePdf: z.boolean().optional(),
    items: z.array(proposalItemSchema).min(1, "Add at least one line item"),
    /** Step 2 — the full invoice created for the client alongside the proposal. */
    invoice: proposalInvoiceSchema,
  })
  .superRefine((val, ctx) => {
    if (val.source === "lead") {
      if (!val.leadId) {
        ctx.addIssue({ code: "custom", path: ["leadId"], message: "Pick a lead" });
      }
      return;
    }
    if (!val.recipientName) {
      ctx.addIssue({
        code: "custom",
        path: ["recipientName"],
        message: "Who is this proposal for?",
      });
    }
    // The email is the accept-link destination and becomes their login.
    if (!val.recipientEmail) {
      ctx.addIssue({
        code: "custom",
        path: ["recipientEmail"],
        message: "An email is required — the proposal is sent to it",
      });
    }
  });

export type ProposalInput = z.infer<typeof proposalSchema>;
export type ProposalItemInput = z.infer<typeof proposalItemSchema>;

/** Who agreed, for an acceptance the admin records on the client's behalf. */
export const acceptProposalSchema = z.object({
  signedName: z.string().trim().min(2, "Type your full name").max(120),
});

/** No line breaks, tabs or other control characters: these go onto a certificate. */
const plainLine = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

/**
 * Public signing. Anyone with the link can post this, so every field is
 * capped, and nothing in it is trusted beyond what it is: the server rebuilds
 * the document from the database and only compares documentHash with it, and
 * checks the PNG byte by byte (src/lib/signature-png.ts).
 */
export const signProposalSchema = z
  .object({
    signerName: z
      .string()
      .trim()
      .min(2, "Type your full name")
      .max(120, "Keep your name under 120 characters")
      .refine(plainLine, "Type your name on one line"),
    signerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid email for your signed copy")
      .max(255),
    signerTitle: z.string().trim().max(120).refine(plainLine).optional().or(z.literal("")),
    signerCompany: z.string().trim().max(160).refine(plainLine).optional().or(z.literal("")),
    method: z.enum(["DRAWN", "TYPED"]),
    /** DRAWN only: the trimmed PNG as a data URL. */
    imagePng: z.string().max(SIGNATURE_DATA_URL_MAX, "Your signature image is too large").optional(),
    consent: z.literal(true, { message: "Tick the box to agree to sign electronically" }),
    consentVersion: z.string().max(64),
    /** The hash of the document the page rendered. */
    documentHash: z.string().regex(/^[0-9a-f]{64}$/, "Reload the proposal and sign again"),
    /** The signer's browser zone, for their local time on the certificate. */
    timeZone: z.string().max(64).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.method === "DRAWN" && !value.imagePng) {
      ctx.addIssue({
        code: "custom",
        path: ["imagePng"],
        message: "Draw your signature in the box, or choose Type.",
      });
    }
    if (value.method === "TYPED" && value.imagePng) {
      ctx.addIssue({ code: "custom", path: ["imagePng"], message: "A typed signature has no drawing." });
    }
  });

export type SignProposalInput = z.input<typeof signProposalSchema>;

/** Public decline: the reason is optional, and capped because anyone with the link can post it. */
export const declineProposalSchema = z.object({
  reason: z.string().trim().max(1000, "Keep it under 1,000 characters").optional().or(z.literal("")),
});

/** Validity windows offered when sending or extending. */
export const proposalValidityDays = [7, 14, 30, 60, 90] as const;

export const extendProposalSchema = z.object({
  days: z.number().int().min(1).max(120),
});

/** Who a duplicate is for: the same recipient, a pipeline lead, or someone typed in. */
export const duplicateProposalSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("same") }),
  z.object({ source: z.literal("lead"), leadId: z.string().min(1, "Pick a lead") }),
  z.object({
    source: z.literal("manual"),
    recipientName: z.string().trim().min(1, "Who is this proposal for?").max(160),
    recipientEmail: z.string().trim().email("Enter a valid email").max(255),
    recipientCompany: z.string().trim().max(160).optional().or(z.literal("")),
  }),
]);

export type DuplicateProposalInput = z.infer<typeof duplicateProposalSchema>;
