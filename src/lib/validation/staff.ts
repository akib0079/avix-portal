import { z } from "zod";

export const staffSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().max(80).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email").max(255),
});

export type StaffInput = z.infer<typeof staffSchema>;
