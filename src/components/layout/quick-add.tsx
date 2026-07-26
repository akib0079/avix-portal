"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Plus,
  UserPlus,
  Receipt,
  FileSignature,
  CalendarPlus,
  Target,
} from "lucide-react";

const ITEMS = [
  { label: "New client", href: "/admin/clients/new", icon: UserPlus },
  { label: "New invoice", href: "/admin/invoices/new", icon: Receipt },
  { label: "New proposal", href: "/admin/proposals", icon: FileSignature },
  { label: "New meeting", href: "/admin/calendar", icon: CalendarPlus },
  { label: "New lead", href: "/admin/leads", icon: Target },
];

/**
 * Topbar quick-add: jump to any create flow from anywhere. Admin-only (mounted
 * by the shell only for admins). Reuses the existing create routes — no new
 * server code.
 */
export function QuickAdd({ tone = "light" }: { tone?: "light" | "dark" }) {
  const router = useRouter();

  // Prefetch the create routes so the jump is instant.
  useEffect(() => {
    ITEMS.forEach((i) => router.prefetch(i.href));
  }, [router]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={tone === "dark" ? "ghost" : "outline"}
          size="sm"
          className={cn(
            "gap-1.5",
            tone === "dark" && "text-white hover:bg-sidebar-accent hover:text-white",
          )}
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Quick add</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Create</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.href} onSelect={() => router.push(item.href)}>
              <Icon className="mr-2 size-4 text-muted-foreground" />
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
