"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import type { ConversationSummary, ThreadPage } from "@/lib/dal/messages";
import { MessageThread } from "./message-thread";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lane, LaneEmpty, LaneScroller } from "@/components/ui/lanes";
import { LanePill } from "@/components/ui/status-pill";
import { HUE } from "@/lib/status-colors";
import { useLocalChoice, useLocalSet } from "@/lib/use-local-pref";
import { cn } from "@/lib/utils";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { initials } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import { formatDistanceToNowStrict } from "date-fns";
import {
  MessagesSquare,
  FolderKanban,
  Inbox,
  Search,
  ArrowLeft,
  Loader2,
  KanbanSquare,
  List,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));

function threadKey(c: { clientId: string; projectId: string | null }) {
  return `${c.clientId}::${c.projectId ?? "general"}`;
}

/**
 * Whose move it is. A client's last word is "needs reply" until you answer
 * — opening it doesn't count — unless it is old enough to be a "thanks!"
 * from last quarter. Anything unread always needs you.
 */
type Triage = "needs" | "waiting" | "quiet";
const QUIET_DAYS = 14;

const TRIAGE: { id: Triage; title: string; color: string; hint: string }[] = [
  { id: "needs", title: "Needs reply", color: HUE.brand, hint: "The client spoke last" },
  { id: "waiting", title: "Waiting on client", color: HUE.blue, hint: "You spoke last" },
  { id: "quiet", title: "Quiet", color: HUE.slate, hint: `Nothing for ${QUIET_DAYS}+ days` },
];
const TRIAGE_BY_ID = Object.fromEntries(TRIAGE.map((t) => [t.id, t])) as Record<
  Triage,
  (typeof TRIAGE)[number]
>;

