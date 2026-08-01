"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useNavFavourites } from "@/lib/nav-favourites";
import { initials } from "@/lib/format";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { QuickAdd } from "@/components/layout/quick-add";
import { ThemeToggle } from "@/components/layout/theme-toggle";
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
  FileSignature,
  CircleCheckBig,
  CalendarPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Star,
} from "lucide-react";

/** Only the admin shell varies by role; the portal is always CLIENT. */
type ShellRole = "ADMIN" | "STAFF" | "CLIENT";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** which live count to show as a badge on this item, if any */
  badge?: "tasks" | "actions" | "messages";
  /** Group heading rendered above this item (first item of the group only). */
  section?: string;
};

const adminNav: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutGrid },
  { href: "/admin/my-work", label: "My Work", icon: CircleCheckBig },
  { href: "/admin/reports", label: "Reports", icon: ChartNoAxesCombined },
  { href: "/admin/leads", label: "Leads", icon: Target },
  { href: "/admin/proposals", label: "Proposals", icon: FileSignature },
  { href: "/admin/clients", label: "Clients", icon: Users },
  { href: "/admin/projects", label: "Projects", icon: FolderKanban },
  { href: "/admin/invoices", label: "Invoices", icon: FileText },
  { href: "/admin/retainers", label: "Retainers", icon: Repeat },
  { href: "/admin/messages", label: "Messages", icon: MessagesSquare, badge: "messages" },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/admin/task-requests", label: "Task Requests", icon: Inbox, badge: "tasks" },
  { href: "/admin/marketing", label: "Marketing", icon: Megaphone },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

/**
 * Staff see only the delivery surface. This is cosmetic — the real gate is
 * requireAdmin in each page/DAL, which 404s staff on everything else.
 */
const staffNav: NavItem[] = [
  { href: "/admin/my-work", label: "My Work", icon: CircleCheckBig },
  { href: "/admin/projects", label: "Projects", icon: FolderKanban },
  { href: "/admin/messages", label: "Messages", icon: MessagesSquare, badge: "messages" },
];

