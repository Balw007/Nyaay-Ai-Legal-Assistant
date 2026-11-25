"use client";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CalendarClock, Check } from "lucide-react";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

// A worked example for the sign-in screen, labelled as one. The dates are what the s.138 playbook computes
// for these two facts (app/data/playbooks); no matter or party is involved.
const STEPS = [
  { label: "Bank reports dishonour", date: "18 Jul 2026", note: "Date you confirm" },
  { label: "Last day to send the demand notice", date: "17 Aug 2026", note: "s.138 proviso (b), 30 days" },
  { label: "Drawer's 15-day payment period ends", date: "18 Aug 2026", note: "Notice received 3 Aug" },
  { label: "Last day to file the complaint", date: "19 Sep 2026", note: "s.142(1)(b), one month" },
];

export function DeadlineCard() {
  const reduce = useReducedMotion();
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = window.setInterval(() => setAt((n) => (n + 1) % STEPS.length), 2200);
    return () => window.clearInterval(t);
  }, [reduce]);

  return (
    <motion.figure initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: ease.out, delay: 0.5 }}
      className="deadline-card w-full max-w-md rounded-2xl p-5">
      <figcaption className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium text-text"><CalendarClock className="h-4 w-4 text-brass" />Cheque dishonour, s.138</span>
        <span className="rounded-md border border-rule-strong px-1.5 py-px text-xs text-muted">Example</span>
      </figcaption>
      <ol className="mt-4">
        {STEPS.map((s, i) => {
          const on = reduce || i <= at, now = !reduce && i === at;
          return (
            <li key={s.label} className="relative flex gap-3 pb-4 last:pb-0">
              {i < STEPS.length - 1 && (
                <span aria-hidden className="absolute left-[10px] top-6 h-[calc(100%-24px)] w-px bg-rule-strong">
                  <span className={cn("block h-full w-full origin-top bg-brass transition-transform duration-700", !reduce && i < at ? "scale-y-100" : "scale-y-0")} />
                </span>
              )}
              <span aria-hidden className={cn("mt-0.5 grid h-[21px] w-[21px] shrink-0 place-items-center rounded-full border transition-all duration-500",
                on ? "border-brass bg-brass-soft text-brass" : "border-rule-strong text-transparent", now && "shadow-[0_0_16px_-2px_var(--brass)]")}>
                <Check className="h-3 w-3" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm transition-colors duration-500", on ? "text-text" : "text-muted")}>{s.label}</span>
                <span className="block text-xs text-faint">{s.note}</span>
              </span>
              <span className={cn("tnum shrink-0 text-sm transition-colors duration-500", now ? "text-brass" : on ? "text-text" : "text-muted")}>{s.date}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 border-t border-rule pt-3 text-xs text-muted">Calculated by fixed rules, never by AI.</p>
    </motion.figure>
  );
}
