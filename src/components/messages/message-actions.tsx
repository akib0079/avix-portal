"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Reply, Copy, Check } from "lucide-react";

/**
 * Swipe-to-reply, plus reply and copy buttons.
 *
 * The swipe is the mobile affordance every chat app has trained people to
 * expect, and it costs nothing on desktop where the buttons do the same job.
 *
 * Pointer events rather than touch events so one implementation covers finger,
 * stylus and trackpad. The gesture only engages once horizontal movement beats
 * vertical — otherwise a slightly-off-vertical scroll would drag the bubble
 * sideways and the thread would feel broken every time you scrolled it.
 */

/** Past this many px the release fires a reply. */
const TRIGGER_PX = 56;
/** Never let the bubble travel further than this, however hard you pull. */
const MAX_PX = 80;
/** Horizontal travel before we claim the gesture from the scroller. */
const CLAIM_PX = 10;

export function SwipeToReply({
  onReply,
  children,
}: {
  onReply: () => void;
  children: React.ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  // null until the gesture is decided; then true for a horizontal drag.
  const claimed = useRef<boolean | null>(null);

  function reset() {
    start.current = null;
    claimed.current = null;
    setDragging(false);
    setDx(0);
  }

  return (
    <div className="relative touch-pan-y">
      {/* The icon is revealed by the bubble moving off it, so it only appears
          in proportion to how far the gesture has actually gone. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-1 text-primary transition-opacity"
        style={{ opacity: Math.min(1, dx / TRIGGER_PX) }}
      >
        <Reply className="size-4" />
      </span>

      <div
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: dragging ? undefined : "transform 160ms ease-out",
        }}
        onPointerDown={(e) => {
          // Mouse drags are not a gesture anyone expects here; the buttons
          // cover the pointer case.
          if (e.pointerType === "mouse") return;
          start.current = { x: e.clientX, y: e.clientY };
          claimed.current = null;
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const moveX = e.clientX - start.current.x;
          const moveY = e.clientY - start.current.y;

          if (claimed.current === null) {
            if (Math.abs(moveY) > Math.abs(moveX)) {
              // Vertical wins: this is a scroll, stay out of its way for good.
              claimed.current = false;
              return;
            }
            if (Math.abs(moveX) < CLAIM_PX) return;
            claimed.current = true;
            setDragging(true);
          }
          if (claimed.current === false) return;

          // Rightward only, and resistance past the trigger so the pull has a
          // ceiling you can feel.
          const next = Math.max(0, moveX);
          setDx(next > TRIGGER_PX ? TRIGGER_PX + (next - TRIGGER_PX) * 0.3 : next);
        }}
        onPointerUp={() => {
          if (claimed.current && dx >= TRIGGER_PX) onReply();
          reset();
        }}
        onPointerCancel={reset}
      >
        {children}
      </div>
    </div>
  );
}

export function MessageActions({
  text,
  onReply,
  align,
}: {
  text: string;
  onReply: () => void;
  align: "left" | "right";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard writes need a secure context and can be blocked outright.
      toast.error("This browser wouldn't let me copy that.");
    }
  }

  return (
    <div
      className={cn(
        // Visible on touch, where there is no hover to reveal them; from sm
        // they fade in with the bubble so the thread stays clean.
        "mt-1 flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/msg:opacity-100 sm:group-focus-within/msg:opacity-100",
        align === "right" && "justify-end",
      )}
    >
      <ActionButton label="Reply to this message" onClick={onReply}>
        <Reply className="size-3.5" />
      </ActionButton>
      <ActionButton label={copied ? "Copied" : "Copy text"} onClick={copy}>
        {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
      </ActionButton>
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
