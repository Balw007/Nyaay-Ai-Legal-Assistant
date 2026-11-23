"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { BookMarked, Expand, Focus, Network, Plus, Search, Trash2, X } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { Bookmark, GlobalSearch, Judgment, Links, Matter } from "@/lib/types";
import { readRecent } from "@/lib/recent";
import { plural, timeAgo } from "@/lib/format";
import { sheetIn } from "@/lib/motion";
import { AuthorityGraph, EDGE_COLOR, EDGE_LABEL, type EdgeKind, type GEdge, type GNode } from "@/components/graph/authority-graph";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Badge, Empty, ErrorNote, PageHeader, Panel, Segmented, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/info";

const MAX_NEIGHBOURS = 24;
const FILTERS: EdgeKind[] = ["cites", "cited", "positive", "caution", "negative", "saved", "court"];
type Preset = "all" | "citations" | "followed" | "overruled" | "related";
// Each view hides the other relationship kinds. "Related cases" keeps courts and your saved paragraphs.
const PRESETS: Record<Preset, EdgeKind[]> = {
  all: [],
  citations: ["positive", "caution", "negative", "saved", "court"],
  followed: ["cites", "cited", "caution", "negative", "saved", "court"],
  overruled: ["cites", "cited", "positive", "caution", "saved", "court"],
  related: ["cites", "cited", "positive", "caution", "negative"],
};

type Graph = { nodes: Map<string, GNode>; edges: Map<string, GEdge>; more: Map<string, number> };
const j = (id: string) => `j:${id}`;

function GraphInner() {
  const params = useSearchParams();
  const focusId = params.get("focus");
  const [view, setView] = useState<"map" | "saved">(params.get("view") === "saved" ? "saved" : "map");
  return (
    <div className="space-y-5">
      <PageHeader title="Authority map" sub="How the judgments in your library cite one another, how later courts treated them, and which ones you saved to your matters. Only links recorded in your library are drawn."
        actions={<Segmented label="View" value={view} onChange={setView} items={[{ value: "map", label: <><Network className="h-3.5 w-3.5" />Map</> }, { value: "saved", label: <><BookMarked className="h-3.5 w-3.5" />Saved paragraphs</> }]} />} />
      {view === "map" ? <MapView focusId={focusId} /> : <SavedView />}
    </div>
  );
}

