"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { formatDistanceToNow } from "date-fns";
import type { JSONContent } from "@tiptap/react";
import { sendMessage } from "@/lib/actions/messages";
import type { MessageView } from "@/lib/dal/messages";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { RichTextViewer } from "@/components/editor/rich-text-viewer";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { Loader2, Send, MessagesSquare } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));

export function MessageThread({
  projectId,
  viewerRole,
  initialMessages,
}: {
  projectId: string;
  viewerRole: "ADMIN" | "CLIENT";
  initialMessages: MessageView[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<JSONContent | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sending, setSending] = useState(false);

  const { data, mutate } = useSWR<{ messages: MessageView[] } | null>(
    `/api/messages?projectId=${projectId}`,
    fetcher,
    { refreshInterval: 20_000, fallbackData: { messages: initialMessages } },
  );
  const messages = data?.messages ?? initialMessages;

  async function onSend() {
    if (!draft) return;
    setSending(true);
    const result = await sendMessage({ projectId, body: draft });
    setSending(false);
    if (!result.ok) return void toast.error(result.error);
    setDraft(null);
    setResetKey((k) => k + 1);
    mutate();
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted">
              <MessagesSquare className="size-5 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium">No messages yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {viewerRole === "ADMIN"
                ? "Start the conversation with your client."
                : "Send a message to the Avix Digital team."}
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
                      : "bg-slate-200 text-slate-700",
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
                    {m.senderName} ·{" "}
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
