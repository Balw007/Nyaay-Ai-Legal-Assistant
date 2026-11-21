"use client";
import Link from "next/link";
import { Menu, Search } from "lucide-react";
import { useHealth } from "@/lib/hooks";
import { Kbd } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function Topbar({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const { data: h, isError } = useHealth();
  const ai = h?.ai;
  const aiTone = isError ? "tape" : ai?.ready ? "leaf" : "amber";
  const aiText = isError ? "Server offline" : !ai ? "Checking AI" : ai.ready ? `AI ready · ${ai.model ?? ai.provider}` : "AI offline";

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-rule bg-paper/70 px-4 backdrop-blur-xl md:px-8">
      <button onClick={onMenu} aria-label="Open menu" className="rounded-md p-1.5 text-muted hover:bg-vellum md:hidden"><Menu className="h-5 w-5" /></button>
      <button onClick={onSearch}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-rule bg-vellum px-3 text-left text-base text-faint hover:border-rule-strong">
        <Search className="h-4 w-4" />
        <span className="flex-1 truncate">Search matters, drafts, judgments</span>
        <span className="hidden sm:inline-flex gap-1"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
      </button>
      <div className="ml-auto flex items-center gap-2">
        {h && h.real_judgments === 0 && (
          <Link href="/library" className="hidden lg:inline-flex items-center rounded-md border border-amber/30 bg-amber-soft px-2.5 py-1 text-sm text-amber hover:brightness-95">
            Library is empty. Load judgments
          </Link>
        )}
        <Link href="/settings#ai" title={ai?.message}
          className={cn("inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-sm hover:bg-vellum",
            aiTone === "leaf" ? "text-leaf" : aiTone === "tape" ? "text-tape" : "text-amber")}>
          <span className={cn("h-2 w-2 rounded-full", aiTone === "leaf" ? "bg-leaf" : aiTone === "tape" ? "bg-tape" : "bg-amber")} />
          <span className="hidden sm:inline">{aiText}</span>
        </Link>
      </div>
    </header>
  );
}
