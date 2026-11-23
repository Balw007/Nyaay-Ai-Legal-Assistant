"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { Kbd } from "@/components/ui/misc";
import { floatIn } from "@/lib/motion";
import { ALL_NAV } from "./nav";

const typing = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
};

/** Global keys: G then a letter jumps to a workspace, / opens search, ? lists every shortcut. */
export function useShortcuts({ onSearch, onAsk, onHelp }: { onSearch: () => void; onAsk: () => void; onHelp: () => void }) {
  const router = useRouter();
  const pending = useRef<number>(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (pending.current && Date.now() - pending.current < 1200) {
        pending.current = 0;
        const dest = ALL_NAV.find((n) => n.key === k);
        if (dest) { e.preventDefault(); router.push(dest.href); }
        return;
      }
      if (k === "g") { pending.current = Date.now(); return; }
      if (k === "/") { e.preventDefault(); onSearch(); }
      else if (e.key === "?") { e.preventDefault(); onHelp(); }
      else if (k === "a" && e.shiftKey) { e.preventDefault(); onAsk(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, onSearch, onAsk, onHelp]);
}

const GENERAL: [string[], string][] = [
  [["Ctrl", "K"], "Search, open or run a command"],
  [["/"], "Search"],
  [["Shift", "A"], "Ask your library"],
  [["?"], "This list"],
  [["Ctrl", "F"], "Find in a judgment"],
  [["Esc"], "Close a panel or dialog"],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-[#02040a]/50 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" {...floatIn} className="glass-4 relative w-full max-w-2xl rounded-2xl">
            <header className="relative z-[3] flex items-center justify-between border-b border-rule px-5 py-4">
              <h2 className="font-editorial text-xl">Keyboard shortcuts</h2>
              <button autoFocus onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-vellum hover:text-text"><X className="h-4 w-4" /></button>
            </header>
            <div className="relative z-[3] grid gap-8 p-5 sm:grid-cols-2">
              <dl className="space-y-2.5">
                {GENERAL.map(([keys, what]) => (
                  <div key={what} className="flex items-center justify-between gap-4 text-sm"><dt className="text-muted">{what}</dt><dd className="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dd></div>
                ))}
              </dl>
              <dl className="space-y-2.5">
                {ALL_NAV.filter((n) => n.key).map((n) => (
                  <div key={n.href} className="flex items-center justify-between gap-4 text-sm"><dt className="text-muted">{n.label}</dt><dd className="flex gap-1"><Kbd>G</Kbd><Kbd>{n.key!.toUpperCase()}</Kbd></dd></div>
                ))}
              </dl>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
