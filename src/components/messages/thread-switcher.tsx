"use client";

import { useState } from "react";
import useSWR from "swr";
import type { MessageView } from "@/lib/dal/messages";
import { MessageThread } from "./message-thread";
import { cn } from "@/lib/utils";
import { MessagesSquare, FolderKanban } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));

export type ThreadOption = { id: string; projectName: string; unread: number };

/**
 * Client-side chat hub: pick the general thread ("Chat with Avix Digital") or
 * any of their projects, then talk in that thread.
 */
export function ThreadSwitcher({
  generalUnread,
  projects,
  initialMessages,
  initialProjectId = null,
}: {
  generalUnread: number;
  projects: ThreadOption[];
  /** Messages of the initially selected thread (server-rendered). */
  initialMessages: MessageView[];
  initialProjectId?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(initialProjectId);

  // The thread the user has switched to (initial one comes pre-rendered).
  const query = selected ? `?projectId=${selected}` : "";
  const { data } = useSWR<{ messages: MessageView[] } | null>(
    `/api/messages${query}`,
    fetcher,
    {
      // Reuse the server-rendered messages for the thread we started on.
      fallbackData:
        selected === initialProjectId ? { messages: initialMessages } : undefined,
      revalidateOnMount: selected !== initialProjectId,
    },
  );
  const messages = data?.messages ?? [];

  const threads = [
    {
      id: null as string | null,
      label: "General chat",
      hint: "Anything at all — questions, ideas, a new job",
      unread: generalUnread,
      icon: MessagesSquare,
    },
    ...projects.map((p) => ({
      id: p.id as string | null,
      label: p.projectName,
      hint: "About this project",
      unread: p.unread,
      icon: FolderKanban,
    })),
  ];

  const active = threads.find((t) => t.id === selected) ?? threads[0];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
      {/* Thread list */}
      <div className="space-y-1.5">
        <p className="px-1 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Conversations
        </p>
        {threads.map((thread) => {
          const isActive = thread.id === selected;
          return (
            <button
              key={thread.id ?? "general"}
              type="button"
              onClick={() => setSelected(thread.id)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
                isActive
                  ? "border-primary/40 bg-brand-tint"
                  : "bg-card hover:bg-muted/50",
              )}
            >
              <thread.icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{thread.label}</span>
                  {thread.unread > 0 && (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">
                      {thread.unread}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {thread.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Active thread */}
      <div className="rounded-xl border bg-card p-5">
        <div className="mb-4 border-b pb-3">
          <h2 className="font-heading text-lg font-semibold">{active.label}</h2>
          <p className="text-sm text-muted-foreground">
            You&apos;re messaging the Avix Digital team directly — we usually reply
            within one business day.
          </p>
        </div>
        <MessageThread
          key={selected ?? "general"}
          projectId={selected}
          viewerRole="CLIENT"
          initialMessages={messages}
        />
      </div>
    </div>
  );
}
