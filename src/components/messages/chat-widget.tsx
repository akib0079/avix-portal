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
export function ChatWidget({
  projectId,
  viewerRole,
  initialMessages,
  title,
}: {
  projectId: string;
  viewerRole: "ADMIN" | "CLIENT";
  initialMessages: MessageView[];
  title: string;
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
