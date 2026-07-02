import type { MilestoneStatus, PricingType } from "@prisma/client";
import type { JSONContent } from "@tiptap/react";

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
}): MilestoneView {
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
  };
}
