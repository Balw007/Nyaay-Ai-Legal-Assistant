"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { AlertTriangle, BookOpen, ChevronLeft, ChevronRight, Library, Maximize2, Search, Sparkles, X } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { AskSource, Corpus, Judgment, SearchResponse } from "@/lib/types";
import { fmtDate, plural } from "@/lib/format";
import { spring, sheetIn } from "@/lib/motion";
import { MorphLink } from "@/lib/transition";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Badge, Empty, ErrorNote, Panel, Segmented, Skeleton, Spinner } from "@/components/ui/misc";
import { Marked } from "@/components/research/marked";
import { ActsResults, HeadnoteResults, ResearchAssistant, ResultTabs } from "@/components/research/panels";
import { TreatmentBadges, TreatmentWord } from "@/components/research/treatment";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/info";

type Mode = "search" | "ask";
const PAGE = 10;

interface AskOut {
  question: string; mode: string; answer: string | null; sources: AskSource[]; message?: string; cached?: boolean;
  confidence?: "high" | "medium" | "low"; limitations?: string;
  checks?: { invalid_markers_removed: number[]; uncited_sentences: string[]; cited_sources: number[] };
}

const readerHref = (jid: string, para?: number) => `/judgments/${encodeURIComponent(jid)}${para !== undefined ? `?para=${para}` : ""}`;
const judgmentQuery = (jid: string) => ({ queryKey: ["judgment", jid], queryFn: () => api.get<Judgment>(`/judgments/${encodeURIComponent(jid)}`) });

function ResearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initialAsk = params.get("ask");
  const [mode, setMode] = useState<Mode>(initialAsk ? "ask" : "search");
  const [text, setText] = useState(initialAsk ?? params.get("q") ?? "");
  const [court, setCourt] = useState(params.get("court") ?? "");
  const [yFrom, setYFrom] = useState(params.get("from") ?? "");
  const [yTo, setYTo] = useState(params.get("to") ?? "");
  const [act, setAct] = useState(params.get("act") ?? "");
  const [section, setSection] = useState(params.get("section") ?? "");
  const q = params.get("q") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const [tab, setTab] = useState<ResultTab>("judgments");
  const [peek, setPeek] = useState<Peek | null>(null);
  useEffect(() => setPeek(null), [q, offset]);
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPeek(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peek]);

  const facets = useQuery({ queryKey: ["section-facets"], queryFn: () => api.get<{ act: string; name: string; judgments: number }[]>("/library/sections") });
  const stats = useQuery({ queryKey: ["research-stats"], queryFn: () => api.get<Corpus>("/research/stats") });
  const search = useQuery({
    queryKey: ["search", q, params.get("court"), params.get("from"), params.get("to"), params.get("act"), params.get("section"), offset],
    enabled: mode === "search" && q.length >= 2,
    queryFn: () => api.get<SearchResponse>(`/research/search${qs({ q, court: params.get("court"), year_from: params.get("from"), year_to: params.get("to"), act: params.get("act"), section: params.get("section"), limit: PAGE, offset })}`),
  });
  const ask = useMutation({
    mutationFn: (question: string) => api.post<AskOut>("/research/ask", {
      question, court: court || null, year_from: yFrom ? Number(yFrom) : null, year_to: yTo ? Number(yTo) : null,
    }),
  });

  const askedOnce = useRef(false);
  useEffect(() => {
    if (initialAsk && !askedOnce.current && initialAsk.trim().length >= 5) { askedOnce.current = true; ask.mutate(initialAsk.trim()); }
  }, [initialAsk]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (mode === "search") {
      if (t.length < 2) return;
      router.push(`/research${qs({ q: t, court, from: yFrom, to: yTo, act, section: act ? section : "" })}`);
    } else {
      if (t.length < 5) return;
      ask.mutate(t);
    }
  }
  // Filters apply at once when there is already a search on screen.
  const applyFilters = (next: { court?: string; from?: string; to?: string; act?: string; section?: string }) => {
    const c = next.court ?? court, f = next.from ?? yFrom, t = next.to ?? yTo, a = next.act ?? act, s = next.section ?? section;
    if (mode === "search" && q) router.push(`/research${qs({ q, court: c, from: f, to: t, act: a, section: a ? s : "" })}`);
  };

  const empty = stats.data && stats.data.judgments === 0;
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const min = stats.data?.year_min ?? 1950;
    const max = stats.data?.year_max ?? now;
    return Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => max - i);
  }, [stats.data]);

  const active = (mode === "search" && !!q) || (mode === "ask" && (ask.isPending || !!ask.data || !!ask.error));

  const field = (
    <motion.form layoutId="research-field" transition={spring.gentle} onSubmit={submit}
      className={cn("glass-4 rounded-2xl p-2", active ? "w-full" : "w-full max-w-3xl")} data-specular role="search">
      <div className="relative z-[3] flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          {mode === "search" ? <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" /> : <Sparkles className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan" />}
          <Input value={text} onChange={(e) => setText(e.target.value)} aria-label={mode === "search" ? "Search words" : "Your question"} autoFocus={!active}
            className={cn("border-0 bg-transparent pl-12 shadow-none focus:ring-0", active ? "h-12 text-md" : "h-14 text-lg")}
            placeholder={mode === "search" ? "cheque dishonour notice thirty days" : "When must the demand notice be sent after a cheque bounces?"} />
        </div>
        <div className="flex items-center gap-2 px-1 pb-1 sm:pb-0">
          <Segmented label="Research mode" value={mode} onChange={setMode}
            items={[{ value: "search", label: <><Search className="h-3.5 w-3.5" />Search</> }, { value: "ask", label: <><Sparkles className="h-3.5 w-3.5" />Ask AI</>, tone: "cyan" }]} />
          <Button type="submit" variant={mode === "ask" ? "ai" : "primary"} size="lg" loading={ask.isPending} disabled={mode === "search" ? text.trim().length < 2 : text.trim().length < 5}>
            {mode === "search" ? "Search" : "Ask"}
          </Button>
        </div>
      </div>
    </motion.form>
  );

  return (
    <LayoutGroup>
      {!active ? (
        <div className="flex min-h-[62vh] flex-col items-center justify-center text-center">
          <motion.h1 initial={{ opacity: 0.4, y: 8 }} animate={{ opacity: 1, y: 0 }} className="font-editorial text-[2.4rem] leading-tight md:text-4xl">Research the law to the paragraph</motion.h1>
          <p className="mb-8 mt-3 max-w-[60ch] text-md text-muted">
            {stats.data && stats.data.judgments > 0
              ? <>Search {plural(stats.data.real_judgments || stats.data.judgments, "judgment")} and {plural(stats.data.paragraphs, "paragraph")}, or ask a question and get an answer that cites them.</>
              : "Search judgments to the paragraph, or ask a question and get an answer that cites them."}
          </p>
          {field}
          <p className="mt-4 max-w-[64ch] text-sm text-faint">{mode === "search" ? "Legal synonyms are matched: bounce, dishonour and returned unpaid find each other." : "Answers use only paragraphs from your library, and every reference is checked."}</p>
          {empty && (
            <Panel className="mt-10 w-full max-w-xl text-left">
              <Empty icon={Library} title="No judgments loaded yet" action={<Link href="/library"><Button variant="primary">Load real judgments</Button></Link>}>
                Research works on the judgments in your library. Load Supreme Court or High Court judgments from the open datasets, or upload your own.
              </Empty>
            </Panel>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {field}
          <div className={cn("grid gap-6", mode === "search" && "lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_340px]")}>
            {mode === "search" && (
              <Filters stats={stats.data} years={years} court={court} yFrom={yFrom} yTo={yTo}
                setCourt={(v) => { setCourt(v); applyFilters({ court: v }); }} setFrom={(v) => { setYFrom(v); applyFilters({ from: v }); }} setTo={(v) => { setYTo(v); applyFilters({ to: v }); }}
                acts={facets.data ?? []} act={act} section={section}
                setAct={(v) => { setAct(v); if (!v) setSection(""); applyFilters({ act: v, section: v ? section : "" }); }}
                setSection={setSection} applySection={() => applyFilters({})} />
            )}
            {mode === "search" && (
              <div className="min-w-0 space-y-4">
                <ResultTabs q={q} tab={tab} setTab={setTab} total={search.data?.total} />
                {tab === "judgments" && <SearchResults q={q} offset={offset} data={search.data} loading={search.isFetching} error={search.error} peek={peek} setPeek={setPeek}
                  onPage={(o) => router.push(`/research${qs({ q, court: params.get("court"), from: params.get("from"), to: params.get("to"), act: params.get("act"), section: params.get("section"), offset: o || undefined })}`)} />}
                {tab === "acts" && <ActsResults q={q} />}
                {tab === "headnotes" && <HeadnoteResults q={q} />}
              </div>
            )}
            {mode === "search" && (
              <div className="hidden xl:block">
                <div className="sticky top-24 space-y-4">
                  <AnimatePresence mode="wait">
                    {peek ? <PeekPanel key={peek.jid} peek={peek} onClose={() => setPeek(null)} setPara={(n) => setPeek({ ...peek, para: n })} />
                      : <motion.div key="assistant" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><ResearchAssistant q={q} /></motion.div>}
                  </AnimatePresence>
                </div>
              </div>
            )}
            {mode === "ask" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-faint">Answer from</span>
                  <Select value={court} onChange={(e) => setCourt(e.target.value)} className="h-8 w-auto min-w-[180px] text-sm" aria-label="Court">
                    <option value="">All courts</option>
                    {stats.data?.courts.map((c) => <option key={c.court} value={c.court}>{c.court}</option>)}
                  </Select>
                  <Select value={yFrom} onChange={(e) => setYFrom(e.target.value)} className="h-8 w-auto text-sm" aria-label="From year"><option value="">From any year</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
                  <Select value={yTo} onChange={(e) => setYTo(e.target.value)} className="h-8 w-auto text-sm" aria-label="To year"><option value="">To any year</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
                </div>
                <AskResult data={ask.data} loading={ask.isPending} error={ask.error} />
              </div>
            )}
          </div>
        </div>
      )}
    </LayoutGroup>
  );
}

