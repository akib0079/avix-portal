"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { JSONContent } from "@tiptap/react";
import { milestoneSchema, type MilestoneInput } from "@/lib/validation/milestone";
import { createMilestone, updateMilestone } from "@/lib/actions/milestones";
import type { MilestoneView } from "./milestone-types";
import { RichTextEditor } from "@/components/editor/rich-text-editor-lazy";
import { PricingFields } from "./pricing-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TeamOption } from "@/lib/dal/users";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function MilestoneFormDialog({
  projectId,
  milestone,
  open,
  onOpenChange,
  billingType = "MILESTONE",
  canEditPricing = true,
  team = [],
}: {
  projectId: string;
  /** present = edit mode */
  milestone?: MilestoneView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** CONTRACT hides per-milestone pricing (whole project has one price). */
  billingType?: "MILESTONE" | "CONTRACT";
  /** false for STAFF — money-blind; the server discards any pricing they send. */
  canEditPricing?: boolean;
  /** Admins and staff who can be assigned this milestone. */
  team?: TeamOption[];
}) {
  const router = useRouter();
  const isEdit = !!milestone;

  const form = useForm<MilestoneInput>({
    resolver: zodResolver(milestoneSchema),
    defaultValues: {
      title: "",
      description: undefined,
      assigneeId: "none",
      dueDate: "",
      pricingType: "NONE",
      hourlyRate: null,
      estimatedHours: null,
      fixedPrice: null,
    },
  });

  // Re-sync when the dialog opens for a different milestone.
  useEffect(() => {
    if (open) {
      form.reset({
        title: milestone?.title ?? "",
        description: milestone?.description ?? undefined,
        assigneeId: milestone?.assigneeId ?? "none",
        dueDate: milestone?.dueDate ?? "",
        pricingType: milestone?.pricingType ?? "NONE",
        hourlyRate: milestone?.hourlyRate ?? null,
        estimatedHours: milestone?.estimatedHours ?? null,
        fixedPrice: milestone?.fixedPrice ?? null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, milestone?.id]);

  async function onSubmit(values: MilestoneInput) {
    const result = isEdit
      ? await updateMilestone(milestone.id, values)
      : await createMilestone(projectId, values);
    if (!result.ok) return void toast.error(result.error);
    toast.success(isEdit ? "Milestone updated." : "Milestone added.");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? "Edit milestone" : "Add milestone"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the milestone details and pricing."
              : "Add a step to this project's board."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Payment & Shipping Setup" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <RichTextEditor
                      value={(field.value as JSONContent) ?? null}
                      onChange={field.onChange}
                      placeholder="What does this milestone cover?"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Who does it, and by when — the two questions the board could
                never answer before. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="assigneeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assigned to</FormLabel>
                    <Select
                      value={field.value || "none"}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {team.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name}
                            {member.role === "STAFF" ? " · staff" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {billingType !== "CONTRACT" && canEditPricing && (
              <PricingFields
                form={form as unknown as Parameters<typeof PricingFields>[0]["form"]}
              />
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={form.formState.isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
                {isEdit ? "Save changes" : "Add milestone"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
