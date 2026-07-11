import type { MilestoneStatus, PricingType } from "@prisma/client";
import type { JSONContent } from "@tiptap/react";

/** Serialized time entry safe for client components (no Decimal/Date). */
export type TimeEntryView = {
  id: string;
  date: string; // "YYYY-MM-DD"
  hours: number;
  note: string | null;
};

/** Serialized milestone safe to pass into client components (no Decimal). */
export type MilestoneView = {
  id: string;
  title: string;
  status: MilestoneStatus;
  position: number;
  description: JSONContent | null;
  pricingType: PricingType;
  hourlyRate: number | null;
  estimatedHours: number | null;
  fixedPrice: number | null;
  loggedHours: number;
  timeEntries: TimeEntryView[];
  clientApprovedAt: string | null; // ISO date
};

export function toMilestoneView(m: {
  id: string;
  title: string;
  status: MilestoneStatus;
  position: number;
  description: unknown;
  pricingType: PricingType;
  hourlyRate: unknown;
  estimatedHours: unknown;
  fixedPrice: unknown;
  clientApprovedAt?: Date | null;
  timeEntries?: { id: string; date: Date; hours: unknown; note: string | null }[];
}): MilestoneView {
  const entries = (m.timeEntries ?? []).map((e) => ({
    id: e.id,
    date: e.date.toISOString().slice(0, 10),
    hours: Number(e.hours),
    note: e.note,
  }));
  return {
    id: m.id,
    title: m.title,
    status: m.status,
    position: m.position,
    description: (m.description as JSONContent) ?? null,
    pricingType: m.pricingType,
    hourlyRate: m.hourlyRate == null ? null : Number(m.hourlyRate),
    estimatedHours: m.estimatedHours == null ? null : Number(m.estimatedHours),
    fixedPrice: m.fixedPrice == null ? null : Number(m.fixedPrice),
    loggedHours: entries.reduce((sum, e) => sum + e.hours, 0),
    timeEntries: entries,
    clientApprovedAt: m.clientApprovedAt?.toISOString() ?? null,
  };
}
