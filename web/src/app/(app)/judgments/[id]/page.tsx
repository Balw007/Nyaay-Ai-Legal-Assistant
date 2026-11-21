"use client";
import Link from "next/link";
import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Bookmark, ChevronDown, ChevronUp, Copy, ExternalLink, PanelRightClose, PanelRightOpen, Search, Sparkles, Type, X } from "lucide-react";
import { api } from "@/lib/api";
import type { AskSource, Judgment, Links, Matter } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Badge, ErrorNote, Panel, Spinner } from "@/components/ui/misc";
import { Highlight, countMatches } from "@/components/research/marked";
import { TreatmentBadges } from "@/components/research/treatment";
import { CitationGraph } from "@/components/visuals/citation-graph";
import { cn } from "@/lib/utils";

interface SummaryOut { mode: string; message?: string; issues?: string[]; held?: string; disposition?: string; key_paragraphs?: number[]; basis?: string }
interface AskOut { mode: string; answer: string | null; message?: string; sources: AskSource[]; confidence?: string; checks?: { uncited_sentences: string[] } }

const SIZES = ["text-[15px]", "text-[17px]", "text-[19.5px]"];

function readSize() { try { return Math.min(2, Math.max(0, Number(localStorage.getItem("nyaay-reader-size") ?? 1))); } catch { return 1; } }

