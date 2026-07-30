/**
 * Flattens Tiptap JSON to plain text. Shared by the message DAL, the send
 * action and any preview surface — deliberately dependency-free so both the
 * server graph and scripts can use it.
 */
export function richTextToPlain(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: { text?: string; content?: unknown[] }) => {
    if (node.text) parts.push(node.text);
    if (Array.isArray(node.content)) {
      node.content.forEach((c) => walk(c as { text?: string; content?: unknown[] }));
    }
  };
  walk((doc as { content?: unknown[] }) ?? {});
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Plain text, clipped for a list preview. */
export function richTextPreview(doc: unknown, max = 90): string {
  const text = richTextToPlain(doc);
  return clipPreview(text, max);
}

export function clipPreview(text: string, max = 90): string {
  const trimmed = text.trim();
  if (!trimmed) return "(no text)";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
