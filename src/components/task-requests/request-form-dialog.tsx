"use client";

import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { JSONContent } from "@tiptap/react";
import {
  taskRequestSchema,
  type TaskRequestInput,
} from "@/lib/validation/task-request";
import { submitTaskRequest } from "@/lib/actions/task-requests";
import { RichTextEditor } from "@/components/editor/rich-text-editor-lazy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
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
import { toast } from "sonner";
import { Loader2, MessageSquarePlus } from "lucide-react";

/**
 * The client's one way to ask for something new: it becomes a work item
 * waiting in Requested on the project ("Waiting for the team"), with the
 * request that records the team's decision. On a project page it's fixed to
 * that project; elsewhere the client picks one.
 */
export function RequestFormDialog({
  projects,
  defaultProjectId,
  defaultTitle = "",
  triggerLabel = "Request a task",
  trigger,
}: {
  projects: { id: string; projectName: string }[];
  defaultProjectId?: string;
  /** "Ask again" after a decline starts from the old title. */
  defaultTitle?: string;
  triggerLabel?: string;
  /** A different opener than the default button. */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const blank = {
    projectId: defaultProjectId ?? projects[0]?.id ?? "",
    title: defaultTitle,
    description: undefined,
  };

  const form = useForm<TaskRequestInput>({
    resolver: zodResolver(taskRequestSchema),
    defaultValues: blank,
  });

  async function onSubmit(values: TaskRequestInput) {
    const result = await submitTaskRequest(values);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Request sent — it waits for the team, and you'll hear as soon as they decide.");
    setOpen(false);
    form.reset(blank);
    // submitTaskRequest revalidates the requests page and the project, and
    // Next applies that render from the action's response — no refresh.
  }

  if (projects.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <MessageSquarePlus /> {triggerLabel}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading">Request a task</DialogTitle>
          <DialogDescription>
            Describe what you need — you can format text and attach images.
            It waits for the team, who accept it into your project&apos;s
            milestones or get back to you.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {projects.length > 1 && (
              <FormField
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select project" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.projectName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What do you need?</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Add a size guide to product pages"
                      {...field}
                    />
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
                  <FormLabel>Details</FormLabel>
                  <FormControl>
                    <RichTextEditor
                      value={(field.value as JSONContent) ?? null}
                      onChange={field.onChange}
                      placeholder="Describe the task in detail — add screenshots or reference images if helpful."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={form.formState.isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
                Submit request
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
