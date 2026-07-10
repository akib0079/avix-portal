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
import { MessageCircle, X } from "lucide-react";

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
        <Button
          className="fixed right-5 bottom-5 z-40 size-14 rounded-full shadow-lg shadow-primary/30 transition-transform hover:scale-105"
          size="icon"
          aria-label="Open project chat"
        >
          {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-md"
        aria-describedby={undefined}
      >
        <div className="border-b bg-sidebar px-5 py-4">
          <SheetTitle className="font-heading flex items-center gap-2 text-base text-white">
            <MessageCircle className="size-4 text-primary" />
            {title}
          </SheetTitle>
          <p className="mt-0.5 text-xs text-slate-400">
            {viewerRole === "CLIENT"
              ? "We usually reply within one business day."
              : "Messages are visible to the client."}
          </p>
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
