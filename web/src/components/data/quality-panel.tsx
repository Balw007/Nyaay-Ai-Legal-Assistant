"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Pencil, ScanLine, Tags, ClipboardCheck } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { DuplicateGroup, QualityItem, QualityReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Badge, ErrorNote, Panel, PanelHeader, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

const tone = (s: number) => (s >= 90 ? "leaf" : s >= 70 ? "brass" : s >= 50 ? "amber" : "tape") as "leaf" | "brass" | "amber" | "tape";
const PAGE = 15;

export function QualityPanel({ admin, running, onJob }: { admin: boolean; running: boolean; onJob: () => void }) {
  const qc = useQueryClient();
  const [issue, setIssue] = useState("");
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<string | null>(null);
  const rep = useQuery({ queryKey: ["quality"], queryFn: () => api.get<QualityReport>("/library/quality"), refetchInterval: running ? 4000 : false });
  const list = useQuery({
    queryKey: ["quality-list", issue, page, rep.data?.scored],
    queryFn: () => api.get<{ total: number; items: QualityItem[] }>(`/library/quality/list${qs({ issue, max_score: issue ? undefined : 89, limit: PAGE, offset: page * PAGE })}`),
    enabled: !!rep.data?.scored,
  });
  const dups = useQuery({ queryKey: ["quality-dups"], enabled: !!rep.data?.duplicate_groups, queryFn: () => api.get<DuplicateGroup[]>("/library/quality/duplicates") });
  const run = useMutation({ mutationFn: () => api.post("/library/quality/run"), onSuccess: () => { toast.success("Checking every judgment…"); onJob(); }, onError: (e) => toast.error((e as Error).message) });
  const tag = useMutation({ mutationFn: () => api.post("/library/retag?everything=true"), onSuccess: () => { toast.success("Tagging judgments with their Acts and sections…"); onJob(); }, onError: (e) => toast.error((e as Error).message) });

  if (rep.isLoading) return <Panel><div className="p-4"><Spinner label="Reading quality report" /></div></Panel>;
  if (rep.isError) return <ErrorNote error={rep.error} />;
  const r = rep.data!;
  const total = Math.max(1, r.scored);
  const csv = `/api/library/quality/export.csv${qs({ issue, max_score: issue ? undefined : 89 })}`;

  return (
    <Panel>
      <PanelHeader title="Data quality" sub="Every judgment is scored out of 100 from checks you can read. Below 70, look before you rely on it."
        action={<div className="flex gap-2">
          <Button size="sm" disabled={!admin || running} loading={run.isPending} onClick={() => run.mutate()}><ClipboardCheck className="h-3.5 w-3.5" />Check all</Button>
          <Button size="sm" disabled={!admin || running} loading={tag.isPending} onClick={() => tag.mutate()}><Tags className="h-3.5 w-3.5" />Re-tag sections</Button>
        </div>} />
      {r.scored === 0 ? (
        <p className="p-4 text-sm text-muted">{r.judgments ? `${r.judgments.toLocaleString("en-IN")} judgments have not been checked yet. ` : "Load judgments first. "}{admin && r.judgments ? "Press “Check all”." : ""}</p>
      ) : (
        <>
          <div className="grid gap-px bg-rule sm:grid-cols-4">
            <div className="bg-surface-solid/60 px-4 py-3"><p className="text-xs text-muted">Average score</p><p className="font-display text-xl font-semibold tabular-nums">{r.average}</p>{r.stale > 0 && <p className="text-xs text-amber">{r.stale} not checked yet</p>}</div>
            <div className="bg-surface-solid/60 px-4 py-3"><p className="text-xs text-muted">Trustworthy (90+)</p><p className="font-display text-xl font-semibold tabular-nums">{Math.round((r.share_trustworthy ?? 0) * 100)}%</p></div>
            <div className="bg-surface-solid/60 px-4 py-3"><p className="text-xs text-muted">With Act/section tags</p><p className="font-display text-xl font-semibold tabular-nums">{r.section_tagging.with_refs.toLocaleString("en-IN")}</p><p className="text-xs text-faint">of {r.judgments.toLocaleString("en-IN")}</p></div>
            <div className="bg-surface-solid/60 px-4 py-3"><p className="text-xs text-muted">Need OCR again</p><p className="font-display text-xl font-semibold tabular-nums">{r.needs_ocr}</p><p className="text-xs text-faint">+ {r.scanned_skipped} scanned, skipped</p></div>
          </div>
          <div className="space-y-2 p-4">
            {Object.entries(r.buckets).map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 text-sm"><span className="w-14 text-muted tabular-nums">{k}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-vellum"><div className={cn("h-full rounded-full", k === "90-100" ? "bg-leaf" : k === "70-89" ? "bg-brass" : k === "50-69" ? "bg-amber" : "bg-tape")} style={{ width: `${(v / total) * 100}%` }} /></div>
                <span className="w-12 text-right tabular-nums">{v.toLocaleString("en-IN")}</span></div>
            ))}
          </div>
          <div className="border-t border-rule p-4">
            <p className="mb-2 text-sm font-medium">What is wrong</p>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => { setIssue(""); setPage(0); }} className={cn("rounded-sm border px-2 py-0.5 text-sm", !issue ? "border-brass bg-brass-soft text-brass" : "border-rule text-muted hover:text-text")}>Below 90</button>
              {r.issues.filter((i) => i.count > 0).map((i) => (
                <button key={i.code} title={i.fix} onClick={() => { setIssue(i.code); setPage(0); }}
                  className={cn("rounded-sm border px-2 py-0.5 text-sm", issue === i.code ? "border-brass bg-brass-soft text-brass" : "border-rule text-muted hover:text-text")}>{i.label} <span className="tabular-nums">· {i.count}</span></button>
              ))}
              {r.issues.every((i) => i.count === 0) && <span className="text-sm text-leaf">No problems found.</span>}
            </div>
          </div>
          <div className="border-t border-rule">
            <div className="flex items-center justify-between px-4 py-2.5 text-sm text-muted"><span>{list.data ? `${list.data.total.toLocaleString("en-IN")} judgments` : ""}</span>
              <a href={csv}><Button size="sm" variant="ghost"><Download className="h-3.5 w-3.5" />CSV for fixing offline</Button></a></div>
            <ul className="divide-y divide-rule">
              {list.data?.items.map((it) => (
                <li key={it.id} className="px-4 py-2.5">
                  <div className="flex items-start gap-3">
                    <Badge tone={tone(it.score)} className="mt-0.5 tabular-nums">{it.score}</Badge>
                    <div className="min-w-0 flex-1">
                      <Link href={`/judgments/${encodeURIComponent(it.id)}`} className="block truncate text-base hover:text-brass">{it.title}</Link>
                      <p className="text-xs text-faint">{[it.court, it.decision_date || "no date", `${it.n_paras} paras`].join(" · ")}</p>
                      <div className="mt-1 flex flex-wrap gap-1">{it.issues.map((c) => <Badge key={c}>{r.issues.find((i) => i.code === c)?.label ?? c}</Badge>)}</div>
                    </div>
                    {it.source_url && it.issues.some((c) => c === "garbled" || c === "low_text") && <a href={it.source_url} target="_blank" rel="noreferrer" title="Open the original PDF to re-run OCR"><ScanLine className="h-4 w-4 text-muted hover:text-brass" /></a>}
                    {admin && <Button size="icon" variant="ghost" aria-label="Fix details" onClick={() => setEdit(edit === it.id ? null : it.id)}><Pencil className="h-3.5 w-3.5" /></Button>}
                  </div>
                  {edit === it.id && <Fix item={it} onDone={() => { setEdit(null); qc.invalidateQueries({ queryKey: ["quality"] }); qc.invalidateQueries({ queryKey: ["quality-list"] }); }} />}
                </li>
              ))}
            </ul>
            {list.data && list.data.total > PAGE && (
              <div className="flex items-center justify-between border-t border-rule px-4 py-2 text-sm">
                <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                <span className="text-muted tabular-nums">{page * PAGE + 1}–{Math.min(list.data.total, (page + 1) * PAGE)} of {list.data.total}</span>
                <Button size="sm" variant="ghost" disabled={(page + 1) * PAGE >= list.data.total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            )}
          </div>
          {!!dups.data?.length && (
            <div className="border-t border-rule p-4">
              <p className="mb-2 text-sm font-medium">Possible duplicates <span className="text-muted">({r.duplicate_groups}): same court, date and case name, stored twice</span></p>
              <ul className="space-y-1.5 text-sm">
                {dups.data.slice(0, 8).map((g) => <li key={g.ids.join()} className="text-muted"><span className="text-text">{g.title}</span> · {g.date} · {g.ids.map((id, i) => <span key={id}>{i > 0 && ", "}<Link className="text-brass hover:underline" href={`/judgments/${encodeURIComponent(id)}`}>{g.sources[i] ?? "copy"} ({g.paras[i]} paras)</Link></span>)}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function Fix({ item, onDone }: { item: QualityItem; onDone: () => void }) {
  const [f, setF] = useState({ title: item.title, decision_date: item.decision_date || "", citation: "" });
  const m = useMutation({
    mutationFn: () => api.patch(`/library/judgments/${encodeURIComponent(item.id)}`, {
      title: f.title, decision_date: f.decision_date || undefined, ...(f.citation.trim() ? { citations: f.citation.split(";").map((x) => x.trim()).filter(Boolean) } : {}) }),
    onSuccess: () => { toast.success("Fixed and re-checked"); onDone(); }, onError: (e) => toast.error((e as Error).message),
  });
  return (
    <form className="mt-3 grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label="Title (parties)" className="sm:col-span-3"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Decision date" hint="2019-04-30"><Input value={f.decision_date} onChange={(e) => setF({ ...f, decision_date: e.target.value })} /></Field>
      <Field label="Citation(s)" hint="Separate several with ;" className="sm:col-span-2"><Input value={f.citation} onChange={(e) => setF({ ...f, citation: e.target.value })} placeholder="2019 INSC 400; (2019) 5 SCC 418" /></Field>
      <div className="sm:col-span-3"><Button size="sm" variant="primary" type="submit" loading={m.isPending}>Save fix</Button></div>
    </form>
  );
}
