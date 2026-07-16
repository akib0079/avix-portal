"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { meetingDurations } from "@/lib/validation/meeting";
import { createMeeting } from "@/lib/actions/meetings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, CalendarPlus, Globe } from "lucide-react";

export type MeetingClientOption = {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  timezone: string | null;
};

export type MeetingProjectOption = {
  id: string;
  projectName: string;
  clientId: string | null;
};

// The dialog's own form shape: date + time as the admin picks them locally;
// converted to a UTC instant right before calling the action.
const formSchema = z.object({
  title: z.string().trim().min(1, "Give the meeting a title").max(160),
  clientId: z.string().min(1, "Pick a client"),
  projectId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a time"),
  durationMins: z.number().int().min(15).max(480),
  meetingUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), {
      message: "Meeting link must start with http(s)://",
    })
    .optional()
    .or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});
type FormValues = z.infer<typeof formSchema>;

function toInstant(date: string, time: string): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const instant = new Date(y, m - 1, d, hh, mm); // admin's local wall clock
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function previewIn(timezone: string | null, instant: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone ?? undefined,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(instant);
  } catch {
    return "—";
  }
}

export function MeetingFormDialog({
  clients,
  projects,
  open,
  onOpenChange,
  defaultDate,
}: {
  clients: MeetingClientOption[];
  projects: MeetingProjectOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "YYYY-MM-DD" prefill when opened from a day cell. */
  defaultDate?: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      clientId: "",
      projectId: "none",
      date: defaultDate ?? "",
      time: "15:00",
      durationMins: 30,
      meetingUrl: "",
      notes: "",
    },
  });

  // Re-prefill the date when opened from a specific day.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && defaultDate) form.setValue("date", defaultDate);
  }

  const clientId = form.watch("clientId");
  const date = form.watch("date");
  const time = form.watch("time");
  const selectedClient = clients.find((c) => c.id === clientId);
  const clientProjects = projects.filter(
    (p) => p.clientId === clientId || p.clientId === null,
  );

  const instant = useMemo(
    () => (date && time ? toInstant(date, time) : null),
    [date, time],
  );

  async function onSubmit(values: FormValues) {
    const startsAt = toInstant(values.date, values.time);
    if (!startsAt) return void toast.error("Pick a valid date and time.");
    setSaving(true);
    const result = await createMeeting({
      title: values.title,
      clientId: values.clientId,
      projectId: values.projectId,
      startsAtIso: startsAt.toISOString(),
      durationMins: values.durationMins,
      meetingUrl: values.meetingUrl,
      notes: values.notes,
    });
    setSaving(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Meeting booked — the client has been emailed.");
    onOpenChange(false);
    form.reset();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Book a meeting</DialogTitle>
          <DialogDescription>
            The client gets an email with the time in their timezone, a join
            link, and add-to-calendar buttons.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Homepage design review" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select client" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.firstName} {c.lastName}
                            {c.company ? ` — ${c.company}` : ""}
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
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project (optional)</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Not linked" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Not linked</SelectItem>
                        {clientProjects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.projectName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time (your time)</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="durationMins"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration</FormLabel>
                    <Select
                      value={String(field.value)}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {meetingDurations.map((d) => (
                          <SelectItem key={d} value={String(d)}>
                            {d} min
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Both-timezones preview */}
            {instant && selectedClient && (
              <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs">
                <Globe className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <div>
                  <p>
                    <span className="text-muted-foreground">Your time:</span>{" "}
                    <span className="font-medium">{previewIn(null, instant)}</span>
                  </p>
                  {selectedClient.timezone ? (
                    <p>
                      <span className="text-muted-foreground">
                        {selectedClient.firstName}&apos;s time:
                      </span>{" "}
                      <span className="font-medium">
                        {previewIn(selectedClient.timezone, instant)}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        ({selectedClient.timezone.split("/").pop()?.replaceAll("_", " ")})
                      </span>
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      No timezone on file for {selectedClient.firstName} yet — it
                      fills in when they next log in.
                    </p>
                  )}
                </div>
              </div>
            )}

            <FormField
              control={form.control}
              name="meetingUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Meeting link (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="url"
                      placeholder="https://meet.google.com/… or Zoom link"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Agenda, things to prepare…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <CalendarPlus />}
                Book & email client
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
