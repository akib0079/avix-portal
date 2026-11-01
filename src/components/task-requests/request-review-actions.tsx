"use client";

import { useState } from "react";
import type { ProjectBillingType } from "@prisma/client";
import type { WorkRole } from "@/lib/board";
import { AcceptRequestDialog, DeclineRequestDialog } from "@/components/board/work-dialogs";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

/**
 * Accept or decline a request from the cross-project inbox — the same two
 * dialogs as the project's Requested lane and list, so a request is decided
 * the same way wherever it's met. The project's people and phases load when
 * the accept dialog opens. Both actions revalidate the inbox, which re-renders
 * with the request in its new lane.
 */
export function RequestReviewActions({
  request,
}: {
  request: {
    id: string;
    title: string;
    clientName: string;
    projectId: string;
    billingType: ProjectBillingType;
    itemId: string | null;
    role: WorkRole;
  };
}) {
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => setAccepting(true)}>
        <Check /> Accept
      </Button>
      <Button size="sm" variant="outline" onClick={() => setDeclining(true)}>
        <X /> Decline
      </Button>

      {accepting && (
        <AcceptRequestDialog
          open
          onOpenChange={setAccepting}
          requestId={request.id}
          title={request.title}
          clientName={request.clientName}
          projectId={request.projectId}
          role={request.role}
          billingType={request.billingType}
          itemId={request.itemId}
        />
      )}
      {declining && (
        <DeclineRequestDialog
          open
          onOpenChange={setDeclining}
          requestId={request.id}
          title={request.title}
          clientName={request.clientName}
        />
      )}
    </div>
  );
}
