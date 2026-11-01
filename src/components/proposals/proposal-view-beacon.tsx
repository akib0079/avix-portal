"use client";

import { useEffect, useRef } from "react";
import { recordProposalView } from "@/lib/actions/proposals";

/**
 * Tells the server the client really opened the proposal. It runs only in a
 * browser, after the page has mounted, which is the point: the link scanners
 * mail providers run over every incoming link fetch the HTML but never run
 * it, so they can't pass for the client. Renders nothing.
 */
export function ProposalViewBeacon({ proposalId, token }: { proposalId: string; token: string }) {
  // Strict mode runs effects twice in development; one open is one view.
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const key = `${proposalId}:${token}`;
    if (sent.current === key) return;
    sent.current = key;
    recordProposalView(proposalId, token).catch(() => {
      // Best-effort: a missed view must never trouble the client.
    });
  }, [proposalId, token]);

  return null;
}
