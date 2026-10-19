"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { MessageView } from "@/lib/dal/messages";
import { MessageThread } from "./message-thread";
import { X, Maximize2, Minimize2, ExternalLink, MessageCircle } from "lucide-react";
import { AvixBot } from "@/components/avix-bot";
import { LocalTime } from "@/components/local-time";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/utils";

function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.22 3.08.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35zM12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.44 4.43-9.87 9.89-9.87a9.82 9.82 0 0 1 6.99 2.9 9.82 9.82 0 0 1 2.89 6.99c0 5.44-4.43 9.87-9.88 9.87zm8.41-18.28A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.18-1.24-6.16-3.48-8.4z" />
    </svg>
  );
}

/**
 * The project chat, as a dock: a launcher in the corner that opens a floating
 * window above it.
 *
 * Non-modal on purpose. The old version was a full-height sheet over a dimmed
 * page, which made "check the board while you answer" impossible — and that
 * is the normal way a project conversation goes. The dock leaves the page
 * live: drag a card, open a task, scroll the timeline, keep typing. It can
 * widen when a message needs room, and on a phone it simply takes the screen.
 */
export function ChatWidget({
  projectId,
  clientId,
  clientTimezone,
  viewerRole,
  initialMessages,
  title,
  whatsappUrl,
  canWriteInternal = false,
}: {
  projectId: string;
  /** Required for ADMIN viewers — whose thread this is. */
  clientId?: string;
  /** Shows the client's live local time in the header (admin view). */
  clientTimezone?: string | null;
  viewerRole: "ADMIN" | "CLIENT";
  initialMessages: MessageView[];
  title: string;
  whatsappUrl?: string | null;
  /** Team viewers can leave notes the client never sees. */
  canWriteInternal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [unread, setUnread] = useState(() => {
    const field = viewerRole === "ADMIN" ? "readByAdminAt" : "readByClientAt";
    return initialMessages.filter((m) => m.senderRole !== viewerRole && !m[field]).length;
  });
  const keyboard = useKeyboardInset();
  // Somewhere to go when the dock is too small for the conversation.
  const fullThreadHref =
    viewerRole === "ADMIN"
      ? `/admin/messages${clientId ? `?client=${clientId}` : ""}`
      : "/portal/messages";

  return (
    <DialogPrimitive.Root
      open={open}
      modal={false}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setUnread(0);
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={open ? "Close chat" : `Open chat${unread ? ` — ${unread} unread` : ""}`}
          className={cn(
            "group fixed right-4 bottom-4 z-40 flex h-14 items-center gap-2.5 rounded-full bg-[var(--deck)] pr-2 pl-2 text-white shadow-[0_18px_40px_-14px_rgb(12_19_36/0.65)] ring-1 ring-white/10 transition-[transform,padding] duration-200 hover:scale-[1.03] sm:right-6 sm:bottom-6",
            !open && "sm:pr-5",
            open && "max-sm:hidden",
          )}
        >
          <span className="relative flex size-10 items-center justify-center rounded-full bg-white/5">
            {open ? <X className="size-5" /> : <AvixBot size={22} float={false} />}
            {!open && unread > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white ring-2 ring-[var(--deck)]">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </span>
          {!open && (
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-sm font-semibold">
                {viewerRole === "CLIENT" ? "Chat with the team" : "Message client"}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className="signal size-1.5 text-emerald-400" />
                {viewerRole === "CLIENT" ? "Replies within a business day" : "Visible to the client"}
              </span>
            </span>
          )}
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // The page behind stays usable: a click on it must not close the chat.
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "dock-in fixed z-50 flex flex-col overflow-hidden bg-[var(--chat-canvas)] shadow-[0_30px_80px_-24px_rgb(12_19_36/0.55)] outline-none",
            // Phone: the whole screen. Desktop: a window above the launcher.
            "inset-0 h-dvh sm:inset-auto sm:right-6 sm:bottom-24 sm:h-[min(44rem,calc(100dvh-8rem))] sm:rounded-3xl sm:ring-1 sm:ring-[var(--hairline)]",
            wide ? "sm:w-[min(46rem,calc(100vw-3rem))]" : "sm:w-[25.5rem]",
          )}
          style={keyboard ? { height: `calc(100dvh - ${keyboard}px)` } : undefined}
        >
          {/* Header — the deck, so the chat reads as part of the cockpit. */}
          <div className="deck relative shrink-0 rounded-none px-4 pt-4 pb-3.5 sm:rounded-t-3xl sm:rounded-b-none">
            <div className="relative z-10 flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                {viewerRole === "CLIENT" ? (
                  <AvixBot size={22} float={false} />
                ) : (
                  <MessageCircle className="size-5 text-white" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="font-heading truncate text-base font-semibold text-white">
                  {title}
                </DialogPrimitive.Title>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-300">
                  {viewerRole === "CLIENT" ? (
                    <>
                      <span className="signal size-1.5 text-emerald-400" />
                      Replies within a business day
                    </>
                  ) : (
                    <LocalTime timezone={clientTimezone ?? null} className="text-slate-300" />
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <HeaderButton
                  label={wide ? "Narrow the chat" : "Widen the chat"}
                  onClick={() => setWide((w) => !w)}
                  className="max-sm:hidden"
                >
                  {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </HeaderButton>
                <Link
                  href={fullThreadHref}
                  title="Open in Messages"
                  aria-label="Open in Messages"
                  className="rounded-lg p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <ExternalLink className="size-4" />
                </Link>
                <DialogPrimitive.Close asChild>
                  <HeaderButton label="Close chat">
                    <X className="size-4" />
                  </HeaderButton>
                </DialogPrimitive.Close>
              </div>
            </div>
            {viewerRole === "CLIENT" && whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative z-10 mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-400/25 transition-colors hover:bg-emerald-500/25"
              >
                <WhatsappIcon className="size-3.5" />
                Urgent? WhatsApp us
              </a>
            )}
          </div>

          {/* min-h-0 lets the thread's own scroll area shrink; without it the
              flex child grows to its content and the composer scrolls away. */}
          <div className="min-h-0 flex-1 px-3 pt-1 pb-3">
            <MessageThread
              projectId={projectId}
              clientId={clientId}
              viewerRole={viewerRole}
              initialMessages={initialMessages}
              canWriteInternal={canWriteInternal}
              variant="fill"
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function HeaderButton({
  label,
  onClick,
  className,
  children,
  ...rest
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "rounded-lg p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
