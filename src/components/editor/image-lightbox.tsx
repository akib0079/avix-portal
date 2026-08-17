"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { X, ZoomIn, ZoomOut, Copy, Download, Check } from "lucide-react";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const STEP = 0.5;

/**
 * Full-screen viewer for an image in a message or description.
 *
 * Rendered through a portal so it escapes the chat panel's overflow clipping —
 * inside the sheet it would otherwise be trapped in a 500px-wide scroll box.
 */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  // Whether a drag is in progress must drive rendering (cursor + transition),
  // so it is state, not just a ref.
  const [dragging, setDragging] = useState(false);

  const zoomBy = useCallback((delta: number) => {
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta));
      if (next === MIN_ZOOM) setOffset({ x: 0, y: 0 }); // recentre when zoomed out
      return next;
    });
  }, []);

  // Escape closes, +/- zoom, 0 resets.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") zoomBy(STEP);
      if (e.key === "-") zoomBy(-STEP);
      if (e.key === "0") {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      }
    }
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while the overlay is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, zoomBy]);

  async function copyImage() {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      // Safari and Firefox only reliably accept PNG on the clipboard, so
      // anything else is redrawn through a canvas first.
      const png =
        blob.type === "image/png" ? blob : await toPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Image copied.");
    } catch {
      // Clipboard image writes are blocked in some browsers/contexts; the
      // download button is the fallback, so say so rather than failing mutely.
      toast.error("This browser wouldn't allow copying the image — download it instead.");
    }
  }

  // The component only ever renders from a click handler, so the document is
  // always present by now; the guard is for safety in SSR-ish contexts.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Image"}
    >
      {/* Toolbar */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 truncate text-sm text-white/70">{alt || "Image"}</span>
        <div className="flex shrink-0 items-center gap-1">
          <ToolButton label="Zoom out" onClick={() => zoomBy(-STEP)} disabled={zoom <= MIN_ZOOM}>
            <ZoomOut className="size-4" />
          </ToolButton>
          <span className="w-12 text-center text-xs tabular-nums text-white/70">
            {Math.round(zoom * 100)}%
          </span>
          <ToolButton label="Zoom in" onClick={() => zoomBy(STEP)} disabled={zoom >= MAX_ZOOM}>
            <ZoomIn className="size-4" />
          </ToolButton>
          <ToolButton label="Copy image" onClick={copyImage}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </ToolButton>
          <a
            href={src}
            download
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Download image"
            title="Download"
          >
            <Download className="size-4" />
          </a>
          <ToolButton label="Close" onClick={onClose}>
            <X className="size-5" />
          </ToolButton>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="flex flex-1 items-center justify-center overflow-hidden p-4"
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => zoomBy(e.deltaY < 0 ? STEP / 2 : -STEP / 2)}
        onPointerDown={(e) => {
          if (zoom <= MIN_ZOOM) return;
          dragFrom.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
          setDragging(true);
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragFrom.current) return;
          setOffset({ x: e.clientX - dragFrom.current.x, y: e.clientY - dragFrom.current.y });
        }}
        onPointerUp={() => {
          dragFrom.current = null;
          setDragging(false);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onDoubleClick={() => (zoom > 1 ? (setZoom(1), setOffset({ x: 0, y: 0 })) : zoomBy(1))}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
          }}
          className={cn(
            "max-h-full max-w-full object-contain transition-transform",
            dragging && "transition-none",
          )}
        />
      </div>

      <p className="pb-3 text-center text-xs text-white/40">
        Scroll or double-click to zoom · drag to pan · Esc to close
      </p>
    </div>,
    document.body,
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** Redraw through a canvas so the clipboard always receives a PNG. */
async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/png"),
  );
}
