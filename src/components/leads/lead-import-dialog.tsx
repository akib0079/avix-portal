"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importLeads } from "@/lib/actions/leads";
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
import { useActivity } from "@/components/layout/activity-indicator";
import { Download, FileUp, Loader2, Upload } from "lucide-react";

const TEMPLATE_HEADER =
  "name,email,company,source,stage,estimatedValue,notes,brandInfo,responseMessage,nextFollowUp";
const TEMPLATE_SAMPLE =
  'Sarah Miller,sarah@acme.com,Acme Co,Referral,Proposal,2500,Wants a Shopify store,"DTC skincare brand, 5k orders/mo, on Wix","Hi Sarah — happy to help with the Shopify build. Here is what I would suggest…",2026-08-01\nJohn Doe,john@example.com,,Website,New,1200,Landing page rebuild,,,';

export function LeadImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { track } = useActivity();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowCount, setRowCount] = useState(0);

  function downloadTemplate() {
    const blob = new Blob([`${TEMPLATE_HEADER}\n${TEMPLATE_SAMPLE}\n`], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "avix-leads-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      setFileName(file.name);
      setRowCount(Math.max(0, text.trim().split(/\r?\n/).length - 1));
    };
    reader.readAsText(file);
  }

  async function onImport() {
    if (!csvText) return;
    setBusy(true);
    const result = await track(importLeads(csvText), "Importing leads…");
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    const { imported, skipped } = result.data!;
    toast.success(
      `Imported ${imported} lead${imported === 1 ? "" : "s"}${skipped ? ` · ${skipped} skipped` : ""}.`,
    );
    setCsvText(null);
    setFileName(null);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Import leads</DialogTitle>
          <DialogDescription>
            Upload a spreadsheet of leads at once. In Excel or Google Sheets,
            use <strong>File → Save as / Download → CSV</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-medium">Columns</p>
          <p className="mt-1 text-xs text-muted-foreground">
            name (required), email, company, source, stage, estimatedValue,
            notes, brandInfo, responseMessage, nextFollowUp (YYYY-MM-DD).
            Unknown source/stage default to Other / New.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={downloadTemplate}
          >
            <Download /> Download CSV template
          </Button>
        </div>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-brand-tint/40"
        >
          {fileName ? (
            <>
              <FileUp className="size-4 shrink-0 text-primary" />
              <span className="truncate">
                {fileName} — {rowCount} row{rowCount === 1 ? "" : "s"} ready
              </span>
            </>
          ) : (
            <>
              <Upload className="size-4 shrink-0" />
              Choose a .csv file
            </>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onImport} disabled={busy || !csvText}>
            {busy ? <Loader2 className="animate-spin" /> : <FileUp />}
            Import {rowCount > 0 ? `${rowCount} lead${rowCount === 1 ? "" : "s"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
