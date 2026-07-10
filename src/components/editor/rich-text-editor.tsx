"use client";

import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link2,
  ImagePlus,
} from "lucide-react";

/**
 * Turn common share links into direct image URLs so they render in an <img>.
 * Google Drive:  drive.google.com/file/d/<id>/view → lh3.googleusercontent.com/d/<id>
 * Dropbox:       ...dropbox.com/...?...dl=0        → raw=1
 * Anything else passes through untouched.
 */
function normalizeImageUrl(raw: string): string {
  const drive = raw.match(
    /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?.*id=)([\w-]{20,})/,
  );
  if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}`;
  if (/dropbox\.com\//.test(raw)) {
    const url = raw.replace(/([?&])dl=0/, "$1raw=1");
    return url.includes("raw=1") ? url : url + (url.includes("?") ? "&" : "?") + "raw=1";
  }
  return raw;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn("size-8", active && "bg-accent text-accent-foreground")}
    >
      {children}
      <span className="sr-only">{label}</span>
    </Button>
  );
}

function Toolbar({ editor, allowImages }: { editor: Editor; allowImages: boolean }) {
  // File uploads are disabled — images are added by URL (e.g. a Google Drive
  // or Dropbox share link, which we normalize to a direct-view URL).
  function insertImageByUrl() {
    const raw = window.prompt(
      "Image URL (e.g. a Google Drive or Dropbox share link)",
      "https://",
    );
    if (raw === null || raw.trim() === "" || raw.trim() === "https://") return;
    const trimmed = raw.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      toast.error("Image URLs must start with http(s)://");
      return;
    }
    editor.chain().focus().setImage({ src: normalizeImageUrl(trimmed) }).run();
  }

  function setLink() {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL (leave empty to remove)", previous ?? "https://");
    if (url === null) return;
    if (url === "" || url === "https://") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast.error("Links must start with http(s)://");
      return;
    }
    editor.chain().focus().setLink({ href: url }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/50 p-1">
      <ToolbarButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-4" />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        label="Heading"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Subheading"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="size-4" />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="size-4" />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton label="Link" active={editor.isActive("link")} onClick={setLink}>
        <Link2 className="size-4" />
      </ToolbarButton>
      {allowImages && (
        <ToolbarButton label="Insert image by URL" onClick={insertImageByUrl}>
          <ImagePlus className="size-4" />
        </ToolbarButton>
      )}
    </div>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write something…",
  allowImages = true,
  className,
}: {
  value?: JSONContent | null;
  onChange: (json: JSONContent) => void;
  placeholder?: string;
  allowImages?: boolean;
  className?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ["http", "https"],
        },
      }),
      Image.configure({ allowBase64: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: value ?? undefined,
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      attributes: {
        class: "rich-text px-3 py-2 min-h-32 max-h-96 overflow-y-auto",
      },
    },
  });

  if (!editor) {
    return (
      <div className={cn("rounded-lg border bg-muted/30", className)}>
        <div className="h-9 border-b" />
        <div className="min-h-32 px-3 py-2 text-sm text-muted-foreground">Loading editor…</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-background transition-shadow focus-within:ring-2 focus-within:ring-ring/40",
        className,
      )}
    >
      <Toolbar editor={editor} allowImages={allowImages} />
      <EditorContent editor={editor} />
    </div>
  );
}