function Filters({ stats, years, court, yFrom, yTo, setCourt, setFrom, setTo, acts, act, section, setAct, setSection, applySection }:
  { stats?: Corpus; years: number[]; court: string; yFrom: string; yTo: string; setCourt: (v: string) => void; setFrom: (v: string) => void; setTo: (v: string) => void;
    acts: { act: string; name: string; judgments: number }[]; act: string; section: string; setAct: (v: string) => void; setSection: (v: string) => void; applySection: () => void }) {
  const courts = stats?.courts ?? [];
  return (
    <aside aria-label="Filters" className="space-y-5 lg:sticky lg:top-24 lg:self-start">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Court</legend>
        <div className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
          {[{ court: "", count: stats?.judgments ?? 0 }, ...courts].map((c) => {
            const on = court === c.court;
            return (
              <label key={c.court || "all"} className={cn("relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors", on ? "text-text" : "text-muted hover:bg-vellum hover:text-text")}>
                <input type="radio" name="court" className="sr-only" checked={on} onChange={() => setCourt(c.court)} />
                {on && <motion.span layoutId="court-on" transition={spring.snappy} className="glass-5 absolute inset-0 rounded-lg" />}
                <span className="relative min-w-0 flex-1 truncate">{c.court || "All courts"}</span>
                <span className="tnum relative text-xs text-faint">{c.count.toLocaleString("en-IN")}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Decided</legend>
        <div className="flex gap-1.5">
          {[5, 10].map((n) => { const from = String(new Date().getFullYear() - n); return (
            <button key={n} type="button" onClick={() => setFrom(yFrom === from ? "" : from)} aria-pressed={yFrom === from}
              className={cn("flex-1 rounded-lg border px-2 py-1 text-xs transition-colors", yFrom === from ? "border-brass/50 bg-brass-soft text-brass" : "border-rule text-muted hover:text-text")}>Last {n} years</button>
          ); })}
        </div>
        <Select value={yFrom} onChange={(e) => setFrom(e.target.value)} className="h-8 text-sm" aria-label="From year"><option value="">From any year</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        <Select value={yTo} onChange={(e) => setTo(e.target.value)} className="h-8 text-sm" aria-label="To year"><option value="">To any year</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
      </fieldset>
      {acts.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Provision discussed</legend>
          <Select value={act} onChange={(e) => setAct(e.target.value)} className="h-8 text-sm" aria-label="Act">
            <option value="">Any Act</option>{acts.map((f) => <option key={f.act} value={f.act}>{f.name} ({f.judgments.toLocaleString("en-IN")})</option>)}
          </Select>
          {act && (
            <form onSubmit={(e) => { e.preventDefault(); applySection(); }} className="flex gap-1.5">
              <Input value={section} onChange={(e) => setSection(e.target.value)} placeholder="Section, e.g. 138" aria-label="Section" className="h-8 text-sm" />
              <Button size="sm" type="submit">Apply</Button>
            </form>
          )}
        </fieldset>
      )}
    </aside>
  );
}

type Peek = { jid: string; para: number; title: string };
type ResultTab = "judgments" | "acts" | "headnotes";

function SearchResults({ q, offset, data, loading, error, onPage, peek, setPeek }: { q: string; offset: number; data?: SearchResponse; loading: boolean; error: unknown; onPage: (o: number) => void; peek: Peek | null; setPeek: (p: Peek | null) => void }) {
  const qc = useQueryClient();

  if (error) return <ErrorNote error={error} />;
  if (loading && !data) return (
    <div className="space-y-3" aria-busy="true"><Spinner label="Searching paragraphs" />
      {[0, 1, 2].map((i) => <Panel key={i} className="space-y-3 p-5"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-3 w-1/3" /><Skeleton className="h-12" /></Panel>)}
    </div>
  );
  if (!data) return null;
  if (data.total === 0) return (
    <Panel><Empty icon={Search} title={`No paragraphs matched “${data.query}”`}>Try fewer or different words, remove the court or year filter, or ask the question in Ask AI.</Empty></Panel>
  );
  const end = Math.min(data.total, offset + data.results.length);
  const prefetch = (jid: string) => () => qc.prefetchQuery(judgmentQuery(jid));

  return (
    <div>
      <section aria-label="Search results" className="min-w-0 space-y-3">
        <p className="text-sm text-muted" aria-live="polite">{plural(data.total, "judgment")}, showing {offset + 1} to {end}{data.match === "or" && ". No judgment had every word, so these match some of them"}</p>
        <ol className="space-y-3">
          {data.results.map((r, i) => (
            <motion.li key={r.id} initial={{ opacity: 0.5, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: Math.min(i, 6) * 0.035 }}>
              <Panel as="article" lit data-morph className={cn("p-5 transition-colors hover:border-brass/40", r.treatment.negative && "shadow-[inset_3px_0_0_var(--tape)]", peek?.jid === r.id && "glow-brass")}>
                <div className="relative z-[3] flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <MorphLink href={readerHref(r.id, r.hits[0]?.no)} prepare={prefetch(r.id)} onMouseEnter={prefetch(r.id)} className="font-editorial text-lg leading-snug hover:text-brass">{r.title}</MorphLink>
                    <p className="mt-1 text-sm text-muted">{[r.citation, r.court, r.decision_date ? fmtDate(r.decision_date) : r.year].filter(Boolean).join(", ")}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5"><TreatmentBadges t={r.treatment} /></div>
                </div>
                <ul className="relative z-[3] mt-3 space-y-1">
                  {r.hits.map((h) => (
                    <li key={h.no}>
                      <a href={readerHref(r.id, h.no)} onMouseEnter={prefetch(r.id)}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || window.innerWidth < 1280) return;
                          e.preventDefault(); setPeek({ jid: r.id, para: h.no, title: r.title });
                        }}
                        className={cn("group -mx-2 flex gap-3 rounded-lg px-2 py-1.5 hover:bg-vellum", peek?.jid === r.id && peek.para === h.no && "bg-brass-soft")}
                        aria-label={`Paragraph ${h.no} of ${r.title}`}>
                        <span className="tnum w-10 shrink-0 pt-0.5 text-right text-sm text-brass">¶ {h.no}</span>
                        <Marked html={h.snippet} className="prose-judgment text-base text-muted group-hover:text-text" />
                      </a>
                    </li>
                  ))}
                </ul>
              </Panel>
            </motion.li>
          ))}
        </ol>
        {data.total > PAGE && (
          <nav aria-label="Pages" className="flex items-center justify-between pt-2">
            <Button size="sm" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - PAGE))}><ChevronLeft className="h-4 w-4" /> Previous</Button>
            <span className="text-sm text-faint">Page {Math.floor(offset / PAGE) + 1} of {Math.ceil(data.total / PAGE)}</span>
            <Button size="sm" disabled={end >= data.total} onClick={() => onPage(offset + PAGE)}>Next <ChevronRight className="h-4 w-4" /></Button>
          </nav>
        )}
      </section>
    </div>
  );
}

