"use client";

import { useSyncExternalStore } from "react";

/**
 * Height in px that the on-screen keyboard is currently covering.
 *
 * `interactive-widget=resizes-content` in the viewport meta is the declarative
 * fix, but it only landed in Safari recently, and a large share of real phones
 * are older iOS. There, opening the keyboard leaves the layout viewport at its
 * full height and simply draws the keyboard over the bottom of it — so a
 * composer docked to the bottom of a full-height column vanishes exactly when
 * it is tapped.
 *
 * visualViewport reports the genuinely visible rectangle and has been in iOS
 * Safari since 13 and Chrome since 61, so it covers the devices the meta tag
 * does not.
 *
 * The two mechanisms do not fight. Where `resizes-content` works, the layout
 * viewport shrinks with the keyboard, so innerHeight tracks visualViewport
 * height and this returns ~0 — no double subtraction. Where it doesn't, the
 * difference is the keyboard. Browsers without visualViewport get 0 and the
 * previous behaviour.
 *
 * offsetTop matters because iOS also scrolls the layout viewport up behind the
 * keyboard; without it the inset is overstated by however far it shifted.
 */

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const vv = window.visualViewport;
  if (vv && listeners.size === 1) {
    vv.addEventListener("resize", emit);
    vv.addEventListener("scroll", emit);
  }
  return () => {
    listeners.delete(listener);
    if (vv && listeners.size === 0) {
      vv.removeEventListener("resize", emit);
      vv.removeEventListener("scroll", emit);
    }
  };
}

function getSnapshot(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const inset = window.innerHeight - vv.height - vv.offsetTop;
  // Round so getSnapshot is stable across sub-pixel jitter, which would
  // otherwise re-render on every scroll frame. Ignore anything tiny: a few
  // pixels is browser chrome settling, not a keyboard.
  const rounded = Math.round(inset);
  return rounded > 24 ? rounded : 0;
}

function getServerSnapshot(): number {
  return 0;
}

export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
