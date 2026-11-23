"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Moon, Pin, PinOff, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";
import { usePendingApprovals } from "@/lib/hooks";
import { useTheme } from "@/components/providers";
import { NAV, isActive } from "./nav";
import { Seal } from "./wordmark";
import { Logo } from "@/components/brand/logo";

export const RAIL_COLLAPSED = 68;
export const RAIL_EXPANDED = 240;

/**
 * The floating rail. Collapsed it is a column of lit icons; it opens on hover (with a short intent delay,
 * so passing the cursor across it does nothing) or stays open when pinned. The active item sits on an
 * L5 surface that glides between items. Labels stay in the accessibility tree when collapsed.
 */
export function Rail({ pinned, setPinned, onNavigate, mobile }: { pinned: boolean; setPinned?: (v: boolean) => void; onNavigate?: () => void; mobile?: boolean }) {
  const path = usePathname();
  const { data: pending } = usePendingApprovals();
  const { theme, toggle } = useTheme();
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = mobile || pinned || hover;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const enter = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setHover(true), 140); };
  const leave = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setHover(false), 220); };


  const counts: Record<string, number | undefined> = { "/approvals": pending?.length };
  const label = "transition-opacity duration-200 whitespace-nowrap";

  return (
    <motion.nav aria-label="Main" onPointerEnter={mobile ? undefined : enter} onPointerLeave={mobile ? undefined : leave}
      onFocusCapture={mobile ? undefined : () => setHover(true)} onBlurCapture={mobile ? undefined : (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHover(false); }}
      animate={{ width: mobile ? "100%" : open ? RAIL_EXPANDED : RAIL_COLLAPSED }} transition={spring.smooth}
      className={cn("vt-rail glass-2 flex h-full flex-col overflow-hidden text-on-ink", mobile ? "rounded-2xl" : "rounded-[22px]")}
      style={{ viewTransitionName: mobile ? undefined : "vt-rail" }}>
      <div className="relative z-[3] flex h-16 shrink-0 items-center gap-2.5 pl-[18px] pr-3">
        <Link href="/" onClick={onNavigate} aria-label="Nyaay, home" className="relative flex h-10 items-center rounded-lg">
          <Seal className={cn("h-8 w-8 shrink-0 text-[16px] transition-opacity duration-200", open ? "opacity-0" : "opacity-100")} />
          <Logo className={cn("absolute left-0 top-1/2 h-[30px] -translate-y-1/2 transition-opacity duration-200", open ? "opacity-100" : "pointer-events-none opacity-0")} />
        </Link>
        {setPinned && (
          <button onClick={() => setPinned(!pinned)} aria-pressed={pinned} aria-label={pinned ? "Unpin the menu" : "Keep the menu open"} title={pinned ? "Unpin" : "Keep open"}
            className={cn("ml-auto rounded-md p-1.5 text-on-ink-muted hover:bg-ink-2 hover:text-on-ink", label, open ? "opacity-100" : "pointer-events-none opacity-0")}>
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      <div className="relative z-[3] flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-2.5 pb-3 no-scrollbar">
        {NAV.map((g) => (
          <div key={g.label}>
            <div className="relative h-6">
              <p className={cn("absolute left-2.5 top-1 text-xs text-on-ink-muted", label, open ? "opacity-100" : "opacity-0")}>{g.label}</p>
              <span aria-hidden className={cn("absolute left-1/2 top-3 h-px w-5 -translate-x-1/2 bg-rule", label, open ? "opacity-0" : "opacity-100")} />
            </div>
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const on = isActive(path, it.href);
                const n = counts[it.href];
                return (
                  <li key={it.href}>
                    <Link href={it.href} onClick={onNavigate} aria-current={on ? "page" : undefined} title={open ? undefined : it.label}
                      className={cn("group relative flex h-10 items-center gap-3 rounded-xl px-[13px] text-base outline-offset-[-2px] transition-colors",
                        on ? "text-on-ink" : "text-on-ink-muted hover:text-on-ink")}>
                      {on && <motion.span layoutId={mobile ? "rail-active-m" : "rail-active"} transition={spring.snappy} className="glass-5 absolute inset-0 rounded-xl" />}
                      {!on && <span className="absolute inset-0 rounded-xl bg-ink-2 opacity-0 transition-opacity group-hover:opacity-100" />}
                      <it.icon className={cn("relative h-[18px] w-[18px] shrink-0", on && "text-brass drop-shadow-[0_0_6px_var(--brass)]")} />
                      <span className={cn("relative flex-1", label, open ? "opacity-100" : "opacity-0")}>{it.label}</span>
                      {!!n && (
                        <span className={cn("rounded-full bg-brass px-1.5 text-xs font-medium tabular-nums text-on-brass transition-all",
                          open ? "relative" : "absolute right-1 top-1 h-4 min-w-4 px-1 text-[10px] leading-4")}>{n > 99 ? "99+" : n}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="relative z-[3] shrink-0 space-y-0.5 border-t border-rule p-2.5">
        <button onClick={toggle} title={open ? undefined : theme === "dark" ? "Light mode" : "Dark mode"}
          className="flex h-10 w-full items-center gap-3 rounded-xl px-[13px] text-base text-on-ink-muted hover:bg-ink-2 hover:text-on-ink">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={theme} initial={{ rotate: -60, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 60, opacity: 0 }} transition={spring.snappy} className="shrink-0">
              {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </motion.span>
          </AnimatePresence>
          <span className={cn(label, open ? "opacity-100" : "opacity-0")}>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
      </div>
    </motion.nav>
  );
}
