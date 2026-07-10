import type { ReactNode } from "react";
import { brand } from "./theme";

/**
 * Email-safe renderer for stored Tiptap JSON — the email sibling of
 * `rich-text-viewer.tsx` (same node/mark coverage, same href/src allowlist),
 * but emitting inline-styled markup that email clients understand.
 */

type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = {
  type?: string;
  text?: string;
  marks?: Mark[];
  attrs?: Record<string, unknown>;
  content?: Node[];
};

const text: React.CSSProperties = {
  color: "#334155",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0 0 12px",
};

function safeHref(url: unknown): string | null {
  if (typeof url !== "string") return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function safeImageSrc(url: unknown): string | null {
  if (typeof url !== "string") return null;
  // Relative uploads won't resolve inside an email client; require http(s).
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
        element = (
          <code style={{ fontFamily: "monospace", fontSize: "13px" }}>{element}</code>
        );
        break;
      case "link": {
        const href = safeHref(mark.attrs?.href);
        element = href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: brand.orange, textDecoration: "underline" }}
          >
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
      return (
        <p key={key} style={text}>
          {children.length ? children : " "}
        </p>
      );
    case "heading": {
      const level = node.attrs?.level === 3 ? 3 : 2;
      const style: React.CSSProperties = {
        color: brand.navy,
        fontSize: level === 3 ? "15px" : "17px",
        fontWeight: 700,
        margin: "20px 0 8px",
      };
      return level === 3 ? (
        <h3 key={key} style={style}>
          {children}
        </h3>
      ) : (
        <h2 key={key} style={style}>
          {children}
        </h2>
      );
    }
    case "bulletList":
      return (
        <ul key={key} style={{ ...text, paddingLeft: "22px" }}>
          {children}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key} style={{ ...text, paddingLeft: "22px" }}>
          {children}
        </ol>
      );
    case "listItem":
      return (
        <li key={key} style={{ margin: "0 0 4px" }}>
          {children}
        </li>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          style={{
            borderLeft: `3px solid ${brand.border}`,
            color: brand.slate,
            margin: "0 0 12px",
            paddingLeft: "14px",
          }}
        >
          {children}
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre
          key={key}
          style={{
            backgroundColor: brand.bg,
            border: `1px solid ${brand.border}`,
            borderRadius: "6px",
            fontFamily: "monospace",
            fontSize: "13px",
            margin: "0 0 12px",
            overflowX: "auto",
            padding: "12px",
          }}
        >
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
          style={{ borderRadius: "8px", margin: "0 0 12px", maxWidth: "100%" }}
        />
      );
    }
    case "hardBreak":
      return <br key={key} />;
    case "horizontalRule":
      return (
        <hr
          key={key}
          style={{ border: "none", borderTop: `1px solid ${brand.border}`, margin: "16px 0" }}
        />
      );
    default:
      return children.length ? <div key={key}>{children}</div> : null;
  }
}

export function RichTextEmail({ content }: { content: unknown }) {
  const doc = content as Node | null;
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.content)) return null;
  return <>{doc.content.map((node, i) => renderNode(node, i))}</>;
}
