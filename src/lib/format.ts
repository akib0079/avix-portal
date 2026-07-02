import type {
  Priority,
  ProjectStatus,
  ProjectType,
  ProjectSource,
  MilestoneStatus,
  InvoiceStatus,
  TaskRequestStatus,
  PricingType,
} from "@prisma/client";

export const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatDate(date: Date | string | null | undefined) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

export const projectTypeLabels: Record<ProjectType, string> = {
  SHOPIFY: "Shopify",
  WORDPRESS: "WordPress",
  WEBFLOW: "Webflow",
  CUSTOM_WEB_DEV: "Custom Web Development",
  APP_DEV: "App Development",
  UI_DESIGN_FIGMA: "UI Design (Figma)",
};

export const projectSourceLabels: Record<ProjectSource, string> = {
  FIVERR: "Fiverr",
  UPWORK: "Upwork",
  INDEPENDENT: "Independent",
  DEED: "Deed",
};

export const priorityLabels: Record<Priority, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const projectStatusLabels: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
  COMPLETED: "Completed",
};

export const milestoneStatusLabels: Record<MilestoneStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
};

export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  ASSIGNED: "Assigned",
  SENT: "Sent",
  IN_REVIEW: "In Review",
  PAID: "Paid",
};

export const taskRequestStatusLabels: Record<TaskRequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/** "$80/hr × 5h = $400" | "$400 fixed" | "No charge" */
export function formatPricing(m: {
  pricingType: PricingType;
  hourlyRate: number | string | null;
  estimatedHours: number | string | null;
  fixedPrice: number | string | null;
}): string | null {
  if (m.pricingType === "HOURLY" && m.hourlyRate != null) {
    const rate = Number(m.hourlyRate);
    if (m.estimatedHours != null) {
      const hours = Number(m.estimatedHours);
      return `${usd.format(rate)}/hr × ${hours}h = ${usd.format(rate * hours)}`;
    }
    return `${usd.format(rate)}/hr`;
  }
  if (m.pricingType === "FIXED" && m.fixedPrice != null) {
    return `${usd.format(Number(m.fixedPrice))} fixed`;
  }
  return null;
}

export function milestoneTotal(m: {
  pricingType: PricingType;
  hourlyRate: number | string | null;
  estimatedHours: number | string | null;
  fixedPrice: number | string | null;
}): number {
  if (m.pricingType === "HOURLY" && m.hourlyRate != null && m.estimatedHours != null)
    return Number(m.hourlyRate) * Number(m.estimatedHours);
  if (m.pricingType === "FIXED" && m.fixedPrice != null)
    return Number(m.fixedPrice);
  return 0;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
