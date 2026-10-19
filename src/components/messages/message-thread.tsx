"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { format, isSameDay, isToday, isYesterday } from "date-fns";
import type { JSONContent } from "@tiptap/react";
import { sendMessage, markThreadRead } from "@/lib/actions/messages";
import type { MessageView } from "@/lib/dal/messages";
import type { BoardCard } from "@/lib/board";
import { boardTaskHref } from "@/lib/board";
import { RichTextEditor } from "@/components/editor/rich-text-editor-lazy";
import { RichTextViewer } from "@/components/editor/rich-text-viewer";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { richTextToPlain } from "@/lib/rich-text";
import { SwipeToReply } from "./message-actions";
import { initials } from "@/lib/format";
import {
  Loader2,
  ChevronUp,
  Check,
  CheckCheck,
  Lock,
  Reply,
  Copy,
  ArrowDown,
  SendHorizontal,
  KanbanSquare,
} from "lucide-react";
import { AvixBot } from "@/components/avix-bot";

const NewTaskDialog = dynamic(
  () => import("@/components/board/new-task-dialog").then((m) => m.NewTaskDialog),
  { ssr: false },
);

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

/** One-tap openers for an empty thread — the hardest message to write is the first. */
const STARTERS = [
  "I have a quick question about the project.",
  "I'd like to request a change.",
  "Could we schedule a call this week?",
];

function paragraphDoc(text: string): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

