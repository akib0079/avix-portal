"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateRevenueTarget } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Save, Target } from "lucide-react";

export function RevenueTargetSetting({ initial }: { initial: number }) {
  const router = useRouter();
  const [value, setValue] = useState(initial > 0 ? String(initial) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await updateRevenueTarget(value);
    setSaving(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Monthly target saved.");
    router.refresh();
  }

  return (
    <div>
      <h2 className="font-heading flex items-center gap-2 text-lg font-semibold">
        <Target className="size-5 text-primary" /> Monthly revenue target
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Shown on the dashboard as progress against what you&apos;ve collected
        this month. Leave empty to hide it.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          type="number"
          min={0}
          step={100}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="10000"
          className="max-w-[180px]"
        />
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save className="size-4" />} Save
        </Button>
      </div>
    </div>
  );
}