/** The paragraph in its context, without leaving the results. "Open in reader" morphs into the full judgment. */
function PeekPanel({ peek, onClose, setPara }: { peek: Peek; onClose: () => void; setPara: (n: number) => void }) {
  const j = useQuery(judgmentQuery(peek.jid));
  const ref = useRef<HTMLDivElement>(null);
  const paras = j.data?.paragraphs.filter((p) => p.no !== 0) ?? [];
  const idx = paras.findIndex((p) => p.no === peek.para);
  const window_ = idx < 0 ? paras.slice(0, 5) : paras.slice(Math.max(0, idx - 2), idx + 3);
  useEffect(() => { ref.current?.querySelector("[data-target]")?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [peek.para, j.data]);

  return (
    <motion.aside {...sheetIn} aria-label={`Preview of ${peek.title}`}>
      <div data-morph className="glass-4 sticky top-24 flex max-h-[calc(100vh-7.5rem)] flex-col overflow-hidden rounded-2xl">
        <header className="relative z-[3] flex items-start gap-2 border-b border-rule p-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-cyan">{j.data?.court ?? " "}</p>
            <h2 className="font-editorial mt-0.5 text-lg leading-snug">{peek.title}</h2>
            {j.data?.citations[0] && <p className="mt-1 text-sm text-muted">{j.data.citations[0]}</p>}
          </div>
          <button onClick={onClose} aria-label="Close preview" className="rounded-lg p-1.5 text-muted hover:bg-vellum hover:text-text"><X className="h-4 w-4" /></button>
        </header>
        <div ref={ref} className="relative z-[3] flex-1 overflow-y-auto scrollbar-thin p-4">
          {j.isLoading && <div className="space-y-3"><Skeleton className="h-4" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-4/6" /></div>}
          {j.isError && <ErrorNote error={j.error} />}
          <ol className="prose-judgment space-y-4 text-[15px]">
            {window_.map((p) => (
              <li key={p.no} data-target={p.no === peek.para ? "" : undefined}
                className={cn("relative rounded-lg py-1 pl-10 pr-2", p.no === peek.para ? "bg-brass-soft shadow-[inset_2px_0_0_var(--brass)] text-text" : "text-muted")}>
                <button onClick={() => setPara(p.no)} className="tnum absolute left-1 top-1.5 w-7 text-right text-xs text-faint hover:text-brass" aria-label={`Focus paragraph ${p.no}`}>{p.no}</button>
                {p.text}
              </li>
            ))}
          </ol>
        </div>
        <footer className="relative z-[3] flex items-center justify-between gap-2 border-t border-rule p-3">
          <span className="text-xs text-faint">{j.data ? `${j.data.n_paras} paragraphs` : ""}</span>
          <MorphLink href={readerHref(peek.jid, peek.para)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-brass px-3.5 text-base font-semibold text-on-brass hover:brightness-105">
            <Maximize2 className="h-4 w-4" />Open in reader
          </MorphLink>
        </footer>
      </div>
    </motion.aside>
  );
}

function AnswerText({ text, onRef }: { text: string; onRef: (sid: number) => void }) {
  const parts = text.split(/(\[S\d+\])/g);
  return (
    <div className="whitespace-pre-line border-l-2 border-cyan/40 pl-4 text-md leading-8 text-text">
      {parts.map((p, i) => {
        const m = p.match(/^\[S(\d+)\]$/);
        return m ? (
          <button key={i} onClick={() => onRef(Number(m[1]))} aria-label={`Source ${m[1]}`}
            className="mx-0.5 inline-flex h-5 min-w-5 -translate-y-0.5 items-center justify-center rounded-md border border-brass/40 bg-brass-soft px-1 font-sans text-[11px] font-semibold text-brass hover:bg-brass hover:text-on-brass">{m[1]}</button>
        ) : <span key={i}>{p}</span>;
      })}
    </div>
  );
}

function AskResult({ data, loading, error }: { data?: AskOut; loading: boolean; error: unknown }) {
  const qc = useQueryClient();
  const [active, setActive] = useState<number | null>(null);
  const refs = useRef<Record<number, HTMLLIElement | null>>({});
  if (error) return <ErrorNote error={error} />;
  if (loading) return (
    <Panel level={4} className="p-6" aria-busy="true">
      <div className="relative z-[3] flex items-center gap-3 text-cyan"><Sparkles className="h-4 w-4 animate-pulse" /><span className="text-base">Finding paragraphs and writing a cited answer. On a laptop without a graphics card this can take a minute.</span></div>
      <div className="relative z-[3] mt-4 h-1 overflow-hidden rounded-full bg-vellum"><div className="h-full w-1/3 bg-gradient-to-r from-transparent via-cyan to-transparent animate-[scan_1.6s_linear_infinite]" /></div>
    </Panel>
  );
  if (!data) return null;
  const jump = (sid: number) => { setActive(sid); refs.current[sid]?.scrollIntoView({ behavior: "smooth", block: "center" }); };
  const conf = data.confidence;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <Panel level={4} className="self-start p-6 lg:sticky lg:top-24">
        <div className="relative z-[3]">
          {data.mode === "answer" && data.answer ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge tone="cyan"><Sparkles className="h-3 w-3" />AI answer, not verified</Badge>
                {conf && <Badge tone={conf === "high" ? "leaf" : conf === "medium" ? "amber" : "tape"} title="The model's own estimate. It is not a check of the law: read the cited paragraphs.">Model's own confidence: {conf}</Badge>}
                {data.cached && <Badge>Saved answer</Badge>}
              </div>
              <AnswerText text={data.answer} onRef={jump} />
              {!!data.checks?.uncited_sentences.length && (
                <div className="mt-4 rounded-lg border border-amber/30 bg-amber-soft p-3 text-sm text-amber">
                  <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />{plural(data.checks.uncited_sentences.length, "sentence")} without a source</p>
                  <p className="mt-1 text-amber/90">Do not rely on these unless you find authority for them.</p>
                </div>
              )}
              {!!data.checks?.invalid_markers_removed.length && <p className="mt-2 text-sm text-tape">Removed {plural(data.checks.invalid_markers_removed.length, "reference")} that did not match a retrieved paragraph.</p>}
              {data.limitations && <p className="mt-3 text-sm text-faint">Limits: {data.limitations}</p>}
              <p className="mt-4 border-t border-rule pt-3 text-xs text-faint">Generated by your local AI from the paragraphs listed beside it. Read the paragraphs before you rely on the answer.</p>
            </>
          ) : (
            <div className="space-y-2">
              <Badge tone={data.mode === "no_sources" ? "neutral" : "amber"}>{data.mode === "no_sources" ? "Nothing found" : "No written answer"}</Badge>
              <p className="text-base text-muted">{data.message}</p>
              {data.mode === "retrieval_only" && <Link href="/intelligence" className="text-sm text-brass hover:underline">Check the local AI in Intelligence</Link>}
            </div>
          )}
        </div>
      </Panel>
      <section aria-label="Sources">
        <h2 className="mb-3 flex items-center gap-1.5 text-md font-medium">Sources<InfoTip k="Sources" /> <span className="text-sm font-normal text-faint">{plural(data.sources.length, "paragraph")}</span></h2>
        <ol className="space-y-3">
          {data.sources.map((s) => (
            <li key={s.sid} ref={(el) => { refs.current[s.sid] = el; }}>
              <Panel as="article" data-morph className={cn("p-4 transition-shadow", active === s.sid && "glow-brass", s.treatment === "negative" && "shadow-[inset_3px_0_0_var(--tape)]")}>
                <div className="relative z-[3] flex items-start gap-3">
                  <span className="grid h-6 min-w-6 place-items-center rounded-md border border-brass/40 bg-brass-soft px-1 text-xs font-semibold text-brass">{s.sid}</span>
                  <div className="min-w-0 flex-1">
                    <MorphLink href={readerHref(s.jid, s.para_no)} prepare={() => qc.prefetchQuery(judgmentQuery(s.jid))} className="font-medium hover:text-brass">{s.title}</MorphLink>
                    <p className="text-sm text-muted">{[s.citation, s.court, fmtDate(s.decision_date), `para ${s.para_no}`].filter(Boolean).join(", ")}</p>
                    <div className="mt-1"><TreatmentWord value={s.treatment} /></div>
                    <p className="prose-judgment mt-2 line-clamp-6 text-base text-muted">{s.text}</p>
                    <MorphLink href={readerHref(s.jid, s.para_no)} prepare={() => qc.prefetchQuery(judgmentQuery(s.jid))} className="mt-2 inline-flex items-center gap-1 text-sm text-brass hover:underline"><BookOpen className="h-3.5 w-3.5" />Read in context</MorphLink>
                  </div>
                </div>
              </Panel>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function ResearchPage() {
  return <Suspense fallback={<Spinner />}><ResearchInner /></Suspense>;
}
