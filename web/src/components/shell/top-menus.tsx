"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Bell, Bot, CheckCheck, Clapperboard, Keyboard, Library, LogOut, Moon, Settings, Sun } from "lucide-react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useMe, usePendingApprovals } from "@/lib/hooks";
import { isActive, useTasks } from "@/lib/agents";
import { floatIn } from "@/lib/motion";
import { useTheme } from "@/components/providers";
import { boing } from "@/components/shell/specular";
import { cn } from "@/lib/utils";

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

const SEEN = "nyaay-notifications-seen";

/** Notifications from real state only: proposals waiting, agent results to review, agents still working. */
export function NotificationsBell() {
  const { open, setOpen, ref } = usePopover();
  const { data: pending } = usePendingApprovals();
  const { data: tasks } = useTasks(20);
  const [seen, setSeen] = useState(0);
  useEffect(() => { try { setSeen(Number(localStorage.getItem(SEEN) ?? 0)); } catch {} }, []);
  const finished = (tasks ?? []).filter((t) => (t.status === "done" || t.status === "failed") && t.finished_at).slice(0, 5);
  const running = (tasks ?? []).filter(isActive);
  const fresh = finished.filter((t) => new Date(t.finished_at! + "Z").getTime() > seen).length;
  const count = (pending?.length ?? 0) + fresh;
  const markSeen = () => { const now = Date.now(); setSeen(now); try { localStorage.setItem(SEEN, String(now)); } catch {} };
  // Something new arrived: one boing of the bell, never a loop.
  const bell = useRef<HTMLButtonElement>(null);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (prev.current !== null && count > prev.current) boing(bell.current, 1.2);
    prev.current = count;
  }, [count]);

  return (
    <div ref={ref} className="relative">
      <button ref={bell} data-press="" onClick={() => { setOpen(!open); if (!open) markSeen(); }} aria-expanded={open} aria-haspopup="dialog"
        aria-label={`Notifications${count ? `, ${count} new` : ""}`}
        className="relative grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:bg-vellum hover:text-text">
        <Bell className="h-[18px] w-[18px]" />
        {count > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-tape px-1 text-[10px] font-semibold text-white">{count > 99 ? "99+" : count}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div {...floatIn} role="dialog" aria-label="Notifications" className="glass-4 absolute right-0 top-12 z-50 w-[360px] overflow-hidden rounded-2xl">
            <div className="relative z-[3]">
              <p className="border-b border-rule px-4 py-3 text-sm font-medium">Notifications</p>
              <ul className="max-h-[60vh] divide-y divide-rule overflow-y-auto scrollbar-thin">
                {!!pending?.length && (
                  <li><Link href="/approvals" onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-3 hover:bg-vellum">
                    <CheckCheck className="mt-0.5 h-4 w-4 text-brass" />
                    <span className="text-sm"><span className="font-medium">{pending.length} proposals</span> are waiting for an advocate to approve</span>
                  </Link></li>
                )}
                {running.map((t) => (
                  <li key={t.id}><Link href={`/intelligence?task=${t.id}`} onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-3 hover:bg-vellum">
                    <Bot className="mt-0.5 h-4 w-4 text-cyan" />
                    <span className="min-w-0 text-sm"><span className="font-medium">{t.agent_name}</span> is working: <span className="text-muted">{t.step}</span></span>
                  </Link></li>
                ))}
                {finished.map((t) => (
                  <li key={t.id}><Link href={`/intelligence?task=${t.id}`} onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-3 hover:bg-vellum">
                    <Bot className={cn("mt-0.5 h-4 w-4", t.status === "done" ? "text-leaf" : "text-tape")} />
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{t.agent_name}</span> {t.status === "done" ? "finished. Review the result" : "could not finish"}
                      <span className="block truncate text-muted">{t.title}</span>
                      <span className="text-xs text-faint">{timeAgo(t.finished_at + "Z")}</span>
                    </span>
                  </Link></li>
                ))}
                {!pending?.length && !running.length && !finished.length && <li className="px-4 py-8 text-center text-sm text-muted">Nothing new. Agent results and approvals appear here.</li>}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function UserMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const { open, setOpen, ref } = usePopover();
  const { data: me } = useMe();
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  if (!me) return null;
  const initial = me.user.name.slice(0, 1).toUpperCase();
  async function signOut() {
    await api.post("/auth/logout").catch(() => {});
    qc.clear();
    location.href = "/login";
  }
  const item = "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-vellum hover:text-text";
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`Account: ${me.user.name}`}
        className="flex h-10 items-center gap-2.5 rounded-xl pl-1 pr-2 hover:bg-vellum">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[radial-gradient(circle_at_30%_25%,color-mix(in_srgb,var(--brass)_70%,white),var(--brass-deep))] text-sm font-semibold text-on-brass shadow-[0_0_14px_-4px_var(--brass)]">{initial}</span>
        <span className="hidden text-left leading-tight lg:block">
          <span className="block max-w-[140px] truncate text-sm">{me.user.name}</span>
          <span className="block text-xs capitalize text-faint">{me.user.role}</span>
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div {...floatIn} role="menu" className="glass-4 absolute right-0 top-12 z-50 w-64 rounded-2xl p-1.5">
            <div className="relative z-[3]">
              <div className="px-3 py-2.5">
                <p className="truncate text-sm font-medium">{me.user.name}</p>
                <p className="truncate text-xs text-faint">{me.firm.name}{me.user.enrolment_no ? `, ${me.user.enrolment_no}` : ""}</p>
              </div>
              <div className="my-1 h-px bg-rule" />
              <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className={item}><Settings className="h-4 w-4" />Settings</Link>
              <Link href="/library" role="menuitem" onClick={() => setOpen(false)} className={item}><Library className="h-4 w-4" />Library</Link>
              <button role="menuitem" onClick={toggle} className={item}>{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{theme === "dark" ? "Light mode" : "Dark mode"}</button>
              <button role="menuitem" onClick={() => { setOpen(false); onShortcuts(); }} className={item}><Keyboard className="h-4 w-4" />Keyboard shortcuts</button>
              <button role="menuitem" onClick={() => { setOpen(false); try { sessionStorage.removeItem("nyaay-intro-played"); } catch {} window.dispatchEvent(new Event("nyaay:intro")); }} className={item}><Clapperboard className="h-4 w-4" />Play the welcome intro</button>
              <div className="my-1 h-px bg-rule" />
              <button role="menuitem" onClick={signOut} className={item}><LogOut className="h-4 w-4" />Sign out</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
