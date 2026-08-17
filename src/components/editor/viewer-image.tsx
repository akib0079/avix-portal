"use client";

import { useState } from "react";
import { ImageLightbox } from "./image-lightbox";
import { Maximize2 } from "lucide-react";

/**
 * An image inside stored rich text. Click to open it full screen, where it can
 * be zoomed, panned, copied or downloaded.
 *
 * Its own client component so the viewer itself stays a server component —
 * rich text renders on the server everywhere it's used.
 */
export function ViewerImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group/img relative block cursor-zoom-in overflow-hidden rounded-lg border bg-muted/30 transition-shadow hover:shadow-md"
        aria-label={alt ? `View ${alt} full screen` : "View image full screen"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" className="block max-h-96 w-auto" />
        <span className="pointer-events-none absolute top-2 right-2 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover/img:opacity-100">
          <Maximize2 className="size-3.5" />
        </span>
      </button>
      {open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
