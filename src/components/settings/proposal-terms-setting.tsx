"use client";

import { useState } from "react";
import { updateProposalDefaultTerms } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { FileSignature, Loader2, RotateCcw, Save } from "lucide-react";

/**
 * The terms every new proposal starts with. Each proposal keeps its own copy
 * (edited in the builder), so changing this never rewrites what a client has
 * already been sent.
 */
export function ProposalTermsSetting({
  initial,
  defaultText,
}: {
  initial: string;
  /** The built-in wording, for "Use the default". */
  defaultText: string;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await updateProposalDefaultTerms(text);
    setSaving(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Default proposal terms saved.");
  }

  return (
    <div>
      <h2 className="font-heading flex items-center gap-2 text-lg font-semibold">
        <FileSignature className="size-5 text-primary" /> Proposal terms
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The terms new proposals start with: payment, ownership, revisions, cancellation. Each
        proposal can still be edited on its own. Leave empty to start proposals without terms.
        Worth having your adviser read once.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={10000}
        rows={12}
        className="mt-3 text-sm"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save className="size-4" />} Save terms
        </Button>
        {text !== defaultText && (
          <Button size="sm" variant="outline" onClick={() => setText(defaultText)} disabled={saving}>
            <RotateCcw className="size-4" /> Use the default wording
          </Button>
        )}
      </div>
    </div>
  );
}
