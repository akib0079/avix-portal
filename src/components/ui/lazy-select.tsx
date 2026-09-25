"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  selectTriggerClassName,
} from "@/components/ui/select";

/**
 * A select for use in every row of a long list.
 *
 * A Radix Select is a small application — collection, popper, focus scope,
 * a hidden native <select> — and a list of 300 of them had to hydrate before
 * the page would respond. This renders a plain button with the same look
 * (and, unlike Radix on the server, the current label actually visible), and
 * swaps in the real Select the first time someone reaches for it.
 *
 * It opens as a popper below the trigger: "item-aligned" would put the
 * current option under the pointer that is still pressed, and the pointer-up
 * would pick it and close the menu straight away.
 */
export function LazySelect<V extends string>({
  value,
  options,
  onValueChange,
  size = "sm",
  className,
  ariaLabel,
  disabled,
}: {
  value: V;
  options: readonly { value: V; label: string }[];
  onValueChange: (value: V) => void;
  size?: "sm" | "default";
  className?: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const label = options.find((o) => o.value === value)?.label ?? value;

  if (!armed) {
    return (
      <button
        type="button"
        data-slot="select-trigger"
        data-size={size}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={false}
        disabled={disabled}
        onPointerDown={(e) => {
          if (e.button === 0) setArmed(true);
        }}
        onKeyDown={(e) => {
          if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            setArmed(true);
          }
        }}
        className={cn(selectTriggerClassName, className)}
      >
        <span data-slot="select-value">{label}</span>
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <Select
      defaultOpen
      value={value}
      onValueChange={(v) => onValueChange(v as V)}
      disabled={disabled}
    >
      <SelectTrigger size={size} className={className} aria-label={ariaLabel} autoFocus>
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