function MapView({ focusId }: { focusId: string | null }) {
  const qc = useQueryClient();
  const [g, setG] = useState<Graph>({ nodes: new Map(), edges: new Map(), more: new Map() });
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [hidden, setHidden] = useState<Set<EdgeKind>>(new Set());
  const [preset, setPreset] = useState<Preset>("all");
  const seeded = useRef(false);

  const bookmarks = useQuery({ queryKey: ["bookmarks"], queryFn: () => api.get<Bookmark[]>("/bookmarks") });
  const matters = useQuery({ queryKey: ["matters"], queryFn: () => api.get<Matter[]>("/matters") });

  const mutate = useCallback((fn: (g: Graph) => void) => {
    setG((prev) => { const next = { nodes: new Map(prev.nodes), edges: new Map(prev.edges), more: new Map(prev.more) }; fn(next); return next; });
  }, []);

  const addNode = (g: Graph, n: Omit<GNode, "ref"> & { ref?: string }) => {
    const old = g.nodes.get(n.id);
    g.nodes.set(n.id, { ...(old ?? {}), ...n, ref: n.ref ?? old?.ref ?? n.id, expanded: old?.expanded || n.expanded, seed: old?.seed || n.seed, sub: n.sub ?? old?.sub } as GNode);
  };
  const addEdge = (g: Graph, e: GEdge) => { g.edges.set(e.id, e); };
  const addCourt = (g: Graph, jid: string, court?: string | null) => {
    if (!court) return;
    addNode(g, { id: `c:${court}`, kind: "court", title: court, ref: court });
    addEdge(g, { id: `court:${jid}`, source: j(jid), target: `c:${court}`, kind: "court" });
  };

  const expand = useCallback(async (jid: string) => {
    mutate((g) => { const n = g.nodes.get(j(jid)); if (n) g.nodes.set(n.id, { ...n, loading: true }); });
    try {
      const [links, doc] = await Promise.all([
        qc.fetchQuery({ queryKey: ["links", jid], queryFn: () => api.get<Links>(`/judgments/${encodeURIComponent(jid)}/links`) }),
        qc.fetchQuery({ queryKey: ["judgment", jid], queryFn: () => api.get<Judgment>(`/judgments/${encodeURIComponent(jid)}`) }),
      ]);
      mutate((g) => {
        addNode(g, { id: j(jid), kind: "judgment", title: doc.title, sub: [doc.citations[0], doc.court, doc.year].filter(Boolean).join(", "), year: doc.year, expanded: true, ref: jid });
        g.nodes.set(j(jid), { ...g.nodes.get(j(jid))!, loading: false, expanded: true });
        addCourt(g, jid, doc.court);
        const cites = links.cites.slice(0, MAX_NEIGHBOURS);
        const by = links.cited_by.slice(0, MAX_NEIGHBOURS);
        cites.forEach((c) => {
          const cid = String(c.id);
          addNode(g, { id: j(cid), kind: "judgment", title: c.title, sub: [c.court, c.year].filter(Boolean).join(", "), year: c.year, ref: cid });
          addEdge(g, { id: `cites:${jid}>${cid}`, source: j(jid), target: j(cid), kind: "cites" });
          addCourt(g, cid, c.court);
        });
        by.forEach((c) => {
          const cid = String(c.id);
          addNode(g, { id: j(cid), kind: "judgment", title: c.title, sub: [c.court, c.year].filter(Boolean).join(", "), year: c.year, ref: cid });
          const kind = (["negative", "caution", "positive"].includes(c.treatment ?? "") ? c.treatment : "cited") as EdgeKind;
          addEdge(g, { id: `cites:${cid}>${jid}`, source: j(cid), target: j(jid), kind, paras: c.paras });
          addCourt(g, cid, c.court);
        });
        const extra = Math.max(0, links.cites.length - cites.length) + Math.max(0, links.cited_by.length - by.length);
        g.more.set(j(jid), extra + links.not_in_corpus);
      });
    } catch (e) {
      mutate((g) => { const n = g.nodes.get(j(jid)); if (n) g.nodes.set(n.id, { ...n, loading: false }); });
      toast.error(e instanceof Error ? e.message : "Could not load links");
    }
  }, [mutate, qc]);

  // Seed the map: paragraphs saved to matters, judgments you opened recently, and ?focus=.
  useEffect(() => {
    if (seeded.current || !bookmarks.data || !matters.data) return;
    seeded.current = true;
    const titleOf = new Map(matters.data.map((m) => [m.id, m.title]));
    const recent = readRecent().filter((r) => r.kind === "judgment").slice(0, 6);
    // Work out the seeds first: a state updater runs later, during render.
    const seeds = new Set<string>([...bookmarks.data.map((b) => b.jid), ...recent.map((r) => r.id), ...(focusId ? [focusId] : [])]);
    mutate((g) => {
      bookmarks.data.forEach((b) => {
        addNode(g, { id: j(b.jid), kind: "judgment", title: b.title, sub: b.citation, seed: true, ref: b.jid });
        const mid = b.matter_id ? `m:${b.matter_id}` : "m:none";
        addNode(g, { id: mid, kind: b.matter_id ? "matter" : "saved", title: b.matter_id ? (titleOf.get(b.matter_id) ?? `Matter ${b.matter_id}`) : "Saved, no matter", ref: b.matter_id ? String(b.matter_id) : "" });
        const eid = `saved:${mid}>${b.jid}`;
        const old = g.edges.get(eid);
        const paras = [...(old?.paras ?? []), ...(b.para_no !== null ? [b.para_no] : [])];
        addEdge(g, { id: eid, source: mid, target: j(b.jid), kind: "saved", paras: [...new Set(paras)] });
      });
      recent.forEach((r) => addNode(g, { id: j(r.id), kind: "judgment", title: r.title, sub: r.sub, seed: true, ref: r.id }));
      if (focusId && !g.nodes.has(j(focusId))) addNode(g, { id: j(focusId), kind: "judgment", title: focusId, seed: true, ref: focusId });
    });
    const list = [...seeds];
    if (focusId) { list.splice(list.indexOf(focusId), 1); list.unshift(focusId); setSelected(j(focusId)); }
    list.slice(0, 10).forEach((id) => { void expand(id); });
  }, [bookmarks.data, matters.data, focusId, expand, mutate]);

  const nodes = useMemo(() => [...g.nodes.values()], [g.nodes]);
  const edges = useMemo(() => [...g.edges.values()], [g.edges]);
  const sel = selected ? g.nodes.get(selected) ?? null : null;
  const counts = useMemo(() => ({
    judgments: nodes.filter((n) => n.kind === "judgment").length,
    matters: nodes.filter((n) => n.kind === "matter" || n.kind === "saved").length,
    links: edges.filter((e) => e.kind !== "court").length,
  }), [nodes, edges]);

  const addFromSearch = (id: string, title: string, sub?: string) => {
    mutate((g) => addNode(g, { id: j(id), kind: "judgment", title, sub, seed: true, ref: id }));
    setSelected(j(id));
    void expand(id);
  };

  if (bookmarks.isError) return <ErrorNote error={bookmarks.error} />;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-3">
      <Segmented label="Show" value={preset} onChange={(v) => { setPreset(v); setHidden(new Set(PRESETS[v])); }}
        items={[{ value: "all", label: "All" }, { value: "citations", label: "Citations" }, { value: "followed", label: "Followed" }, { value: "overruled", label: "Overruled", tone: "cyan" }, { value: "related", label: "Related cases" }]} />
      <Panel className="relative overflow-hidden rounded-2xl md:h-[min(72vh,720px)] md:min-h-[460px]">
        <div className="relative z-10 flex flex-wrap items-start gap-2 p-3 md:absolute md:inset-x-3 md:top-3 md:p-0">
          <AddJudgment onAdd={addFromSearch} />
          <div className="glass-4 flex flex-wrap items-center gap-1 rounded-xl p-1" role="group" aria-label="Show relationships">
            {FILTERS.map((k) => {
              const on = !hidden.has(k);
              return (
                <button key={k} aria-pressed={on} onClick={() => setHidden((h) => { const n = new Set(h); if (on) n.add(k); else n.delete(k); return n; })}
                  className={cn("relative z-[3] inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors", on ? "text-text" : "text-faint line-through")}>
                  <span className="h-[3px] w-3 rounded-full" style={{ background: EDGE_COLOR[k] }} />{EDGE_LABEL[k]}
                </button>
              );
            })}
          </div>
        </div>
        {bookmarks.isLoading || matters.isLoading ? (
          <div className="grid h-[420px] place-items-center md:h-full"><Spinner label="Gathering your authorities" /></div>
        ) : nodes.length === 0 ? (
          <div className="grid h-[420px] place-items-center md:h-full">
            <Empty icon={Network} title="Your map starts with an authority">
              Save a paragraph to a matter from any judgment, open a few judgments, or add one with the search above. Each judgment then shows what it relies on and who later cited it.
            </Empty>
          </div>
        ) : (
          <div className="h-[420px] md:h-full"><AuthorityGraph nodes={nodes} edges={edges} selected={selected} onSelect={setSelected} focus={focus} hiddenKinds={hidden} /></div>
        )}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex items-end justify-between gap-3 text-xs text-faint">
          <span className="tnum">{plural(counts.judgments, "judgment")}, {plural(counts.matters, "matter")}, {plural(counts.links, "link")}</span>
          <span className="hidden sm:inline">Drag to move, scroll to zoom, select an item to inspect it</span>
        </div>
      </Panel>
      </div>

      <AnimatePresence mode="wait">
        {sel ? (
          <motion.div key={sel.id} {...sheetIn}>
            <Inspector node={sel} g={g} focus={focus} setFocus={setFocus} onExpand={() => void expand(sel.ref)} onSelect={setSelected} onClose={() => setSelected(null)} />
          </motion.div>
        ) : (
          <motion.div key="legend" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <Insights g={g} onSelect={setSelected} />
            <Panel className="space-y-3 p-5 text-sm">
              <h2 className="relative z-[3] flex items-center gap-1.5 text-md font-medium">Reading the map<InfoTip k="Reading the map" /></h2>
              <ul className="relative z-[3] space-y-2.5 text-muted">
                <li className="flex gap-3"><span className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-cyan" />A judgment. Filled once its links are loaded.</li>
                <li className="flex gap-3"><span className="mt-1 h-3 w-3 shrink-0 rotate-45 rounded-[2px] bg-brass" />One of your matters, linked to the paragraphs you saved to it.</li>
                <li className="flex gap-3"><span className="mt-1 h-3 w-3 shrink-0 rounded-[3px] border-2 border-platinum" />A court.</li>
                <li className="flex gap-3"><span className="mt-2 h-[3px] w-3 shrink-0 rounded-full bg-tape" />A later judgment that may have overruled or disapproved the earlier one.</li>
              </ul>
              <p className="relative z-[3] border-t border-rule pt-3 text-xs text-faint">Treatment is read from the words of the citing paragraph. It is a signal to read, never a verdict. Statutes and principles are not drawn yet.</p>
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AddJudgment({ onAdd }: { onAdd: (id: string, title: string, sub?: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const dq = q.trim();
  const res = useQuery({ queryKey: ["global-search", dq], enabled: dq.length >= 2, queryFn: () => api.get<GlobalSearch>(`/search${qs({ q: dq })}`) });
  return (
    <div className="relative">
      <div className="glass-4 flex items-center gap-2 rounded-xl px-2.5">
        <Search className="relative z-[3] h-4 w-4 text-faint" />
        <Input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Add a judgment to the map" aria-label="Add a judgment to the map" className="relative z-[3] h-9 w-60 border-0 bg-transparent px-0 shadow-none focus:ring-0" />
      </div>
      {open && dq.length >= 2 && (
        <div className="glass-4 absolute left-0 top-12 z-20 w-[min(420px,80vw)] overflow-hidden rounded-xl">
          <ul className="relative z-[3] max-h-72 overflow-y-auto scrollbar-thin p-1">
            {res.isFetching && <li className="px-3 py-2"><Spinner label="Searching" /></li>}
            {res.data?.judgments.length === 0 && <li className="px-3 py-2 text-sm text-muted">No judgment matched.</li>}
            {res.data?.judgments.map((x) => (
              <li key={x.id}>
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => { onAdd(x.id, x.title, x.sub); setQ(""); setOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-brass-soft">
                  <Plus className="h-3.5 w-3.5 shrink-0 text-brass" /><span className="min-w-0 flex-1 truncate">{x.title}</span><span className="shrink-0 text-xs text-faint">{x.sub}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Inspector({ node, g, focus, setFocus, onExpand, onSelect, onClose }:
  { node: GNode; g: Graph; focus: boolean; setFocus: (v: boolean) => void; onExpand: () => void; onSelect: (id: string) => void; onClose: () => void }) {
  const rel = [...g.edges.values()].flatMap((e) => {
    const a = typeof e.source === "string" ? e.source : e.source.id;
    const b = typeof e.target === "string" ? e.target : e.target.id;
    if (a !== node.id && b !== node.id) return [];
    const other = g.nodes.get(a === node.id ? b : a);
    if (!other) return [];
    const outgoing = a === node.id;
    const label = e.kind === "court" ? (outgoing ? "Decided by" : "Decided here")
      : e.kind === "saved" ? (outgoing ? "Saved paragraphs" : "Saved to matter")
      : e.kind === "cites" ? (outgoing ? "Relies on" : "Cited by")
      : outgoing ? (e.kind === "negative" ? "May overrule or disapprove" : e.kind === "caution" ? "Distinguishes or doubts" : e.kind === "positive" ? "Follows" : "Cites")
      : EDGE_LABEL[e.kind];
    return [{ e, other, label }];
  });
  const groups = rel.reduce<Record<string, typeof rel>>((acc, r) => { (acc[r.label] ??= []).push(r); return acc; }, {});
  const more = g.more.get(node.id) ?? 0;
  const href = node.kind === "judgment" ? `/judgments/${encodeURIComponent(node.ref)}` : node.kind === "matter" ? `/matters/${node.ref}` : null;

  return (
    <Panel level={4} className="flex max-h-[min(72vh,720px)] flex-col overflow-hidden rounded-2xl">
      <header className="relative z-[3] flex items-start gap-2 border-b border-rule p-4">
        <div className="min-w-0 flex-1">
          <Badge tone={node.kind === "judgment" ? "cyan" : node.kind === "court" ? "neutral" : "brass"}>{node.kind === "judgment" ? "Judgment" : node.kind === "court" ? "Court" : node.kind === "matter" ? "Matter" : "Saved authorities"}</Badge>
          <h2 className="font-editorial mt-2 text-lg leading-snug">{node.title}</h2>
          {node.sub && <p className="mt-0.5 text-sm text-muted">{node.sub}</p>}
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-vellum hover:text-text"><X className="h-4 w-4" /></button>
      </header>
      <div className="relative z-[3] flex flex-wrap gap-2 border-b border-rule p-3">
        {href && <Link href={href}><Button size="sm" variant="primary">Open {node.kind === "judgment" ? "judgment" : "matter"}</Button></Link>}
        {node.kind === "judgment" && !node.expanded && <Button size="sm" onClick={onExpand} loading={node.loading}><Expand className="h-3.5 w-3.5" />Show its links</Button>}
        <Button size="sm" variant={focus ? "brass" : "ghost"} aria-pressed={focus} onClick={() => setFocus(!focus)}><Focus className="h-3.5 w-3.5" />Focus</Button>
      </div>
      <div className="relative z-[3] flex-1 space-y-4 overflow-y-auto scrollbar-thin p-4 text-sm">
        {Object.keys(groups).length === 0 && <p className="text-muted">{node.kind === "judgment" && !node.expanded ? "Load its links to see what it relies on and who cited it." : "No links recorded in your library."}</p>}
        {Object.entries(groups).map(([label, list]) => (
          <section key={label}>
            <h3 className="mb-1.5 text-xs text-faint">{label} <span className="tnum">{list.length}</span></h3>
            <ul className="space-y-1">
              {list.map(({ e, other }) => (
                <li key={e.id}>
                  <button onClick={() => onSelect(other.id)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-vellum">
                    <span className="mt-1.5 h-[3px] w-3 shrink-0 rounded-full" style={{ background: EDGE_COLOR[e.kind] }} />
                    <span className="min-w-0 flex-1"><span className="line-clamp-2">{other.title}</span>
                      {!!e.paras?.length && <span className="text-xs text-faint">para {e.paras.join(", ")}</span>}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {more > 0 && <p className="border-t border-rule pt-3 text-xs text-faint">{plural(more, "further citation")} not drawn: either beyond the first {MAX_NEIGHBOURS} links, or to judgments not in your library.</p>}
      </div>
    </Panel>
  );
}

/** Every paragraph saved from the reader, grouped by matter. Notes can be edited; a saved paragraph can be removed. */
function SavedView() {
  const qc = useQueryClient();
  const bookmarks = useQuery({ queryKey: ["bookmarks"], queryFn: () => api.get<Bookmark[]>("/bookmarks") });
  const matters = useQuery({ queryKey: ["matters"], queryFn: () => api.get<Matter[]>("/matters") });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/bookmarks/${id}`),
    onSuccess: () => { toast.success("Removed from saved paragraphs"); qc.invalidateQueries({ queryKey: ["bookmarks"] }); qc.invalidateQueries({ queryKey: ["matter"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (bookmarks.isLoading) return <Spinner label="Loading saved paragraphs" />;
  if (bookmarks.isError) return <ErrorNote error={bookmarks.error} />;
  const titleOf = new Map((matters.data ?? []).map((m) => [m.id, m.title]));
  const groups = (bookmarks.data ?? []).reduce<Record<string, Bookmark[]>>((acc, b) => { (acc[b.matter_id ? String(b.matter_id) : ""] ??= []).push(b); return acc; }, {});
  if (!bookmarks.data?.length) return <Panel><Empty icon={BookMarked} title="No saved paragraphs yet">In any judgment, select a paragraph number and choose Save to matter.</Empty></Panel>;
  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([mid, list]) => (
        <section key={mid || "none"}>
          <h2 className="mb-2 text-md font-medium">{mid ? <Link href={`/matters/${mid}`} className="hover:text-brass">{titleOf.get(Number(mid)) ?? `Matter ${mid}`}</Link> : "Not saved to a matter"} <span className="text-sm font-normal text-faint">{plural(list.length, "paragraph")}</span></h2>
          <ul className="space-y-3">
            {list.map((b) => <SavedItem key={b.id} b={b} onDelete={() => { if (confirm(`Remove the saved paragraph from “${b.title}”? This cannot be undone.`)) del.mutate(b.id); }} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SavedItem({ b, onDelete }: { b: Bookmark; onDelete: () => void }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [note, setNote] = useState(b.note ?? "");
  const save = useMutation({
    mutationFn: () => api.patch(`/bookmarks/${b.id}`, { note }),
    onSuccess: () => { setEdit(false); toast.success("Note saved"); qc.invalidateQueries({ queryKey: ["bookmarks"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <li>
      <Panel as="article" className="p-4">
        <div className="relative z-[3] flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/judgments/${encodeURIComponent(b.jid)}${b.para_no !== null ? `?para=${b.para_no}` : ""}`} className="font-medium hover:text-brass">{b.title}</Link>
            <p className="text-sm text-muted">{[b.citation, b.para_no !== null ? `para ${b.para_no}` : null, `saved ${timeAgo(b.created_at)}`].filter(Boolean).join(", ")}</p>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEdit((v) => !v)}>{b.note ? "Edit note" : "Add note"}</Button>
            <Button size="icon" variant="ghost" aria-label={`Remove saved paragraph from ${b.title}`} onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
        {b.excerpt && <p className="prose-judgment relative z-[3] mt-2 line-clamp-4 text-base text-muted">{b.excerpt}</p>}
        {edit ? (
          <form className="relative z-[3] mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
            <div className="flex gap-2"><Button size="sm" variant="primary" type="submit" loading={save.isPending}>Save note</Button><Button size="sm" variant="ghost" type="button" onClick={() => setEdit(false)}>Cancel</Button></div>
          </form>
        ) : b.note ? <p className="relative z-[3] mt-2 rounded-lg border border-brass/25 bg-brass-soft px-3 py-2 text-sm">{b.note}</p> : null}
      </Panel>
    </li>
  );
}

export default function GraphPage() {
  return <Suspense fallback={<Spinner />}><GraphInner /></Suspense>;
}

/** Counts of what is actually on the map, and the judgments most connected to the rest (the key precedents). */
function Insights({ g, onSelect }: { g: Graph; onSelect: (id: string) => void }) {
  const edges = [...g.edges.values()];
  const count = (k: EdgeKind[]) => edges.filter((e) => k.includes(e.kind)).length;
  const degree = new Map<string, number>();
  edges.filter((e) => e.kind !== "court" && e.kind !== "saved").forEach((e) => {
    const a = typeof e.source === "string" ? e.source : e.source.id, b = typeof e.target === "string" ? e.target : e.target.id;
    degree.set(b, (degree.get(b) ?? 0) + 1);
    degree.set(a, (degree.get(a) ?? 0) + 0);
  });
  const key = [...degree.entries()].filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).slice(0, 5)
    .map(([id, n]) => ({ n: g.nodes.get(id), cites: n })).filter((x) => x.n);
  const rows: [string, number, string][] = [
    ["citations between judgments", count(["cites", "cited"]), "bg-cyan"],
    ["followed", count(["positive"]), "bg-leaf"],
    ["distinguished or doubted", count(["caution"]), "bg-amber"],
    ["may be overruled", count(["negative"]), "bg-tape"],
    ["paragraphs saved to matters", count(["saved"]), "bg-brass"],
  ];
  return (
    <Panel lit className="p-5 text-sm">
      <h2 className="relative z-[3] flex items-center gap-1.5 text-md font-medium">Network insights<InfoTip k="Network insights" /></h2>
      <ul className="relative z-[3] mt-3 space-y-2">
        {rows.map(([label, n, dot]) => (
          <li key={label} className="flex items-center gap-3"><span className={cn("h-2 w-2 rounded-full", dot)} /><span className="tnum w-6 text-right text-text">{n}</span><span className="text-muted">{label}</span></li>
        ))}
      </ul>
      <h3 className="relative z-[3] mt-5 text-sm font-medium">Key precedents</h3>
      {key.length === 0 ? <p className="relative z-[3] mt-1 text-xs text-faint">The judgments cited most by others on the map appear here as the map grows.</p> : (
        <ol className="relative z-[3] mt-2 space-y-1">
          {key.map(({ n, cites }) => (
            <li key={n!.id}><button onClick={() => onSelect(n!.id)} className="flex w-full items-baseline gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-vellum">
              <span className="line-clamp-1 flex-1">{n!.title}</span><span className="tnum shrink-0 text-xs text-faint">{cites} cited</span>
            </button></li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
