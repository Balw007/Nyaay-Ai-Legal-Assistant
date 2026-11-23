"use client";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ScrollText } from "lucide-react";
import { isActive, useStartAgent, useTask } from "@/lib/agents";
import { AgentProgress } from "@/components/agents/agent-row";
import { AlertTriangle, ArrowLeft, Bookmark, ChevronDown, ChevronUp, Copy, ExternalLink, Network, PanelRightClose, PanelRightOpen, Search, Sparkles, Type, X } from "lucide-react";
import { api } from "@/lib/api";
import type { AskSource, Judgment, Links, Matter } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { pushRecent } from "@/lib/recent";
import { floatIn, sheetIn, spring } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Badge, ErrorNote, Panel, Skeleton, Spinner, Tabs } from "@/components/ui/misc";
import { Highlight, countMatches } from "@/components/research/marked";
import { TreatmentBadges } from "@/components/research/treatment";
import { CitationGraph } from "@/components/visuals/citation-graph";
import { GoldBadge, GoldPanel, SectionsPanel } from "@/components/data/judgment-panels";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/info";

interface SummaryOut { mode: string; message?: string; issues?: string[]; held?: string; disposition?: string; key_paragraphs?: number[]; basis?: string }
interface AskOut { mode: string; answer: string | null; message?: string; sources: AskSource[]; confidence?: string; checks?: { uncited_sentences: string[] } }
type PanelTab = "headnote" | "ask" | "network" | "cited";

const SIZES = ["text-[15px]", "text-[17px]", "text-[19.5px]"];

function readSize() { try { return Math.min(2, Math.max(0, Number(localStorage.getItem("nyaay-reader-size") ?? 1))); } catch { return 1; } }

export default function JudgmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = use(params);
  return <Suspense fallback={<ReaderSkeleton />}><Reader id={decodeURIComponent(raw)} /></Suspense>;
}

function ReaderSkeleton() {
  return (
    <div className="mx-auto max-w-[74ch] space-y-4 pt-8" aria-busy="true">
      <Spinner label="Opening judgment" />
      <Skeleton className="h-3 w-40" /><Skeleton className="h-8 w-4/5" /><Skeleton className="h-3 w-2/3" />
      <div className="space-y-3 pt-6">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4" />)}</div>
    </div>
  );
}

