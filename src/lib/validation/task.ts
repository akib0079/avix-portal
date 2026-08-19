import { z } from "zod";

/** "none" is what the selects submit when nothing is chosen. */
const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((v) => (!v || v === "none" ? null : v));

/** An empty date input submits "", which must mean "no date", not Invalid Date. */
const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(Date.parse(v)), "Enter a valid date");

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(200),
  // Tiptap JSON; the editor owns the shape, so this is deliberately loose.
  notes: z.unknown().optional(),
  status: z.enum(["TODO", "DOING", "DONE"]).default("TODO"),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  dueDate: optionalDate,
  recurrence: z.enum(["NONE", "DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]).default("NONE"),
  assigneeId: optionalId,
  clientId: optionalId,
  projectId: optionalId,
  invoiceId: optionalId,
  leadId: optionalId,
});

export type TaskInput = z.input<typeof taskSchema>;
export type TaskValues = z.output<typeof taskSchema>;

/** Quick-capture: a title and nothing else, so adding is never a form. */
export const quickTaskSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(200),
  dueDate: optionalDate,
});

export type QuickTaskInput = z.input<typeof quickTaskSchema>;

export const subtaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(1, "Name the step").max(200),
});

export type SubtaskInput = z.infer<typeof subtaskSchema>;

/**
 * Snooze targets. Relative rather than a date picker because deferring is a
 * snap decision — "not today" — and making it a calendar interaction is enough
 * friction that people leave the task in Today instead and stop trusting it.
 */
export const SNOOZE_PRESETS = ["tomorrow", "nextWeek", "nextMonth"] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];
