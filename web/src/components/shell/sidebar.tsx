"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, CalendarDays, CheckCheck, FileSignature, FolderOpen, LayoutDashboard, Library, LogOut, Moon, Search, Settings, ShieldCheck, Sun, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useMe, usePendingApprovals } from "@/lib/hooks";
import { useTheme } from "@/components/providers";
import { Wordmark } from "./wordmark";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; count?: number };

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const { data: me } = useMe();
  const { data: pending } = usePendingApprovals();
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();

  const groups: { label: string; items: Item[] }[] = [
    { label: "Today", items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/approvals", label: "Approvals", icon: CheckCheck, count: pending?.length },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
    ] },
    { label: "Practice", items: [
      { href: "/matters", label: "Matters", icon: FolderOpen },
      { href: "/drafts", label: "Drafts", icon: FileSignature },
      { href: "/clients", label: "Clients", icon: Users },
    ] },
    { label: "Law", items: [
      { href: "/research", label: "Research", icon: Search },
      { href: "/citations", label: "Citation check", icon: ShieldCheck },
      { href: "/library", label: "Library", icon: Library },
      { href: "/tools/convert", label: "Section converter", icon: ArrowLeftRight },
    ] },
  ];

  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

  async function signOut() {
    await api.post("/auth/logout").catch(() => {});
    qc.clear();
    location.href = "/login";
  }

  return (
    <nav aria-label="Main" className="flex h-full flex-col bg-ink/85 backdrop-blur-xl border-r border-white/5 text-on-ink">
      <div className="px-5 pt-5 pb-6"><Link href="/" onClick={onNavigate}><Wordmark onInk /></Link></div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 space-y-6">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-2 pb-1.5 text-xs text-on-ink-muted">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.href}>
                  <Link href={it.href} onClick={onNavigate} aria-current={active(it.href) ? "page" : undefined}
                    className={cn("group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-base transition-colors",
                      active(it.href) ? "bg-ink-3 text-on-ink shadow-[inset_2px_0_0_var(--brass)]" : "text-on-ink-muted hover:bg-ink-2 hover:text-on-ink")}>
                    <it.icon className={cn("h-4 w-4", active(it.href) ? "text-brass" : "")} />
                    <span className="flex-1">{it.label}</span>
                    {!!it.count && <span className="rounded-full bg-brass px-1.5 text-xs font-medium text-[#0a0e18] tabular-nums">{it.count}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 p-3 space-y-0.5">
        <Link href="/settings" onClick={onNavigate} aria-current={active("/settings") ? "page" : undefined}
          className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-base", active("/settings") ? "bg-ink-3 text-on-ink" : "text-on-ink-muted hover:bg-ink-2 hover:text-on-ink")}>
          <Settings className="h-4 w-4" /> Settings
        </Link>
        <button onClick={toggle} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-base text-on-ink-muted hover:bg-ink-2 hover:text-on-ink">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        {me && (
          <div className="mt-2 flex items-center gap-2.5 rounded-md px-2 py-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-3 text-sm font-medium">{me.user.name.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-on-ink">{me.user.name}</p>
              <p className="truncate text-xs text-on-ink-muted">{me.firm.name}</p>
            </div>
            <button onClick={signOut} aria-label="Sign out" title="Sign out" className="rounded p-1 text-on-ink-muted hover:text-on-ink hover:bg-ink-2"><LogOut className="h-4 w-4" /></button>
          </div>
        )}
      </div>
    </nav>
  );
}

