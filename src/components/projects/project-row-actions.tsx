"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteProject } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Eye, Trash2, Loader2 } from "lucide-react";

export function ProjectRowActions({
  project,
  redirectAfterDelete,
  canDelete = true,
}: {
  project: { id: string; projectName: string };
  redirectAfterDelete?: string;
  /** false for STAFF — deleteProject is admin-only on the server. */
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center justify-end gap-1">
      <Button asChild variant="ghost" size="icon" className="size-8">
        <Link href={`/admin/projects/${project.id}`}>
          <Eye className="size-4" />
          <span className="sr-only">View project</span>
        </Link>
      </Button>
      {canDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-destructive hover:text-destructive"
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="size-4" />
          <span className="sr-only">Delete project</span>
        </Button>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{project.projectName}”?</DialogTitle>
            <DialogDescription>
              This permanently deletes the project, its milestones, and any
              task requests. Invoices are kept but unlinked from the project.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const result = await deleteProject(project.id);
                setBusy(false);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Project deleted.");
                setConfirmOpen(false);
                if (redirectAfterDelete) router.push(redirectAfterDelete);
                router.refresh();
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
