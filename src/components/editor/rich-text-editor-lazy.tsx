"use client";

import dynamic from "next/dynamic";
import type { JSONContent } from "@tiptap/react";
import { cn } from "@/lib/utils";

/**
 * Tiptap is the single largest client dependency and it is only ever needed
 * once someone actually edits text — but it was previously imported eagerly by
 * six components (chat, project form, milestone dialog, task requests,
 * campaign composer, templates), so it shipped on the Messages page and every
 * project page whether or not anyone typed.
 *
 * Import THIS wrapper instead of the real editor. Same props; the heavy chunk
 * is fetched on demand behind a same-size placeholder so nothing shifts.
 */

type RichTextEditorProps = {
  value?: JSONContent | null;
  onChange: (json: JSONContent) => void;
  placeholder?: string;
  allowImages?: boolean;
  className?: string;
};

function EditorPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-lg border bg-background", className)}
      aria-busy="true"
      aria-label="Loading editor"
    >
      {/* Mirrors the real toolbar + content box so there is no layout shift. */}
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="size-7 animate-pulse rounded bg-muted" />
        ))}
      </div>
      <div className="min-h-[7rem] px-3 py-2">
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

export const RichTextEditor = dynamic<RichTextEditorProps>(
  () => import("./rich-text-editor").then((m) => m.RichTextEditor),
  {
    // The editor touches the DOM directly; there is nothing useful to SSR.
    ssr: false,
    loading: () => <EditorPlaceholder />,
  },
);
