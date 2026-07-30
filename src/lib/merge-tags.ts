/**
 * Merge tags for campaign copy: `{{firstName}}`, `{{name}}`, `{{company}}`.
 *
 * Every tag has a fallback so a message never ships as "Hi ," — an unknown or
 * empty value renders the fallback, not an empty string. Deliberately no
 * server-only import: the composer's help text and the preview both use this.
 */

export type MergeVars = {
  firstName?: string | null;
  name?: string | null;
  company?: string | null;
  email?: string | null;
};

export const mergeTags = [
  { tag: "{{firstName}}", label: "First name", fallback: "there" },
  { tag: "{{name}}", label: "Full name", fallback: "there" },
  { tag: "{{company}}", label: "Company", fallback: "your team" },
  { tag: "{{email}}", label: "Email", fallback: "" },
] as const;

const FALLBACKS: Record<string, string> = {
  firstName: "there",
  name: "there",
  company: "your team",
  email: "",
};

const TAG_RE = /\{\{\s*(firstName|name|company|email)\s*\}\}/g;

/** Replace merge tags in a plain string (subject lines, text nodes). */
export function renderMergeTags(text: string, vars: MergeVars): string {
  return text.replace(TAG_RE, (_match, key: string) => {
    const value = vars[key as keyof MergeVars];
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed || FALLBACKS[key] || "";
  });
}

/** True when the copy actually uses a tag — lets the UI show a hint only when relevant. */
export function hasMergeTags(text: string): boolean {
  TAG_RE.lastIndex = 0;
  return TAG_RE.test(text);
}

type TiptapNode = {
  type?: string;
  text?: string;
  content?: TiptapNode[];
  [key: string]: unknown;
};

/**
 * Walk a Tiptap document and render merge tags in every text node, returning a
 * new document. Marks, attrs and node types are copied through untouched.
 */
export function renderMergeTagsInDoc(doc: unknown, vars: MergeVars): unknown {
  if (doc == null || typeof doc !== "object") return doc;

  const walk = (node: TiptapNode): TiptapNode => {
    const next: TiptapNode = { ...node };
    if (typeof next.text === "string") next.text = renderMergeTags(next.text, vars);
    if (Array.isArray(next.content)) next.content = next.content.map(walk);
    return next;
  };

  return Array.isArray(doc)
    ? (doc as TiptapNode[]).map(walk)
    : walk(doc as TiptapNode);
}
