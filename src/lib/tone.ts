/**
 * Semantic tones for status colour.
 *
 * Before this, "good / warning / bad" was written out as raw palette classes
 * in 50+ places (bg-emerald-100 here, bg-emerald-50 there, amber-600 vs
 * amber-700), each with a hand-written dark: variant that was easy to forget.
 * Pick a MEANING here instead of a colour, and light/dark stay in step.
 *
 * Dependency-free so client and server components can both import it.
 */

export type Tone = "good" | "warn" | "bad" | "info" | "accent" | "neutral";

/** Filled chip: a status pill. */
export const toneChip: Record<Tone, string> = {
  good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  bad: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  accent: "bg-brand-tint text-foreground",
  neutral: "bg-muted text-muted-foreground",
};

/** Text only: a number or label that carries the meaning itself. */
export const toneText: Record<Tone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
  info: "text-sky-600 dark:text-sky-400",
  accent: "text-primary",
  neutral: "text-muted-foreground",
};

/** Border + tinted surface: a callout block. */
export const toneSurface: Record<Tone, string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  warn: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  bad: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  accent: "border-primary/30 bg-brand-tint text-foreground",
  neutral: "border-border bg-muted text-muted-foreground",
};

/** Just the border, for ringing a row that needs attention. */
export const toneBorder: Record<Tone, string> = {
  good: "border-emerald-300 dark:border-emerald-900",
  warn: "border-amber-300 dark:border-amber-800",
  bad: "border-red-300 dark:border-red-900",
  info: "border-sky-300 dark:border-sky-900",
  accent: "border-primary/40",
  neutral: "border-border",
};

/**
 * How overdue something is, as a tone. Used by invoices, milestones and
 * projects so "late" looks identical everywhere.
 */
export function dueTone(daysUntilDue: number | null): Tone {
  if (daysUntilDue === null) return "neutral";
  if (daysUntilDue < 0) return "bad";
  if (daysUntilDue <= 7) return "warn";
  return "good";
}
