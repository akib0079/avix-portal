"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { BoardAttachment, BoardPerson, BoardSide } from "@/lib/board";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "./board-bits";
import { AtSign, ImagePlus, LifeBuoy, Loader2, SendHorizontal, X } from "lucide-react";

export type CommentDraft = {
  body: string;
  mentionIds: string[];
  attachments: BoardAttachment[];
  kind: "COMMENT" | "HELP";
};

type Upload = BoardAttachment & { uploading?: boolean; key: string };

/** "@" at a word start, then up to two words of name, right before the caret. */
const MENTION_AT_CARET = /(^|\s)@([^\s@]{0,24}(?: [^\s@]{0,24})?)$/;

/**
 * The comment box on a card. Plain text on purpose — fast to write, and
 * @mentions need nothing more than a picker that inserts "@Name". Paste a
 * screenshot and it uploads; flip "Ask for help" and the comment becomes a
 * request the other side has to answer.
 */
export function CommentComposer({
  people,
  viewer,
  onSubmit,
  autoFocus,
}: {
  people: BoardPerson[];
  viewer: { id: string; side: BoardSide };
  /** Resolves false when the send failed — the draft comes back. */
  onSubmit: (draft: CommentDraft) => Promise<boolean>;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState<{ query: string; start: number; active: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Where the caret goes after we rewrite the text (inserting a mention).
  // Applied in a layout effect — before the browser handles the next key —
  // because on the next frame a fast typist's keystroke has already landed
  // at the end of the text.
  const caretRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = inputRef.current;
    const pos = caretRef.current;
    if (!el || pos == null) return;
    caretRef.current = null;
    el.focus();
    el.setSelectionRange(pos, pos);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const candidates = menu
    ? people
        .filter((p) => p.id !== viewer.id)
        .filter((p) => p.name.toLowerCase().includes(menu.query.toLowerCase()))
        .slice(0, 6)
    : [];

  function grow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }

  function detectMention(value: string, caret: number) {
    const match = MENTION_AT_CARET.exec(value.slice(0, caret));
    if (!match) return setMenu(null);
    const query = match[2] ?? "";
    setMenu({ query, start: caret - query.length - 1, active: 0 });
  }

  function choose(person: BoardPerson) {
    const el = inputRef.current;
    if (!el || !menu) return;
    const caret = el.selectionStart ?? text.length;
    const insert = `@${person.name} `;
    const next = text.slice(0, menu.start) + insert + text.slice(caret);
    caretRef.current = menu.start + insert.length;
    setText(next);
    setPicked((prev) => (prev.some((p) => p.id === person.id) ? prev : [...prev, person]));
    setMenu(null);
  }

  function startMention() {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? text.length;
    const needsSpace = caret > 0 && !/\s/.test(text[caret - 1] ?? "");
    const next = `${text.slice(0, caret)}${needsSpace ? " " : ""}@${text.slice(caret)}`;
    const pos = caret + (needsSpace ? 2 : 1);
    caretRef.current = pos;
    setText(next);
    setMenu({ query: "", start: pos - 1, active: 0 });
  }

  async function upload(files: File[]) {
    const room = 6 - uploads.length;
    if (room <= 0) return void toast.error("Up to six images per comment.");
    for (const file of files.slice(0, room)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 6)}`;
      setUploads((prev) => [...prev, { key, url: "", name: file.name || "image", uploading: true }]);
      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch("/api/uploads/images", { method: "POST", body });
        const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!res.ok || !data?.url) throw new Error(data?.error ?? "Couldn't upload that image.");
        setUploads((prev) =>
          prev.map((u) => (u.key === key ? { ...u, url: data.url!, uploading: false } : u)),
        );
      } catch (err) {
        setUploads((prev) => prev.filter((u) => u.key !== key));
        toast.error((err as Error).message);
      }
    }
  }

  async function send() {
    const body = text.trim();
    const ready = uploads.filter((u) => !u.uploading && u.url);
    if (!body && ready.length === 0) return;
    if (uploads.some((u) => u.uploading)) return void toast.message("Hang on — an image is still uploading.");

    const draft: CommentDraft = {
      body,
      mentionIds: picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id),
      attachments: ready.map(({ url, name }) => ({ url, name })),
      kind: help ? "HELP" : "COMMENT",
    };
    // Clear first: the comment appears in the thread straight away.
    const restore = { text, picked, uploads, help };
    setText("");
    setPicked([]);
    setUploads([]);
    setHelp(false);
    if (inputRef.current) inputRef.current.style.height = "";
    const ok = await onSubmit(draft);
    if (!ok) {
      setText(restore.text);
      setPicked(restore.picked);
      setUploads(restore.uploads);
      setHelp(restore.help);
    }
  }

  const otherSide = viewer.side === "CLIENT" ? "the team" : "the client";

  return (
    <div className="relative">
      {menu && candidates.length > 0 && (
        <div
          role="listbox"
          aria-label="Mention someone"
          className="absolute right-0 bottom-full left-0 z-20 mb-2 overflow-hidden rounded-xl border bg-popover p-1 shadow-xl"
        >
          <p className="px-2 pt-1 pb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Pin someone
          </p>
          {candidates.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={i === menu.active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(p)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                i === menu.active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              <PersonAvatar person={p} size={22} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {p.role === "CLIENT" ? "Client" : "Avix team"}
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        className={cn(
          "rounded-xl border bg-background transition-[box-shadow,border-color] focus-within:ring-2 focus-within:ring-ring/30",
          help && "border-red-400/70 bg-red-500/[0.03] focus-within:ring-red-400/30",
        )}
      >
        {help && (
          <p className="flex items-center gap-1.5 border-b border-red-400/30 px-3 py-1.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
            <LifeBuoy className="size-3" /> Help request — {otherSide} will be notified and it stays open until answered
          </p>
        )}
        <textarea
          ref={inputRef}
          autoFocus={autoFocus}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            grow(e.target);
            detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => {
            if (menu && candidates.length > 0) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setMenu({ ...menu, active: (menu.active + delta + candidates.length) % candidates.length });
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                choose(candidates[menu.active]!);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMenu(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          onBlur={() => setMenu(null)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
            if (files.length) {
              e.preventDefault();
              void upload(files);
            }
          }}
          placeholder={help ? `What do you need from ${otherSide}?` : "Comment, or type @ to pin someone…"}
          className="block max-h-[220px] min-h-10 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm outline-none placeholder:text-muted-foreground max-sm:text-base"
          maxLength={5000}
        />

        {uploads.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-1 pb-1">
            {uploads.map((u) => (
              <span key={u.key} className="relative size-14 overflow-hidden rounded-lg border bg-muted">
                {u.uploading ? (
                  <span className="flex size-full items-center justify-center">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.url} alt={u.name} className="size-full object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => setUploads((prev) => prev.filter((x) => x.key !== u.key))}
                  className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white"
                  aria-label={`Remove ${u.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <ToolButton label="Pin someone (@)" onClick={startMention}>
            <AtSign className="size-4" />
          </ToolButton>
          <ToolButton label="Attach an image" onClick={() => fileRef.current?.click()}>
            <ImagePlus className="size-4" />
          </ToolButton>
          <button
            type="button"
            onClick={() => setHelp((v) => !v)}
            aria-pressed={help}
            className={cn(
              "ml-1 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors",
              help
                ? "border-red-400/70 bg-red-500/10 text-red-600 dark:text-red-400"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            <LifeBuoy className="size-3.5" />
            {viewer.side === "CLIENT" ? "Ask for help" : "Ask for input"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void upload(files);
            }}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void send()}
            disabled={!text.trim() && !uploads.some((u) => u.url)}
            className={cn("ml-auto h-8 gap-1.5 rounded-lg", help && "bg-red-500 hover:bg-red-600")}
          >
            {help ? "Ask" : "Send"}
            <SendHorizontal className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
