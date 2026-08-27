import { Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";

/**
 * Renders the Tiptap JSON of a line-item description into react-pdf nodes.
 *
 * The editor and the PDF have no shared rendering layer — one is HTML, the
 * other is a PDF primitive tree — so the document model has to be walked by
 * hand. Only what an invoice line legitimately needs is supported: paragraphs,
 * bullet and numbered lists, bold, italic. Headings collapse to bold text and
 * images are dropped, because a picture inside a priced table cell has nowhere
 * sensible to go and would push the amount column off its row.
 *
 * Anything unrecognised degrades to its text content rather than disappearing:
 * an invoice quietly losing a line is far worse than one that renders it plain.
 */

type Node = {
  type?: string;
  text?: string;
  content?: Node[];
  marks?: { type: string }[];
  attrs?: Record<string, unknown>;
};

export type RichPdfStyles = {
  paragraph: Style;
  bold: Style;
  italic: Style;
  bulletRow: Style;
  bulletDot: Style;
  bulletText: Style;
};

/** Inline runs of one block, split wherever the marks change. */
function inlines(node: Node, styles: RichPdfStyles, keyPrefix: string) {
  const out: React.ReactElement[] = [];
  let i = 0;
  for (const child of node.content ?? []) {
    if (child.type !== "text" || !child.text) {
      // A nested inline node (a link, say) still has words worth printing.
      if (child.content) out.push(...inlines(child, styles, `${keyPrefix}-${i}`));
      i++;
      continue;
    }
    const marks = new Set((child.marks ?? []).map((m) => m.type));
    const style: Style[] = [];
    if (marks.has("bold")) style.push(styles.bold);
    if (marks.has("italic")) style.push(styles.italic);
    out.push(
      <Text key={`${keyPrefix}-${i}`} style={style.length ? style : undefined}>
        {child.text}
      </Text>,
    );
    i++;
  }
  return out;
}

function blocks(
  nodes: Node[],
  styles: RichPdfStyles,
  keyPrefix: string,
): React.ReactElement[] {
  const out: React.ReactElement[] = [];

  nodes.forEach((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "paragraph": {
        const runs = inlines(node, styles, key);
        // Tiptap keeps an empty trailing paragraph; it would print as a gap.
        if (runs.length === 0) return;
        out.push(
          <Text key={key} style={styles.paragraph}>
            {runs}
          </Text>,
        );
        return;
      }
      case "heading": {
        // No heading sizes in a table cell — bold carries the same emphasis
        // without breaking the row rhythm.
        out.push(
          <Text key={key} style={[styles.paragraph, styles.bold]}>
            {inlines(node, styles, key)}
          </Text>,
        );
        return;
      }
      case "bulletList":
      case "orderedList": {
        const ordered = node.type === "orderedList";
        (node.content ?? []).forEach((item, j) => {
          // A listItem wraps paragraphs; render each, marking only the first.
          (item.content ?? []).forEach((para, k) => {
            out.push(
              <View key={`${key}-${j}-${k}`} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>
                  {k === 0 ? (ordered ? `${j + 1}.` : "•") : " "}
                </Text>
                <Text style={styles.bulletText}>
                  {inlines(para, styles, `${key}-${j}-${k}`)}
                </Text>
              </View>,
            );
          });
        });
        return;
      }
      case "blockquote":
        out.push(...blocks(node.content ?? [], styles, key));
        return;
      case "image":
        // Deliberately dropped — see the note at the top of the file.
        return;
      default: {
        if (node.content) {
          out.push(...blocks(node.content, styles, key));
        } else if (node.text) {
          out.push(
            <Text key={key} style={styles.paragraph}>
              {node.text}
            </Text>,
          );
        }
      }
    }
  });

  return out;
}

/** True when there is anything worth rendering. */
export function hasRichContent(doc: unknown): boolean {
  const root = doc as Node | null;
  if (!root || typeof root !== "object" || !Array.isArray(root.content)) return false;
  return root.content.some((n) => (n.content?.length ?? 0) > 0 || Boolean(n.text));
}

export function renderRichToPdf(doc: unknown, styles: RichPdfStyles) {
  const root = doc as Node | null;
  if (!root || !Array.isArray(root.content)) return null;
  return blocks(root.content, styles, "r");
}
