import { z } from "zod";

/** A work item's price, as the accept dialog and the drawer's price editor take it. */
export const pricingFields = {
  pricingType: z.enum(["NONE", "HOURLY", "FIXED"]),
  hourlyRate: z.number().min(0).max(99999).nullable().optional(),
  estimatedHours: z.number().min(0).max(9999).nullable().optional(),
  fixedPrice: z.number().min(0).max(9999999).nullable().optional(),
};
