"use client";

import { useState } from "react";
import useSWR from "swr";
import type { ConversationSummary, MessageView } from "@/lib/dal/messages";
import { MessageThread } from "./message-thread";
import { cn, } from "@/lib/utils";
import { initials } from "@/lib/format";
import { formatDistanceToNow } from "date-fns";
import { MessagesSquare, FolderKanban, Inbox } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));

function threadKey(c: { clientId: string; projectId: string | null }) {
  return `${c.clientId}::${c.projectId ?? "general"}`;
}

/** Unified inbox: every client conversation (general + per-project). */
export function AdminInbox({
  conversations,
}: {
  conversations: ConversationSummary[];
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(
    conversations[0] ? threadKey(conversations[0]) : null,
  );
  const active = conversations.find((c) => threadKey(c) === selectedKey) ?? null;

  const query = active
    ? `?clientId=${active.clientId}${active.projectId ? `&projectId=${active.projectId}` : ""}`
    : null;
  const { data } = useSWR<{ messages: MessageView[] } | null>(
    query ? `/api/messages${query}` : null,
    fetcher,
    { refreshInterval: 20_000 },
  );
  const messages = data?.messages ?? [];

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Inbox className="size-6 text-muted-foreground" />
        </div>
        <p className="mt-4 font-medium">No conversations yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          When a client messages you — from a project or their general chat — it
          lands here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      {/* Conversation list */}
      <div className="space-y-1.5">
        {conversations.map((c) => {
          const key = threadKey(c);
          const isActive = key === selectedKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedKey(key)}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                isActive ? "border-primary/40 bg-brand-tint" : "bg-card hover:bg-muted/50",
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                {initials(c.clientName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{c.clientName}</span>
                  {c.unread > 0 && (
                    <span className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">
                      {c.unread}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  {c.projectId ? (
                    <>
                      <FolderKanban className="size-3 shrink-0" />
                      <span className="truncate">{c.projectName}</span>
                    </>
                  ) : (
                    <>
                      <MessagesSquare className="size-3 shrink-0" />
                      General chat
                    </>
                  )}
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {c.preview}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: true })}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Active thread */}
      <div className="rounded-xl border bg-card p-5">
        {active && (
          <>
            <div className="mb-4 border-b pb-3">
              <h2 className="font-heading text-lg font-semibold">
                {active.clientName}
                {active.company && (
                  <span className="text-muted-foreground"> · {active.company}</span>
                )}
              </h2>
              <p className="text-sm text-muted-foreground">
                {active.projectId ? active.projectName : "General chat (no project)"}
              </p>
            </div>
            <MessageThread
              key={selectedKey ?? ""}
              projectId={active.projectId}
              clientId={active.clientId}
              viewerRole="ADMIN"
              initialMessages={messages}
            />
          </>
        )}
      </div>
    </div>
  );
}
