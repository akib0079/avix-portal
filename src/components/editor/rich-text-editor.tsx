"use client";

import { useState } from "react";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  CloudUpload,
} from "lucide-react";

/** Short display label for an inserted image link, e.g. "📎 mockup.png". */
function imageLinkLabel(url: string): string {
  try {
    const name = decodeURIComponent(
      new URL(url).pathname.split("/").filter(Boolean).pop() ?? "",
    );
    // Only use the path segment when it looks like a real filename
    // (Drive/Dropbox share URLs end in generic segments like "view").
    if (name && name.length <= 60 && /\.[a-z0-9]{2,5}$/i.test(name)) {
      return `📎 ${name}`;
    }
  } catch {
    /* fall through */
  }
  return "📎 View image";
}

function isValidHttpUrl(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url);
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

function Toolbar({
  editor,
  allowImages,
  onLink,
  onImage,
}: {
  editor: Editor;
  allowImages: boolean;
  onLink: () => void;
  onImage: () => void;
}) {
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
      <ToolbarButton label="Link" active={editor.isActive("link")} onClick={onLink}>
        <Link2 className="size-4" />
      </ToolbarButton>
      {allowImages && (
        <ToolbarButton label="Insert image link" onClick={onImage}>
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
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [imageOpen, setImageOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");

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
    // JSON round-trip: ProseMirror emits null-prototype objects (mark attrs),
    // which React refuses to serialize into server actions ("temporary
    // client reference"). Re-cloning yields plain Object.prototype objects.
    onUpdate: ({ editor }) => onChange(JSON.parse(JSON.stringify(editor.getJSON()))),
    editorProps: {
      attributes: {
        class: "rich-text px-3 py-2 min-h-32 max-h-96 overflow-y-auto",
      },
      // Pasting or dropping image FILES is not supported — pop the
      // Drive/Dropbox dialog instead of silently ignoring the file.
      handlePaste: (_view, event) => {
        if (event.clipboardData?.files?.length) {
          setImageUrl("");
          setImageOpen(true);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        if (event.dataTransfer?.files?.length) {
          setImageUrl("");
          setImageOpen(true);
          return true;
        }
        return false;
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

  function openLinkDialog() {
    if (!editor) return;
    setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? "");
    setLinkOpen(true);
  }

  function applyLink() {
    if (!editor) return;
    const url = linkUrl.trim();
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      setLinkOpen(false);
      return;
    }
    if (!isValidHttpUrl(url)) {
      toast.error("Links must start with http:// or https://");
      return;
    }
    if (editor.state.selection.empty && !editor.isActive("link")) {
      // Nothing selected: insert the URL itself as a link.
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] },
          { type: "text", text: " " },
        ])
        .run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
    setLinkOpen(false);
  }

  function applyImageLink() {
    if (!editor) return;
    const url = imageUrl.trim();
    if (!isValidHttpUrl(url)) {
      toast.error("Paste a Google Drive or Dropbox share link (http(s)://…)");
      return;
    }
    editor
      .chain()
      .focus()
      .insertContent([
        {
          type: "text",
          text: imageLinkLabel(url),
          marks: [{ type: "link", attrs: { href: url } }],
        },
        { type: "text", text: " " },
      ])
      .run();
    setImageOpen(false);
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-background transition-shadow focus-within:ring-2 focus-within:ring-ring/40",
        className,
      )}
    >
      <Toolbar
        editor={editor}
        allowImages={allowImages}
        onLink={openLinkDialog}
        onImage={() => {
          setImageUrl("");
          setImageOpen(true);
        }}
      />
      <EditorContent editor={editor} />

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Add link</DialogTitle>
            <DialogDescription>
              Leave empty and save to remove an existing link.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="url"
            placeholder="https://…"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={applyLink}>
              Save link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={imageOpen} onOpenChange={setImageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <CloudUpload className="size-4 text-primary" />
              Share an image
            </DialogTitle>
            <DialogDescription>
              Direct image uploads aren&apos;t supported. Please upload your image
              to <strong>Google Drive</strong> or <strong>Dropbox</strong>, then
              paste the share link below — it will appear as a clickable link.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="url"
            placeholder="https://drive.google.com/… or https://www.dropbox.com/…"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyImageLink();
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImageOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={applyImageLink}>
              Insert link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