function Reader({ id }: { id: string }) {
  const search = useSearchParams();
  const target = search.get("para") !== null ? Number(search.get("para")) : null;

  const j = useQuery({ queryKey: ["judgment", id], queryFn: () => api.get<Judgment>(`/judgments/${encodeURIComponent(id)}`) });
  const links = useQuery({ queryKey: ["links", id], queryFn: () => api.get<Links>(`/judgments/${encodeURIComponent(id)}/links`) });

  const [size, setSize] = useState(1);
  useEffect(() => setSize(readSize()), []);
  useEffect(() => { try { localStorage.setItem("nyaay-reader-size", String(size)); } catch {} }, [size]);

  const [rail, setRail] = useState(true);
  const [tab, setTab] = useState<PanelTab>("headnote");
  const [askPrefill, setAskPrefill] = useState<{ text: string; n: number } | null>(null);
  const [headnoteGo, setHeadnoteGo] = useState(0);
  const [selected, setSelected] = useState<number | null>(target);
  const [find, setFind] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [hit, setHit] = useState(0);
  const [current, setCurrent] = useState<number | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const articleRef = useRef<HTMLElement>(null);

  const paras = useMemo(() => j.data?.paragraphs ?? [], [j.data]);
  const preamble = paras.find((p) => p.no === 0);
  const body = useMemo(() => paras.filter((p) => p.no !== 0), [paras]);
  const cite = j.data?.citations?.[0] ?? "";

  useEffect(() => {
    if (j.data) pushRecent({ kind: "judgment", id: j.data.id, title: j.data.title, sub: j.data.court });
  }, [j.data]);

  const { offsets, total, hitParas } = useMemo(() => {
    const offsets: number[] = [];
    const hitParas = new Set<number>();
    let t = 0;
    for (const p of paras) { offsets.push(t); const n = countMatches(p.text, find); if (n) hitParas.add(p.no); t += n; }
    return { offsets, total: t, hitParas };
  }, [paras, find]);
  useEffect(() => setHit(0), [find]);
  useEffect(() => {
    if (!total) return;
    document.querySelector(`[data-find="${hit}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [hit, total]);

  const jumpTo = useCallback((n: number) => {
    setSelected(n);
    document.getElementById(`para-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Jump to ?para=N once the text is on screen.
  useEffect(() => {
    if (target === null || !j.data) return;
    const t = setTimeout(() => document.getElementById(`para-${target}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    return () => clearTimeout(t);
  }, [target, j.data]);

  // Reading position for the minimap: the paragraph nearest the upper third of the screen.
  useEffect(() => {
    if (!body.length) return;
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.no));
      if (vis.length) setCurrent(Math.min(...vis));
    }, { rootMargin: "-25% 0px -60% 0px" });
    body.forEach((p) => { const el = document.getElementById(`para-${p.no}`); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [body]);

  const openFind = useCallback(() => { setFindOpen(true); setTimeout(() => findRef.current?.select(), 0); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); openFind(); }
      if (e.key === "Escape") { setFindOpen(false); setFind(""); }
    };
    const onCmd = (e: Event) => {
      const what = (e as CustomEvent<string>).detail;
      if (what === "find") openFind();
      if (what === "ask") { setRail(true); setTab("ask"); setTimeout(() => document.getElementById("ask-this")?.focus(), 80); }
      if (what === "headnote") { setRail(true); setTab("headnote"); setHeadnoteGo((n) => n + 1); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("nyaay:reader", onCmd);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("nyaay:reader", onCmd); };
  }, [openFind]);

  const copyText = useCallback((text: string, no: number) => {
    if (!j.data) return;
    const ref = [j.data.title, cite, `para ${no}`].filter(Boolean).join(", ");
    navigator.clipboard.writeText(`“${text}”\n— ${ref}`).then(() => toast.success("Copied with citation"), () => toast.error("Could not copy. Select the text instead."));
  }, [j.data, cite]);

  if (j.isLoading) return <ReaderSkeleton />;
  if (j.isError) return <div className="space-y-4"><BackLink /><ErrorNote error={j.error} /></div>;
  const J = j.data!;
  const negative = (links.data?.treatment.negative ?? 0) > 0;
  const citedBy = links.data?.cited_by.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <BackLink />
        <div className="glass-3 flex items-center gap-1 rounded-xl p-1">
          <Button size="sm" variant="ghost" className="relative z-[3]" onClick={() => (findOpen ? setFindOpen(false) : openFind())} aria-pressed={findOpen} title="Find in judgment (Ctrl+F)"><Search className="h-4 w-4" /> Find</Button>
          <div className="relative z-[3] flex items-center rounded-lg" role="group" aria-label="Text size">
            {[0, 1, 2].map((s) => (
              <button key={s} onClick={() => setSize(s)} aria-pressed={size === s} aria-label={["Small", "Medium", "Large"][s] + " text"}
                className={cn("relative rounded-md px-2 py-1 text-muted hover:text-text", size === s && "text-brass")}>
                {size === s && <motion.span layoutId="size-on" transition={spring.snappy} className="absolute inset-0 rounded-md bg-brass-soft" />}
                <Type className={cn("relative", ["h-3 w-3", "h-3.5 w-3.5", "h-4 w-4"][s])} />
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setRail((v) => !v)} aria-pressed={rail} className="relative z-[3] hidden xl:inline-flex" title={rail ? "Hide the intelligence panel" : "Show the intelligence panel"}>
            {rail ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {findOpen && (
          <motion.div {...floatIn} className="sticky top-24 z-20 mx-auto max-w-xl">
            <Panel level={4} className="flex items-center gap-2 rounded-2xl p-2">
              <Search className="relative z-[3] ml-1 h-4 w-4 text-faint" />
              <Input ref={findRef} value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find in this judgment" className="relative z-[3] h-8 border-0 bg-transparent shadow-none focus:ring-0"
                onKeyDown={(e) => { if (e.key === "Enter" && total) { e.preventDefault(); setHit((h) => (e.shiftKey ? (h - 1 + total) % total : (h + 1) % total)); } }} aria-label="Find in this judgment" />
              <span className="relative z-[3] whitespace-nowrap text-sm text-muted tabular-nums" aria-live="polite">{find.length >= 2 ? (total ? `${hit + 1} of ${total}` : "No matches") : ""}</span>
              <Button size="icon" variant="ghost" className="relative z-[3]" disabled={!total} onClick={() => setHit((h) => (h - 1 + total) % total)} aria-label="Previous match"><ChevronUp className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="relative z-[3]" disabled={!total} onClick={() => setHit((h) => (h + 1) % total)} aria-label="Next match"><ChevronDown className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="relative z-[3]" onClick={() => { setFindOpen(false); setFind(""); }} aria-label="Close find"><X className="h-4 w-4" /></Button>
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn("grid gap-6", rail ? "xl:grid-cols-[230px_minmax(0,1fr)_360px]" : "xl:grid-cols-[230px_minmax(0,1fr)]")}>
        <Navigator paras={body} current={current} target={target} selected={selected} hits={hitParas} onJump={jumpTo}
          onSummary={() => { setRail(true); setTab("headnote"); }} onDetails={() => window.scrollTo({ top: 0, behavior: "smooth" })} />

        <article ref={articleRef} className="paper-page light min-w-0" aria-label={J.title}>
          <header className="vt-hero mx-auto max-w-[74ch] border-b border-rule pb-6">
            <p className="text-sm text-cyan">{J.court}</p>
            <h1 className="font-editorial mt-2 text-[2rem] leading-[1.15] md:text-[2.35rem]">{J.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
              {J.decision_date && <span>Decided {fmtDate(J.decision_date, { day: "numeric", month: "long", year: "numeric" })}</span>}
              {J.bench && <span>{J.bench}</span>}
              {J.disposal && <span>{J.disposal}</span>}
              <span>{J.n_paras} paragraphs</span>
            </div>
            {J.citations.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">{J.citations.map((c) => <Badge key={c} tone="brass">{c}</Badge>)}</div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <TreatmentBadges t={links.data?.treatment} />
              <GoldBadge jid={J.id} />
              {J.source_url && <a href={J.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brass hover:underline"><ExternalLink className="h-3.5 w-3.5" />Original PDF</a>}
              {J.source === "fixture" && <Badge tone="amber" className="border-dashed">Fictional test judgment, not law</Badge>}
              <Link href={`/graph?focus=${encodeURIComponent(J.id)}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-brass"><Network className="h-3.5 w-3.5" />Show on the authority map</Link>
            </div>
            {negative && (
              <p className="mt-4 flex gap-2 rounded-lg border border-tape/40 bg-tape-soft p-3 text-sm text-tape">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                A later judgment in your library may have overruled or disapproved this case. Read the citing paragraphs in the Cited by tab before relying on it.
              </p>
            )}
          </header>

          {preamble && <p className="prose-judgment mx-auto mt-6 max-w-[74ch] whitespace-pre-line text-sm text-faint">{preamble.text}</p>}

          <ol className={cn("prose-judgment mx-auto mt-6 max-w-[74ch] space-y-5 pl-12", SIZES[size])}>
            {body.map((p) => {
              const idx = paras.indexOf(p);
              const on = selected === p.no;
              const targeted = target === p.no;
              return (
                <li key={p.no} id={`para-${p.no}`} data-no={p.no} className="group relative scroll-mt-28">
                  <button onClick={() => setSelected(on ? null : p.no)} aria-expanded={on} aria-label={`Paragraph ${p.no} actions`}
                    className={cn("tnum absolute -left-12 top-0.5 w-9 text-right text-[13px] transition-colors",
                      on || targeted ? "font-semibold text-brass" : "text-faint group-hover:text-muted")}>
                    {p.no}
                  </button>
                  <p className={cn("-mx-3 rounded-lg px-3 py-1 transition-colors duration-300",
                    targeted && "bg-brass-soft shadow-[inset_2px_0_0_var(--brass)]", on && !targeted && "bg-vellum")}>
                    <Highlight text={p.text} term={find} activeIndex={hit} offset={offsets[idx]} />
                  </p>
                  <AnimatePresence>
                    {on && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth} className="overflow-hidden font-sans">
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => copyText(p.text, p.no)}><Copy className="h-3.5 w-3.5" />Copy with citation</Button>
                          <Button size="sm" variant="ai" onClick={() => { setRail(true); setTab("ask"); setAskPrefill({ text: `Explain paragraph ${p.no} in plain words and how the court applies it.`, n: Date.now() }); }}>
                            <Sparkles className="h-3.5 w-3.5" />Ask about this paragraph
                          </Button>
                          <SaveToMatter jid={J.id} para={p.no} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ol>
          {body.length === 0 && <p className="mx-auto mt-8 max-w-[74ch] text-muted">This judgment has no readable text. It may be a scanned PDF; open the original.</p>}
          <div className="sticky bottom-4 z-10 mx-auto mt-10 flex w-fit items-center gap-3 rounded-full border border-rule bg-[color-mix(in_srgb,var(--surface-solid)_92%,transparent)] px-4 py-1.5 text-xs text-muted shadow-[0_10px_30px_-12px_rgba(0,0,0,.35)] backdrop-blur">
            <button onClick={openFind} className="inline-flex items-center gap-1.5 hover:text-text"><Search className="h-3.5 w-3.5" />Find in judgment</button>
            <span className="h-3 w-px bg-rule" />
            <span className="tnum" aria-live="off">¶ {current ?? body[0]?.no ?? 0} of {body.length ? body[body.length - 1].no : 0}</span>
          </div>
          <SelectionToolbar container={articleRef}
            onCopy={(t, n) => copyText(t, n)}
            onAsk={(t, n) => { setRail(true); setTab("ask"); setAskPrefill({ text: `What does the court mean here (paragraph ${n}): “${t.slice(0, 400)}”?`, n: Date.now() }); }}
            onSave={(n) => jumpTo(n)} />
        </article>

        <AnimatePresence initial={false}>
          {rail && (
            <motion.aside key="panel" {...sheetIn} className="min-w-0" aria-label="Intelligence panel">
              <div className="glass-3 flex flex-col overflow-hidden rounded-2xl xl:sticky xl:top-24 xl:max-h-[calc(100vh-7.5rem)]">
                <Tabs<PanelTab> value={tab} onChange={setTab} className="relative z-[3] px-2 pt-1"
                  items={[
                    { value: "headnote", label: "Headnote" },
                    { value: "ask", label: "Ask" },
                    { value: "network", label: "Network" },
                    { value: "cited", label: <>Cited by{citedBy ? <span className="tnum ml-1 text-xs text-faint">{citedBy}</span> : null}</> },
                  ]} />
                <div className="relative z-[3] flex-1 overflow-y-auto scrollbar-thin p-4">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
                      {tab === "headnote" && (
                        <div className="space-y-4">
                          {/* An advocate-verified headnote comes first; the AI draft follows it. */}
                          <GoldPanel jid={J.id} onJump={jumpTo} />
                          <SectionsPanel jid={J.id} />
                          <Headnote id={J.id} onJump={jumpTo} go={headnoteGo} />
                        </div>
                      )}
                      {tab === "ask" && <AskThis id={J.id} onJump={jumpTo} prefill={askPrefill} />}
                      {tab === "network" && (links.isLoading ? <Spinner /> : links.data ? <CitationGraph links={links.data} title={J.title} /> : <ErrorNote error={links.error} />)}
                      {tab === "cited" && <CitedBy links={links.data} loading={links.isLoading} />}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Document navigator: summary, case details, and every paragraph by its opening words. The paragraph you are
 * reading is lit; the cited paragraph is gold; find matches are cyan. */
function Navigator({ paras, current, target, selected, hits, onJump, onSummary, onDetails }:
  { paras: { no: number; text: string }[]; current: number | null; target: number | null; selected: number | null; hits: Set<number>; onJump: (n: number) => void; onSummary: () => void; onDetails: () => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(`[data-nav="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);
  const item = "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-muted hover:bg-vellum hover:text-text";
  return (
    <nav aria-label="Document navigator" className="hidden xl:block">
      <div className="glass-3 sticky top-24 flex max-h-[calc(100vh-7.5rem)] flex-col overflow-hidden rounded-2xl">
        <p className="relative z-[3] flex items-center gap-1.5 px-4 pb-2 pt-3.5 text-sm font-medium">Document navigator<InfoTip k="Judgment" title="Reading a judgment" /></p>
        <div className="relative z-[3] space-y-0.5 px-1.5">
          <button onClick={onSummary} className={item}><Sparkles className="h-3.5 w-3.5 text-cyan" />Judgment summary</button>
          <button onClick={onDetails} className={item}><ScrollText className="h-3.5 w-3.5" />Case details</button>
        </div>
        <p className="relative z-[3] px-4 pb-1 pt-3 text-xs text-faint">Paragraphs</p>
        <ol ref={listRef} className="relative z-[3] flex-1 space-y-0.5 overflow-y-auto scrollbar-thin px-1.5 pb-3">
          {paras.map((p) => {
            const on = p.no === current;
            const gold = p.no === target || p.no === selected;
            return (
              <li key={p.no}>
                <button data-nav={p.no} onClick={() => onJump(p.no)} aria-current={on ? "location" : undefined}
                  className={cn("relative flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                    on ? "glass-5 text-text" : "text-muted hover:bg-vellum hover:text-text")}>
                  <span className={cn("tnum relative w-6 shrink-0 text-right", gold ? "font-semibold text-brass" : hits.has(p.no) ? "text-cyan" : "text-faint")}>{p.no}</span>
                  <span className="relative line-clamp-1">{p.text.split(/\s+/).slice(0, 8).join(" ")}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

/** Select text in the judgment and a small toolbar appears above it. */
function SelectionToolbar({ container, onCopy, onAsk, onSave }:
  { container: React.RefObject<HTMLElement | null>; onCopy: (t: string, n: number) => void; onAsk: (t: string, n: number) => void; onSave: (n: number) => void }) {
  const [sel, setSel] = useState<{ text: string; no: number; x: number; y: number } | null>(null);
  useEffect(() => {
    const read = () => {
      const s = window.getSelection();
      const text = s?.toString().trim() ?? "";
      if (!s || s.rangeCount === 0 || text.length < 3 || !container.current?.contains(s.anchorNode)) { setSel(null); return; }
      const li = (s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement)?.closest("li[data-no]") as HTMLElement | null;
      if (!li) { setSel(null); return; }
      const r = s.getRangeAt(0).getBoundingClientRect();
      setSel({ text, no: Number(li.dataset.no), x: r.left + r.width / 2, y: r.top });
    };
    const up = () => setTimeout(read, 0);
    const clear = () => setSel(null);
    document.addEventListener("mouseup", up);
    document.addEventListener("keyup", up);
    window.addEventListener("scroll", clear, { passive: true });
    return () => { document.removeEventListener("mouseup", up); document.removeEventListener("keyup", up); window.removeEventListener("scroll", clear); };
  }, [container]);
  const words = sel?.text.split(/\s+/).filter((w) => w.length > 3).slice(0, 8).join(" ") ?? "";
  return createPortal(
    <AnimatePresence>
      {sel && (
        <motion.div role="toolbar" aria-label="Selected text" {...floatIn}
          className="glass-4 fixed z-40 flex items-center gap-0.5 rounded-xl p-1 font-sans"
          style={{ left: Math.min(Math.max(sel.x, 170), window.innerWidth - 170), top: Math.max(sel.y - 52, 72), x: "-50%" }}
          onMouseDown={(e) => e.preventDefault()}>
          <Button size="sm" variant="ghost" className="relative z-[3]" onClick={() => { onCopy(sel.text, sel.no); setSel(null); }}><Copy className="h-3.5 w-3.5" />Copy with citation</Button>
          <Button size="sm" variant="ghost" className="relative z-[3] text-cyan hover:text-cyan" onClick={() => { onAsk(sel.text, sel.no); setSel(null); }}><Sparkles className="h-3.5 w-3.5" />Ask</Button>
          <Link href={`/research?q=${encodeURIComponent(words)}`} className="relative z-[3] inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted hover:bg-vellum hover:text-text"><Search className="h-3.5 w-3.5" />Similar</Link>
          <Button size="sm" variant="ghost" className="relative z-[3]" onClick={() => { onSave(sel.no); setSel(null); }} title="Open this paragraph's actions to save it to a matter"><Bookmark className="h-3.5 w-3.5" />Save ¶ {sel.no}</Button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function CitedBy({ links, loading }: { links?: Links; loading: boolean }) {
  if (loading) return <Spinner />;
  if (!links?.cited_by.length) return <p className="text-sm text-muted">No other judgment in your library cites this one.</p>;
  return (
    <ul className="space-y-3">
      {links.cited_by.slice(0, 30).map((c) => (
        <li key={String(c.id)} className="text-sm">
          <Link href={`/judgments/${encodeURIComponent(String(c.id))}${c.paras?.[0] !== undefined ? `?para=${c.paras[0]}` : ""}`} className="hover:text-brass">{c.title}</Link>
          <p className="text-xs text-faint">{[c.court, c.year].filter(Boolean).join(", ")}{c.paras?.length ? `, para ${c.paras.join(", ")}` : ""}
            {c.treatment && c.treatment !== "cited" && <span className={cn("ml-1", c.treatment === "negative" ? "text-tape" : c.treatment === "caution" ? "text-amber" : "text-leaf")}>({c.treatment === "negative" ? "may overrule" : c.treatment === "caution" ? "distinguishes" : "follows"})</span>}</p>
        </li>
      ))}
    </ul>
  );
}

function BackLink() {
  return <Link href="/research" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"><ArrowLeft className="h-4 w-4" />Research</Link>;
}

function SaveToMatter({ jid, para }: { jid: string; para: number }) {
  const [open, setOpen] = useState(false);
  const [matter, setMatter] = useState("");
  const [note, setNote] = useState("");
  const matters = useQuery({ queryKey: ["matters"], enabled: open, queryFn: () => api.get<Matter[]>("/matters") });
  const save = useMutation({
    mutationFn: () => api.post("/bookmarks", { jid, para_no: para, matter_id: matter ? Number(matter) : null, note }),
    onSuccess: () => { toast.success(`Saved paragraph ${para}`); setOpen(false); setNote(""); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}><Bookmark className="h-3.5 w-3.5" />Save to matter</Button>;
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-rule bg-vellum p-2">
      <Select value={matter} onChange={(e) => setMatter(e.target.value)} className="h-8 w-auto min-w-[220px] text-sm" aria-label="Matter">
        <option value="">No matter (saved authorities)</option>
        {matters.data?.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
      </Select>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-8 min-w-[160px] flex-1 text-sm" />
      <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

/** "Summarise this judgment" runs the Judgment Analysis Agent: it appears under AI Agents with its steps,
 * and the headnote it writes shows here when it finishes. A headnote already written is reused. */
function Headnote({ id, onJump, go }: { id: string; onJump: (n: number) => void; go: number }) {
  const start = useStartAgent();
  const [taskId, setTaskId] = useState<number | null>(null);
  const { data: t } = useTask(taskId);
  const run = () => start.mutate({ agent: "judgment", input: { jid: id } }, { onSuccess: (x) => setTaskId(x.id), onError: (e) => toast.error((e as Error).message) });
  useEffect(() => { if (go > 0 && !taskId) run(); }, [go]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = (t?.status === "done" ? t.result : null) as SummaryOut | null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-3.5 w-3.5 text-cyan" />AI headnote<InfoTip k="AI headnote" /></h2>
        {d && <Badge tone="cyan">Draft, not verified</Badge>}
      </div>
      {!t && (
        <>
          <p className="text-sm text-muted">The Judgment Analysis Agent reads this judgment and drafts the issues, the holding and the key paragraphs. You can follow it under AI Agents.</p>
          <Button size="sm" variant="ai" className="mt-3 w-full justify-center" loading={start.isPending} onClick={run}>Summarise this judgment</Button>
        </>
      )}
      {t && isActive(t) && <div className="space-y-2"><p className="text-xs text-faint">{t.step}</p><AgentProgress t={t} /></div>}
      {t?.status === "failed" && <p className="text-sm text-amber">{t.error}</p>}
      {d && (
        <div className="space-y-3 text-sm">
          {!!d.issues?.length && (<div><p className="text-xs text-faint">Issues</p><ul className="mt-1 list-disc space-y-1 pl-4 text-muted">{d.issues.map((x) => <li key={x}>{x}</li>)}</ul></div>)}
          {d.held && <div><p className="text-xs text-faint">Held</p><p className="mt-1 border-l-2 border-cyan/40 pl-3 leading-6 text-text">{d.held}</p></div>}
          {d.disposition && <div><p className="text-xs text-faint">Result</p><p className="mt-1 text-muted">{d.disposition}</p></div>}
          {!!d.key_paragraphs?.length && (
            <div><p className="text-xs text-faint">Key paragraphs</p><div className="mt-1 flex flex-wrap gap-1">{d.key_paragraphs.map((n) => <button key={n} onClick={() => onJump(n)} className="rounded-md border border-brass/40 bg-brass-soft px-1.5 text-xs text-brass hover:bg-brass hover:text-on-brass">¶ {n}</button>)}</div></div>
          )}
          {d.basis && <p className="border-t border-rule pt-2 text-xs text-faint">{d.basis}</p>}
        </div>
      )}
      {t && <Link href={`/intelligence?task=${t.id}`} className="mt-2 inline-block text-xs text-brass hover:underline">Open in AI Agents</Link>}
    </div>
  );
}

function AskThis({ id, onJump, prefill }: { id: string; onJump: (n: number) => void; prefill: { text: string; n: number } | null }) {
  const [q, setQ] = useState("");
  const m = useMutation({ mutationFn: (question: string) => api.post<AskOut>("/research/ask", { question, jid: id }) });
  useEffect(() => { if (prefill) { setQ(prefill.text); setTimeout(() => document.getElementById("ask-this")?.focus(), 60); } }, [prefill]);
  const d = m.data;
  const paraOf = (sid: number) => d?.sources.find((s) => s.sid === sid)?.para_no;
  return (
    <div>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-3.5 w-3.5 text-cyan" />Ask this judgment<InfoTip k="Ask this judgment" /></h2>
      <p className="mb-2 text-xs text-faint">Answered by your local AI from this judgment's paragraphs only.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 5) m.mutate(q.trim()); }} className="space-y-2">
        <Textarea id="ask-this" rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="What did the court hold on limitation?" className="text-sm" aria-label="Question about this judgment" />
        <Button size="sm" variant="ai" type="submit" loading={m.isPending} disabled={q.trim().length < 5}>Ask</Button>
      </form>
      {m.isError && <ErrorNote error={m.error} className="mt-2" />}
      {d && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 border-t border-rule pt-3 text-sm">
          {d.mode === "answer" && d.answer ? (
            <>
              <Badge tone="cyan" className="mb-2"><Sparkles className="h-3 w-3" />AI answer, not verified</Badge>
              <p className="border-l-2 border-cyan/40 pl-3 leading-7">
                {d.answer.split(/(\[S\d+\])/g).map((part, i) => {
                  const mm = part.match(/^\[S(\d+)\]$/);
                  if (!mm) return <span key={i}>{part}</span>;
                  const para = paraOf(Number(mm[1]));
                  // A reference that maps to no retrieved paragraph is shown as unmatched, never as a paragraph number.
                  return para !== undefined
                    ? <button key={i} onClick={() => onJump(para)} aria-label={`Go to paragraph ${para}`} className="mx-0.5 rounded-md border border-brass/40 bg-brass-soft px-1 text-[11px] font-semibold text-brass hover:bg-brass hover:text-on-brass">¶ {para}</button>
                    : <span key={i} title="This reference did not match a paragraph" className="mx-0.5 rounded-md border border-tape/40 bg-tape-soft px-1 text-[11px] text-tape">unmatched</span>;
                })}
              </p>
              {!!d.checks?.uncited_sentences.length && <p className="mt-2 text-xs text-amber">{d.checks.uncited_sentences.length} sentence(s) have no source. Do not rely on them.</p>}
            </>
          ) : (
            <>
              <p className="text-amber">{d.message}</p>
              {!!d.sources.length && <div className="mt-2 flex flex-wrap gap-1">{d.sources.map((s) => <button key={s.sid} onClick={() => onJump(s.para_no)} className="rounded-md border border-rule px-1.5 text-xs text-muted hover:border-brass/50 hover:text-text">¶ {s.para_no}</button>)}</div>}
            </>
          )}
        </motion.div>
      )}
    </div>
  );
}
