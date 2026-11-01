"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Eraser, Undo2 } from "lucide-react";
import { SIGNATURE_MAX_HEIGHT, SIGNATURE_MAX_WIDTH } from "@/lib/signature-rules";

type Point = { x: number; y: number };
type Stroke = Point[];

export type SignaturePadHandle = {
  /** The drawing as a trimmed PNG data URL, or null when there is too little ink. */
  toPng(): string | null;
};

const INK = "#0f172a";
const LINE_WIDTH = 2.4;
/** Less ink than this, in CSS pixels of stroke, is a tap or a slip, not a signature. */
const MIN_INK = 40;
/** Exported at twice the on-screen size (crisp in the PDF), within the server's limits. */
const EXPORT_SCALE = 2;
const EXPORT_PADDING = 6;

function inkLength(strokes: Stroke[]): number {
  let total = 0;
  for (const s of strokes) {
    for (let i = 1; i < s.length; i++) total += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
  }
  return total;
}

/** Each stroke through the midpoints of its samples: smooth, and still close to every one. */
function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = LINE_WIDTH;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  for (const s of strokes) {
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0].x, s[0].y, LINE_WIDTH / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(s[0].x, s[0].y);
    for (let i = 1; i < s.length - 1; i++) {
      ctx.quadraticCurveTo(s[i].x, s[i].y, (s[i].x + s[i + 1].x) / 2, (s[i].y + s[i + 1].y) / 2);
    }
    const last = s[s.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
}

/**
 * A signature drawn with a mouse, finger or stylus. Pointer events cover all
 * three; touch-action: none stops a finger stroke from scrolling the page.
 * The canvas backing store is sized to the device pixel ratio, so ink is sharp
 * on a phone, and the strokes are kept as points (in CSS pixels) rather than
 * pixels, which is what makes Undo, a resize and the export lossless.
 *
 * The export is trimmed to the ink plus a margin and redrawn at a fixed scale
 * on a transparent background, so its size depends on the signature, not on
 * the screen it was drawn on.
 */
export function SignaturePad({
  ref,
  onInkChange,
  disabled = false,
}: {
  ref?: Ref<SignaturePadHandle>;
  /** Called when a stroke ends, is undone or cleared: is there enough ink to sign with? */
  onInkChange?: (hasInk: boolean) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const active = useRef<{ pointerId: number; left: number; top: number; width: number; height: number } | null>(null);
  const frame = useRef<number | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);

  const paint = useCallback(() => {
    frame.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const scale = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawStrokes(ctx, strokes.current);
  }, []);

  const schedule = useCallback(() => {
    if (frame.current == null) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  // Backing store = CSS size × devicePixelRatio, refitted when either changes
  // (a rotation, a resize, dragging the window to another screen, zooming).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let media: MediaQueryList | null = null;
    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      paint();
    };
    const watchRatio = () => {
      media?.removeEventListener("change", onRatio);
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      media.addEventListener("change", onRatio);
    };
    function onRatio() {
      fit();
      watchRatio();
    }
    fit();
    watchRatio();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      media?.removeEventListener("change", onRatio);
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [paint]);

  useImperativeHandle(
    ref,
    () => ({
      toPng() {
        const all = strokes.current;
        if (inkLength(all) < MIN_INK) return null;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const s of all) {
          for (const p of s) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
        }
        const width = maxX - minX + EXPORT_PADDING * 2;
        const height = maxY - minY + EXPORT_PADDING * 2;
        const scale = Math.min(EXPORT_SCALE, SIGNATURE_MAX_WIDTH / width, SIGNATURE_MAX_HEIGHT / height);
        const out = document.createElement("canvas");
        out.width = Math.max(1, Math.floor(width * scale));
        out.height = Math.max(1, Math.floor(height * scale));
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.setTransform(scale, 0, 0, scale, (EXPORT_PADDING - minX) * scale, (EXPORT_PADDING - minY) * scale);
        drawStrokes(ctx, all);
        return out.toDataURL("image/png");
      },
    }),
    [],
  );

  function changed() {
    setStrokeCount(strokes.current.length);
    onInkChange?.(inkLength(strokes.current) >= MIN_INK);
  }

  /** Clamped to the pad: ink dragged off the edge would be signed but never seen. */
  function pointAt(e: { clientX: number; clientY: number }): Point {
    const a = active.current!;
    return {
      x: Math.min(Math.max(e.clientX - a.left, 0), a.width),
      y: Math.min(Math.max(e.clientY - a.top, 0), a.height),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || active.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    active.current = { pointerId: e.pointerId, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    strokes.current = [...strokes.current, [pointAt(e)]];
    schedule();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!active.current || e.pointerId !== active.current.pointerId) return;
    const stroke = strokes.current[strokes.current.length - 1];
    // Coalesced events carry the samples between frames: smoother curves on
    // fast strokes, where a plain pointermove would cut corners.
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const sample of samples.length > 0 ? samples : [e.nativeEvent]) stroke.push(pointAt(sample));
    schedule();
  }

  function onPointerEnd(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!active.current || e.pointerId !== active.current.pointerId) return;
    active.current = null;
    changed();
  }

  function undo() {
    strokes.current = strokes.current.slice(0, -1);
    paint();
    changed();
  }

  function clear() {
    strokes.current = [];
    paint();
    changed();
  }

  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

  return (
    <div>
      {/* Paper in both themes: the exported ink is dark on transparent, and
          this is what it will look like on the certificate. */}
      <div className="relative h-40 overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white sm:h-44">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Signature pad: draw your signature with a mouse, finger or stylus"
          className="absolute inset-0 size-full cursor-crosshair touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        />
        <div aria-hidden className="pointer-events-none absolute inset-x-6 bottom-10 border-b border-slate-300" />
        <span aria-hidden className="pointer-events-none absolute bottom-10 left-6 mb-1 text-lg leading-none text-slate-400">
          ×
        </span>
        {strokeCount === 0 && (
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-slate-400">
            Sign above the line
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Prefer the keyboard? Choose Type above.</p>
        <div className="flex gap-1">
          <button type="button" onClick={undo} disabled={disabled || strokeCount === 0} className={buttonClass}>
            <Undo2 className="size-3.5" /> Undo
          </button>
          <button type="button" onClick={clear} disabled={disabled || strokeCount === 0} className={buttonClass}>
            <Eraser className="size-3.5" /> Clear
          </button>
        </div>
      </div>
    </div>
  );
}
