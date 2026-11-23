"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Search, Sparkles } from "lucide-react";
import { useHealth } from "@/lib/hooks";
import { Kbd } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";
import { workspaceOf } from "./nav";
import { Seal } from "./wordmark";
import { NotificationsBell, UserMenu } from "./top-menus";

/** The state of the local AI as a small light: green ready, amber model missing/stopped, red server down. */
export function AiOrb({ className, showText = true }: { className?: string; showText?: boolean }) {
  const { data: h, isError } = useHealth();
  const ai = h?.ai;
  const tone = isError ? "tape" : ai?.ready ? "leaf" : "amber";
  const text = isError ? "Server offline" : !ai ? "Checking AI" : ai.ready ? `AI ready · ${ai.model ?? ai.provider}` : "AI offline";
  const c = tone === "leaf" ? "bg-leaf" : tone === "tape" ? "bg-tape" : "bg-amber";
  return (
    <Link href="/intelligence" title={ai?.message ?? text} aria-label={`${text}. Open Intelligence`}
      className={cn("inline-flex h-9 items-center gap-2 rounded-xl px-2.5 text-sm hover:bg-vellum",
        tone === "leaf" ? "text-leaf" : tone === "tape" ? "text-tape" : "text-amber", className)}>
      <span className="relative grid h-3 w-3 place-items-center">
        {tone === "leaf" && <span className={cn("absolute inset-0 rounded-full opacity-40 animate-[breathe_2.4s_ease-in-out_infinite]", c)} />}
        <span className={cn("h-2 w-2 rounded-full shadow-[0_0_10px_currentColor]", c)} />
      </span>
      {showText && <span className="hidden max-w-[180px] truncate lg:inline">{text}</span>}
    </Link>
  );
}

export function CommandBar({ onSearch, onAsk, onShortcuts }: { onSearch: () => void; onAsk: () => void; onShortcuts: () => void }) {
  const path = usePathname();
  const ws = workspaceOf(path);
  const { data: h } = useHealth();

  return (
    <div className="sticky top-0 z-30 px-3 pt-3 md:px-6">
      <header className="vt-bar glass-2 mx-auto flex h-14 max-w-[1400px] items-center gap-2 rounded-2xl pl-2 pr-2 md:pl-3" style={{ viewTransitionName: "vt-bar" }}>
        <Link href="/" className="relative z-[3] md:hidden" aria-label="Nyaay, command centre"><Seal className="h-8 w-8 text-[15px]" /></Link>
        <div className="relative z-[3] hidden min-w-0 items-center gap-2 pr-1 md:flex" aria-live="polite">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={ws.label} initial={{ opacity: 0, y: 6, filter: "blur(3px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -6, filter: "blur(3px)" }} transition={spring.snappy}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1 text-sm text-muted">
              <ws.icon className="h-4 w-4 text-brass" />{ws.label}
            </motion.span>
          </AnimatePresence>
          <span aria-hidden className="h-5 w-px bg-rule" />
        </div>
        <button onClick={onSearch} data-specular
          className="relative z-[3] flex h-10 min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-xl border border-rule bg-vellum px-3 text-left text-base text-faint transition-colors hover:border-rule-strong md:max-w-xl">
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">Search, open, or ask anything</span>
          <span className="hidden gap-1 sm:inline-flex"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
        </button>
        <button onClick={onAsk} className="relative z-[3] hidden h-10 items-center gap-2 rounded-xl border border-cyan/30 bg-cyan-soft px-3 text-sm text-cyan transition-colors hover:bg-cyan/20 sm:inline-flex" title="Ask a question answered from your library">
          <Sparkles className="h-4 w-4" /><span className="hidden lg:inline">Ask</span>
        </button>
        <div className="relative z-[3] ml-auto flex items-center gap-1">
          {h && h.real_judgments === 0 && (
            <Link href="/library" className="hidden items-center rounded-xl border border-amber/30 bg-amber-soft px-2.5 py-1.5 text-sm text-amber hover:brightness-95 xl:inline-flex">
              Library is empty. Load judgments
            </Link>
          )}
          <AiOrb />
          <NotificationsBell />
          <UserMenu onShortcuts={onShortcuts} />
        </div>
      </header>
    </div>
  );
}
