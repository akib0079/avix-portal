import { z } from "zod";

export const meetingDurations = [15, 30, 45, 60, 90, 120] as const;

export const meetingSchema = z.object({
  title: z.string().trim().min(1, "Give the meeting a title").max(160),
  clientId: z.string().min(1, "Pick a client"),
  // "none" = not tied to a project
  projectId: z.string().min(1),
  /** UTC instant computed in the admin's browser from their local date+time. */
  startsAtIso: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a date and time"),
  durationMins: z
    .number()
    .int()
    .min(15, "Too short")
    .max(480, "Too long"),
  meetingUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), {
      message: "Meeting link must start with http(s)://",
    })
    .optional()
    .or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type MeetingInput = z.infer<typeof meetingSchema>;
