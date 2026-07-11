"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateBrandColor,
  uploadBrandingFile,
  clearBrandingFile,
} from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Save, Upload, Trash2, Palette } from "lucide-react";

const DEFAULT_COLOR = "#F65D0B";

function ImageUploader({
  which,
  label,
  hint,
  currentUrl,
}: {
  which: "logo" | "favicon";
  label: string;
  hint: string;
  currentUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    const result = await uploadBrandingFile(which, fd);
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success(`${label} updated.`);
    router.refresh();
  }

  async function onClear() {
    setBusy(true);
    const result = await clearBrandingFile(which);
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success(`${label} reset to default.`);
    router.refresh();
  }

  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      <div className="mt-3 flex items-center gap-4">
        <div className="flex h-14 w-24 items-center justify-center overflow-hidden rounded-md border bg-sidebar">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentUrl} alt={label} className="max-h-10 max-w-20 object-contain" />
          ) : (
            <span className="text-[10px] text-slate-400">default</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
            Upload
          </Button>
          {currentUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={onClear}
            >
              <Trash2 /> Reset
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

export function BrandingSetting({
  color,
  logoUrl,
  faviconUrl,
}: {
  color: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(color ?? DEFAULT_COLOR);
  const [saving, setSaving] = useState(false);

  async function saveColor() {
    setSaving(true);
    const result = await updateBrandColor(value);
    setSaving(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Brand color saved.");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-heading text-lg font-semibold">Branding</h2>
        <p className="text-sm text-muted-foreground">
          Make the portal yours — logo, favicon, and accent color.
        </p>
      </div>

      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Palette className="size-3.5" /> Accent color
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_COLOR}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            className="size-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
            aria-label="Pick accent color"
          />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="#F65D0B"
            className="max-w-[140px] font-mono"
          />
          <Button onClick={saveColor} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
          {value.toUpperCase() !== DEFAULT_COLOR && (
            <Button variant="ghost" onClick={() => setValue(DEFAULT_COLOR)}>
              Reset
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ImageUploader
          which="logo"
          label="Logo"
          hint="Shown in the sidebar and on the login page. PNG/SVG on a transparent background works best."
          currentUrl={logoUrl}
        />
        <ImageUploader
          which="favicon"
          label="Favicon"
          hint="The little browser-tab icon. A square PNG (512×512) is ideal."
          currentUrl={faviconUrl}
        />
      </div>
    </div>
  );
}
