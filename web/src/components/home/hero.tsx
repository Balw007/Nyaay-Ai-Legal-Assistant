"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, CalendarClock, Clock, CheckCheck, FilePlus2, FolderOpen, Gavel, Library, MoreHorizontal, Search, ShieldCheck, Sparkles, Activity, Cpu } from "lucide-react";
import { api } from "@/lib/api";
import type { Dashboard, Matter } from "@/lib/types";
import { fmtDate, plural, timeAgo } from "@/lib/format";
import { useHealth } from "@/lib/hooks";
import { isActive, useStartAgent, useTasks, type AgentTask, type ResearchResult } from "@/lib/agents";
import { readRecent, type Recent } from "@/lib/recent";
import { MorphLink } from "@/lib/transition";
import { CountUp, Sharpen } from "@/components/fx/motion-bits";
import { Badge, Empty, Kbd, Panel, PanelHeader, Segmented, Skeleton } from "@/components/ui/misc";
import { AgentRow } from "@/components/agents/agent-row";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/info";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The welcome area: the greeting and one search for everything, open to the ribbon in the page background. */
export function Hero({ name }: { name: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const start = useStartAgent();
  const text = q.trim();

  const ask = () => {
    if (text.length < 5) { input.current?.focus(); toast("Type a question first, then press Ask AI."); return; }
    start.mutate({ agent: "research", input: { question: text } }, {
      onSuccess: (t) => { toast.success("The Research Agent has started. Follow it under Active Agents."); router.prefetch(`/intelligence?task=${t.id}`); setQ(""); },
      onError: (e) => toast.error((e as Error).message),
    });
  };
  const chips: { label: string; icon: React.ComponentType<{ className?: string }>; on: () => void; tone?: string }[] = [
    { label: "Research", icon: Search, on: () => router.push(text ? `/research?q=${encodeURIComponent(text)}` : "/research") },
    { label: "Ask AI", icon: Sparkles, on: ask, tone: "text-cyan" },
    { label: "Analyse a judgment", icon: Gavel, on: () => window.dispatchEvent(new Event("nyaay:search")) },
    { label: "Check citations", icon: ShieldCheck, on: () => router.push("/citations") },
    { label: "Create draft", icon: FilePlus2, on: () => router.push("/drafts") },
    { label: "More", icon: MoreHorizontal, on: () => window.dispatchEvent(new Event("nyaay:search")) },
  ];

  return (
    <section aria-label="Welcome" className="relative xl:min-h-[495px]">
      <div className="relative z-[2] flex min-h-[400px] flex-col items-center justify-center px-6 pb-24 pt-14 text-center">
        <h1 className="font-editorial text-[2.4rem] leading-tight text-text md:text-[3.2rem]">
          <Sharpen key={name} text={name ? `${greeting()}, ${name}` : greeting()} />
        </h1>
        <p className="mt-2 inline-flex items-center gap-1.5 text-md text-muted">What would you like to do today?<InfoTip k="Home" title="Home" /></p>
        <form onSubmit={(e) => { e.preventDefault(); if (text.length >= 2) router.push(`/research?q=${encodeURIComponent(text)}`); }}
          className="hero-search mt-8 flex w-full max-w-2xl items-center gap-3 rounded-full px-5" role="search">
          <Search className="h-5 w-5 shrink-0 text-muted" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search matters, judgments, acts and sections, or ask Nyaay"
            placeholder="Search matters, judgments, acts, sections or ask Nyaay…" className="h-14 min-w-0 flex-1 bg-transparent text-md text-text placeholder:text-faint outline-none" />
          <span className="hidden shrink-0 sm:inline-flex"><Kbd>Ctrl K</Kbd></span>
        </form>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {chips.map((c) => (
            <button key={c.label} type="button" onClick={c.on} disabled={c.label === "Ask AI" && start.isPending} data-tilt="6" data-press=""
              className="glass-2 relative inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm text-text transition-colors hover:border-cyan/40 disabled:opacity-60">
              <c.icon className={cn("relative z-[3] h-4 w-4", c.tone ?? "text-muted")} /><span className="relative z-[3]">{c.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Count({ n, word }: { n: number; word?: string }) {
  return <><span className="tnum text-md font-semibold"><CountUp value={n} /></span>{word ? ` ${n === 1 ? word : `${word}s`}` : null}</>;
}

/** Real counts only, each a link to the work behind it. */
export function TodaysIntelligence({ d }: { d?: Dashboard }) {
  const { data: h, isError } = useHealth();
  if (!d) return <Panel className="p-5"><Skeleton className="h-5 w-40" /><Skeleton className="mt-4 h-32" /></Panel>;
  const c = d.counts;
  const ai = h?.ai;
  const rows: { icon: React.ComponentType<{ className?: string }>; text: React.ReactNode; tone: string; href: string }[] = [
    { icon: Gavel, text: <><Count n={c.hearings_today} word="hearing" /> today</>, tone: "text-cyan", href: "/calendar" },
    { icon: CalendarClock, text: <><Count n={c.deadlines_week} word="deadline" /> this week{c.overdue ? <span className="text-tape">, {c.overdue} overdue</span> : null}</>, tone: "text-tape", href: "/calendar" },
    { icon: CheckCheck, text: <><Count n={c.pending_approvals} word="approval" /> pending</>, tone: "text-brass", href: "/approvals" },
    { icon: Library, text: <><Count n={d.corpus.real_judgments} /> judgments in your library</>, tone: "text-platinum", href: "/library" },
    {
      icon: isError ? Activity : Cpu,
      text: isError ? "Server offline" : !ai ? "Checking the system…" : ai.ready ? <>System running normally <span className="text-faint">({ai.model})</span></> : <>Local AI offline. <span className="text-faint">{ai.message}</span></>,
      tone: isError ? "text-tape" : ai?.ready ? "text-leaf" : "text-amber", href: "/intelligence",
    },
  ];
  return (
    <Panel lit tilt={2} className="glow-card">
      <PanelHeader title="Today's intelligence" />
      <ul className="relative z-[3] p-1.5">
        {rows.map((r, i) => (
          <li key={i}>
            <Link href={r.href} className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:bg-vellum">
              <r.icon className={cn("h-4 w-4 shrink-0", r.tone)} /><span className="min-w-0 flex-1 truncate">{r.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ActiveAgents() {
  const { data, isLoading } = useTasks(20);
  const list = useMemo(() => {
    const all = data ?? [];
    const active = all.filter(isActive);
    return [...active, ...all.filter((t) => !isActive(t))].slice(0, 3);
  }, [data]);
  const running = (data ?? []).filter(isActive).length;
  return (
    <Panel tilt={2} className="glow-card">
      <PanelHeader title="Active agents" sub={<span className={running ? "text-cyan" : undefined}>{running ? `${running} working now` : "None working now"}</span>}
        action={<Link href="/intelligence" className="inline-flex items-center gap-1 text-sm text-brass hover:underline">All agents <ArrowRight className="h-3 w-3" /></Link>} />
      <div className="relative z-[3] space-y-1.5 p-1.5">
        {isLoading ? <Skeleton className="h-16" /> : list.length === 0 ? (
          <p className="px-2.5 py-4 text-sm text-muted">No agent has run yet. Ask a question above, or open a judgment and press Summarise.</p>
        ) : list.map((t) => <AgentRow key={t.id} t={t} compact />)}
      </div>
    </Panel>
  );
}

/** Recent work in one place: your matters, and what you opened on this device. */
export function RecentMatters() {
  const matters = useQuery({ queryKey: ["matters"], queryFn: () => api.get<Matter[]>("/matters") });
  const [view, setView] = useState<"matters" | "opened">("matters");
  const [opened, setOpened] = useState<Recent[]>([]);
  useEffect(() => {
    const load = () => setOpened(readRecent().slice(0, 5));
    load();
    window.addEventListener("nyaay-recent", load);
    return () => window.removeEventListener("nyaay-recent", load);
  }, []);
  const list = useMemo(() => {
    const all = (matters.data ?? []).filter((m) => m.status === "active");
    const recent = readRecent().filter((r) => r.kind === "matter").map((r) => Number(r.id));
    const byRecent = recent.map((id) => all.find((m) => m.id === id)).filter(Boolean) as Matter[];
    const rest = all.filter((m) => !recent.includes(m.id)).sort((a, b) => (a.next_date ?? "9").localeCompare(b.next_date ?? "9"));
    return [...byRecent, ...rest].slice(0, 5);
  }, [matters.data]);
  return (
    <Panel className="h-full">
      <PanelHeader title="Recent matters"
        action={<Segmented label="Show" value={view} onChange={setView} className="p-0.5 [&_button]:px-2 [&_button]:py-1 [&_button]:text-xs"
          items={[{ value: "matters", label: "Matters" }, { value: "opened", label: "Opened here" }]} />} />
      {view === "matters" ? (
        <ul className="relative z-[3] space-y-0.5 p-1.5">
          {matters.isLoading ? <Skeleton className="h-24" /> : list.length === 0 ? <li className="px-2.5 py-4 text-sm text-muted">No active matters yet.</li> : list.map((m) => (
            <li key={m.id}>
              <Link href={`/matters/${m.id}`} className="flex items-start gap-3 rounded-lg px-2.5 py-2 hover:bg-vellum">
                <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-brass" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{m.title}</span>
                  <span className="block truncate text-xs text-faint">{[m.court, m.next_date ? `next ${fmtDate(m.next_date)}` : null].filter(Boolean).join(", ") || "No court details yet"}</span>
                </span>
              </Link>
            </li>
          ))}
          <li><Link href="/matters" className="flex items-center justify-end gap-1 px-2.5 pt-1 text-sm text-brass hover:underline">All matters <ArrowRight className="h-3 w-3" /></Link></li>
        </ul>
      ) : opened.length === 0 ? (
        <Empty icon={Clock} title="Nothing opened yet" className="py-8">Judgments and matters you open on this device appear here.</Empty>
      ) : (
        <ul className="relative z-[3] space-y-0.5 p-1.5">
          {opened.map((r) => (
            <li key={`${r.kind}${r.id}`} data-morph>
              <MorphLink href={r.kind === "matter" ? `/matters/${r.id}` : `/judgments/${encodeURIComponent(r.id)}`} className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:bg-vellum">
                {r.kind === "matter" ? <Badge tone="brass">Matter</Badge> : <Badge tone="cyan">Judgment</Badge>}
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="shrink-0 text-xs text-faint">{timeAgo(new Date(r.at).toISOString())}</span>
              </MorphLink>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The most recent answer the Research Agent produced, clearly marked as AI. Nothing invented when there is none. */
export function AiInsights() {
  const { data } = useTasks(20);
  const t = (data ?? []).find((x) => x.agent === "research" && x.status === "done") as AgentTask | undefined;
  const r = t?.result as ResearchResult | undefined;
  return (
    <Panel lit className="h-full">
      <PanelHeader title="AI insights" sub="Latest answer from the Research Agent"
        action={r?.mode === "answer" ? <Badge tone="cyan">AI, not verified</Badge> : undefined} />
      <div className="relative z-[3] px-4 py-3">
        {!t ? (
          <p className="py-3 text-sm text-muted">When the Research Agent answers a question, its latest answer appears here with the paragraphs it relied on.</p>
        ) : (
          <>
            <p className="text-sm font-medium">{t.title}</p>
            {r?.mode === "answer" && r.answer ? (
              <p className="mt-2 line-clamp-4 border-l-2 border-cyan/40 pl-3 text-sm leading-6 text-muted">{r.answer.replace(/\[S\d+\]/g, "")}</p>
            ) : (
              <p className="mt-2 text-sm text-muted">{r?.sources?.length ? `No written answer (the local AI was not running). ${plural(r.sources.length, "relevant paragraph")} found.` : r?.message ?? "No answer."}</p>
            )}
            <Link href={`/intelligence?task=${t.id}`}
              className="glass-2 mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-cyan hover:border-cyan/40">
              <span className="relative z-[3]">View analysis</span><ArrowRight className="relative z-[3] h-3 w-3" />
            </Link>
          </>
        )}
      </div>
    </Panel>
  );
}


