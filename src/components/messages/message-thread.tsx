"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { formatDistanceToNow } from "date-fns";
import type { JSONContent } from "@tiptap/react";
import { sendMessage, markThreadRead } from "@/lib/actions/messages";
import type { MessageView } from "@/lib/dal/messages";
import { RichTextEditor } from "@/components/editor/rich-text-editor-lazy";
import { RichTextViewer } from "@/components/editor/rich-text-viewer";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { Loader2, Send, ChevronUp } from "lucide-react";
import { AvixBot } from "@/components/avix-bot";

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));

type ThreadResponse = {
  messages: MessageView[];
  hasMore: boolean;
  incremental: boolean;
};

const OPTIMISTIC_PREFIX = "optimistic-";

export function MessageThread({
  projectId = null,
  clientId,
  viewerRole,
  initialMessages,
  initialHasMore = false,
}: {
  /** null = the client's general thread (no project) */
  projectId?: string | null;
  /** Required for ADMIN viewers — which client's thread this is. */
  clientId?: string;
  viewerRole: "ADMIN" | "CLIENT";
  initialMessages: MessageView[];
  /** True when older messages exist behind the first page. */
  initialHasMore?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<JSONContent | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [messages, setMessages] = useState<MessageView[]>(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);

  const baseQuery = new URLSearchParams();
  if (projectId) baseQuery.set("projectId", projectId);
  if (clientId) baseQuery.set("clientId", clientId);
  const baseQueryString = baseQuery.toString();

  // Poll from the newest *confirmed* message: optimistic entries carry a
  // client clock, which could otherwise skip real messages.
  const confirmed = messages.filter((m) => !m.id.startsWith(OPTIMISTIC_PREFIX));
  const since = confirmed.length
    ? confirmed[confirmed.length - 1]!.createdAt
    : mountedAtRef();

  const { mutate } = useSWR<ThreadResponse | null>(
    `/api/messages?${baseQueryString}&since=${encodeURIComponent(since)}`,
    fetcher,
    {
      refreshInterval: 20_000,
      revalidateOnFocus: true,
      onSuccess: (data) => {
        if (!data?.messages?.length) return;
        setMessages((current) => merge(current, data.messages));
      },
    },
  );

  /** Reading a thread that's on screen clears its unread badge. */
  const markRead = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void markThreadRead({ clientId, projectId }).then(() => router.refresh());
  }, [clientId, projectId, router]);

  useEffect(() => {
    markRead();
  }, [markRead]);

  // Incoming messages while the tab is open are read as they land.
  const incomingCount = confirmed.length;
  const lastMarked = useRef(incomingCount);
  useEffect(() => {
    if (incomingCount !== lastMarked.current) {
      lastMarked.current = incomingCount;
      markRead();
    }
  }, [incomingCount, markRead]);

  async function loadOlder() {
    const oldest = messages.find((m) => !m.id.startsWith(OPTIMISTIC_PREFIX));
    if (!oldest) return;
    setLoadingOlder(true);
    const res = await fetch(
      `/api/messages?${baseQueryString}&before=${encodeURIComponent(oldest.createdAt)}`,
    );
    setLoadingOlder(false);
    if (!res.ok) return void toast.error("Couldn't load earlier messages.");
    const data = (await res.json()) as ThreadResponse;
    setMessages((current) => merge(data.messages, current));
    setHasMore(data.hasMore);
  }

  async function onSend() {
    if (!draft) return;
    const body = draft;
    // Optimistic: show the message and clear the composer immediately; the
    // server round-trip swaps in the saved row (or reverts) right after.
    const tempId = `${OPTIMISTIC_PREFIX}${Date.now()}`;
    const optimistic: MessageView = {
      id: tempId,
      senderId: "me",
      senderRole: viewerRole,
      senderName: "You",
      // Own optimistic echo — never tagged as a teammate's message.
      senderIsStaff: false,
      body,
      createdAt: new Date().toISOString(),
      readByAdminAt: null,
      readByClientAt: null,
    };
    setDraft(null);
    setResetKey((k) => k + 1);
    setSending(true);
    setMessages((current) => [...current, optimistic]);

    const result = await sendMessage({ projectId, clientId, body });
    setSending(false);

    if (!result.ok) {
      setMessages((current) => current.filter((m) => m.id !== tempId));
      toast.error(result.error);
      setDraft(body); // restore the unsent draft
      setResetKey((k) => k + 1);
      return;
    }

    const saved = result.data?.message;
    setMessages((current) =>
      saved
        ? merge(
            current.filter((m) => m.id !== tempId),
            [saved],
          )
        : current.filter((m) => m.id !== tempId),
    );
    void mutate();
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 space-y-4">
        {hasMore && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? <Loader2 className="animate-spin" /> : <ChevronUp />}
              Load earlier messages
            </Button>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-10 text-center">
            <AvixBot size={30} />
            <p className="mt-4 text-sm font-medium">
              {viewerRole === "ADMIN" ? "No messages yet" : "Hi there! 👋"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {viewerRole === "ADMIN"
                ? "Start the conversation with your client."
                : "You can chat with us right from here — ask us anything about your project."}
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.senderRole === viewerRole;
            return (
              <div
                key={m.id}
                className={cn("flex gap-3", mine && "flex-row-reverse")}
              >
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    m.senderRole === "ADMIN"
                      ? "bg-primary text-white"
                      : "bg-slate-200 text-foreground",
                  )}
                >
                  {initials(m.senderName)}
                </div>
                <div className={cn("max-w-[80%]", mine && "text-right")}>
                  <div
                    className={cn(
                      "inline-block rounded-2xl px-4 py-2.5 text-left",
                      mine
                        ? "rounded-tr-sm bg-brand-tint"
                        : "rounded-tl-sm bg-muted",
                    )}
                  >
                    <RichTextViewer content={m.body} />
                  </div>
                  <p className="mt-1 px-1 text-[11px] text-muted-foreground">
                    {m.senderName}
                    {/* Clients see who they spoke to, and that they're on our team. */}
                    {m.senderIsStaff && !mine ? " · Avix Digital team" : ""} ·{" "}
                    {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-xl border bg-background p-3">
        <RichTextEditor
          key={resetKey}
          value={draft}
          onChange={setDraft}
          placeholder="Write a message…"
          allowImages
        />
        <div className="mt-2 flex justify-end">
          <Button onClick={onSend} disabled={sending || !draft}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            Send message
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Merge two chronological lists, de-duplicating by id. */
function merge(a: MessageView[], b: MessageView[]): MessageView[] {
  const seen = new Set(a.map((m) => m.id));
  return [...a, ...b.filter((m) => !seen.has(m.id))].sort(
    (x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt),
  );
}

/**
 * Fallback `since` for an empty thread — anything created from now on is new.
 * Computed once per module load rather than per render so the SWR key is stable.
 */
const MOUNTED_AT = new Date().toISOString();
function mountedAtRef() {
  return MOUNTED_AT;
}
