import { z } from "zod";
import { currencyCodes } from "@/lib/currency";
import { isDay } from "@/lib/recurring";

/**
 * When a recurring plan's invoices come: how often, the next one, where it
 * stops, and whether each new invoice waits as a draft or goes straight to
 * the client. Shared by the plan form, "Make recurring" on an invoice and the
 * Repeat section of a new one. Dates are calendar days in the agency's zone.
 */
export const scheduleSchema = z
  .object({
    frequency: z.enum(["WEEK", "MONTH"]),
    interval: z
      .number({ message: "Say how often" })
      .int("Use a whole number")
      .min(1, "At least 1")
      .max(52, "Up to 52"),
    /** The next invoice's date; for a new plan, the first one's. */
    nextDate: z.string().refine(isDay, "Pick a date"),
    ends: z.enum(["never", "after", "on"]),
    endAfterCount: z.number().int("Use a whole number").min(1).max(520).nullish(),
    endDate: z.string().optional().or(z.literal("")),
    /** Send each new invoice instead of leaving a draft. Missed periods are always drafts. */
    autoSend: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.frequency === "MONTH" && value.interval > 24) {
      ctx.addIssue({ code: "custom", path: ["interval"], message: "Up to every 24 months" });
    }
    if (value.ends === "after" && !value.endAfterCount) {
      ctx.addIssue({ code: "custom", path: ["endAfterCount"], message: "How many invoices?" });
    }
    if (value.ends === "on") {
      if (!value.endDate || !isDay(value.endDate)) {
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "Pick the last date" });
      } else if (value.endDate < value.nextDate) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: "The end can't come before the next invoice",
        });
      }
    }
  });

export type ScheduleInput = z.infer<typeof scheduleSchema>;

/** A plan as the Recurring page creates and edits it. */
export const retainerSchema = z.object({
  title: z.string().trim().min(1, "Name the plan (e.g. Monthly maintenance)").max(160),
  clientId: z.string().min(1, "Pick a client"),
  // "none" = not tied to a project
  projectId: z.string().min(1),
  /** What each invoice bills; a plan with a template takes the template's total. */
  amount: z
    .number({ message: "Enter the amount per invoice" })
    .positive("Amount must be greater than zero")
    .max(9999999),
  currency: z.enum(currencyCodes),
  /**
   * What one invoice is worth in USD, for a plan billed in another currency.
   * MRR only: each invoice still gets the value it settles at entered by
   * hand, like any other.
   */
  amountUsd: z.number().min(0).max(9999999).nullish(),
  paymentTermsDays: z.number().int().min(0).max(365).nullish(),
  active: z.boolean(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  schedule: scheduleSchema,
});

export type RetainerInput = z.infer<typeof retainerSchema>;

/** Making one invoice repeat: the plan's name and its schedule. */
export const repeatSchema = z.object({
  title: z.string().trim().min(1, "Name the plan (e.g. Monthly maintenance)").max(160),
  schedule: scheduleSchema,
});

export type RepeatInput = z.infer<typeof repeatSchema>;
