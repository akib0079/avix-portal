"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { ActivityProvider } from "@/components/layout/activity-indicator";
import { GlobalSearchProvider, SearchTrigger } from "@/components/layout/global-search";
import {
  LayoutGrid,
  Users,
  FolderKanban,
  FileText,
  Inbox,
  LogOut,
  Menu,
  MessageSquarePlus,
  Settings,
  CreditCard,
  Megaphone,
  ChartNoAxesCombined,
  Target,
  MessagesSquare,
  Loader2,
  CalendarDays,
  Repeat,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** show the pending-task-requests badge on this item */
  badge?: boolean;
};

const adminNav: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutGrid },
  { href: "/admin/reports", label: "Reports", icon: ChartNoAxesCombined },
  { href: "/admin/leads", label: "Leads", icon: Target },
  { href: "/admin/clients", label: "Clients", icon: Users },
  { href: "/admin/projects", label: "Projects", icon: FolderKanban },
  { href: "/admin/invoices", label: "Invoices", icon: FileText },
  { href: "/admin/retainers", label: "Retainers", icon: Repeat },
  { href: "/admin/messages", label: "Messages", icon: MessagesSquare },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/admin/task-requests", label: "Task Requests", icon: Inbox, badge: true },
  { href: "/admin/marketing", label: "Marketing", icon: Megaphone },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

const clientNav: NavItem[] = [
  { href: "/portal", label: "Overview", icon: LayoutGrid },
  { href: "/portal/messages", label: "Chat with us", icon: MessagesSquare },
  { href: "/portal/projects", label: "My Projects", icon: FolderKanban },
  { href: "/portal/invoices", label: "Invoices", icon: FileText },
  { href: "/portal/payment", label: "How to Pay", icon: CreditCard },
  { href: "/portal/requests", label: "Task Requests", icon: MessageSquarePlus },
];

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const { data } = useSWR<{ pendingTaskRequests: number } | null>(
    items.some((i) => i.badge) ? "/api/notifications" : null,
    fetcher,
    { refreshInterval: 30_000 },
  );
  const pending = data?.pendingTaskRequests ?? 0;

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active =
          item.href === "/admin" || item.href === "/portal"
            ? pathname === item.href
            : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white",
              active && "bg-sidebar-accent text-white",
            )}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
            )}
            <Icon className="size-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.badge && pending > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-white">
                {pending > 99 ? "99+" : pending}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function LogoMark({ logoUrl, width, height }: { logoUrl?: string | null; width: number; height: number }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logoUrl}
        alt="Logo"
        style={{ maxWidth: width, maxHeight: height }}
        className="h-auto w-auto object-contain"
      />
    );
  }
  return (
    <Image
      src="/avix-logo.png"
      alt="Avix Digital"
      width={width}
      height={height}
      priority
      className="brightness-0 invert"
    />
  );
}

function SidebarInner({
  variant,
  user,
  pathname,
  onNavigate,
  logoUrl,
}: {
  variant: "admin" | "client";
  user: { name: string; email: string };
  pathname: string;
  onNavigate?: () => void;
  logoUrl?: string | null;
}) {
  const router = useRouter();
  const items = variant === "admin" ? adminNav : clientNav;
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await authClient.signOut();
      router.push("/login");
      router.refresh();
    } catch {
      // Network hiccup — let them try again instead of a stuck spinner.
      setSigningOut(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="px-5 pt-6 pb-4">
        <Link href={variant === "admin" ? "/admin" : "/portal"} onClick={onNavigate}>
          <LogoMark logoUrl={logoUrl} width={132} height={33} />
        </Link>
      </div>
      <p className="px-5 pb-2 text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
        {variant === "admin" ? "Admin Panel" : "Client Portal"}
      </p>
      {variant === "admin" && (
        <div className="px-3 pb-3">
          <SearchTrigger tone="dark" />
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-3">
        <NavLinks items={items} pathname={pathname} onNavigate={onNavigate} />
      </div>
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
            {initials(user.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
        </div>
        <button
          onClick={signOut}
          disabled={signingOut}
          aria-busy={signingOut}
          className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-400 transition-colors hover:bg-sidebar-accent hover:text-white disabled:pointer-events-none disabled:opacity-80"
        >
          {signingOut ? (
            <>
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-white">Signing out…</span>
            </>
          ) : (
            <>
              <LogOut className="size-4" /> Sign out
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function AppShell({
  variant,
  user,
  children,
  logoUrl,
}: {
  variant: "admin" | "client";
  user: { name: string; email: string };
  children: React.ReactNode;
  logoUrl?: string | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const shell = (
    <div className="flex min-h-screen w-full">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">
        <SidebarInner variant={variant} user={user} pathname={pathname} logoUrl={logoUrl} />
      </aside>

      {/* Mobile topbar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b bg-sidebar px-4 lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-sidebar-accent hover:text-white"
            >
              <Menu className="size-5" />
              <span className="sr-only">Open menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 border-sidebar-border bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarInner
              variant={variant}
              user={user}
              pathname={pathname}
              onNavigate={() => setOpen(false)}
              logoUrl={logoUrl}
            />
          </SheetContent>
        </Sheet>
        <LogoMark logoUrl={logoUrl} width={110} height={28} />
        <div className="ml-auto">
          <NotificationBell tone="dark" />
        </div>
      </div>

      {/* Main content */}
      <main className="min-w-0 flex-1 pt-14 lg:pt-0 lg:pl-60">
        {/* Desktop topbar */}
        <div className="sticky top-0 z-20 hidden h-14 items-center justify-end border-b bg-background/80 px-6 backdrop-blur lg:flex lg:px-10">
          <NotificationBell tone="light" />
        </div>
        <div className="mx-auto w-full max-w-[88rem] px-4 py-8 sm:px-6 lg:px-10">
          {children}
        </div>
      </main>
    </div>
  );

  return (
    <ActivityProvider>
      {variant === "admin" ? (
        <GlobalSearchProvider>{shell}</GlobalSearchProvider>
      ) : (
        shell
      )}
    </ActivityProvider>
  );
}
