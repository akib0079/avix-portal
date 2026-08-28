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

/**
 * Plain text that keeps its shape: one line per block, list items bulleted.
 *
 * richTextToPlain above joins every text node with a space, which is right for
 * a one-line chat preview and wrong for anything that has to be read back. An
 * invoice line item flattened that way becomes a single run-on sentence — and
 * the PDF's fallback parser, which splits on newlines, then sees one line and
 * renders a title with no bullets under it. That is exactly what shipped.
 */
export function richTextToLines(doc: unknown): string {
  type Node = { type?: string; text?: string; content?: Node[] };

  const inline = (node: Node): string => {
    if (node.text) return node.text;
    return (node.content ?? []).map(inline).join("");
  };

  const lines: string[] = [];
  const walk = (nodes: Node[], bullet: string | null) => {
    for (const node of nodes) {
      switch (node.type) {
        case "bulletList":
          walk(node.content ?? [], "•");
          break;
        case "orderedList":
          (node.content ?? []).forEach((item, i) => walk([item], `${i + 1}.`));
          break;
        case "listItem":
          (node.content ?? []).forEach((child, i) => {
            const text = inline(child).trim();
            if (text) lines.push(i === 0 && bullet ? `${bullet} ${text}` : text);
          });
          break;
        case "paragraph":
        case "heading": {
          const text = inline(node).trim();
          if (text) lines.push(text);
          break;
        }
        default:
          if (node.content) walk(node.content, bullet);
          else if (node.text) lines.push(node.text);
      }
    }
  };

  const root = (doc as { content?: Node[] }) ?? {};
  walk(root.content ?? [], null);
  return lines.join("\n").trim();
}
