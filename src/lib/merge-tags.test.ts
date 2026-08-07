import { describe, it, expect } from "vitest";
import { renderMergeTags, hasMergeTags, renderMergeTagsInDoc } from "./merge-tags";

describe("renderMergeTags", () => {
  it("substitutes known tags with the supplied values", () => {
    expect(renderMergeTags("Hi {{firstName}}!", { firstName: "Jane" })).toBe("Hi Jane!");
  });

  it("falls back instead of ever rendering an empty greeting", () => {
    // The whole point of fallbacks: "Hi ," must never ship.
    expect(renderMergeTags("Hi {{firstName}},", { firstName: null })).toBe("Hi there,");
    expect(renderMergeTags("Hi {{firstName}},", { firstName: "" })).toBe("Hi there,");
    expect(renderMergeTags("Hi {{firstName}},", { firstName: "   " })).toBe("Hi there,");
  });

  it("falls back to a blank string for {{email}} rather than a placeholder word", () => {
    expect(renderMergeTags("Contact: {{email}}", {})).toBe("Contact: ");
  });

  it("replaces every occurrence, including repeats", () => {
    expect(renderMergeTags("{{name}} {{name}}", { name: "Jane" })).toBe("Jane Jane");
  });

  it("tolerates extra whitespace inside the braces", () => {
    expect(renderMergeTags("Hi {{ firstName }}!", { firstName: "Jane" })).toBe("Hi Jane!");
  });

  it("leaves unknown/unsupported tokens untouched", () => {
    expect(renderMergeTags("{{unknownTag}}", {})).toBe("{{unknownTag}}");
  });
});

describe("hasMergeTags", () => {
  it("detects a supported tag", () => {
    expect(hasMergeTags("Hi {{firstName}}")).toBe(true);
  });

  it("is false for plain text", () => {
    expect(hasMergeTags("Hi there")).toBe(false);
  });

  it("does not leak regex lastIndex state across calls (global-regex footgun)", () => {
    // A regex with the /g flag remembers lastIndex; calling .test() twice on
    // the same input can silently flip true -> false without a manual reset.
    expect(hasMergeTags("{{name}}")).toBe(true);
    expect(hasMergeTags("{{name}}")).toBe(true);
    expect(hasMergeTags("{{name}}")).toBe(true);
  });
});

describe("renderMergeTagsInDoc", () => {
  it("renders tags inside nested Tiptap text nodes", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hi {{firstName}}, welcome to {{company}}." }],
        },
      ],
    };
    const result = renderMergeTagsInDoc(doc, { firstName: "Jane", company: "Acme" }) as typeof doc;
    expect(result.content[0].content[0].text).toBe("Hi Jane, welcome to Acme.");
  });

  it("passes through null/non-object input unchanged", () => {
    expect(renderMergeTagsInDoc(null, {})).toBeNull();
    expect(renderMergeTagsInDoc(undefined, {})).toBeUndefined();
  });

  it("does not mutate the original document", () => {
    const doc = { type: "text", text: "Hi {{firstName}}" };
    const result = renderMergeTagsInDoc(doc, { firstName: "Jane" });
    expect(doc.text).toBe("Hi {{firstName}}");
    expect(result).not.toBe(doc);
  });
});