const clientNav: NavItem[] = [
  { href: "/portal", label: "Overview", icon: LayoutGrid },
  { href: "/portal/actions", label: "Needs you", icon: CircleCheckBig, badge: "actions" },
  { href: "/portal/projects", label: "My Projects", icon: FolderKanban, section: "Work" },
  { href: "/portal/requests", label: "Task Requests", icon: MessageSquarePlus },
  { href: "/portal/invoices", label: "Invoices", icon: FileText, section: "Billing" },
  { href: "/portal/payment", label: "How to Pay", icon: CreditCard },
  {
    href: "/portal/messages",
    label: "Chat with us",
    icon: MessagesSquare,
    badge: "messages",
    section: "Contact",
  },
  { href: "/portal/book", label: "Book a Meeting", icon: CalendarPlus },
  { href: "/portal/settings", label: "Settings", icon: Settings, section: "Account" },
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
  const { data } = useSWR<{
    pendingTaskRequests: number;
    pendingActions: number;
    unreadMessages: number;
  } | null>(
    items.some((i) => i.badge) ? "/api/notifications" : null,
    fetcher,
    { refreshInterval: 30_000 },
  );
  const badgeCount = (kind: "tasks" | "actions" | "messages") => {
    if (kind === "tasks") return data?.pendingTaskRequests ?? 0;
    if (kind === "messages") return data?.unreadMessages ?? 0;
    return data?.pendingActions ?? 0;
  };

  const { favourites, toggle, isFavourite } = useNavFavourites();

  // Pinned links lift to the top in the order they were pinned; the rest keep
  // their original grouping. An item appears once, never in both places.
  const pinned = favourites
    .map((href) => items.find((item) => item.href === href))
    .filter((item): item is NavItem => Boolean(item));
  const rest = items.filter((item) => !favourites.includes(item.href));

  function renderItem(item: NavItem, options: { inFavourites?: boolean } = {}) {
    const active =
      item.href === "/admin" || item.href === "/portal"
        ? pathname === item.href
        : pathname.startsWith(item.href);
    const Icon = item.icon;
    const starred = isFavourite(item.href);
    const count = item.badge ? badgeCount(item.badge) : 0;

    return (
      <div key={item.href} className="group/nav relative">
        {!options.inFavourites && item.section && (
          <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-sidebar-foreground/45 uppercase">
            {item.section}
          </p>
        )}
        <Link
          href={item.href}
          onClick={onNavigate}
          className={cn(
            "relative flex items-center gap-3 rounded-lg py-2 pr-9 pl-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white",
            active && "bg-sidebar-accent text-white",
          )}
        >
          {active && (
            <span className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
          )}
          <Icon className="size-4 shrink-0" />
          <span className="flex-1 truncate">{item.label}</span>
          {count > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Link>

        {/* Sits above the link rather than inside it — a button can't be a
            child of an anchor, and this keeps the whole row clickable. */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            toggle(item.href);
          }}
          aria-label={starred ? `Unpin ${item.label}` : `Pin ${item.label} to the top`}
          title={starred ? "Unpin" : "Pin to top"}
          className={cn(
            "absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 transition-opacity",
            "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none",
            starred
              ? "text-primary opacity-100"
              : "text-sidebar-foreground/50 opacity-0 group-hover/nav:opacity-100 hover:text-white",
          )}
        >
          <Star className={cn("size-3.5", starred && "fill-current")} />
        </button>
      </div>
    );
  }

  return (
    <nav className="flex flex-col gap-1">
      {pinned.length > 0 && (
        <>
          <p className="flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-sidebar-foreground/45 uppercase">
            <Star className="size-2.5 fill-current" /> Pinned
          </p>
          {pinned.map((item) => renderItem(item, { inFavourites: true }))}
          <span className="mx-3 my-2 h-px bg-sidebar-foreground/10" />
        </>
      )}
      {rest.map((item) => renderItem(item))}
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
  role,
  user,
  pathname,
  onNavigate,
  logoUrl,
}: {
  variant: "admin" | "client";
  role?: ShellRole;
  user: { name: string; email: string };
  pathname: string;
  onNavigate?: () => void;
  logoUrl?: string | null;
}) {
  const router = useRouter();
  const isStaff = role === "STAFF";
  const items =
    variant === "admin" ? (isStaff ? staffNav : adminNav) : clientNav;
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
        <Link
          href={variant === "admin" ? (isStaff ? "/admin/projects" : "/admin") : "/portal"}
          onClick={onNavigate}
        >
          <LogoMark logoUrl={logoUrl} width={132} height={33} />
        </Link>
      </div>
      <p className="px-5 pb-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {variant === "admin" ? (isStaff ? "Staff Panel" : "Admin Panel") : "Client Portal"}
      </p>
      {/* Search is admin-only — /api/search returns invoice amounts. */}
      {variant === "admin" && !isStaff && (
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
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <button
          onClick={signOut}
          disabled={signingOut}
          aria-busy={signingOut}
          className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-white disabled:pointer-events-none disabled:opacity-80"
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
  role,
  user,
  children,
  logoUrl,
}: {
  variant: "admin" | "client";
  role?: ShellRole;
  user: { name: string; email: string };
  children: React.ReactNode;
  logoUrl?: string | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Desktop sidebar can be switched off entirely; remembered across visits.
  const [collapsed, setCollapsed] = useState(false);
  const isStaff = role === "STAFF";
  const showQuickAdd = variant === "admin" && !isStaff;

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem("avix.sidebar.off");
    } catch {
      /* private mode — keep the default */
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    if (saved === "1") setCollapsed(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  function toggleSidebar() {
    setCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("avix.sidebar.off", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const shell = (
    <div className="flex min-h-screen w-full bg-muted/60 dark:bg-background">
      {/* Desktop sidebar — floats above the canvas like the login panel */}
      <aside
        className={cn(
          "fixed inset-y-3 left-3 z-30 hidden w-[17rem] overflow-hidden rounded-[26px] shadow-xl shadow-black/10 ring-1 ring-black/5 transition-transform duration-200 dark:ring-white/10",
          collapsed ? "lg:hidden" : "lg:block",
        )}
      >
        <SidebarInner
          variant={variant}
          role={role}
          user={user}
          pathname={pathname}
          logoUrl={logoUrl}
        />
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
              role={role}
              user={user}
              pathname={pathname}
              onNavigate={() => setOpen(false)}
              logoUrl={logoUrl}
            />
          </SheetContent>
        </Sheet>
        <LogoMark logoUrl={logoUrl} width={110} height={28} />
        <div className="ml-auto flex items-center gap-2">
          {showQuickAdd && <QuickAdd tone="dark" />}
          <ThemeToggle tone="dark" />
          <NotificationBell tone="dark" />
        </div>
      </div>

      {/* Main content — soft muted canvas in light mode so the rounded cards
          pop (reference look); dark keeps its deep background. */}
      <main
        className={cn(
          "min-w-0 flex-1 pt-14 transition-[padding] duration-200 lg:pt-0",
          collapsed ? "lg:pl-0" : "lg:pl-[18.25rem]",
        )}
      >
        {/* Desktop topbar */}
        <div className="sticky top-0 z-20 hidden h-14 items-center gap-2 px-6 backdrop-blur lg:flex lg:px-10">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            title={collapsed ? "Show sidebar" : "Hide sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5" />
            ) : (
              <PanelLeftClose className="size-5" />
            )}
          </Button>
          <div className="ml-auto" />
          {showQuickAdd && <QuickAdd tone="light" />}
          <ThemeToggle tone="light" />
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
      {variant === "admin" && !isStaff ? (
        <GlobalSearchProvider>{shell}</GlobalSearchProvider>
      ) : (
        shell
      )}
    </ActivityProvider>
  );
}
