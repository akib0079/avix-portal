"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateWhatsappSupportUrl } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

export function WhatsappSetting({ initialUrl }: { initialUrl: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await updateWhatsappSupportUrl(url);
    setSaving(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success(url.trim() ? "WhatsApp link saved." : "WhatsApp link removed.");
    router.refresh();
  }

  return (
    <div>
      <h2 className="font-heading text-lg font-semibold">WhatsApp support</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Shown to clients in the project chat for urgent help. Leave empty to
        hide it.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <Input
          type="url"
          placeholder="https://wa.link/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="max-w-sm"
        />
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
      </div>
    </div>
  );
}
