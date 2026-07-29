import { z } from "zod";

/** Client-editable profile fields (their own account only). */
export const clientProfileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().max(80).optional().or(z.literal("")),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  /** IANA zone — validated against Intl on the server. */
  timezone: z.string().trim().max(64).optional().or(z.literal("")),
  /** Opt out of marketing emails (transactional mail is unaffected). */
  marketingOptOut: z.boolean(),
});

export type ClientProfileInput = z.infer<typeof clientProfileSchema>;
