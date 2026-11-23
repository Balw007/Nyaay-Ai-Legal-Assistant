"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { ArrowDown, ArrowUp, CheckCheck, Clock, Cpu, Eye, EyeOff, Gavel, GripVertical, LayoutGrid, Library, Search, Sparkles } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { CalEvent, Dashboard } from "@/lib/types";
import { fmtDay, plural, timeAgo, todayISO } from "@/lib/format";
import { useHealth, useMe } from "@/lib/hooks";
import { readRecent, type Recent } from "@/lib/recent";
import { spring } from "@/lib/motion";
import { MorphLink } from "@/lib/transition";
import { Badge, Empty, ErrorNote, Panel, PanelHeader, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Countdown, DayRail } from "@/components/visuals/timeline";
import { ActiveAgents, AiInsights, Hero, RecentMatters, TodaysIntelligence } from "@/components/home/hero";
import { Titled } from "@/components/ui/info";
import { cn } from "@/lib/utils";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/* --------------------------------------------------------------- arrangeable workspace */
// Three even rows by default: this week's hearings and deadlines; your matters; what happened.
type PanelId = "docket" | "deadlines" | "matters" | "stages" | "insights" | "activity" | "library";
const PANELS: { id: PanelId; label: string; span: string }[] = [
  { id: "docket", label: "Cause list", span: "lg:col-span-2" },
  { id: "deadlines", label: "Deadlines", span: "" },
  { id: "matters", label: "Recent matters", span: "" },
  { id: "stages", label: "Matters by stage", span: "" },
  { id: "insights", label: "AI insights", span: "" },
  { id: "activity", label: "Recent activity", span: "lg:col-span-2" },
  { id: "library", label: "Library", span: "" },
];
type Layout = { order: PanelId[]; hidden: PanelId[] };
const LAYOUT_KEY = "nyaay-home-layout-v2";
const DEFAULT: Layout = { order: PANELS.map((p) => p.id), hidden: [] };

function useLayout() {
  const [layout, setLayout] = useState<Layout>(DEFAULT);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Layout | null;
      if (saved?.order) {
        const known = saved.order.filter((id) => PANELS.some((p) => p.id === id));
        const missing = PANELS.map((p) => p.id).filter((id) => !known.includes(id));
        setLayout({ order: [...known, ...missing], hidden: saved.hidden ?? [] });
      }
    } catch {}
  }, []);
  const save = (l: Layout) => { setLayout(l); try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)); } catch {} };
  return [layout, save] as const;
}

