"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { FolderOpen, LayoutDashboard, Menu, Search, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";
import { isActive } from "./nav";

const DOCK = [
  { href: "/", label: "Today", icon: LayoutDashboard },
  { href: "/research", label: "Research", icon: Search },
  { href: "/matters", label: "Matters", icon: FolderOpen },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
];

/** Phones: a floating dock at the thumb, four destinations and the full menu. */
export function Dock({ onMenu }: { onMenu: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Quick" className="fixed inset-x-3 bottom-3 z-30 md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="glass-2 flex h-16 items-stretch justify-around rounded-[22px] px-1.5">
        {DOCK.map((d) => {
          const on = isActive(path, d.href) || (d.href === "/research" && path.startsWith("/judgments"));
          return (
            <li key={d.href} className="relative z-[3] flex-1">
              <Link href={d.href} aria-current={on ? "page" : undefined}
                className={cn("relative flex h-full flex-col items-center justify-center gap-1 rounded-2xl text-[11px]", on ? "text-brass" : "text-muted")}>
                {on && <motion.span layoutId="dock-active" transition={spring.snappy} className="glass-5 absolute inset-x-1 inset-y-1.5 rounded-2xl" />}
                <d.icon className="relative h-5 w-5" /><span className="relative">{d.label}</span>
              </Link>
            </li>
          );
        })}
        <li className="relative z-[3] flex-1">
          <button onClick={onMenu} className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl text-[11px] text-muted" aria-label="Open the full menu">
            <Menu className="h-5 w-5" /><span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
