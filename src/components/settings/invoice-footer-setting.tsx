"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateInvoiceFooter } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Save, Receipt } from "lucide-react";

export function InvoiceFooterSetting({ initial }: { initial: string }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await updateInvoiceFooter(text);
    setSaving(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Invoice footer saved.");
    router.refresh();
  }

  return (
    <div>
      <h2 className="font-heading flex items-center gap-2 text-lg font-semibold">
        <Receipt className="size-5 text-primary" /> Invoice footer
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A note printed at the bottom of every generated invoice. Leave empty to hide it.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={300}
        rows={2}
        placeholder="Please use wise.com or your personal bank network to do the payment."
        className="mt-3 text-sm"
      />
      <Button className="mt-3" size="sm" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="animate-spin" /> : <Save className="size-4" />} Save footer
      </Button>
    </div>
  );
}
