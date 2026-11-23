"use client";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import type { Deadline, MatterDetail } from "@/lib/types";
import { daysUntil, fmtDate, parseDay, todayISO } from "@/lib/format";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

// The matter on one time axis, in three lanes, so the source of every date is never in doubt:
//   Entered   dates the advocate confirmed from documents (matter.facts)          solid brass
//   Rules     deadlines calculated from those dates by fixed statutory rules       brass ring (red when close)
//   Court     dates read from orders, and the next hearing on the matter           cyan (amber if the order needs review)
// Nothing here is computed in the browser except positions on the axis: dates come from the backend as is.

type Source = "entered" | "rule" | "court";
type Ev = { key: string; date: string; label: string; source: Source; detail: string; warn?: boolean; done?: boolean };

const LANES: { id: Source; label: string; hint: string }[] = [
  { id: "entered", label: "Entered by you", hint: "Dates you confirmed from the documents" },
  { id: "rule", label: "Calculated by rule", hint: "Deadlines from fixed statutory rules, not AI" },
  { id: "court", label: "From the court", hint: "Order dates and hearings" },
];

export function CaseTimeline({ d, inputs }: { d: MatterDetail; inputs?: { name: string; label: string }[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const events = useMemo<Ev[]>(() => {
    const out: Ev[] = [];
    const labelOf = (k: string) => inputs?.find((i) => i.name === k)?.label ?? k.replace(/_/g, " ");
    Object.entries(d.matter.facts ?? {}).forEach(([k, v]) => {
      if (v && /^\d{4}-\d{2}-\d{2}/.test(v)) out.push({ key: `f-${k}`, date: v.slice(0, 10), label: labelOf(k), source: "entered", detail: "Entered and confirmed by you" });
    });
    (d.deadlines as (Deadline & { met?: boolean })[]).forEach((x) => {
      if (x.due_date) out.push({ key: `d-${x.id}`, date: x.due_date, label: x.label, source: "rule", detail: `Calculated: ${x.authority}${x.needs_confirmation ? ". Confirm the date it depends on" : ""}`, warn: x.needs_confirmation, done: x.met });
    });
    (d.orders ?? []).forEach((o) => {
      if (o.order_date) out.push({ key: `o-${o.id}`, date: o.order_date, label: "Order", source: "court", detail: `Read from ${o.filename ?? "an order"}${o.needs_review?.length ? ". Some details need checking" : ""}`, warn: !!o.needs_review?.length });
    });
    if (d.matter.next_date) out.push({ key: "next", date: d.matter.next_date, label: "Next hearing", source: "court", detail: "Next hearing date on this matter" });
    return out.filter((e) => parseDay(e.date)).sort((a, b) => a.date.localeCompare(b.date));
  }, [d, inputs]);

  if (events.length === 0) {
    return <p className="px-1 text-sm text-muted">Enter the key dates in the overview below. The timeline shows them beside the deadlines Nyaay calculates and the dates read from orders.</p>;
  }

  const today = todayISO();
  const t = (iso: string) => parseDay(iso)!.getTime();
  const lo = Math.min(t(events[0].date), t(today));
  const hi = Math.max(t(events[events.length - 1].date), t(today));
  const pad = Math.max((hi - lo) * 0.04, 86_400_000 * 2);
  const x = (iso: string) => ((t(iso) - lo + pad) / (hi - lo + 2 * pad)) * 100;

  return (
    <div>
      <div className="overflow-x-auto scrollbar-thin">
        <div className="relative min-w-[680px] pb-2" role="img" aria-label="Case timeline. The same dates are listed below the chart.">
          {LANES.map((lane) => (
            <div key={lane.id} className="relative flex h-11 items-center border-b border-rule last:border-0">
              <span className="w-36 shrink-0 pr-3 text-xs text-muted" title={lane.hint}>{lane.label}</span>
              <div className="relative h-full flex-1">
                <span className="absolute inset-x-0 top-1/2 h-px bg-rule" />
                {events.filter((e) => e.source === lane.id).map((e, i) => {
                  const near = daysUntil(e.date);
                  const urgent = e.source === "rule" && !e.done && near !== null && near <= 3;
                  return (
                    <motion.span key={e.key} title={`${e.label}, ${fmtDate(e.date)}. ${e.detail}`}
                      initial={{ scale: 0, opacity: 0 }} animate={{ scale: hover === e.key ? 1.5 : 1, opacity: 1 }} transition={{ ...spring.snappy, delay: hover ? 0 : 0.04 * i }}
                      onPointerEnter={() => setHover(e.key)} onPointerLeave={() => setHover(null)}
                      className={cn("absolute top-1/2 -ml-[6px] -mt-[6px] h-3 w-3 rounded-full",
                        e.source === "entered" && "rotate-45 rounded-[2px] bg-brass shadow-[0_0_10px_-2px_var(--brass)]",
                        e.source === "rule" && (e.done ? "border-2 border-leaf bg-paper" : urgent ? "border-2 border-tape bg-tape-soft shadow-[0_0_12px_-2px_var(--tape)]" : "border-2 border-brass bg-paper"),
                        e.source === "court" && (e.warn ? "bg-amber" : "bg-cyan shadow-[0_0_10px_-2px_var(--cyan)]"))}
                      style={{ left: `${x(e.date)}%` }} />
                  );
                })}
              </div>
            </div>
          ))}
          <div className="pointer-events-none absolute bottom-0 top-0 flex" style={{ left: `calc(9rem + (100% - 9rem) * ${x(today) / 100})` }}>
            <span className="w-px bg-gradient-to-b from-transparent via-brass to-transparent opacity-70" />
            <span className="absolute -top-1 -translate-x-1/2 rounded bg-brass px-1 text-[10px] font-medium text-on-brass">Today</span>
          </div>
        </div>
      </div>
      <ol className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2" aria-label="Dates on the timeline">
        {events.map((e) => (
          <li key={e.key} onPointerEnter={() => setHover(e.key)} onPointerLeave={() => setHover(null)}
            className={cn("flex items-baseline gap-2.5 rounded-md px-1.5 py-1 text-sm transition-colors", hover === e.key && "bg-vellum", e.done && "opacity-60")}>
            <span className="tnum w-24 shrink-0 text-muted">{fmtDate(e.date)}</span>
            <span className="min-w-0 flex-1">{e.label}</span>
            <span className={cn("shrink-0 text-xs", e.source === "entered" ? "text-brass" : e.source === "rule" ? "text-muted" : e.warn ? "text-amber" : "text-cyan")}>
              {e.source === "entered" ? "You" : e.source === "rule" ? (e.done ? "Rule, passed" : "Rule") : e.warn ? "Order, check" : "Court"}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
