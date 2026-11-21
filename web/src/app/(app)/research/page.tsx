"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { AlertTriangle, BookOpen, ChevronLeft, ChevronRight, Library, Search, Sparkles } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { AskSource, Corpus, SearchResponse } from "@/lib/types";
import { fmtDate, plural } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Badge, Empty, ErrorNote, PageHeader, Panel, Spinner } from "@/components/ui/misc";
import { Marked } from "@/components/research/marked";
import { TreatmentBadges, TreatmentWord } from "@/components/research/treatment";
import { cn } from "@/lib/utils";

type Mode = "search" | "ask";
const PAGE = 10;

interface AskOut {
  question: string; mode: string; answer: string | null; sources: AskSource[]; message?: string; cached?: boolean;
  confidence?: "high" | "medium" | "low"; limitations?: string;
  checks?: { invalid_markers_removed: number[]; uncited_sentences: string[]; cited_sources: number[] };
}

const readerHref = (jid: string, para?: number) => `/judgments/${encodeURIComponent(jid)}${para !== undefined ? `?para=${para}` : ""}`;

function ResearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initialAsk = params.get("ask");
  const [mode, setMode] = useState<Mode>(initialAsk ? "ask" : "search");
  const [text, setText] = useState(initialAsk ?? params.get("q") ?? "");
  const [court, setCourt] = useState(params.get("court") ?? "");
  const [yFrom, setYFrom] = useState(params.get("from") ?? "");
  const [yTo, setYTo] = useState(params.get("to") ?? "");
  const q = params.get("q") ?? "";
  const offset = Number(params.get("offset") ?? 0);

  const stats = useQuery({ queryKey: ["research-stats"], queryFn: () => api.get<Corpus>("/research/stats") });
  const search = useQuery({
    queryKey: ["search", q, params.get("court"), params.get("from"), params.get("to"), offset],
    enabled: mode === "search" && q.length >= 2,
    queryFn: () => api.get<SearchResponse>(`/research/search${qs({ q, court: params.get("court"), year_from: params.get("from"), year_to: params.get("to"), limit: PAGE, offset })}`),
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (mode === "search") {
      if (t.length < 2) return;
      router.push(`/research${qs({ q: t, court, from: yFrom, to: yTo })}`);
    } else {
      if (t.length < 5) return;
      ask.mutate(t);
    }
  }

  const empty = stats.data && stats.data.judgments === 0;
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const min = stats.data?.year_min ?? 1950;
    const max = stats.data?.year_max ?? now;
    return Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => max - i);
  }, [stats.data]);

  return (
    <div className="space-y-6">
      <PageHeader title="Research" sub={stats.data && stats.data.judgments > 0
        ? `${plural(stats.data.real_judgments || stats.data.judgments, "judgment")} · ${plural(stats.data.paragraphs, "paragraph")} searchable to the paragraph`
        : "Search judgments to the paragraph, or ask a question and get an answer that cites them."} />

      {empty && (
        <Panel className="p-2">
          <Empty icon={Library} title="No judgments loaded yet" action={<Link href="/library"><Button variant="primary">Load real judgments</Button></Link>}>
            Research works on the judgments in your library. Load Supreme Court or High Court judgments from the open datasets, or upload your own.
          </Empty>
        </Panel>
      )}

      <Panel className="p-4">
        <form onSubmit={submit} className="space-y-3">
          <div role="tablist" aria-label="Research mode" className="inline-flex rounded-md border border-rule bg-vellum p-0.5">
            {([["search", "Search judgments", Search], ["ask", "Ask AI", Sparkles]] as const).map(([v, label, Icon]) => (
              <button key={v} type="button" role="tab" aria-selected={mode === v} onClick={() => setMode(v)}
                className={cn("inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors",
                  mode === v ? (v === "ask" ? "bg-cyan-soft text-cyan" : "bg-brass-soft text-brass") : "text-muted hover:text-text")}>
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              {mode === "search" ? <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" /> : <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan" />}
              <Input value={text} onChange={(e) => setText(e.target.value)} className="h-11 pl-9 text-md" aria-label={mode === "search" ? "Search words" : "Your question"}
                placeholder={mode === "search" ? "cheque dishonour notice thirty days" : "When must the demand notice be sent after a cheque bounces?"} />
            </div>
            <Button type="submit" variant="primary" size="lg" loading={ask.isPending} disabled={mode === "search" ? text.trim().length < 2 : text.trim().length < 5}>
              {mode === "search" ? "Search" : "Ask"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Select value={court} onChange={(e) => setCourt(e.target.value)} className="h-8 w-auto min-w-[200px] text-sm" aria-label="Court">
              <option value="">All courts</option>
              {stats.data?.courts.map((c) => <option key={c.court} value={c.court}>{c.court} ({c.count.toLocaleString("en-IN")})</option>)}
            </Select>
            <Select value={yFrom} onChange={(e) => setYFrom(e.target.value)} className="h-8 w-auto text-sm" aria-label="From year">
              <option value="">From any year</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            <Select value={yTo} onChange={(e) => setYTo(e.target.value)} className="h-8 w-auto text-sm" aria-label="To year">
              <option value="">To any year</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            {mode === "search" && <span className="text-faint">Legal synonyms are matched: bounce, dishonour and returned unpaid find each other.</span>}
            {mode === "ask" && <span className="text-faint">Answers use only paragraphs from your library, and every reference is checked.</span>}
          </div>
        </form>
      </Panel>

      {mode === "search" && <SearchResults q={q} offset={offset} data={search.data} loading={search.isFetching} error={search.error} onPage={(o) => router.push(`/research${qs({ q, court: params.get("court"), from: params.get("from"), to: params.get("to"), offset: o || undefined })}`)} />}
      {mode === "ask" && <AskResult data={ask.data} loading={ask.isPending} error={ask.error} />}
    </div>
  );
}

function SearchResults({ q, offset, data, loading, error, onPage }: { q: string; offset: number; data?: SearchResponse; loading: boolean; error: unknown; onPage: (o: number) => void }) {
  if (!q) return null;
  if (error) return <ErrorNote error={error} />;
  if (loading && !data) return <Spinner label="Searching" />;
  if (!data) return null;
  if (data.total === 0) return (
    <Panel><Empty icon={Search} title={`No paragraphs matched “${data.query}”`}>Try fewer or different words, remove the court or year filter, or ask the question in Ask AI.</Empty></Panel>
  );
  const end = Math.min(data.total, offset + data.results.length);
  return (
    <section aria-label="Search results" className="space-y-3">
      <p className="text-sm text-muted">{data.total.toLocaleString("en-IN")} judgments · showing {offset + 1}–{end}{data.match === "or" && " · no judgment had every word, so these match some of them"}</p>
      <ol className="space-y-3">
        {data.results.map((r, i) => (
          <motion.li key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
            <Panel as="article" className={cn("p-4 transition-colors hover:border-brass/40", r.treatment.negative && "border-tape/40")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={readerHref(r.id, r.hits[0]?.no)} className="font-display text-md font-medium hover:text-brass">{r.title}</Link>
                  <p className="mt-0.5 text-sm text-muted">{[r.citation, r.court, r.decision_date ? fmtDate(r.decision_date) : r.year].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex flex-wrap gap-1.5"><TreatmentBadges t={r.treatment} /></div>
              </div>
              <ul className="mt-3 space-y-2">
                {r.hits.map((h) => (
                  <li key={h.no}>
                    <Link href={readerHref(r.id, h.no)} className="group flex gap-3 rounded-md px-2 py-1.5 -mx-2 hover:bg-vellum">
                      <span className="w-10 shrink-0 pt-0.5 text-right font-display text-sm text-brass tabular-nums">¶ {h.no}</span>
                      <Marked html={h.snippet} className="prose-judgment text-base text-muted group-hover:text-text" />
                    </Link>
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
  );
}

function AnswerText({ text, onRef }: { text: string; onRef: (sid: number) => void }) {
  const parts = text.split(/(\[S\d+\])/g);
  return (
    <div className="prose-judgment whitespace-pre-line text-md leading-8">
      {parts.map((p, i) => {
        const m = p.match(/^\[S(\d+)\]$/);
        return m ? (
          <button key={i} onClick={() => onRef(Number(m[1]))} aria-label={`Source ${m[1]}`}
            className="mx-0.5 inline-flex h-5 min-w-5 -translate-y-0.5 items-center justify-center rounded-sm border border-brass/40 bg-brass-soft px-1 font-sans text-[11px] font-semibold text-brass hover:bg-brass hover:text-[#0a0e18]">{m[1]}</button>
        ) : <span key={i}>{p}</span>;
      })}
    </div>
  );
}

function AskResult({ data, loading, error }: { data?: AskOut; loading: boolean; error: unknown }) {
  const [active, setActive] = useState<number | null>(null);
  const refs = useRef<Record<number, HTMLLIElement | null>>({});
  if (error) return <ErrorNote error={error} />;
  if (loading) return (
    <Panel className="p-6">
      <div className="flex items-center gap-3 text-cyan"><Sparkles className="h-4 w-4 animate-pulse" /><span className="text-base">Finding paragraphs and writing a cited answer. On a laptop without a graphics card this can take a minute.</span></div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-vellum"><div className="h-full w-1/3 bg-gradient-to-r from-transparent via-cyan to-transparent animate-[scan_1.6s_linear_infinite]" /></div>
    </Panel>
  );
  if (!data) return null;
  const jump = (sid: number) => { setActive(sid); refs.current[sid]?.scrollIntoView({ behavior: "smooth", block: "center" }); };
  const conf = data.confidence;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <Panel className="p-5 lg:sticky lg:top-20 self-start">
        {data.mode === "answer" && data.answer ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone="cyan"><Sparkles className="h-3 w-3" />AI answer</Badge>
              {conf && <Badge tone={conf === "high" ? "leaf" : conf === "medium" ? "amber" : "tape"}>Confidence: {conf}</Badge>}
              {data.cached && <Badge>Saved answer</Badge>}
            </div>
            <AnswerText text={data.answer} onRef={jump} />
            {!!data.checks?.uncited_sentences.length && (
              <div className="mt-4 rounded-md border border-amber/30 bg-amber-soft p-3 text-sm text-amber">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />{plural(data.checks.uncited_sentences.length, "sentence")} without a source</p>
                <p className="mt-1 text-amber/90">Do not rely on these unless you find authority for them.</p>
              </div>
            )}
            {!!data.checks?.invalid_markers_removed.length && <p className="mt-2 text-sm text-tape">Removed {plural(data.checks.invalid_markers_removed.length, "reference")} that did not match a retrieved paragraph.</p>}
            {data.limitations && <p className="mt-3 text-sm text-faint">Limits: {data.limitations}</p>}
            <p className="mt-4 border-t border-rule pt-3 text-xs text-faint">Generated by your local AI from the paragraphs on the right. Read the paragraphs before you rely on the answer.</p>
          </>
        ) : (
          <div className="space-y-2">
            <Badge tone={data.mode === "no_sources" ? "neutral" : "amber"}>{data.mode === "no_sources" ? "Nothing found" : "No written answer"}</Badge>
            <p className="text-base text-muted">{data.message}</p>
            {data.mode === "retrieval_only" && <Link href="/settings#ai" className="text-sm text-brass hover:underline">Check AI status in Settings</Link>}
          </div>
        )}
      </Panel>
      <section aria-label="Sources">
        <h2 className="mb-3 font-display text-md font-medium">Sources <span className="text-faint font-sans text-sm">· {data.sources.length} paragraphs</span></h2>
        <ol className="space-y-3">
          {data.sources.map((s) => (
            <li key={s.sid} ref={(el) => { refs.current[s.sid] = el; }}>
              <Panel as="article" className={cn("p-4 transition-shadow", active === s.sid && "glow-brass", s.treatment === "negative" && "border-tape/40")}>
                <div className="flex items-start gap-3">
                  <span className="grid h-6 min-w-6 place-items-center rounded-sm border border-brass/40 bg-brass-soft px-1 text-xs font-semibold text-brass">{s.sid}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={readerHref(s.jid, s.para_no)} className="font-medium hover:text-brass">{s.title}</Link>
                    <p className="text-sm text-muted">{[s.citation, s.court, fmtDate(s.decision_date), `para ${s.para_no}`].filter(Boolean).join(" · ")}</p>
                    <div className="mt-1"><TreatmentWord value={s.treatment} /></div>
                    <p className="prose-judgment mt-2 text-base text-muted line-clamp-6">{s.text}</p>
                    <Link href={readerHref(s.jid, s.para_no)} className="mt-2 inline-flex items-center gap-1 text-sm text-brass hover:underline"><BookOpen className="h-3.5 w-3.5" />Read in context</Link>
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
