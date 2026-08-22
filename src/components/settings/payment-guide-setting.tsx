"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePaymentGuideUrl } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Save, ExternalLink } from "lucide-react";

export function PaymentGuideSetting({ initialUrl }: { initialUrl: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await updatePaymentGuideUrl(url);
    setSaving(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success(url.trim() ? "Payment guide link saved." : "Payment guide hidden.");
    router.refresh();
  }

  return (
    <div>
      <h2 className="font-heading text-lg font-semibold">Payment guide</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A PDF shown to clients on How to Pay and on every unpaid invoice. Update
        the link whenever you re-upload the file — WordPress puts the upload
        month in the path, so the old link stops working. Leave empty to hide
        the button.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="url"
          placeholder="https://avixdigital.com/wp-content/uploads/…/guide.pdf"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="sm:max-w-lg"
        />
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
          {url.trim() && (
            <Button asChild variant="outline" size="icon" title="Open the current link">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
                <span className="sr-only">Open the current link</span>
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
