"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A row link in a list that can grow without bound. A plain Link prefetches
 * every row as it scrolls into view (two requests each); this one waits until
 * the pointer, focus or a touch shows intent, then prefetches as usual.
 * See next/dist/docs/01-app/02-guides/prefetching.md, "Hover-triggered prefetch".
 */
export function IntentLink({
  onPointerEnter,
  onFocus,
  onTouchStart,
  ...props
}: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intent ? null : false}
      onPointerEnter={(e) => {
        setIntent(true);
        onPointerEnter?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
    />
  );
}
