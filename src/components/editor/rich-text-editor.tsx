"use client";

import { useEffect, useRef, useState } from "react";
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
  Loader2,
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
  onImageLink,
  uploading,
}: {
  editor: Editor;
  allowImages: boolean;
  onLink: () => void;
  /** Opens the file picker — the primary path. */
  onImage: () => void;
  /** Falls back to linking an image hosted elsewhere. */
  onImageLink: () => void;
  uploading: boolean;
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
        <>
          <ToolbarButton label="Upload an image" onClick={onImage}>
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ImagePlus className="size-4" />
            )}
          </ToolbarButton>
          <ToolbarButton label="Link an image hosted elsewhere" onClick={onImageLink}>
            <Link2 className="size-4" />
          </ToolbarButton>
        </>
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
  onSubmit,
  compact = false,
  collapsed = false,
  onFocus,
  onBlur,
}: {
  value?: JSONContent | null;
  onChange: (json: JSONContent) => void;
  placeholder?: string;
  allowImages?: boolean;
  className?: string;
  /** When set, Enter submits and Shift+Enter makes a new line (chat composer). */
  onSubmit?: () => void;
  /** Shorter default height, for a message composer rather than a document. */
  compact?: boolean;
  /**
   * Collapsed: one line, no toolbar. The composer opens on focus, so a phone
   * screen isn't handed a two-row toolbar and five blank lines before anyone
   * has decided to type.
   */
  collapsed?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [imageOpen, setImageOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The editor instance is needed inside ProseMirror handlers that are created
  // before `editor` exists, so reach it through a ref.
  const editorRef = useRef<Editor | null>(null);
  // Held in a ref so the editor's key handler never calls a stale closure.
  const submitRef = useRef(onSubmit);
  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);
  // Same reason as submitRef: tiptap binds these once, at editor creation.
  const onFocusRef = useRef(onFocus);
  const onBlurRef = useRef(onBlur);
  useEffect(() => {
    onFocusRef.current = onFocus;
    onBlurRef.current = onBlur;
  }, [onFocus, onBlur]);

  /**
   * Sends each file to /api/uploads/images and inserts the returned URL. The
   * bytes live on the server's disk; the document only ever carries the path.
   */
  async function uploadFiles(files: File[]) {
    setUploading(true);
    try {
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/uploads/images", { method: "POST", body });
        const data = (await res.json().catch(() => null)) as
          | { url?: string; error?: string }
          | null;
        if (!res.ok || !data?.url) {
          toast.error(data?.error ?? "Couldn't upload that image.");
          // Over quota: every remaining file in this batch would be refused
          // too, so stop rather than firing a toast per image.
          if (res.status === 429) break;
          continue;
        }
        editorRef.current
          ?.chain()
          .focus()
          .setImage({ src: data.url, alt: file.name })
          .run();
      }
    } finally {
      setUploading(false);
    }
  }

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
    onFocus: () => onFocusRef.current?.(),
    onBlur: () => onBlurRef.current?.(),
    editorProps: {
      attributes: {
        class: compact
          // Compact starts at two lines and grows to the cap as you type;
          // collapsed is a single line until focus. Reserving five lines up
          // front just moves the conversation off screen.
          ? cn(
              "rich-text px-3 py-2 max-h-56 overflow-y-auto",
              collapsed ? "min-h-9" : "min-h-14",
            )
          : "rich-text px-3 py-2 min-h-32 max-h-96 overflow-y-auto",
      },
      // Enter sends, Shift+Enter (and the modifier combos) keep their meaning.
      handleKeyDown: (_view, event) => {
        if (
          submitRef.current &&
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          event.preventDefault();
          submitRef.current();
          return true;
        }
        return false;
      },
      // Paste or drop an image file and it uploads — screenshots are the
      // single most common thing people put in a message.
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        void uploadFiles(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        void uploadFiles(files);
        return true;
      },
    },
  });

  // Assigned in an effect, not during render: the ProseMirror handlers only
  // read it on a user event, by which time the effect has run.
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

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
      {!collapsed && (
      <Toolbar
        editor={editor}
        allowImages={allowImages}
        onLink={openLinkDialog}
        onImage={() => fileInputRef.current?.click()}
        onImageLink={() => {
          setImageUrl("");
          setImageOpen(true);
        }}
        uploading={uploading}
      />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = ""; // let the same file be picked again
          if (files.length) void uploadFiles(files);
        }}
      />
      <EditorContent editor={editor} />
      {uploading && (
        <p className="flex items-center gap-1.5 border-t bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Uploading image…
        </p>
      )}

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
              Link an image
            </DialogTitle>
            <DialogDescription>
              For images that already live somewhere else. To put an image in
              directly, paste or drag it into the editor, or use the upload
              button — it&apos;s stored with the message.
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
