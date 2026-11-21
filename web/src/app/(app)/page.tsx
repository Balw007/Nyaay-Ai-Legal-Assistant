"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { AlertTriangle, CheckCheck, Gavel, Library, Search } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { CalEvent, Dashboard } from "@/lib/types";
import { fmtDay, plural, timeAgo, todayISO } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { Badge, Empty, ErrorNote, Panel, PanelHeader, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Countdown, DayRail } from "@/components/visuals/timeline";
import { cn } from "@/lib/utils";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Gauge({ label, value, tone, href }: { label: string; value: number; tone: "brass" | "cyan" | "tape" | "leaf"; href: string }) {
  const color = { brass: "text-brass", cyan: "text-cyan", tape: "text-tape", leaf: "text-leaf" }[tone];
  const bar = { brass: "bg-brass", cyan: "bg-cyan", tape: "bg-tape", leaf: "bg-leaf" }[tone];
  return (
    <Link href={href} className="group relative block px-5 py-4 transition-colors hover:bg-vellum">
      <span className={cn("absolute left-0 top-4 bottom-4 w-[2px] rounded-full opacity-70", bar)} />
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("font-display mt-1 text-[2rem] font-semibold leading-none tabular-nums", value ? color : "text-faint")}>{value}</p>
    </Link>
  );
}

