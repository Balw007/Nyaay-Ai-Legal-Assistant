"use client";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// A side drawer for forms. Escape and the backdrop close it; focus moves into it when it opens.
export function Drawer({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus(), 50);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div ref={ref} role="dialog" aria-modal="true" aria-label={title}
            className={cn("fixed inset-y-0 right-0 z-50 flex w-full flex-col glass !bg-surface-solid/95", wide ? "max-w-2xl" : "max-w-lg")}
            initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: "spring", damping: 32, stiffness: 320 }}>
            <header className="flex items-center justify-between border-b border-rule px-5 py-4">
              <h2 className="font-display text-lg font-semibold">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-vellum hover:text-text"><X className="h-4 w-4" /></button>
            </header>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-5">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
