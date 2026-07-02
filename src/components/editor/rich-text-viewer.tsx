import { cn } from "@/lib/utils";
import type { CSSProperties, ReactNode } from "react";

/**
 * Server-safe renderer for the Tiptap JSON we store. Only node/mark types the
 * editor can produce are rendered; anything else is ignored. React escaping +
 * a src/href allowlist make this XSS-safe without a sanitizer dependency.
 */

type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = {
  type?: string;
  text?: string;
  marks?: Mark[];
  attrs?: Record<string, unknown>;
  content?: Node[];
};

function safeHref(url: unknown): string | null {
  if (typeof url !== "string") return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function safeImageSrc(url: unknown): string | null {
  if (typeof url !== "string") return null;
  // Only our own authenticated image route or absolute http(s).
  if (url.startsWith("/api/files/image/")) return url;
  return /^https?:\/\//i.test(url) ? url : null;
}

function renderText(node: Node, key: number): ReactNode {
  let element: ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        element = <strong>{element}</strong>;
        break;
      case "italic":
        element = <em>{element}</em>;
        break;
      case "strike":
        element = <s>{element}</s>;
        break;
      case "code":
        element = <code>{element}</code>;
        break;
      case "link": {
        const href = safeHref(mark.attrs?.href);
        element = href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {element}
          </a>
        ) : (
          element
        );
        break;
      }
    }
  }
  return <span key={key}>{element}</span>;
}

function renderNode(node: Node, key: number): ReactNode {
  const children = (node.content ?? []).map((child, i) => renderNode(child, i));
  switch (node.type) {
    case "text":
      return renderText(node, key);
    case "paragraph":
      return <p key={key}>{children.length ? children : " "}</p>;
    case "heading": {
      const level = node.attrs?.level === 3 ? 3 : 2;
      return level === 3 ? <h3 key={key}>{children}</h3> : <h2 key={key}>{children}</h2>;
    }
    case "bulletList":
      return <ul key={key}>{children}</ul>;
    case "orderedList":
      return <ol key={key}>{children}</ol>;
    case "listItem":
      return <li key={key}>{children}</li>;
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{(node.content ?? []).map((c) => c.text ?? "").join("")}</code>
        </pre>
      );
    case "image": {
      const src = safeImageSrc(node.attrs?.src);
      if (!src) return null;
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={key}
          src={src}
          alt={typeof node.attrs?.alt === "string" ? node.attrs.alt : ""}
          loading="lazy"
        />
      );
    }
    case "hardBreak":
      return <br key={key} />;
    case "horizontalRule":
      return <hr key={key} />;
    default:
      return children.length ? <div key={key}>{children}</div> : null;
  }
}

export function RichTextViewer({
  content,
  className,
  style,
}: {
  content: unknown;
  className?: string;
  style?: CSSProperties;
}) {
  const doc = content as Node | null;
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.content)) return null;
  return (
    <div className={cn("rich-text", className)} style={style}>
      {doc.content.map((node, i) => renderNode(node, i))}
    </div>
  );
}

/** True when the stored doc has any visible content. */
export function hasRichTextContent(content: unknown): boolean {
  const doc = content as Node | null;
  if (!doc || !Array.isArray(doc.content)) return false;
  const walk = (nodes: Node[]): boolean =>
    nodes.some(
      (n) =>
        (n.type === "text" && (n.text ?? "").trim() !== "") ||
        n.type === "image" ||
        (n.content ? walk(n.content) : false),
    );
  return walk(doc.content);
}
