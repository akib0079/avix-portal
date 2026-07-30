"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { format, formatDistanceToNow, isSameDay, isToday, isYesterday } from "date-fns";
import type { JSONContent } from "@tiptap/react";
import { sendMessage, markThreadRead } from "@/lib/actions/messages";
import type { MessageView } from "@/lib/dal/messages";
import { RichTextEditor } from "@/components/editor/rich-text-editor-lazy";
import { RichTextViewer } from "@/components/editor/rich-text-viewer";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { Loader2, Send, ChevronUp, Check, CheckCheck } from "lucide-react";
import { AvixBot } from "@/components/avix-bot";

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));

type ThreadResponse = {
  messages: MessageView[];
  hasMore: boolean;
  incremental: boolean;
};

const OPTIMISTIC_PREFIX = "optimistic-";
/** Messages from the same person within this window render as one block. */
const GROUP_WINDOW_MS = 5 * 60_000;
/** How close to the bottom still counts as "following the conversation". */
const STICK_THRESHOLD_PX = 140;

export function MessageThread({
  projectId = null,
  clientId,
  viewerRole,
  initialMessages,
  initialHasMore = false,
  variant = "inline",
}: {
  /** null = the client's general thread (no project) */
  projectId?: string | null;
  /** Required for ADMIN viewers — which client's thread this is. */
  clientId?: string;
  viewerRole: "ADMIN" | "CLIENT";
  initialMessages: MessageView[];
  /** True when older messages exist behind the first page. */
  initialHasMore?: boolean;
  /**
   * "fill" — the messages scroll inside their own pane and the composer docks
   * to the bottom (the Messages pages). "inline" — the thread flows in the
   * page, for the project chat widget.
   */
  variant?: "fill" | "inline";
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<JSONContent | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [messages, setMessages] = useState<MessageView[]>(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const draftRef = useRef<JSONContent | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const baseQuery = new URLSearchParams();
  if (projectId) baseQuery.set("projectId", projectId);
  if (clientId) baseQuery.set("clientId", clientId);
  const baseQueryString = baseQuery.toString();

  // Poll from the newest *confirmed* message: optimistic entries carry a
  // client clock, which could otherwise skip real messages.
  const confirmed = messages.filter((m) => !m.id.startsWith(OPTIMISTIC_PREFIX));
  const since = confirmed.length ? confirmed[confirmed.length - 1]!.createdAt : MOUNTED_AT;

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
  const confirmedCount = confirmed.length;
  const lastMarked = useRef(confirmedCount);
  useEffect(() => {
    if (confirmedCount !== lastMarked.current) {
      lastMarked.current = confirmedCount;
      markRead();
    }
  }, [confirmedCount, markRead]);

  // Follow the conversation, but never yank someone out of the history they
  // scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }

  async function loadOlder() {
    const oldest = messages.find((m) => !m.id.startsWith(OPTIMISTIC_PREFIX));
    if (!oldest) return;
    const el = scrollRef.current;
    const heightBefore = el?.scrollHeight ?? 0;
    setLoadingOlder(true);
    const res = await fetch(
      `/api/messages?${baseQueryString}&before=${encodeURIComponent(oldest.createdAt)}`,
    );
    setLoadingOlder(false);
    if (!res.ok) return void toast.error("Couldn't load earlier messages.");
    const data = (await res.json()) as ThreadResponse;
    stickToBottom.current = false;
    setMessages((current) => merge(data.messages, current));
    setHasMore(data.hasMore);
    // Keep the reader's place instead of jumping to the top of the new page.
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - heightBefore;
    });
  }

  async function onSend() {
    const body = draftRef.current;
    if (!body || sending) return;
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
    stickToBottom.current = true;
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

  // The last thing I sent, so a single "Seen" receipt sits under it.
  const lastMine = [...messages].reverse().find((m) => m.senderRole === viewerRole);
  const seenAt =
    lastMine && (viewerRole === "ADMIN" ? lastMine.readByClientAt : lastMine.readByAdminAt);

  const fill = variant === "fill";

  const list = (
    <>
      {hasMore && (
        <div className="flex justify-center pb-2">
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
        messages.map((m, i) => {
          const prev = messages[i - 1];
          const mine = m.senderRole === viewerRole;
          const showDay = !prev || !isSameDay(new Date(prev.createdAt), new Date(m.createdAt));
          // Consecutive messages from the same person collapse into a block.
          const grouped =
            !showDay &&
            !!prev &&
            prev.senderRole === m.senderRole &&
            prev.senderName === m.senderName &&
            Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
          const pending = m.id.startsWith(OPTIMISTIC_PREFIX);
          const isLastMine = lastMine?.id === m.id;

          return (
            <div key={m.id}>
              {showDay && (
                <div className="my-4 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {dayLabel(m.createdAt)}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}

              <div
                className={cn(
                  "flex gap-2.5",
                  grouped ? "mt-0.5" : "mt-3",
                  mine && "flex-row-reverse",
                )}
              >
                {grouped ? (
                  <span className="size-8 shrink-0" aria-hidden />
                ) : (
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      m.senderRole === "ADMIN"
                        ? "bg-primary text-white"
                        : "bg-slate-200 text-foreground dark:bg-slate-700 dark:text-white",
                    )}
                  >
                    {initials(m.senderName)}
                  </span>
                )}

                <div className={cn("max-w-[78%] min-w-0", mine && "text-right")}>
                  {!grouped && (
                    <p
                      className={cn(
                        "mb-1 px-1 text-[11px] text-muted-foreground",
                        mine && "text-right",
                      )}
                    >
                      <span className="font-medium text-foreground">{m.senderName}</span>
                      {/* Clients see who they spoke to, and that they're on our team. */}
                      {m.senderIsStaff && !mine ? " · Avix Digital team" : ""} ·{" "}
                      {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                    </p>
                  )}
                  <div
                    className={cn(
                      "inline-block rounded-2xl px-4 py-2.5 text-left transition-opacity",
                      mine
                        ? "rounded-tr-sm bg-brand-tint"
                        : "rounded-tl-sm bg-muted",
                      pending && "opacity-60",
                    )}
                    title={format(new Date(m.createdAt), "PPp")}
                  >
                    <RichTextViewer content={m.body} />
                  </div>

                  {isLastMine && (
                    <p className="mt-1 flex items-center justify-end gap-1 px-1 text-[11px] text-muted-foreground">
                      {pending ? (
                        <>
                          <Loader2 className="size-3 animate-spin" /> Sending…
                        </>
                      ) : seenAt ? (
                        <>
                          <CheckCheck className="size-3 text-primary" /> Seen
                        </>
                      ) : (
                        <>
                          <Check className="size-3" /> Sent
                        </>
                      )}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </>
  );

  const composer = (
    <div className={cn("rounded-xl border bg-background p-3", fill && "shadow-sm")}>
      <RichTextEditor
        key={resetKey}
        value={draft}
        onChange={setDraft}
        placeholder="Write a message…"
        allowImages
        compact={fill}
        onSubmit={onSend}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="hidden text-[11px] text-muted-foreground sm:block">
          <kbd className="rounded border px-1">Enter</kbd> to send ·{" "}
          <kbd className="rounded border px-1">Shift</kbd>+
          <kbd className="rounded border px-1">Enter</kbd> for a new line
        </p>
        <Button onClick={onSend} disabled={sending || !draft} className="ml-auto">
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
          Send
        </Button>
      </div>
    </div>
  );

  if (!fill) {
    return (
      <div>
        <div className="mb-4">{list}</div>
        {composer}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-4"
      >
        {list}
      </div>
      <div className="pt-3">{composer}</div>
    </div>
  );
}

/** "Today" / "Yesterday" / "Mon, 14 Jul" for the day separators. */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEE, d MMM");
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
 * Module-level so the SWR key stays stable across renders.
 */
const MOUNTED_AT = new Date().toISOString();
