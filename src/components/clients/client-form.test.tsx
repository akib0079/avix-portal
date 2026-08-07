import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { toast } from "sonner";
import { ClientForm } from "./client-form";
import { createClient, updateClient } from "@/lib/actions/clients";

const push = vi.fn();
const refresh = vi.fn();
const back = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, back }),
}));

vi.mock("@/lib/actions/clients", () => ({
  createClient: vi.fn(),
  updateClient: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// jsdom doesn't implement pointer capture / scrollIntoView, which Radix's
// Select relies on for its open/close and keyboard-scroll behaviour.
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  vi.clearAllMocks();
});

describe("ClientForm — add client", () => {
  it("blocks submission and shows inline errors when required fields are empty", async () => {
    const user = userEvent.setup();
    render(<ClientForm />);

    await user.click(screen.getByRole("button", { name: /add client/i }));

    expect(await screen.findByText("First name is required")).toBeInTheDocument();
    expect(screen.getByText("Last name is required")).toBeInTheDocument();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("links each error message to its input via aria-describedby (screen-reader announced)", async () => {
    const user = userEvent.setup();
    render(<ClientForm />);
    await user.click(screen.getByRole("button", { name: /add client/i }));

    const firstName = await screen.findByLabelText("First name");
    const message = screen.getByText("First name is required");
    expect(firstName).toHaveAttribute("aria-invalid", "true");
    expect(firstName.getAttribute("aria-describedby")).toContain(message.id);
  });

  it("submits, shows a success toast, and redirects to the client list", async () => {
    vi.mocked(createClient).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ClientForm />);

    await user.type(screen.getByLabelText("First name"), "Jane");
    await user.type(screen.getByLabelText("Last name"), "Cooper");
    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.click(screen.getByRole("button", { name: /add client/i }));

    await waitFor(() => expect(createClient).toHaveBeenCalledOnce());
    expect(toast.success).toHaveBeenCalledWith("Client added — invite email sent.");
    expect(push).toHaveBeenCalledWith("/admin/clients");
  });

  it("shows the server-side error via toast and does not navigate away on failure", async () => {
    vi.mocked(createClient).mockResolvedValue({
      ok: false,
      error: "A user with this email already exists.",
    });
    const user = userEvent.setup();
    render(<ClientForm />);

    await user.type(screen.getByLabelText("First name"), "Jane");
    await user.type(screen.getByLabelText("Last name"), "Cooper");
    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.click(screen.getByRole("button", { name: /add client/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("A user with this email already exists."),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("disables both buttons and shows a spinner while the submission is in flight", async () => {
    let resolveSubmit!: (v: { ok: true }) => void;
    vi.mocked(createClient).mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<ClientForm />);

    await user.type(screen.getByLabelText("First name"), "Jane");
    await user.type(screen.getByLabelText("Last name"), "Cooper");
    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.click(screen.getByRole("button", { name: /add client/i }));

    const submitButton = await screen.findByRole("button", { name: /add client/i });
    expect(submitButton).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();

    resolveSubmit({ ok: true });
    await waitFor(() => expect(submitButton).not.toBeDisabled());
  });

  it("Cancel navigates back without submitting", async () => {
    const user = userEvent.setup();
    render(<ClientForm />);
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(back).toHaveBeenCalledOnce();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("has no detectable accessibility violations in its default state", async () => {
    const { container } = render(<ClientForm />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("ClientForm — edit client", () => {
  const existingClient = {
    id: "client-1",
    firstName: "Jane",
    lastName: "Cooper",
    email: "jane@example.com",
    company: "",
    phone: "",
    timezone: "",
  };

  it("pre-fills the form from the existing client", () => {
    render(<ClientForm client={existingClient} />);
    expect(screen.getByLabelText("First name")).toHaveValue("Jane");
    expect(screen.getByLabelText("Email")).toHaveValue("jane@example.com");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("updates and refreshes instead of redirecting away", async () => {
    vi.mocked(updateClient).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ClientForm client={existingClient} />);

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateClient).toHaveBeenCalledWith("client-1", expect.anything()));
    expect(toast.success).toHaveBeenCalledWith("Client updated.");
    expect(refresh).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });
});
