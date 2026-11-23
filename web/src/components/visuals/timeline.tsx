"use client";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { CalEvent } from "@/lib/types";
import { parseDay, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

// The next N days as a lit rail. Hearings are cyan, deadlines red tape. Today is the gold mark at the left.
export function DayRail({ events, days = 14 }: { events: CalEvent[]; days?: number }) {
  const reduce = useReducedMotion();
  const start = parseDay(todayISO())!;
  const cols = Array.from({ length: days }, (_, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { iso, d, ev: events.filter((e) => e.date === iso), weekend: d.getDay() === 0 };
  });

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div className="relative min-w-[680px] px-1 pt-2 pb-1">
        <div className="absolute left-3 right-3 top-[42px] h-px bg-gradient-to-r from-brass via-cyan/40 to-transparent" />
        {!reduce && <div className="absolute left-3 right-3 top-[41px] h-[3px] overflow-hidden"><div className="h-full w-1/3 bg-gradient-to-r from-transparent via-cyan/50 to-transparent animate-[scan_4s_linear_infinite]" /></div>}
        <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
          {cols.map((c, i) => {
            const hearing = c.ev.some((e) => e.type === "hearing");
            const deadline = c.ev.some((e) => e.type === "deadline");
            return (
              <li key={c.iso} className="flex flex-col items-center text-center">
                <span className={cn("text-xs", i === 0 ? "text-brass font-medium" : c.weekend ? "text-faint/60" : "text-faint")}>
                  {i === 0 ? "Today" : c.d.toLocaleDateString("en-IN", { weekday: "short" })}
                </span>
                <span className={cn("mb-2 text-sm tabular-nums", i === 0 ? "text-text" : "text-muted")}>{c.d.getDate()}</span>
                <motion.span initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.15 + i * 0.03 }}
                  className={cn("relative grid h-3.5 w-3.5 place-items-center rounded-full border",
                    i === 0 ? "border-brass bg-brass glow-brass" : deadline ? "border-tape bg-tape glow-tape" : hearing ? "border-cyan bg-cyan shadow-[0_0_14px_-3px_var(--cyan)]" : "border-rule-strong bg-paper")}>
                  {(deadline || hearing) && i !== 0 && <span className={cn("absolute inset-0 rounded-full pulse-dot", deadline ? "text-tape" : "text-cyan")} />}
                </motion.span>
                <div className="mt-2 flex w-full flex-col gap-1 px-0.5">
                  {c.ev.slice(0, 3).map((e, k) => (
                    <Link key={k} href={e.matter_id ? `/matters/${e.matter_id}` : "/calendar"} title={`${e.type === "deadline" ? "Deadline" : "Hearing"}: ${e.title}\n${e.detail}`} aria-label={`${e.type === "deadline" ? "Deadline" : "Hearing"}: ${e.type === "deadline" ? `${e.title}, ${e.detail}` : e.title}`}
                      className={cn("truncate rounded-sm border px-1 py-0.5 text-left text-[11px] leading-tight transition-colors",
                        e.type === "deadline" ? "border-tape/30 bg-tape-soft text-tape hover:border-tape/60" : "border-cyan/30 bg-cyan-soft text-cyan hover:border-cyan/60")}>
                      {shortName(e.type === "deadline" ? e.detail : e.title)}
                    </Link>
                  ))}
                  {c.ev.length > 3 && <span className="text-[11px] text-faint">+{c.ev.length - 3}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// "Shreeji Agro Traders v. Malhotra Steel Works" -> "Shreeji Agro"; chips must say whose date it is.
function shortName(s?: string) {
  const first = (s ?? "").split(/\s+v(?:s)?\.?\s+/i)[0].replace(/\(.*?\)/g, "").trim();
  return first.split(/\s+/).slice(0, 2).join(" ") || "Matter";
}

// Countdown ring for a deadline: fills as the day approaches (30-day window).
export function Countdown({ days, className }: { days: number; className?: string }) {
  const r = 15, c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, 1 - days / 30));
  const tone = days < 0 ? "var(--tape)" : days <= 3 ? "var(--tape)" : days <= 10 ? "var(--amber)" : "var(--leaf)";
  return (
    <svg viewBox="0 0 40 40" className={cn("h-11 w-11 shrink-0", className)} role="img" aria-label={days < 0 ? `${-days} days overdue` : `${days} days left`}>
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--rule)" strokeWidth="3" />
      <circle cx="20" cy="20" r={r} fill="none" stroke={tone} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 20 20)" style={{ filter: `drop-shadow(0 0 3px ${tone})` }} />
      <text x="20" y="21" textAnchor="middle" dominantBaseline="middle" fontSize="11" fontWeight="600" fill={tone} fontFamily="var(--font-display)">
        {days < 0 ? `-${-days}` : days}
      </text>
    </svg>
  );
}