const FILTERS = [
  { value: "all", label: "All" },
  { value: "needs", label: "Needs reply" },
  { value: "unread", label: "Unread" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

const VIEWS = ["inbox", "board"] as const;

/**
 * Unified inbox: every client conversation (general + per-project).
 *
 * Two independently scrolling panes inside one viewport-height frame — the
 * conversation list stays put while a long thread scrolls, and the composer
 * stays docked at the bottom. Small screens show one pane at a time.
 *
 * The list is sorted by whose move it is, in the board's lanes, and the
 * Board view lays the same three lanes side by side for a triage pass.
 */
export function AdminInbox({
  conversations,
  renderedAt,
}: {
  conversations: ConversationSummary[];
  /** Server time, so "quiet for 14 days" doesn't drift between renders. */
  renderedAt: number;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(
    conversations[0] ? threadKey(conversations[0]) : null,
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useLocalChoice("avix.inbox.view", "inbox", VIEWS);
  const [folded, toggleFold] = useLocalSet("avix.inbox.folded", ["quiet"]);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const keyboard = useKeyboardInset();
  const router = useRouter();
  // Opened this visit = read, immediately; the refresh after the server-side
  // mark brings the real counts. Keyed to the thread's latest message, so a
  // new message after you looked brings the badge back.
  const [opened, setOpened] = useState<Map<string, string>>(() => new Map());

  const active = conversations.find((c) => threadKey(c) === selectedKey) ?? null;
  // The inbox opens the newest thread on arrival, which marks it read; the
  // board shows no thread, so there it still counts as unread.
  const first = conversations[0];
  const autoOpened =
    view === "inbox" && first && selectedKey === threadKey(first) ? threadKey(first) : null;
  const isOpened = (c: ConversationSummary) => {
    const key = threadKey(c);
    return (
      opened.get(key) === c.lastMessageAt ||
      (key === autoOpened && c.lastMessageAt === first!.lastMessageAt)
    );
  };
  const unreadOf = (c: ConversationSummary) => (isOpened(c) ? 0 : c.unread);
  const triageOf = (c: ConversationSummary): Triage => {
    const age = (renderedAt - Date.parse(c.lastMessageAt)) / 86_400_000;
    if (unreadOf(c) > 0) return "needs";
    if (c.lastFrom === "CLIENT" && age <= QUIET_DAYS) return "needs";
    return age > QUIET_DAYS ? "quiet" : "waiting";
  };
  const totalUnread = conversations.reduce((sum, c) => sum + unreadOf(c), 0);
  const needsCount = conversations.filter((c) => triageOf(c) === "needs").length;

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter === "unread" && c.unread === 0 && !opened.has(threadKey(c))) return false;
      if (filter === "needs" && triageOf(c) !== "needs") return false;
      if (!needle) return true;
      const hay = `${c.clientName} ${c.company ?? ""} ${
        c.projectName ?? "general chat"
      } ${c.preview}`.toLowerCase();
      return hay.includes(needle);
    });
    // triageOf reads `opened`, `view`/`selectedKey` (auto-open) and `renderedAt`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, search, filter, opened, renderedAt, view, selectedKey]);

  // Fetch the selected thread's first page; MessageThread polls onwards from
  // there, so the thread is never fetched twice on a timer.
  const threadQuery =
    active && view === "inbox"
      ? `/api/messages?clientId=${active.clientId}${active.projectId ? `&projectId=${active.projectId}` : ""}`
      : null;
  const { data, isLoading } = useSWR<ThreadPage | null>(threadQuery, fetcher, {
    revalidateOnFocus: false,
  });
  const page: ThreadPage = {
    messages: data?.messages ?? [],
    hasMore: data?.hasMore ?? false,
  };

  function open(c: ConversationSummary) {
    const key = threadKey(c);
    setSelectedKey(key);
    setMobilePane("thread");
    setOpened((prev) => new Map(prev).set(key, c.lastMessageAt));
    if (view !== "inbox") setView("inbox");
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-20 text-center">
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

  const counts: Record<Filter, number> = {
    all: conversations.length,
    needs: needsCount,
    unread: totalUnread,
  };

  const filters = (
    <div className="flex min-w-0 items-center gap-2">
      <div className="inline-flex min-w-0 overflow-x-auto rounded-lg border bg-card p-0.5 [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              filter === f.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            {f.value !== "all" && counts[f.value] > 0 && (
              <span className="ml-1 opacity-70 tabular-nums">{counts[f.value]}</span>
            )}
          </button>
        ))}
      </div>
      <div role="group" aria-label="View" className="ml-auto inline-flex shrink-0 rounded-lg border bg-card p-0.5">
        {(
          [
            { value: "inbox", label: "Inbox", icon: List },
            { value: "board", label: "Board", icon: KanbanSquare },
          ] as const
        ).map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={view === o.value}
            aria-label={`${o.label} view`}
            title={`${o.label} view`}
            onClick={() => setView(o.value)}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              view === o.value
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <o.icon className="size-3.5" />
          </button>
        ))}
      </div>
    </div>
  );

  const searchBox = (
    <div className="relative min-w-0 flex-1">
      <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search conversations"
        className="h-9 bg-card pl-8 text-sm"
      />
    </div>
  );

  if (view === "board") {
    return (
      <div>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          {searchBox}
          {filters}
        </div>
        <LaneScroller>
          {TRIAGE.map((t) => {
            const rows = visible.filter((c) => triageOf(c) === t.id);
            return (
              <Lane
                key={t.id}
                color={t.color}
                title={t.title}
                count={rows.length}
                hint={t.hint}
                collapsed={folded.has(t.id)}
                onToggle={() => toggleFold(t.id)}
                className="lg:min-w-[260px]"
                empty={rows.length === 0 ? <LaneEmpty>All clear</LaneEmpty> : undefined}
              >
                {rows.map((c) => (
                  <ConversationCard
                    key={threadKey(c)}
                    c={c}
                    color={t.color}
                    unread={unreadOf(c)}
                    roomy
                    onOpen={() => open(c)}
                  />
                ))}
              </Lane>
            );
          })}
        </LaneScroller>
      </div>
    );
  }

  const activeTriage = active ? TRIAGE_BY_ID[triageOf(active)] : null;

  return (
    <div
      // Same story as the client inbox: a fixed 560px floor made the pane taller
      // than its container on short screens, so the page scrolled behind an
      // already-scrolling message list. Floors are gated on available height,
      // and the keyboard inset keeps the composer clear on phones whose browser
      // won't shrink the viewport for it.
      className="grid h-[calc(100dvh-5rem)] sm:h-[calc(100dvh-10rem)] min-h-0 grid-cols-1 gap-4 [@media(min-height:640px)]:min-h-[22rem] [@media(min-width:1024px)_and_(min-height:800px)]:min-h-[560px] lg:grid-cols-[340px_1fr]"
      style={keyboard ? { height: `calc(100dvh - 5rem - ${keyboard}px)` } : undefined}
    >
      {/* Conversation list — its own scroll container, so it never runs away
          with the page. Tinted like a board lane, so the cards sit on it. */}
      <aside
        className={cn(
          "surface flex min-h-0 flex-col overflow-hidden",
          mobilePane === "thread" && "hidden lg:flex",
        )}
      >
        <div className="space-y-2 border-b p-3">
          {searchBox}
          {filters}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40 p-2.5 [scrollbar-width:thin]">
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing matches that.
            </p>
          ) : (
            TRIAGE.map((t) => {
              const rows = visible.filter((c) => triageOf(c) === t.id);
              if (rows.length === 0) return null;
              return (
                <section key={t.id} aria-label={t.title} className="mb-3 last:mb-0">
                  <div className="flex items-center gap-2 px-1 pb-1.5">
                    <LanePill color={t.color} className="px-2 py-0.5 text-[11px]">
                      {t.title}
                    </LanePill>
                    <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                      {rows.length}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {rows.map((c) => (
                      <ConversationCard
                        key={threadKey(c)}
                        c={c}
                        color={t.color}
                        unread={unreadOf(c)}
                        active={threadKey(c) === selectedKey}
                        onOpen={() => open(c)}
                      />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </aside>

      {/* Active thread — header pinned, messages scroll, composer docked. */}
      <section
        className={cn(
          "surface flex min-h-0 flex-col overflow-hidden",
          mobilePane === "list" && "hidden lg:flex",
        )}
      >
        {active && activeTriage && (
          <>
            {/* Compact on a phone: every pixel of header is a line of chat. */}
            <div
              className="relative flex items-center gap-2.5 border-b px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3.5"
              style={{ "--col": activeTriage.color } as CSSProperties}
            >
              <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-[var(--col)] opacity-80" />
              <Button
                variant="ghost"
                size="icon"
                className="-ml-1 size-8 shrink-0 lg:hidden"
                onClick={() => setMobilePane("list")}
                aria-label="Back to conversations"
              >
                <ArrowLeft className="size-4" />
              </Button>
              <span className="hidden size-9 shrink-0 items-center justify-center rounded-full bg-[var(--col)] text-xs font-semibold text-white shadow-sm sm:flex">
                {initials(active.clientName)}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-heading text-base font-semibold sm:text-lg">
                  {active.clientName}
                  {active.company && (
                    <span className="font-normal text-muted-foreground"> · {active.company}</span>
                  )}
                </h2>
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
                  {active.projectId ? (
                    <FolderKanban className="size-3 shrink-0" />
                  ) : (
                    <MessagesSquare className="size-3 shrink-0" />
                  )}
                  <span className="truncate">
                    {active.projectId ? active.projectName : "General chat"}
                  </span>
                  <span
                    className="hidden shrink-0 rounded-full bg-[color-mix(in_oklab,var(--col)_13%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[color-mix(in_oklab,var(--col)_72%,var(--foreground))] sm:inline"
                  >
                    {activeTriage.title}
                  </span>
                </p>
              </div>
              <LocalTime timezone={active.timezone} className="shrink-0" />
            </div>

            <div className="min-h-0 flex-1 bg-[var(--chat-canvas)] px-4 pt-2 pb-4">
              {isLoading ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading conversation…
                </p>
              ) : (
                <MessageThread
                  key={selectedKey ?? ""}
                  projectId={active.projectId}
                  clientId={active.clientId}
                  viewerRole="ADMIN"
                  initialMessages={page.messages}
                  initialHasMore={page.hasMore}
                  variant="fill"
                  canWriteInternal
                  onActivity={() => router.refresh()}
                />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** One conversation, as a card on its lane. */
function ConversationCard({
  c,
  color,
  unread,
  active,
  roomy,
  onOpen,
}: {
  c: ConversationSummary;
  color: string;
  unread: number;
  active?: boolean;
  /** Board lanes: a two-line preview instead of one. */
  roomy?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
      style={{ "--col": color } as CSSProperties}
      className={cn(
        "relative flex w-full items-start gap-2.5 overflow-hidden rounded-xl border bg-card p-2.5 text-left shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color] duration-150 outline-none",
        "hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)] focus-visible:ring-2 focus-visible:ring-ring/60",
        active &&
          "border-[color-mix(in_oklab,var(--col)_55%,var(--border))] bg-[color-mix(in_oklab,var(--col)_6%,var(--card))] shadow-[0_6px_20px_-12px_color-mix(in_oklab,var(--col)_60%,transparent)]",
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--col)] text-xs font-semibold text-white shadow-sm">
        {initials(c.clientName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("truncate text-sm", unread > 0 ? "font-semibold" : "font-medium")}>
            {c.clientName}
          </span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {formatDistanceToNowStrict(new Date(c.lastMessageAt), { addSuffix: false })
              .replace(/ seconds?/, "s")
              .replace(/ minutes?/, "m")
              .replace(/ hours?/, "h")
              .replace(/ days?/, "d")
              .replace(/ months?/, "mo")
              .replace(/ years?/, "y")}
          </span>
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
        <span className="mt-1 flex items-start gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 text-xs [overflow-wrap:anywhere]",
              roomy ? "line-clamp-2" : "truncate",
              unread > 0 ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {c.preview}
          </span>
          {unread > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-white">
              {unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
