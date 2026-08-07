import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Button } from "./button";

describe("Button", () => {
  it("renders as a native <button> by default", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("fires onClick when clicked", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Save</Button>);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is keyboard-activatable (Enter/Space), not just clickable", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Save</Button>);
    await user.tab();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disabled buttons are excluded from tab order and don't fire clicks", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick} disabled>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("a loading state (disabled + spinner) still exposes an accessible name", () => {
    render(
      <Button disabled aria-busy="true">
        <span data-testid="spinner" aria-hidden="true" />
        Saving…
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("renders each variant without throwing and keeps its role", () => {
    const variants = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
    for (const variant of variants) {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>);
      expect(screen.getByRole("button", { name: variant })).toBeInTheDocument();
      unmount();
    }
  });

  it("asChild renders the child element's tag (e.g. a link) instead of a <button>", () => {
    render(
      <Button asChild>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- testing Slot passthrough, not real navigation */}
        <a href="/admin/clients">Clients</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Clients" });
    expect(link).toHaveAttribute("href", "/admin/clients");
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<Button>Save changes</Button>);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("an icon-only button has no violations only once it's given an accessible name", async () => {
    const { container } = render(
      <Button size="icon" aria-label="Close">
        <span aria-hidden="true">×</span>
      </Button>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
