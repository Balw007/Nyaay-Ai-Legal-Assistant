"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// A floating sheet for forms (L4). It hovers inside the window rather than bolting to the edge.
// Escape and the backdrop close it; focus moves in, stays in (Tab wraps) and returns to the opener.
export function Drawer({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus(), 60);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(t); opener?.focus?.(); };
  }, [open, onClose]);
  // Drawn at the top of the page so a panel moving under the cursor can never carry it along.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-[#02040a]/55 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div ref={ref} role="dialog" aria-modal="true" aria-label={title}
            className={cn("glass-4 fixed inset-y-2 right-2 z-50 flex w-[calc(100%-1rem)] flex-col overflow-hidden rounded-2xl sm:inset-y-3 sm:right-3", wide ? "max-w-2xl" : "max-w-lg")}
            initial={{ x: 48, opacity: 0, scale: 0.985 }} animate={{ x: 0, opacity: 1, scale: 1 }} exit={{ x: 36, opacity: 0, scale: 0.99 }} transition={spring.smooth}>
            <header className="relative z-[3] flex items-center justify-between border-b border-rule px-5 py-4">
              <h2 className="font-editorial text-xl">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-vellum hover:text-text"><X className="h-4 w-4" /></button>
            </header>
            <div className="relative z-[3] flex-1 overflow-y-auto scrollbar-thin p-5">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
