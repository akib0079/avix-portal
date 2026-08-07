import { describe, it, expect } from "vitest";
import { clientSchema } from "./client";

describe("clientSchema", () => {
  it("accepts a minimal valid client", () => {
    const result = clientSchema.safeParse({
      firstName: "Jane",
      lastName: "Cooper",
      email: "jane@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("trims whitespace-only required fields and reports them as missing", () => {
    const result = clientSchema.safeParse({
      firstName: "   ",
      lastName: "Cooper",
      email: "jane@example.com",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["firstName"]);
    expect(result.error?.issues[0]?.message).toBe("First name is required");
  });

  it("surfaces a friendly message for an invalid email, not a generic zod error", () => {
    const result = clientSchema.safeParse({
      firstName: "Jane",
      lastName: "Cooper",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
    const emailIssue = result.error?.issues.find((i) => i.path[0] === "email");
    expect(emailIssue?.message).toBe("Enter a valid email");
  });

  it("treats company/phone/timezone as optional — empty string is valid", () => {
    const result = clientSchema.safeParse({
      firstName: "Jane",
      lastName: "Cooper",
      email: "jane@example.com",
      company: "",
      phone: "",
      timezone: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a name over the max length instead of silently truncating", () => {
    const result = clientSchema.safeParse({
      firstName: "a".repeat(81),
      lastName: "Cooper",
      email: "jane@example.com",
    });
    expect(result.success).toBe(false);
  });
});
