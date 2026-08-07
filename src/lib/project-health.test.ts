import { describe, it, expect } from "vitest";
import { projectHealth, pendingWork } from "./project-health";

const milestone = (over: Partial<{ id: string; title: string; status: string; position: number }>) => ({
  id: "m1",
  title: "Design",
  status: "PENDING",
  position: 0,
  ...over,
});

describe("projectHealth", () => {
  it("computes percent complete from milestone statuses", () => {
    const h = projectHealth({
      status: "IN_PROGRESS",
      milestones: [
        milestone({ id: "1", status: "COMPLETED" }),
        milestone({ id: "2", status: "COMPLETED" }),
        milestone({ id: "3", status: "PENDING" }),
        milestone({ id: "4", status: "PENDING" }),
      ],
    });
    expect(h.percent).toBe(50);
    expect(h.done).toBe(2);
    expect(h.total).toBe(4);
  });

  it("is 0% with no milestones, not NaN or division-by-zero", () => {
    const h = projectHealth({ status: "PLANNING", milestones: [] });
    expect(h.percent).toBe(0);
    expect(h.nextMilestone).toBeNull();
  });

  it("prefers an IN_PROGRESS milestone as 'next' over an earlier pending one", () => {
    const h = projectHealth({
      status: "IN_PROGRESS",
      milestones: [
        milestone({ id: "1", title: "First", status: "PENDING", position: 0 }),
        milestone({ id: "2", title: "Second", status: "IN_PROGRESS", position: 1 }),
      ],
    });
    expect(h.nextMilestone).toEqual({ id: "2", title: "Second" });
  });

  it("falls back to the first non-completed milestone in position order", () => {
    const h = projectHealth({
      status: "IN_PROGRESS",
      milestones: [
        milestone({ id: "1", title: "First", status: "COMPLETED", position: 0 }),
        milestone({ id: "2", title: "Second", status: "PENDING", position: 2 }),
        milestone({ id: "3", title: "Third", status: "PENDING", position: 1 }),
      ],
    });
    expect(h.nextMilestone).toEqual({ id: "3", title: "Third" });
  });

  it("nextMilestone is null once every milestone is completed", () => {
    const h = projectHealth({
      status: "COMPLETED",
      milestones: [milestone({ id: "1", status: "COMPLETED" })],
    });
    expect(h.nextMilestone).toBeNull();
  });

  it("labels an overdue project with days-late and a 'bad' tone", () => {
    const h = projectHealth({
      status: "IN_PROGRESS",
      dueDate: "2026-08-01",
      now: new Date("2026-08-07T00:00:00Z"),
      milestones: [milestone({ status: "PENDING" })],
    });
    expect(h.overdue).toBe(true);
    expect(h.dueLabel).toBe("6 days overdue");
    expect(h.tone).toBe("bad");
  });

  it("uses singular 'day' for exactly one day", () => {
    const h = projectHealth({
      status: "IN_PROGRESS",
      dueDate: "2026-08-06",
      now: new Date("2026-08-07T00:00:00Z"),
      milestones: [milestone({ status: "PENDING" })],
    });
    expect(h.dueLabel).toBe("1 day overdue");
  });

  it("labels a same-day due date as 'Due today'", () => {
    const h = projectHealth({
      status: "IN_PROGRESS",
      dueDate: "2026-08-07",
      now: new Date("2026-08-07T00:00:00Z"),
      milestones: [milestone({ status: "PENDING" })],
    });
    expect(h.dueLabel).toBe("Due today");
    expect(h.overdue).toBe(false);
  });

  it("warns when due within 7 days but not yet overdue", () => {
    const h = projectHealth({
      status: "IN_PROGRESS",
      dueDate: "2026-08-12",
      now: new Date("2026-08-07T00:00:00Z"),
      milestones: [milestone({ status: "PENDING" })],
    });
    expect(h.tone).toBe("warn");
    expect(h.dueLabel).toBe("Due in 5 days");
  });

  it("a completed project is never 'overdue' even past its due date", () => {
    const h = projectHealth({
      status: "COMPLETED",
      dueDate: "2026-01-01",
      now: new Date("2026-08-07T00:00:00Z"),
      milestones: [milestone({ status: "COMPLETED" })],
    });
    expect(h.overdue).toBe(false);
    expect(h.dueLabel).toBe("Delivered");
    expect(h.tone).toBe("good");
  });

  it("ignores an unparsable due date rather than throwing", () => {
    const h = projectHealth({
      status: "IN_PROGRESS",
      dueDate: "not-a-date",
      milestones: [],
    });
    expect(h.daysToDue).toBeNull();
    expect(h.dueLabel).toBeNull();
  });
});

describe("pendingWork", () => {
  it("counts completed-but-unapproved milestones", () => {
    const w = pendingWork({
      milestones: [
        { status: "COMPLETED", clientApprovedAt: null, clientRating: null },
        { status: "COMPLETED", clientApprovedAt: "2026-01-01", clientRating: null },
        { status: "PENDING", clientApprovedAt: null, clientRating: null },
      ],
      deliverables: [],
    });
    expect(w.milestonesAwaitingApproval).toBe(1);
    expect(w.milestonesAwaitingRating).toBe(1);
  });

  it("counts deliverables with no review decision vs changes requested", () => {
    const w = pendingWork({
      milestones: [],
      deliverables: [
        { reviewStatus: null },
        { reviewStatus: "CHANGES_REQUESTED" },
        { reviewStatus: "APPROVED" },
      ],
    });
    expect(w.deliverablesAwaitingReview).toBe(1);
    expect(w.deliverablesNeedingChanges).toBe(1);
  });

  it("treats every non-PAID, non-CANCELLED invoice as unpaid", () => {
    const w = pendingWork({
      milestones: [],
      deliverables: [],
      invoices: [{ status: "PAID" }, { status: "CANCELLED" }, { status: "SENT" }, { status: "PARTIALLY_PAID" }],
    });
    expect(w.unpaidInvoices).toBe(2);
  });

  it("treats missing requests/invoices as zero rather than throwing", () => {
    const w = pendingWork({ milestones: [], deliverables: [] });
    expect(w.openRequests).toBe(0);
    expect(w.unpaidInvoices).toBe(0);
  });

  it("total is the sum of every category", () => {
    const w = pendingWork({
      milestones: [{ status: "COMPLETED", clientApprovedAt: null, clientRating: null }],
      deliverables: [{ reviewStatus: null }],
      requests: [{ status: "PENDING" }],
      invoices: [{ status: "SENT" }],
    });
    expect(w.total).toBe(4);
  });
});
