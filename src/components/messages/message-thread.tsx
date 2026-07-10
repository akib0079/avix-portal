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
import { Loader2, Send } from "lucide-react";
import { AvixBot } from "@/components/avix-bot";

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
    const body = draft;
    // Optimistic: show the message and clear the composer immediately;
    // the server round-trip confirms (or reverts) in the background.
    const optimistic: MessageView = {
      id: `optimistic-${Date.now()}`,
      senderId: "me",
      senderRole: viewerRole,
      senderName: "You",
      body,
      createdAt: new Date().toISOString(),
    };
    setDraft(null);
    setResetKey((k) => k + 1);
    setSending(true);
    mutate(
      (current) => ({ messages: [...(current?.messages ?? messages), optimistic] }),
      { revalidate: false },
    );
    const result = await sendMessage({ projectId, body });
    setSending(false);
    if (!result.ok) {
      toast.error(result.error);
      setDraft(body); // restore the unsent draft
      setResetKey((k) => k + 1);
    }
    mutate(); // reconcile with the server either way
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 space-y-4">
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
