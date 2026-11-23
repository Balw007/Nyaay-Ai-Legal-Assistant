"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { CalEvent } from "@/lib/types";
import { fmtDate, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge, Empty, ErrorNote, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { IcsDownload } from "@/components/matters/tools";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarPage() {
  const today = todayISO();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(today);

  const grid = useMemo(() => {
    const first = new Date(cursor);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const start = new Date(first); start.setDate(1 - lead);
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);
  const start = iso(grid[0]), end = iso(grid[41]);
  const q = useQuery({ queryKey: ["calendar", start, end], queryFn: () => api.get<{ events: CalEvent[] }>(`/calendar${qs({ start, end })}`) });
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    (q.data?.events ?? []).forEach((e) => m.set(e.date, [...(m.get(e.date) ?? []), e]));
    return m;
  }, [q.data]);
  const dayEvents = byDay.get(selected) ?? [];
  const shift = (n: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));

  return (
    <div className="space-y-6">
      <PageHeader title="Calendar" sub="Hearings and statutory deadlines from all your matters"
        actions={<>
          <IcsDownload label="Download .ics" />
          <Link href="/settings"><Button type="button" title="Subscribe from Google, Apple or Outlook Calendar. Create the link in Settings, Profile.">Subscribe</Button></Link>
          <Button size="icon" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(today); }}>Today</Button>
          <Button size="icon" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
        </>} />
      <ErrorNote error={q.error} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <h2 className="font-display text-lg font-semibold">{cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2>
            <div className="flex gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan" />Hearing</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-tape" />Deadline</span>
            </div>
          </div>
          <div className="grid grid-cols-7 border-b border-rule text-center text-xs text-faint">{WEEK.map((w) => <div key={w} className="py-2">{w}</div>)}</div>
          <div className="grid grid-cols-7 grid-rows-6">
            {grid.map((d) => {
              const k = iso(d), ev = byDay.get(k) ?? [];
              const inMonth = d.getMonth() === cursor.getMonth();
              return (
                <button key={k} onClick={() => setSelected(k)} aria-pressed={selected === k} aria-label={`${fmtDate(k)}, ${ev.length} events`}
                  className={cn("min-h-[92px] border-b border-r border-rule p-1.5 text-left align-top transition-colors hover:bg-vellum [&:nth-child(7n)]:border-r-0",
                    !inMonth && "opacity-40", selected === k && "bg-brass-soft")}>
                  <span className={cn("inline-grid h-6 w-6 place-items-center rounded-full text-sm tabular-nums",
                    k === today ? "bg-brass font-semibold text-on-brass" : "text-muted")}>{d.getDate()}</span>
                  <div className="mt-1 space-y-0.5">
                    {ev.slice(0, 3).map((e, i) => (
                      <div key={i} className={cn("truncate rounded-sm px-1 text-[11px] leading-[18px]",
                        e.type === "deadline" ? "bg-tape-soft text-tape" : "bg-cyan-soft text-cyan")}>{e.title}</div>
                    ))}
                    {ev.length > 3 && <div className="px-1 text-[11px] text-faint">+{ev.length - 3} more</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
        <Panel className="self-start">
          <PanelHeader title={fmtDate(selected, { weekday: "long", day: "numeric", month: "long" })} sub={selected === today ? "Today" : undefined} />
          {dayEvents.length === 0 ? <Empty title="Nothing on this day" /> : (
            <ul className="divide-y divide-rule">
              {dayEvents.map((e, i) => (
                <li key={i} className="px-4 py-3">
                  <Badge tone={e.type === "deadline" ? "tape" : "cyan"}>{e.type === "deadline" ? "Deadline" : "Hearing"}</Badge>
                  <p className="mt-1.5 font-medium leading-snug">{e.title}</p>
                  <p className="text-sm text-muted">{e.detail}</p>
                  {e.matter_id && <Link href={`/matters/${e.matter_id}`} className="mt-1 inline-block text-sm text-brass hover:underline">Open matter</Link>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