/* --------------------------------------------------------------- page */
export default function CommandCentre() {
  const { data: me } = useMe();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/dashboard") });
  const end = new Date(); end.setDate(end.getDate() + 13);
  const endISO = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  const cal = useQuery({ queryKey: ["calendar", todayISO(), endISO], queryFn: () => api.get<{ events: CalEvent[] }>(`/calendar${qs({ start: todayISO(), end: endISO })}`) });
  const [layout, setLayout] = useLayout();
  const [arranging, setArranging] = useState(false);

  if (dash.isError) return <ErrorNote error={dash.error} />;
  const d = dash.data;
  const firstName = me?.user.name.split(" ")[0] ?? "";

  return (
    <div className="space-y-7">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Hero name={firstName} />
        <div className="min-w-0 space-y-6"><TodaysIntelligence d={d} /><ActiveAgents /></div>
      </div>

      {d && d.corpus.real_judgments === 0 && (
        <Panel lit className="flex flex-wrap items-center gap-4 p-4">
          <span className="relative z-[3] grid h-10 w-10 place-items-center rounded-xl border border-amber/30 bg-amber-soft"><Library className="h-5 w-5 text-amber" /></span>
          <div className="relative z-[3] min-w-[220px] flex-1">
            <p className="font-medium">Your judgment library has no real judgments yet</p>
            <p className="text-sm text-muted">Research, AI answers and the citation checker work only on judgments you load. Start with the Supreme Court open dataset.</p>
          </div>
          <Link href="/library" className="relative z-[3]"><Button variant="primary">Load real judgments</Button></Link>
        </Panel>
      )}

      <section aria-labelledby="practice-h" className="space-y-6 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 id="practice-h" className="flex items-center gap-2 font-editorial text-xl"><Titled k="Your practice">Your practice</Titled></h2>
            {d ? <Situation d={d} /> : <Skeleton className="mt-3 h-5 w-96 max-w-full" />}
          </div>
          <Button size="sm" variant={arranging ? "brass" : "ghost"} onClick={() => setArranging((v) => !v)} aria-pressed={arranging}>
            <LayoutGrid className="h-3.5 w-3.5" />{arranging ? "Done arranging" : "Arrange panels"}
          </Button>
        </div>
        {arranging && <p className="text-sm text-faint">Drag panels, or use the arrows, to arrange your workspace. Hidden panels can be shown again here.</p>}

        {!arranging && (
          <Panel className="overflow-hidden" aria-label="Next two weeks">
            <PanelHeader title="The next two weeks"
              action={
                <div className="flex items-center gap-4 text-sm">
                  <span className="hidden items-center gap-1.5 text-muted sm:inline-flex"><span className="h-2 w-2 rounded-full bg-cyan shadow-[0_0_8px_var(--cyan)]" />Hearing</span>
                  <span className="hidden items-center gap-1.5 text-muted sm:inline-flex"><span className="h-2 w-2 rounded-full bg-tape shadow-[0_0_8px_var(--tape)]" />Statutory deadline</span>
                  <Link href="/calendar" className="text-brass hover:underline">Calendar</Link>
                </div>
              } />
            <div className="relative z-[3] px-3 pb-4 pt-2">{cal.data ? <DayRail events={cal.data.events} /> : <Skeleton className="m-2 h-28" />}</div>
          </Panel>
        )}

      <AnimatePresence mode="wait" initial={false}>
        {arranging ? (
          <motion.div key="arrange" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            <Arranger layout={layout} setLayout={setLayout} />
          </motion.div>
        ) : (
          <motion.div key="grid" layout className="grid grid-cols-1 gap-6 lg:grid-cols-3 [grid-auto-flow:dense]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {layout.order.filter((id) => !layout.hidden.includes(id)).map((id) => {
              const p = PANELS.find((x) => x.id === id)!;
              return (
                <motion.div key={id} layout transition={spring.gentle} className={cn("min-w-0 [&>*]:h-full", p.span)}>
                  {d ? <PanelFor id={id} d={d} /> : <Panel className="p-5"><Skeleton className="h-5 w-40" /><Skeleton className="mt-4 h-24" /></Panel>}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
      </section>
    </div>
  );
}

/** The day in one sentence. Every number is a door to the work behind it. */
function Situation({ d }: { d: Dashboard }) {
  const c = d.counts;
  const A = ({ href, n, word, tone }: { href: string; n: number; word: string; tone: string }) => (
    <Link href={href} className={cn("rounded-md px-0.5 font-medium underline decoration-1 underline-offset-4 transition-colors hover:bg-vellum",
      n ? tone : "text-muted decoration-rule-strong")}>
      <span className="tnum">{n.toLocaleString("en-IN")}</span> {word}
    </Link>
  );
  return (
    <p className="mt-2 max-w-[70ch] text-md leading-relaxed text-muted">
      Today you have <A href="/calendar" n={c.hearings_today} word={c.hearings_today === 1 ? "hearing" : "hearings"} tone="text-cyan decoration-cyan/40" />{" "}
      and <A href="/calendar" n={c.deadlines_week} word={c.deadlines_week === 1 ? "deadline" : "deadlines"} tone="text-tape decoration-tape/40" /> this week
      {c.overdue > 0 && <>, with <A href="/matters" n={c.overdue} word="overdue" tone="text-tape decoration-tape/40" /></>}.{" "}
      <A href="/approvals" n={c.pending_approvals} word={c.pending_approvals === 1 ? "proposal is" : "proposals are"} tone="text-brass decoration-brass/40" /> waiting for an advocate
      {" "}across <A href="/matters" n={c.active_matters} word={c.active_matters === 1 ? "active matter" : "active matters"} tone="text-text decoration-rule-strong" />.
    </p>
  );
}

function Arranger({ layout, setLayout }: { layout: Layout; setLayout: (l: Layout) => void }) {
  const move = (i: number, by: number) => {
    const order = [...layout.order];
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setLayout({ ...layout, order });
  };
  return (
    <Reorder.Group axis="y" values={layout.order} onReorder={(order) => setLayout({ ...layout, order })} className="mx-auto max-w-xl space-y-2" aria-label="Arrange panels">
      {layout.order.map((id, i) => {
        const p = PANELS.find((x) => x.id === id)!;
        const hidden = layout.hidden.includes(id);
        return (
          <Reorder.Item key={id} value={id} transition={spring.smooth} whileDrag={{ scale: 1.02, zIndex: 5 }}
            className={cn("glass-3 flex cursor-grab items-center gap-3 rounded-xl px-3 py-2.5 active:cursor-grabbing", hidden && "opacity-55")}>
            <GripVertical className="relative z-[3] h-4 w-4 text-faint" aria-hidden />
            <span className="relative z-[3] flex-1 text-base">{p.label}</span>
            <span className="relative z-[3] flex gap-0.5">
              <Button size="icon" variant="ghost" aria-label={`Move ${p.label} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label={`Move ${p.label} down`} disabled={i === layout.order.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label={hidden ? `Show ${p.label}` : `Hide ${p.label}`} aria-pressed={hidden}
                onClick={() => setLayout({ ...layout, hidden: hidden ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] })}>
                {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </span>
          </Reorder.Item>
        );
      })}
      <div className="flex justify-end pt-2"><Button size="sm" variant="ghost" onClick={() => setLayout(DEFAULT)}>Reset to default</Button></div>
    </Reorder.Group>
  );
}

function PanelFor({ id, d }: { id: PanelId; d: Dashboard }) {
  switch (id) {
    case "docket": return <Docket d={d} />;
    case "deadlines": return <Deadlines d={d} />;
    case "stages": return <Stages d={d} />;
    case "library": return <LibraryPanel d={d} />;
    case "activity": return <ActivityPanel d={d} />;
    case "matters": return <RecentMatters />;
    case "insights": return <AiInsights />;
  }
}

function Docket({ d }: { d: Dashboard }) {
  return (
    <Panel className="h-full">
      <PanelHeader title="Cause list" sub={plural(d.hearings.length, "hearing") + " this week"} />
      {d.hearings.length === 0 ? (
        <Empty icon={Gavel} title="No hearings this week">Next dates appear here when you add them to a matter or an order is read.</Empty>
      ) : (
        <ol className="relative z-[3] divide-y divide-rule">
          {d.hearings.map((h) => {
            const today = h.date === d.date;
            return (
              <li key={`${h.matter_id}-${h.date}`} data-morph className="relative px-4 py-4">
                <div className="flex items-start gap-4">
                  <div className={cn("w-14 shrink-0 rounded-xl border px-1 py-1.5 text-center", today ? "border-cyan/50 bg-cyan-soft shadow-[0_0_20px_-8px_var(--cyan)]" : "border-rule bg-vellum")}>
                    <p className={cn("text-xs", today ? "text-cyan" : "text-faint")}>{today ? "Today" : fmtDay(h.date).split(",")[0]}</p>
                    <p className="tnum text-lg font-semibold leading-tight">{new Date(h.date + "T00:00").getDate()}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <MorphLink href={`/matters/${h.matter_id}`} className="font-medium hover:text-brass">{h.title}</MorphLink>
                    <p className="truncate text-sm text-muted">{[h.court, h.case_number].filter(Boolean).join(", ")}</p>
                    <div className="mt-2"><Badge tone="cyan">{h.stage}</Badge></div>
                    {h.prepare.length > 0 && (
                      <ul className="mt-2.5 space-y-1">
                        {h.prepare.map((p) => <li key={p} className="flex gap-2 text-sm text-muted"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brass" />{p}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

function Deadlines({ d }: { d: Dashboard }) {
  return (
    <Panel className="h-full">
      <PanelHeader title="Deadlines" sub="Calculated by fixed rules from dates you confirmed" />
      {d.deadlines.length === 0 ? <Empty title="No deadlines in the next 14 days" /> : (
        <ul className="relative z-[3] divide-y divide-rule">
          {d.deadlines.map((x, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <Countdown days={x.days_left} />
              <div className="min-w-0 flex-1">
                <p className="text-base leading-snug">{x.label}</p>
                <Link href={`/matters/${x.matter_id}`} className="block truncate text-sm text-muted hover:text-brass">{x.matter}</Link>
                <p className="text-xs text-faint">{x.authority}, due {fmtDay(x.due_date)}{x.needs_confirmation ? ". Date not yet confirmed" : ""}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Stages({ d }: { d: Dashboard }) {
  const max = Math.max(1, ...d.stages.map((s) => s.count));
  return (
    <Panel className="h-full">
      <PanelHeader title="Matters by stage" />
      {d.stages.length === 0 ? <Empty title="No active matters" action={<Link href="/matters?new=1"><Button size="sm">Add a matter</Button></Link>} /> : (
        <ul className="relative z-[3] space-y-3 p-4">
          {d.stages.map((s, i) => (
            <li key={s.stage}>
              <div className="mb-1 flex justify-between text-sm"><span className="text-muted">{s.stage}</span><span className="tnum">{s.count}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-vellum">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-cyan to-brass" initial={{ width: 0 }} animate={{ width: `${(s.count / max) * 100}%` }} transition={{ ...spring.gentle, delay: 0.1 + i * 0.05 }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function LibraryPanel({ d }: { d: Dashboard }) {
  return (
    <Panel className="h-full">
      <PanelHeader title="Library" action={<Link href="/library" className="text-sm text-brass hover:underline">Manage</Link>} />
      <dl className="relative z-[3] grid grid-cols-3 divide-x divide-rule">
        {([["Judgments", d.corpus.real_judgments], ["Paragraphs", d.corpus.paragraphs], ["Courts", d.corpus.courts.length]] as const).map(([k, v]) => (
          <div key={k} className="px-4 py-4"><dt className="text-sm text-muted">{k}</dt><dd className="tnum text-xl font-semibold">{Number(v).toLocaleString("en-IN")}</dd></div>
        ))}
      </dl>
      {d.recent_searches.length > 0 && (
        <div className="relative z-[3] border-t border-rule px-4 py-3">
          <p className="mb-2 text-sm text-faint">Recent searches</p>
          <div className="flex flex-wrap gap-1.5">
            {d.recent_searches.slice(0, 8).map((s) => <Link key={s} href={`/research?q=${encodeURIComponent(s)}`} className="rounded-lg border border-rule px-2 py-0.5 text-sm text-muted hover:border-brass/50 hover:text-text">{s}</Link>)}
          </div>
        </div>
      )}
    </Panel>
  );
}

function ActivityPanel({ d }: { d: Dashboard }) {
  return (
    <Panel className="h-full">
      <PanelHeader title="Recent activity" action={d.counts.pending_approvals > 0 ? <Link href="/approvals"><Button size="sm" variant="brass"><CheckCheck className="h-3.5 w-3.5" /> Review {d.counts.pending_approvals}</Button></Link> : undefined} />
      {d.activity.length === 0 ? <Empty title="Nothing yet" /> : (
        <ul className="relative z-[3] divide-y divide-rule">
          {d.activity.slice(0, 7).map((a) => (
            <li key={a.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
              <span className="w-16 shrink-0 text-faint">{timeAgo(a.at)}</span>
              {a.actor === "system" ? <Cpu className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-cyan" aria-label="Done by Nyaay" /> : <span className="h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0 flex-1 text-muted"><span className="text-text">{a.actor === "system" ? "Nyaay" : a.actor}</span> {a.text}
                {a.matter_id && <>, in <Link className="hover:text-brass" href={`/matters/${a.matter_id}`}>{a.matter}</Link></>}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