export function MessageThread({
  projectId = null,
  clientId,
  viewerRole,
  initialMessages,
  initialHasMore = false,
  variant = "inline",
  canWriteInternal = false,
  onActivity,
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
   * to the bottom (the dock, the Messages pages). "inline" — the thread flows
   * in the page.
   */
  variant?: "fill" | "inline";
  /** Team viewers can write internal notes; clients never see the control. */
  canWriteInternal?: boolean;
  /**
   * Called after a send or a read, for screens that list threads and need
   * their previews and badges refreshed. The project dock passes nothing: the
   * old router.refresh() here re-rendered the whole project page — board,
   * milestones and all — every time a message was opened or sent.
   */
  onActivity?: () => void;
}) {
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const [draft, setDraft] = useState<JSONContent | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** Team-only note mode — admins and staff only. */
  const [internal, setInternal] = useState(false);
  /**
   * The composer opens on focus and folds back when it is left empty.
   * A toolbar and five blank lines are a fair trade for a desktop margin and a
   * bad one on a phone, where they cost a quarter of the conversation.
   */
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<MessageView[]>(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  /** The first message that was unread when the thread opened — the "New" line sits above it. */
  const [firstUnreadId] = useState(() => {
    const field = viewerRole === "ADMIN" ? "readByAdminAt" : "readByClientAt";
    return initialMessages.find((m) => m.senderRole !== viewerRole && !m[field])?.id ?? null;
  });
  const [atBottom, setAtBottom] = useState(true);
  const [missed, setMissed] = useState(0);
  /** Touch has no hover: a tap on a bubble shows its actions. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskFrom, setTaskFrom] = useState<MessageView | null>(null);

  /**
   * Quote a message into the composer.
   *
   * A blockquote in the draft rather than a replyToId column: it needs no
   * migration, it survives in the message body so the client sees exactly what
   * you were answering, and it is editable — you can trim a long quote down to
   * the line that actually matters before sending.
   */
  function quoteReply(m: MessageView) {
    const text = richTextToPlain(m.body).trim();
    if (!text) return;
    // Long messages get quoted by their opening, not in full.
    const excerpt = text.length > 220 ? `${text.slice(0, 220).trimEnd()}…` : text;
    setDraft({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: `${m.senderName}: ${excerpt}` }],
            },
          ],
        },
        { type: "paragraph" },
      ],
    });
    setExpanded(true);
    // Remount the editor so it picks the new value up, then put the caret
    // after the quote.
    setResetKey((k) => k + 1);
  }

  async function copyText(m: MessageView) {
    try {
      await navigator.clipboard.writeText(richTextToPlain(m.body));
      toast.success("Copied.");
    } catch {
      // Clipboard writes need a secure context and can be blocked outright.
      toast.error("This browser wouldn't let me copy that.");
    }
  }

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
        if (!stickToBottom.current) {
          const known = new Set(messages.map((m) => m.id));
          setMissed((n) => n + data.messages.filter((m) => !known.has(m.id)).length);
        }
        setMessages((current) => merge(current, data.messages));
      },
    },
  );

  // Held in a ref: callers pass an inline arrow, and a markRead that changed
  // identity on every render re-ran the mark-on-mount effect after each
  // refresh it triggered — mark, refresh, mark, refresh, forever.
  const onActivityRef = useRef(onActivity);
  useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);

  /** Reading a thread that's on screen clears its unread badge. */
  const markRead = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void markThreadRead({ clientId, projectId }).then(() => {
      // The sidebar badge reads this key; refresh it, not the page.
      void globalMutate("/api/notifications");
      onActivityRef.current?.();
    });
  }, [clientId, projectId, globalMutate]);

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
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    stickToBottom.current = near;
    if (near !== atBottom) setAtBottom(near);
    if (near && missed) setMissed(0);
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setMissed(0);
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
      visibility: internal ? "INTERNAL" : "PUBLIC",
      readByAdminAt: null,
      readByClientAt: null,
    };
    setDraft(null);
    setExpanded(false);
    setResetKey((k) => k + 1);
    setSending(true);
    stickToBottom.current = true;
    setMessages((current) => [...current, optimistic]);

    const result = await sendMessage({ projectId, clientId, body, internal });
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
    onActivityRef.current?.();
  }

  function startWith(text: string) {
    setDraft(paragraphDoc(text));
    setExpanded(true);
    setResetKey((k) => k + 1);
  }

  // The last thing I sent, so a single "Seen" receipt sits under it.
  const lastMine = [...messages].reverse().find((m) => m.senderRole === viewerRole);
  const seenAt =
    lastMine && (viewerRole === "ADMIN" ? lastMine.readByClientAt : lastMine.readByAdminAt);

  const fill = variant === "fill";
  const canMakeTask = !!projectId;

  const list = (
    <>
      {hasMore && (
        <div className="flex justify-center pt-1 pb-3">
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingOlder}
            className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          >
            {loadingOlder ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronUp className="size-3.5" />}
            Earlier messages
          </button>
        </div>
      )}

      {messages.length === 0 ? (
        <div className="flex h-full min-h-60 flex-col items-center justify-center px-4 text-center">
          <AvixBot size={34} />
          <p className="font-heading mt-5 text-base font-semibold">
            {viewerRole === "ADMIN" ? "No messages yet" : "Say hello 👋"}
          </p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {viewerRole === "ADMIN"
              ? "Start the conversation with your client."
              : "Ask anything about your project — a real person on the team answers."}
          </p>
          {viewerRole === "CLIENT" && (
            <div className="mt-5 flex max-w-sm flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => startWith(s)}
                  className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const mine = m.senderRole === viewerRole;
          const showDay = !prev || !isSameDay(new Date(prev.createdAt), new Date(m.createdAt));
          const sameAs = (a?: MessageView, b?: MessageView) =>
            !!a &&
            !!b &&
            a.senderRole === b.senderRole &&
            a.senderName === b.senderName &&
            isSameDay(new Date(a.createdAt), new Date(b.createdAt)) &&
            Math.abs(Date.parse(b.createdAt) - Date.parse(a.createdAt)) < GROUP_WINDOW_MS;
          // Consecutive messages from the same person collapse into a block.
          const grouped = !showDay && sameAs(prev, m) && m.id !== firstUnreadId;
          const lastInGroup = !sameAs(m, next);
          const pending = m.id.startsWith(OPTIMISTIC_PREFIX);
          const isLastMine = lastMine?.id === m.id;
          const note = m.visibility === "INTERNAL";
          const selected = selectedId === m.id;

          return (
            <div key={m.id}>
              {showDay && (
                <div className="sticky top-1 z-10 my-3 flex justify-center">
                  <span className="rounded-full border bg-background/90 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
                    {dayLabel(m.createdAt)}
                  </span>
                </div>
              )}
              {m.id === firstUnreadId && (
                <div className="my-3 flex items-center gap-2" role="separator" aria-label="New messages">
                  <span className="h-px flex-1 bg-primary/40" />
                  <span className="text-[10px] font-semibold tracking-wider text-primary uppercase">New</span>
                  <span className="h-px flex-1 bg-primary/40" />
                </div>
              )}

              <SwipeToReply onReply={() => quoteReply(m)}>
                <div
                  className={cn(
                    "group/msg relative flex gap-2",
                    grouped ? "mt-0.5" : "mt-3",
                    mine && "flex-row-reverse",
                  )}
                >
                  {!mine &&
                    (grouped ? (
                      <span className="w-7 shrink-0" aria-hidden />
                    ) : (
                      <span
                        className={cn(
                          "mt-5 flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                          m.senderRole === "ADMIN"
                            ? "bg-[var(--deck)] text-white ring-1 ring-primary/40"
                            : "bg-slate-200 text-foreground dark:bg-slate-700 dark:text-white",
                        )}
                        aria-hidden
                      >
                        {initials(m.senderName)}
                      </span>
                    ))}

                  {/* 85% of a phone column is still under 300px; the cap only
                      matters on a wide pane, where a full-width line is hard
                      to read. */}
                  <div className={cn("flex max-w-[85%] min-w-0 flex-col sm:max-w-[76%]", mine && "items-end")}>
                    {!grouped && (
                      <p className={cn("mb-1 px-1 text-[11px] text-muted-foreground", mine && "text-right")}>
                        {!mine && (
                          <>
                            <span className="font-semibold text-foreground">{m.senderName}</span>
                            {/* Clients see who they spoke to, and that they're on our team. */}
                            {m.senderIsStaff && " · Avix team"}
                            {" · "}
                          </>
                        )}
                        <time dateTime={m.createdAt}>{format(new Date(m.createdAt), "h:mm a")}</time>
                      </p>
                    )}
                    <div
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a,button,img")) return;
                        setSelectedId((cur) => (cur === m.id ? null : m.id));
                      }}
                      className={cn(
                        "relative rounded-2xl px-3.5 py-2 text-left text-[13.5px] leading-relaxed transition-opacity sm:text-sm",
                        note
                          ? "border border-dashed border-amber-400 bg-amber-50 text-foreground dark:bg-amber-950/40"
                          : mine
                            ? "bubble-mine bg-[var(--bubble-mine)] text-[var(--bubble-mine-fg)] shadow-sm"
                            : "bubble-theirs bg-[var(--bubble-theirs)] text-foreground shadow-[0_1px_2px_rgb(15_23_42/0.06)] ring-1 ring-[var(--hairline)]",
                        !grouped && (mine ? "rounded-tr-md" : "rounded-tl-md"),
                        pending && "opacity-60",
                      )}
                      title={format(new Date(m.createdAt), "PPpp")}
                    >
                      {note && (
                        <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
                          <Lock className="size-2.5" /> Internal note · client can&apos;t see this
                        </p>
                      )}
                      <RichTextViewer content={m.body} />
                    </div>

                    {isLastMine && lastInGroup && (
                      <p className="mt-1 flex items-center justify-end gap-1 px-1 text-[11px] text-muted-foreground">
                        {pending ? (
                          <>
                            <Loader2 className="size-3 animate-spin" /> Sending…
                          </>
                        ) : seenAt ? (
                          <>
                            <CheckCheck className="size-3.5 text-primary" /> Seen
                          </>
                        ) : (
                          <>
                            <Check className="size-3.5" /> Sent
                          </>
                        )}
                      </p>
                    )}
                  </div>

                  {/* Hover actions — a floating pill, ClickUp-style, so the
                      thread stays clean until you reach for one. */}
                  {!pending && (
                    <div
                      className={cn(
                        "absolute top-0 z-20 flex items-center gap-0.5 rounded-lg border bg-popover p-0.5 shadow-md transition-opacity",
                        // Opposite the bubble, Slack-style: always in the
                        // same place, never on top of the text being read.
                        mine ? "left-1" : "right-1",
                        selected
                          ? "opacity-100"
                          : "pointer-events-none opacity-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 group-focus-within/msg:pointer-events-auto group-focus-within/msg:opacity-100",
                        grouped ? "-top-1" : "top-4",
                      )}
                    >
                      <ActionButton label="Reply" onClick={() => quoteReply(m)}>
                        <Reply className="size-3.5" />
                      </ActionButton>
                      <ActionButton label="Copy text" onClick={() => copyText(m)}>
                        <Copy className="size-3.5" />
                      </ActionButton>
                      {canMakeTask && !note && (
                        <ActionButton label="Make a task from this" onClick={() => setTaskFrom(m)}>
                          <KanbanSquare className="size-3.5" />
                        </ActionButton>
                      )}
                    </div>
                  )}
                </div>
              </SwipeToReply>
            </div>
          );
        })
      )}
    </>
  );

  const composer = (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border bg-background shadow-sm transition-[box-shadow,border-color] focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand)_14%,transparent)]",
        internal && "border-amber-400 bg-amber-50/60 dark:bg-amber-950/20",
      )}
    >
      <RichTextEditor
        key={resetKey}
        value={draft}
        onChange={setDraft}
        placeholder={internal ? "Note for the team — the client won't see this…" : "Write a message…"}
        allowImages
        compact={fill}
        collapsed={fill && !expanded && !draft}
        onFocus={() => setExpanded(true)}
        // Only fold back when nothing was written — collapsing a half-typed
        // message the moment focus wanders would be its own bug.
        onBlur={() => {
          if (!draftRef.current) setExpanded(false);
        }}
        onSubmit={onSend}
        className="rounded-none border-0 bg-transparent focus-within:ring-0"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        {canWriteInternal && (
          <button
            type="button"
            onClick={() => setInternal((v) => !v)}
            aria-pressed={internal}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              internal
                ? "border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Lock className="size-3" />
            {internal ? "Internal note" : "Note"}
          </button>
        )}
        <p className="hidden truncate text-[11px] text-muted-foreground lg:block">
          <kbd className="rounded border px-1">Enter</kbd> to send ·{" "}
          <kbd className="rounded border px-1">Shift</kbd>+<kbd className="rounded border px-1">Enter</kbd> new line
        </p>
        <button
          type="button"
          onClick={onSend}
          disabled={sending || !draft}
          aria-label={internal ? "Save note" : "Send message"}
          className={cn(
            "ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-[transform,opacity,background-color] enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-40",
            internal ? "bg-amber-500" : "bg-primary",
          )}
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : internal ? <Lock className="size-4" /> : <SendHorizontal className="size-4" />}
        </button>
      </div>
    </div>
  );

  const taskDialog =
    taskFrom && projectId ? (
      <NewTaskDialog
        open
        onOpenChange={(o) => !o && setTaskFrom(null)}
        projectId={projectId}
        viewer={{ id: "", side: viewerRole }}
        defaultTitle={firstLine(richTextToPlain(taskFrom.body))}
        defaultDescription={taskFrom.body}
        onCreated={(card: BoardCard) => {
          // Lands on an open board straight away, not on its next poll.
          window.dispatchEvent(new CustomEvent("avix:board-card", { detail: { projectId, card } }));
          toast.success("Task added to the board", {
            action: {
              label: "Open",
              onClick: () => router.push(boardTaskHref(viewerRole, projectId, card.id)),
            },
          });
        }}
      />
    ) : null;

  if (!fill) {
    return (
      <div>
        <div className="mb-4">{list}</div>
        {composer}
        {taskDialog}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          // overscroll-contain stops the bounce at the top of the thread from
          // scrolling the page behind it — or triggering pull-to-refresh, which
          // reloads the conversation you were reading.
          className="h-full overflow-y-auto overscroll-contain px-1 pb-4 [scrollbar-width:thin]"
        >
          {list}
        </div>
        {!atBottom && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--deck)] px-3 py-1.5 text-xs font-medium text-white shadow-lg"
          >
            <ArrowDown className="size-3.5" />
            {missed > 0 ? `${missed} new message${missed === 1 ? "" : "s"}` : "Latest"}
          </button>
        )}
      </div>
      <div className="pt-2">{composer}</div>
      {taskDialog}
    </div>
  );
}

function ActionButton({
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
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** A task title from a message: its first line, trimmed to fit. */
function firstLine(text: string): string {
  const line = text.trim().split(/\n|(?<=[.!?])\s/)[0] ?? "";
  return line.length > 120 ? `${line.slice(0, 117).trimEnd()}…` : line;
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
