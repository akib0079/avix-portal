"use client";

import { useState } from "react";
import type { MessageView } from "@/lib/dal/messages";
import { MessageThread } from "./message-thread";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { X } from "lucide-react";
import { AvixBot } from "@/components/avix-bot";

/**
 * Floating support-style chat: a fixed launcher bubble (bottom-right) that
 * opens the project message thread in a right-side panel.
 */
function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.22 3.08.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35zM12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.44 4.43-9.87 9.89-9.87a9.82 9.82 0 0 1 6.99 2.9 9.82 9.82 0 0 1 2.89 6.99c0 5.44-4.43 9.87-9.88 9.87zm8.41-18.28A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.18-1.24-6.16-3.48-8.4z" />
    </svg>
  );
}

export function ChatWidget({
  projectId,
  viewerRole,
  initialMessages,
  title,
  whatsappUrl,
}: {
  projectId: string;
  viewerRole: "ADMIN" | "CLIENT";
  initialMessages: MessageView[];
  title: string;
  whatsappUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open project chat"
          className="group fixed right-5 bottom-5 z-40 flex items-center gap-2.5 rounded-full border border-primary/20 bg-sidebar py-2.5 pr-5 pl-3.5 shadow-lg shadow-primary/25 transition-transform hover:scale-105"
        >
          {open ? (
            <X className="size-6 text-white" />
          ) : (
            <AvixBot size={22} />
          )}
          <span className="text-sm font-semibold text-white">
            {open ? "Close" : "Chat with us"}
          </span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-md"
        aria-describedby={undefined}
      >
        <div className="flex items-center gap-3 border-b bg-sidebar px-5 py-4">
          <AvixBot size={26} />
          <div>
            <SheetTitle className="font-heading text-base text-white">
              {title}
            </SheetTitle>
            <p className="mt-0.5 text-xs text-slate-400">
              {viewerRole === "CLIENT"
                ? "We usually reply within one business day."
                : "Messages are visible to the client."}
            </p>
          </div>
        </div>
        {viewerRole === "CLIENT" && whatsappUrl && (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 border-b bg-emerald-50 px-5 py-3 text-sm text-emerald-800 transition-colors hover:bg-emerald-100"
          >
            <WhatsappIcon className="size-4.5 shrink-0 text-emerald-600" />
            <span>
              Urgent? <span className="font-semibold">Call or message us on WhatsApp</span>
            </span>
          </a>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <MessageThread
            projectId={projectId}
            viewerRole={viewerRole}
            initialMessages={initialMessages}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