export default function DashboardPage() {
  const { data: me } = useMe();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/dashboard") });
  const end = new Date(); end.setDate(end.getDate() + 13);
  const endISO = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  const cal = useQuery({ queryKey: ["calendar", todayISO(), endISO], queryFn: () => api.get<{ events: CalEvent[] }>(`/calendar${qs({ start: todayISO(), end: endISO })}`) });

  if (dash.isLoading) return <Spinner label="Loading your day" />;
  if (dash.isError) return <ErrorNote error={dash.error} />;
  const d = dash.data!;
  const c = d.counts;
  const noLibrary = d.corpus.real_judgments === 0;
  const firstName = me?.user.name.split(" ")[0] ?? "";
  const stageMax = Math.max(1, ...d.stages.map((s) => s.count));

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-base text-muted">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          <h1 className="font-display mt-1 text-2xl font-semibold">{greeting()}, {firstName}</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/research"><Button><Search className="h-4 w-4" /> Research</Button></Link>
          <Link href="/matters?new=1"><Button variant="primary">New matter</Button></Link>
        </div>
      </motion.div>

      {noLibrary && (
        <Panel className="flex flex-wrap items-center gap-4 border-amber/30 p-4">
          <Library className="h-5 w-5 text-amber" />
          <div className="flex-1 min-w-[220px]">
            <p className="font-medium">Your judgment library is empty</p>
            <p className="text-sm text-muted">Research, AI answers and the citation checker work on the judgments you load. Start with the Supreme Court.</p>
          </div>
          <Link href="/library"><Button variant="primary">Load real judgments</Button></Link>
        </Panel>
      )}

      <Panel className="grid grid-cols-2 divide-rule lg:grid-cols-4 lg:divide-x overflow-hidden">
        <Gauge label="Hearings today" value={c.hearings_today} tone="cyan" href="/calendar" />
        <Gauge label="Deadlines this week" value={c.deadlines_week + c.overdue} tone="tape" href="/calendar" />
        <Gauge label="Waiting for your approval" value={c.pending_approvals} tone="brass" href="/approvals" />
        <Gauge label="Active matters" value={c.active_matters} tone="leaf" href="/matters" />
      </Panel>

      <Panel>
        <PanelHeader title="Next two weeks" sub="Hearings and statutory deadlines across all matters" action={<Link href="/calendar" className="text-sm text-brass hover:underline">Calendar</Link>} />
        <div className="p-4">{cal.data ? <DayRail events={cal.data.events} /> : <Spinner />}</div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader title="Cause list" sub={plural(d.hearings.length, "hearing") + " this week"} />
          {d.hearings.length === 0 ? (
            <Empty icon={Gavel} title="No hearings this week">Next dates appear here when you add them to a matter or an order is read.</Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {d.hearings.map((h) => (
                <li key={`${h.matter_id}-${h.date}`} className="px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <div className={cn("w-14 shrink-0 rounded-md border px-1 py-1 text-center", h.date === d.date ? "border-cyan/50 bg-cyan-soft" : "border-rule")}>
                      <p className={cn("text-xs", h.date === d.date ? "text-cyan" : "text-faint")}>{h.date === d.date ? "Today" : fmtDay(h.date).split(",")[0]}</p>
                      <p className="font-display text-lg font-semibold leading-tight">{new Date(h.date + "T00:00").getDate()}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link href={`/matters/${h.matter_id}`} className="font-medium hover:text-brass">{h.title}</Link>
                      <p className="text-sm text-muted truncate">{[h.court, h.case_number].filter(Boolean).join(" · ")}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge tone="cyan">{h.stage}</Badge>
                      </div>
                      {h.prepare.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {h.prepare.map((p) => <li key={p} className="flex gap-2 text-sm text-muted"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brass" />{p}</li>)}
                        </ul>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Deadlines" sub="Computed from dates you confirmed" />
            {d.deadlines.length === 0 ? (
              <Empty title="No deadlines in the next 14 days" />
            ) : (
              <ul className="divide-y divide-rule">
                {d.deadlines.map((x, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-3">
                    <Countdown days={x.days_left} />
                    <div className="min-w-0 flex-1">
                      <p className="text-base leading-snug">{x.label}</p>
                      <Link href={`/matters/${x.matter_id}`} className="text-sm text-muted hover:text-brass truncate block">{x.matter}</Link>
                      <p className="text-xs text-faint">{x.authority} · due {fmtDay(x.due_date)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Matters by stage" />
            {d.stages.length === 0 ? <Empty title="No active matters" action={<Link href="/matters?new=1"><Button size="sm">Add a matter</Button></Link>} /> : (
              <ul className="space-y-2.5 p-4">
                {d.stages.map((s, i) => (
                  <li key={s.stage}>
                    <div className="mb-1 flex justify-between text-sm"><span className="text-muted">{s.stage}</span><span className="tabular-nums">{s.count}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-vellum">
                      <motion.div className="h-full rounded-full bg-gradient-to-r from-cyan to-brass" initial={{ width: 0 }} animate={{ width: `${(s.count / stageMax) * 100}%` }} transition={{ delay: 0.1 + i * 0.05, duration: 0.6 }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Library" action={<Link href="/library" className="text-sm text-brass hover:underline">Manage</Link>} />
          <div className="grid grid-cols-3 divide-x divide-rule">
            {[["Judgments", d.corpus.real_judgments], ["Paragraphs", d.corpus.paragraphs], ["Courts", d.corpus.courts.length]].map(([k, v]) => (
              <div key={k} className="px-4 py-4"><p className="text-sm text-muted">{k}</p><p className="font-display text-xl font-semibold tabular-nums">{Number(v).toLocaleString("en-IN")}</p></div>
            ))}
          </div>
          {d.recent_searches.length > 0 && (
            <div className="border-t border-rule px-4 py-3">
              <p className="mb-2 text-sm text-faint">Recent searches</p>
              <div className="flex flex-wrap gap-1.5">
                {d.recent_searches.slice(0, 8).map((s) => <Link key={s} href={`/research?q=${encodeURIComponent(s)}`} className="rounded-sm border border-rule px-2 py-0.5 text-sm text-muted hover:border-brass/50 hover:text-text">{s}</Link>)}
              </div>
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Recent activity" action={c.pending_approvals > 0 ? <Link href="/approvals"><Button size="sm" variant="brass"><CheckCheck className="h-3.5 w-3.5" /> Review {c.pending_approvals}</Button></Link> : undefined} />
          <ul className="divide-y divide-rule">
            {d.activity.slice(0, 7).map((a) => (
              <li key={a.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
                <span className="w-16 shrink-0 text-faint">{timeAgo(a.at)}</span>
                <span className="min-w-0 flex-1 text-muted"><span className="text-text">{a.actor === "system" ? "Nyaay" : a.actor}</span> {a.text}
                  {a.matter_id && <> · <Link className="hover:text-brass" href={`/matters/${a.matter_id}`}>{a.matter}</Link></>}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      {c.overdue > 0 && <p className="flex items-center gap-2 text-sm text-tape"><AlertTriangle className="h-4 w-4" />{plural(c.overdue, "deadline")} overdue. Open the matter to confirm or record what was done.</p>}
    </div>
  );
}
