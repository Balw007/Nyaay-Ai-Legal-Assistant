"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Info } from "lucide-react";
import { HELP, type Help } from "@/lib/help";
import { cn } from "@/lib/utils";

/**
 * The (i) next to a feature's name. Hover, keyboard focus or a tap opens a short explanation; moving away, Esc or
 * a tap elsewhere closes it. The card is drawn at the top of the page, so a panel's rounded clipping never cuts it.
 */
export function InfoTip({ k, help, title, className }: { k?: string; help?: Help; title?: string; className?: string }) {
  const h = help ?? (k ? HELP[k] : undefined);
  const name = title ?? k ?? "this";
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback(() => { window.clearTimeout(timer.current); setOpen(true); }, []);
  const hide = useCallback((delay = 120) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setOpen(false); setPinned(false); }, delay);
  }, []);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const W = 300, margin = 12;
      const x = Math.min(Math.max(r.left + r.width / 2 - W / 2, margin), window.innerWidth - W - margin);
      const above = r.bottom + 220 > window.innerHeight && r.top > 240;
      setPos({ x, y: above ? r.top - 8 : r.bottom + 8, above });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setPinned(false); btn.current?.focus(); } };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || document.getElementById(id)?.contains(t)) return;
      setOpen(false); setPinned(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [open, id]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!h) return null;
  return (
    <>
      <button ref={btn} type="button" aria-label={`What is ${name}?`} aria-expanded={open} aria-describedby={open ? id : undefined}
        onMouseEnter={show} onMouseLeave={() => { if (!pinned) hide(); }}
        onFocus={show} onBlur={() => { if (!pinned) hide(0); }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (open && pinned) { setOpen(false); setPinned(false); } else { setPinned(true); show(); } }}
        className={cn("relative z-[4] inline-grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full align-middle text-faint transition-colors",
          "hover:bg-vellum hover:text-text focus-visible:text-text aria-expanded:text-brass", className)}>
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div id={id} role="tooltip" key="tip"
              onMouseEnter={show} onMouseLeave={() => { if (!pinned) hide(); }}
              initial={{ opacity: 0, y: pos.above ? 4 : -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}
              style={{ left: pos.x, top: pos.y, translate: pos.above ? "0 -100%" : undefined }}
              className="fixed z-[95] w-[300px] rounded-xl border border-rule-strong bg-[var(--surface-solid)] p-3.5 text-left text-sm normal-case leading-relaxed tracking-normal shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]">
              <div className="relative z-[3] space-y-1.5">
                <p className="font-medium text-text">{name}</p>
                <p className="text-muted">{h.what}</p>
                {h.how && <p className="text-muted"><span className="font-medium text-text">How: </span>{h.how}</p>}
                {h.note && <p className="text-amber">{h.note}</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/** A heading with its (i): use where a feature's name is written by hand rather than through PanelHeader. */
export function Titled({ k, children, className }: { k: string; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5", className)}>{children}<InfoTip k={k} /></span>;
}
