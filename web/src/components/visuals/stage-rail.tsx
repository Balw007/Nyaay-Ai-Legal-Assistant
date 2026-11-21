"use client";
import { motion, useReducedMotion } from "motion/react";
import type { Stage } from "@/lib/types";
import { cn } from "@/lib/utils";

// The case as a lit rail: done stages are solid brass, the current stage pulses cyan, upcoming stages are dim.
export function StageRail({ stages, progress }: { stages: Stage[]; progress?: number }) {
  const reduce = useReducedMotion();
  const cur = stages.findIndex((s) => s.state === "current");
  const lastDone = stages.reduce((a, s, i) => (s.state === "done" ? i : a), -1);
  const reach = cur >= 0 ? cur : lastDone;
  const pct = stages.length > 1 ? Math.max(0, reach) / (stages.length - 1) : progress ?? 0;

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div className="relative min-w-[720px] px-2 pt-3 pb-2">
        <div className="absolute left-[calc(5%)] right-[calc(5%)] top-[22px] h-[2px] rounded-full bg-rule" />
        <motion.div
          className="absolute left-[calc(5%)] top-[22px] h-[2px] rounded-full bg-gradient-to-r from-brass to-cyan shadow-[0_0_12px_-2px_var(--brass)]"
          initial={reduce ? false : { width: 0 }} animate={{ width: `calc(${pct} * 90%)` }} transition={{ duration: 0.9, ease: "easeOut" }} />
        <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
          {stages.map((s, i) => (
            <li key={s.id} className="flex flex-col items-center text-center" aria-current={s.state === "current" ? "step" : undefined}>
              <motion.span
                initial={reduce ? false : { scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.08 * i }}
                className={cn("relative grid h-5 w-5 place-items-center rounded-full border-2",
                  s.state === "done" && "border-brass bg-brass shadow-[0_0_14px_-3px_var(--brass)]",
                  s.state === "current" && "border-cyan bg-paper shadow-[0_0_18px_-2px_var(--cyan)]",
                  s.state === "upcoming" && "border-rule-strong bg-paper")}>
                {s.state === "done" && <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden><path d="M2.5 6.2l2.2 2.2 4.8-4.8" fill="none" stroke="#0a0e18" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                {s.state === "current" && <><span className="h-2 w-2 rounded-full bg-cyan" /><span className="absolute inset-0 rounded-full pulse-dot text-cyan" /></>}
              </motion.span>
              <span className={cn("mt-2 px-1 text-xs leading-tight",
                s.state === "current" ? "font-medium text-cyan" : s.state === "done" ? "text-muted" : "text-faint")}>
                {s.name}
              </span>
              <span className="sr-only">{s.state === "done" ? "completed" : s.state === "current" ? "current stage" : "upcoming"}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
