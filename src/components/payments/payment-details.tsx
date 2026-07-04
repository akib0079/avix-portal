"use client";

import { useState } from "react";
import type { PaymentAccountView } from "@/lib/dal/settings";
import { paymentRegionLabels } from "@/lib/validation/payment";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Check, Copy, Landmark } from "lucide-react";

function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  async function copy(key: string, value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast.success(`${label} copied`);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      toast.error("Couldn't copy — please copy manually.");
    }
  }
  return { copiedKey, copy };
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5 first:border-t-0">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-medium tabular-nums">{value}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={onCopy}
        aria-label={`Copy ${label}`}
      >
        {copied ? (
          <Check className="size-4 text-success" />
        ) : (
          <Copy className="size-4" />
        )}
      </Button>
    </div>
  );
}

function AccountCard({ account }: { account: PaymentAccountView }) {
  const { copiedKey, copy } = useCopy();

  function copyAll() {
    const lines = [
      `Account holder: ${account.holderName}`,
      `Bank: ${account.bankName}`,
      ...account.fields.map((f) => `${f.label}: ${f.value}`),
    ];
    copy(`${account.id}-all`, lines.join("\n"), "All details");
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-start justify-between gap-3 bg-muted/40 px-4 py-3">
        <div>
          <p className="flex items-center gap-2 font-heading font-semibold">
            <Landmark className="size-4 text-primary" />
            {account.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {account.holderName} · {account.bankName}
          </p>
          {account.bankNote && (
            <p className="text-xs text-muted-foreground">{account.bankNote}</p>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={copyAll}>
          {copiedKey === `${account.id}-all` ? (
            <Check className="size-3.5 text-success" />
          ) : (
            <Copy className="size-3.5" />
          )}
          Copy all
        </Button>
      </div>

      <div>
        {account.fields.map((field, i) => {
          const key = `${account.id}-${i}`;
          return (
            <CopyRow
              key={key}
              label={field.label}
              value={field.value}
              copied={copiedKey === key}
              onCopy={() => copy(key, field.value, field.label)}
            />
          );
        })}
      </div>

      {account.note && (
        <p className="border-t bg-brand-tint/40 px-4 py-2.5 text-xs text-muted-foreground">
          {account.note}
        </p>
      )}
    </div>
  );
}

export function PaymentDetails({
  accounts,
  className,
}: {
  accounts: PaymentAccountView[];
  className?: string;
}) {
  if (accounts.length === 0) return null;

  if (accounts.length === 1) {
    return (
      <div className={className}>
        <AccountCard account={accounts[0]} />
      </div>
    );
  }

  return (
    <Tabs defaultValue={accounts[0].id} className={cn("w-full", className)}>
      <TabsList className="mb-3 flex-wrap">
        {accounts.map((a) => (
          <TabsTrigger key={a.id} value={a.id}>
            {paymentRegionLabels[a.region] ?? a.title}
          </TabsTrigger>
        ))}
      </TabsList>
      {accounts.map((a) => (
        <TabsContent key={a.id} value={a.id}>
          <AccountCard account={a} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
