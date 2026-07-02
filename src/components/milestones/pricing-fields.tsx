"use client";

import type { UseFormReturn } from "react-hook-form";
import type { ApprovalPricingInput } from "@/lib/validation/task-request";
import { usd } from "@/lib/format";
import { Input } from "@/components/ui/input";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Any form whose values include the pricing fields can pass its form object
// here (the milestone dialog casts — the shapes are structurally identical).
export function PricingFields({ form }: { form: UseFormReturn<ApprovalPricingInput> }) {
  const pricingType = form.watch("pricingType");
  const hourlyRate = form.watch("hourlyRate");
  const estimatedHours = form.watch("estimatedHours");

  const estimate =
    pricingType === "HOURLY" && hourlyRate && estimatedHours
      ? usd.format(Number(hourlyRate) * Number(estimatedHours))
      : null;

  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <FormField
        control={form.control}
        name="pricingType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Pricing</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="NONE">No charge</SelectItem>
                <SelectItem value="HOURLY">Hourly rate</SelectItem>
                <SelectItem value="FIXED">Fixed price</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {pricingType === "HOURLY" && (
        <div className="mt-4 grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="hourlyRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Rate ($/hr)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="80"
                    className="bg-background"
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="estimatedHours"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Estimated hours</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.5"
                    placeholder="5"
                    className="bg-background"
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}

      {pricingType === "FIXED" && (
        <div className="mt-4">
          <FormField
            control={form.control}
            name="fixedPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fixed price ($)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="400"
                    className="bg-background"
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}

      {estimate && (
        <p className="mt-3 text-sm font-medium text-primary">
          Estimated total: {estimate}
        </p>
      )}
    </div>
  );
}
