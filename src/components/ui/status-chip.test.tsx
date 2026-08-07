import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { AlertCircle } from "lucide-react";
import { StatusChip } from "./status-chip";
import { toneChip } from "@/lib/tone";

describe("StatusChip", () => {
  it("renders its text content", () => {
    render(<StatusChip>Paid</StatusChip>);
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });

  it("defaults to the neutral tone", () => {
    render(<StatusChip>Draft</StatusChip>);
    const chipClass = toneChip.neutral.split(" ")[0];
    expect(screen.getByText("Draft")).toHaveClass(chipClass);
  });

  it("applies the tone's own class for every tone — colour is never conveyed alone", () => {
    (Object.keys(toneChip) as (keyof typeof toneChip)[]).forEach((tone) => {
      const { unmount } = render(<StatusChip tone={tone}>{tone}</StatusChip>);
      const firstClass = toneChip[tone].split(" ")[0];
      expect(screen.getByText(tone)).toHaveClass(firstClass);
      unmount();
    });
  });

  it("renders an optional leading icon", () => {
    const { container } = render(
      <StatusChip tone="bad" icon={AlertCircle}>
        Overdue
      </StatusChip>,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("has no detectable accessibility violations, with or without an icon", async () => {
    const { container } = render(
      <div>
        <StatusChip tone="good">Paid</StatusChip>
        <StatusChip tone="bad" icon={AlertCircle}>
          3 days overdue
        </StatusChip>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