export default function JudgmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = use(params);
  return <Suspense fallback={<Spinner label="Opening judgment" />}><Reader id={decodeURIComponent(raw)} /></Suspense>;
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
  const [selected, setSelected] = useState<number | null>(target);
  const [find, setFind] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [hit, setHit] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);

  const paras = j.data?.paragraphs ?? [];
  const preamble = paras.find((p) => p.no === 0);
  const body = paras.filter((p) => p.no !== 0);
  const cite = j.data?.citations?.[0] ?? "";

  const { offsets, total } = useMemo(() => {
    const offsets: number[] = [];
    let t = 0;
    for (const p of paras) { offsets.push(t); t += countMatches(p.text, find); }
    return { offsets, total: t };
  }, [paras, find]);
  useEffect(() => setHit(0), [find]);
  useEffect(() => {
    if (!total) return;
    document.querySelector(`[data-find="${hit}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [hit, total]);

  // Jump to ?para=N once the text is on screen.
  useEffect(() => {
    if (target === null || !j.data) return;
    const t = setTimeout(() => document.getElementById(`para-${target}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    return () => clearTimeout(t);
  }, [target, j.data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setFindOpen(true); setTimeout(() => findRef.current?.select(), 0); }
      if (e.key === "Escape") { setFindOpen(false); setFind(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function copyPara(no: number) {
    const p = paras.find((x) => x.no === no);
    if (!p || !j.data) return;
    const ref = [j.data.title, cite, `para ${no}`].filter(Boolean).join(", ");
    navigator.clipboard.writeText(`“${p.text}”\n— ${ref}`).then(() => toast.success("Copied with citation"), () => toast.error("Could not copy. Select the text instead."));
  }

  if (j.isLoading) return <Spinner label="Opening judgment" />;
  if (j.isError) return <div className="space-y-4"><BackLink /><ErrorNote error={j.error} /></div>;
  const J = j.data!;
  const negative = (links.data?.treatment.negative ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <BackLink />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => { setFindOpen((v) => !v); setTimeout(() => findRef.current?.focus(), 0); }} aria-pressed={findOpen} title="Find in judgment (Ctrl+F)"><Search className="h-4 w-4" /> Find</Button>
          <div className="flex items-center rounded-md border border-rule" role="group" aria-label="Text size">
            {[0, 1, 2].map((s) => (
              <button key={s} onClick={() => setSize(s)} aria-pressed={size === s} aria-label={["Small", "Medium", "Large"][s] + " text"}
                className={cn("px-2 py-1 text-muted hover:text-text", size === s && "bg-brass-soft text-brass")}>
                <Type className={["h-3 w-3", "h-3.5 w-3.5", "h-4 w-4"][s]} />
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setRail((v) => !v)} aria-pressed={rail} className="hidden xl:inline-flex" title={rail ? "Hide side panel" : "Show side panel"}>
            {rail ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {findOpen && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="sticky top-16 z-10">
            <Panel className="flex items-center gap-2 p-2 !bg-surface-solid/95">
              <Search className="ml-1 h-4 w-4 text-faint" />
              <Input ref={findRef} value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find in this judgment" className="h-8 border-0 bg-transparent focus:ring-0"
                onKeyDown={(e) => { if (e.key === "Enter" && total) { e.preventDefault(); setHit((h) => (e.shiftKey ? (h - 1 + total) % total : (h + 1) % total)); } }} aria-label="Find in this judgment" />
              <span className="whitespace-nowrap text-sm text-muted tabular-nums" aria-live="polite">{find.length >= 2 ? (total ? `${hit + 1} of ${total}` : "No matches") : ""}</span>
              <Button size="icon" variant="ghost" disabled={!total} onClick={() => setHit((h) => (h - 1 + total) % total)} aria-label="Previous match"><ChevronUp className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" disabled={!total} onClick={() => setHit((h) => (h + 1) % total)} aria-label="Next match"><ChevronDown className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => { setFindOpen(false); setFind(""); }} aria-label="Close find"><X className="h-4 w-4" /></Button>
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn("grid gap-8", rail && "xl:grid-cols-[minmax(0,1fr)_340px]")}>
        <article className="min-w-0">
          <header className="mx-auto max-w-[74ch] pb-6 border-b border-rule">
            <p className="text-sm text-cyan">{J.court}</p>
            <h1 className="font-display mt-2 text-[1.75rem] font-semibold leading-tight">{J.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
              {J.decision_date && <span>Decided {fmtDate(J.decision_date, { day: "numeric", month: "long", year: "numeric" })}</span>}
              {J.bench && <span>· {J.bench}</span>}
              {J.disposal && <span>· {J.disposal}</span>}
              <span>· {J.n_paras} paragraphs</span>
            </div>
            {J.citations.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">{J.citations.map((c) => <Badge key={c} tone="brass">{c}</Badge>)}</div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <TreatmentBadges t={links.data?.treatment} />
              {J.source_url && <a href={J.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brass hover:underline"><ExternalLink className="h-3.5 w-3.5" />Original PDF</a>}
              {J.source === "fixture" && <Badge tone="amber">Fictional test judgment</Badge>}
            </div>
            {negative && (
              <p className="mt-4 flex gap-2 rounded-md border border-tape/40 bg-tape-soft p-3 text-sm text-tape">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                A later judgment in your library may have overruled or disapproved this case. Read the citing paragraphs in the side panel before relying on it.
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
                <li key={p.no} id={`para-${p.no}`} className="group relative scroll-mt-28">
                  <button onClick={() => setSelected(on ? null : p.no)} aria-expanded={on} aria-label={`Paragraph ${p.no} actions`}
                    className={cn("absolute -left-12 top-0.5 w-9 text-right font-display text-[13px] tabular-nums transition-colors",
                      on || targeted ? "text-brass font-semibold" : "text-faint group-hover:text-muted")}>
                    {p.no}
                  </button>
                  <p className={cn("rounded-md transition-colors -mx-3 px-3 py-1",
                    targeted && "bg-brass-soft shadow-[inset_2px_0_0_var(--brass)]", on && !targeted && "bg-vellum")}>
                    <Highlight text={p.text} term={find} activeIndex={hit} offset={offsets[idx]} />
                  </p>
                  <AnimatePresence>
                    {on && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden font-sans">
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => copyPara(p.no)}><Copy className="h-3.5 w-3.5" />Copy with citation</Button>
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
        </article>

        {rail && (
          <aside className="hidden xl:block">
            <div className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-4 overflow-y-auto scrollbar-thin pb-6">
              <Headnote id={J.id} onJump={(n) => { setSelected(n); document.getElementById(`para-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} />
              <AskThis id={J.id} onJump={(n) => { setSelected(n); document.getElementById(`para-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} />
              <Panel className="p-4">
                <h2 className="mb-2 font-display text-sm font-medium">Citation network</h2>
                {links.isLoading ? <Spinner /> : links.data ? <CitationGraph links={links.data} title={J.title} /> : <ErrorNote error={links.error} />}
              </Panel>
              {!!links.data?.cited_by.length && (
                <Panel className="p-4">
                  <h2 className="mb-2 font-display text-sm font-medium">Cited by</h2>
                  <ul className="space-y-2">
                    {links.data.cited_by.slice(0, 12).map((c) => (
                      <li key={String(c.id)} className="text-sm">
                        <Link href={`/judgments/${encodeURIComponent(String(c.id))}${c.paras?.[0] !== undefined ? `?para=${c.paras[0]}` : ""}`} className="hover:text-brass">{c.title}</Link>
                        <p className="text-xs text-faint">{[c.court, c.year].filter(Boolean).join(" · ")}{c.paras?.length ? ` · para ${c.paras.join(", ")}` : ""}
                          {c.treatment && c.treatment !== "cited" && <span className={cn("ml-1", c.treatment === "negative" ? "text-tape" : c.treatment === "caution" ? "text-amber" : "text-leaf")}>· {c.treatment === "negative" ? "may overrule" : c.treatment === "caution" ? "distinguishes" : "follows"}</span>}</p>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
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
    <div className="flex w-full flex-wrap items-center gap-2 rounded-md border border-rule bg-vellum p-2">
      <Select value={matter} onChange={(e) => setMatter(e.target.value)} className="h-8 w-auto min-w-[220px] text-sm" aria-label="Matter">
        <option value="">No matter (saved authorities)</option>
        {matters.data?.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
      </Select>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-8 flex-1 min-w-[160px] text-sm" />
      <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

function Headnote({ id, onJump }: { id: string; onJump: (n: number) => void }) {
  const m = useMutation({ mutationFn: () => api.post<SummaryOut>(`/judgments/${encodeURIComponent(id)}/summary`) });
  const d = m.data;
  const ok = d && (d.mode === "generated" || d.mode === "cached");
  return (
    <Panel className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 font-display text-sm font-medium"><Sparkles className="h-3.5 w-3.5 text-cyan" />AI headnote</h2>
        {ok && <Badge tone="cyan">Draft</Badge>}
      </div>
      {!d && !m.isPending && (
        <>
          <p className="text-sm text-muted">Issues, holding and key paragraphs, written by your local AI from this judgment only.</p>
          <Button size="sm" className="mt-3" onClick={() => m.mutate()}>Write headnote</Button>
        </>
      )}
      {m.isPending && <Spinner label="Reading the judgment" />}
      {m.isError && <ErrorNote error={m.error} />}
      {d && !ok && <p className="text-sm text-amber">{d.message ?? "No headnote available."}</p>}
      {ok && (
        <div className="space-y-3 text-sm">
          {!!d.issues?.length && (<div><p className="text-xs text-faint">Issues</p><ul className="mt-1 list-disc space-y-1 pl-4 text-muted">{d.issues.map((x) => <li key={x}>{x}</li>)}</ul></div>)}
          {d.held && <div><p className="text-xs text-faint">Held</p><p className="mt-1 prose-judgment text-text">{d.held}</p></div>}
          {d.disposition && <div><p className="text-xs text-faint">Result</p><p className="mt-1 text-muted">{d.disposition}</p></div>}
          {!!d.key_paragraphs?.length && (
            <div><p className="text-xs text-faint">Key paragraphs</p><div className="mt-1 flex flex-wrap gap-1">{d.key_paragraphs.map((n) => <button key={n} onClick={() => onJump(n)} className="rounded-sm border border-brass/40 bg-brass-soft px-1.5 text-xs text-brass hover:bg-brass hover:text-[#0a0e18]">¶ {n}</button>)}</div></div>
          )}
          {d.basis && <p className="border-t border-rule pt-2 text-xs text-faint">{d.basis}</p>}
        </div>
      )}
    </Panel>
  );
}

function AskThis({ id, onJump }: { id: string; onJump: (n: number) => void }) {
  const [q, setQ] = useState("");
  const m = useMutation({ mutationFn: (question: string) => api.post<AskOut>("/research/ask", { question, jid: id }) });
  const d = m.data;
  const paraOf = (sid: number) => d?.sources.find((s) => s.sid === sid)?.para_no;
  return (
    <Panel className="p-4">
      <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-medium"><Sparkles className="h-3.5 w-3.5 text-cyan" />Ask this judgment</h2>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 5) m.mutate(q.trim()); }} className="space-y-2">
        <Textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder="What did the court hold on limitation?" className="text-sm" aria-label="Question about this judgment" />
        <Button size="sm" type="submit" loading={m.isPending} disabled={q.trim().length < 5}>Ask</Button>
      </form>
      {m.isError && <ErrorNote error={m.error} className="mt-2" />}
      {d && (
        <div className="mt-3 border-t border-rule pt-3 text-sm">
          {d.mode === "answer" && d.answer ? (
            <p className="prose-judgment leading-7">
              {d.answer.split(/(\[S\d+\])/g).map((part, i) => {
                const mm = part.match(/^\[S(\d+)\]$/);
                const para = mm ? paraOf(Number(mm[1])) : undefined;
                return mm ? <button key={i} onClick={() => para !== undefined && onJump(para)} className="mx-0.5 rounded-sm border border-brass/40 bg-brass-soft px-1 font-sans text-[11px] font-semibold text-brass hover:bg-brass hover:text-[#0a0e18]">¶ {para ?? mm[1]}</button> : <span key={i}>{part}</span>;
              })}
            </p>
          ) : (
            <>
              <p className="text-amber">{d.message}</p>
              {!!d.sources.length && <div className="mt-2 flex flex-wrap gap-1">{d.sources.map((s) => <button key={s.sid} onClick={() => onJump(s.para_no)} className="rounded-sm border border-rule px-1.5 text-xs text-muted hover:border-brass/50 hover:text-text">¶ {s.para_no}</button>)}</div>}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
