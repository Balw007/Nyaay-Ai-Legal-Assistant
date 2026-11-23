"use client";
import Link from "next/link";
import { Suspense, useDeferredValue, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, BookOpen, Download, FileUp, Gavel, Search } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { ActDetail, ActSummary, SectionDetail, SectionHit } from "@/lib/types";
import { isAdmin, useMe } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Badge, Empty, ErrorNote, PageHeader, Panel, PanelHeader, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

const NOTICE = "Community copy of the government text. It may lag recent amendments: check it against India Code before you cite it.";

export default function ActsPage() {
  return <Suspense fallback={<Spinner label="Opening Bare Acts" />}><Acts /></Suspense>;
}

function Acts() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const admin = isAdmin(me?.user.role);
  const code = params.get("act") ?? "";
  const no = params.get("no") ?? "";
  const [text, setText] = useState("");
  const dq = useDeferredValue(text.trim());
  const go = (act: string, n = "") => router.push(`/acts${qs({ act, no: n })}`);

  const list = useQuery({ queryKey: ["acts"], queryFn: () => api.get<{ acts: ActSummary[]; catalog: string[] }>("/acts"), refetchInterval: (q) => (q.state.data?.acts.some((a) => a.loaded) ? false : 4000) });
  const loaded = list.data?.acts.filter((a) => a.loaded) ?? [];
  const current = code || loaded[0]?.code || "";
  const detail = useQuery({ queryKey: ["act", current], enabled: !!current && loaded.some((a) => a.code === current), queryFn: () => api.get<ActDetail>(`/acts/${current}`) });
  const section = useQuery({ queryKey: ["act-section", current, no], enabled: !!current && !!no && !!detail.data, queryFn: () => api.get<SectionDetail>(`/acts/${current}/${encodeURIComponent(no)}`), retry: false });
  const hits = useQuery({ queryKey: ["act-search", dq, current], enabled: dq.length >= 1, queryFn: () => api.get<{ results: SectionHit[] }>(`/acts/search${qs({ q: dq })}`) });

  const importAll = useMutation({
    mutationFn: () => api.post("/acts/import", {}),
    onSuccess: () => { toast.success("Downloading Acts. Watch progress on the Library page."); setTimeout(() => qc.invalidateQueries({ queryKey: ["acts"] }), 8000); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (list.isLoading) return <Spinner label="Opening Bare Acts" />;
  if (list.isError) return <ErrorNote error={list.error} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Bare Acts" sub="Sections of the Acts you cite, linked to the judgments in your library that discuss them."
        actions={admin ? <Button size="sm" onClick={() => importAll.mutate()} loading={importAll.isPending}><Download className="h-3.5 w-3.5" /> Download Acts</Button> : undefined} />

      {loaded.length === 0 ? (
        <Panel><Empty icon={BookOpen} title="No Acts loaded yet" action={admin ? <Button variant="primary" onClick={() => importAll.mutate()} loading={importAll.isPending}><Download className="h-4 w-4" /> Download the standard Acts</Button> : undefined}>
          {admin ? "Downloads IPC, CrPC, CPC, the Evidence Act, the NI Act, the Motor Vehicles Act and the Constitution, and the IPC→BNS, CrPC→BNSS and Evidence Act→BSA tables. Load BNS, BNSS and BSA from the official PDFs below."
            : "Ask an owner or admin to load the Acts from this page."}
        </Empty>{admin && <Upload acts={list.data!.acts} onDone={() => qc.invalidateQueries({ queryKey: ["acts"] })} />}</Panel>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input value={text} onChange={(e) => setText(e.target.value)} className="h-11 pl-9 text-md" aria-label="Find a section"
              placeholder="138   ·   139 ni act   ·   presumption in favour of holder   ·   inherent powers" />
          </div>

          {dq ? (
            <Panel>
              <PanelHeader title={`Sections matching “${dq}”`} />
              {hits.isLoading ? <div className="p-4"><Spinner /></div> : !hits.data?.results.length ? <Empty icon={Search} title="No section matched">Try the section number, or fewer words.</Empty> : (
                <ul className="divide-y divide-rule">
                  {hits.data.results.map((h) => (
                    <li key={`${h.act}-${h.no}`}>
                      <button onClick={() => { setText(""); go(h.act, h.no); }} className="block w-full px-4 py-3 text-left hover:bg-vellum">
                        <p className="text-base"><span className="font-medium text-brass">{h.short} s.{h.no}</span> <span className="text-text">{h.heading}</span>{h.exact && <Badge tone="leaf" className="ml-2">section</Badge>}</p>
                        {h.snippet && <p className="mt-0.5 text-sm text-muted [&_mark]:rounded-sm [&_mark]:bg-brass-soft [&_mark]:text-brass" dangerouslySetInnerHTML={{ __html: h.snippet }} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-4">
                <Panel>
                  <PanelHeader title="Acts" />
                  <ul className="max-h-60 overflow-y-auto scrollbar-thin py-1">
                    {loaded.map((a) => (
                      <li key={a.code}>
                        <button onClick={() => go(a.code)} aria-current={a.code === current}
                          className={cn("flex w-full items-center justify-between gap-2 px-4 py-1.5 text-left text-base hover:bg-vellum", a.code === current && "bg-brass-soft text-brass")}>
                          <span className="truncate">{a.name}</span>
                          <span className="text-xs tabular-nums text-faint">{a.n_sections}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>
                {detail.data && <SectionList act={detail.data} current={no} onPick={(n) => go(detail.data!.code, n)} />}
              </div>

              <div className="min-w-0">
                {!no ? (
                  <Panel><Empty icon={Gavel} title={detail.data?.name ?? "Choose a section"}>
                    {detail.data && <>
                      <p>{detail.data.n_sections} sections · {detail.data.official ? "official text" : "community copy"}{detail.data.imported_at && ` · loaded ${fmtDate(detail.data.imported_at)}`}</p>
                      {!detail.data.official && <p className="mt-2 text-amber">{NOTICE}</p>}
                    </>}
                  </Empty></Panel>
                ) : section.isLoading ? <Spinner label="Opening section" /> : section.isError ? <ErrorNote error={section.error} /> : section.data && <Reader s={section.data} loaded={loaded} go={go} />}
              </div>
            </div>
          )}
          {admin && <Panel><PanelHeader title="Load official text" sub="For BNS, BNSS and BSA, or to replace any Act with the official copy from India Code or the Gazette." /><Upload acts={list.data!.acts} onDone={() => qc.invalidateQueries()} /></Panel>}
        </>
      )}
    </div>
  );
}

function SectionList({ act, current, onPick }: { act: ActDetail; current: string; onPick: (n: string) => void }) {
  const [f, setF] = useState("");
  const rows = useMemo(() => { const q = f.trim().toLowerCase(); return q ? act.sections.filter((s) => s.no.toLowerCase() === q || s.no.toLowerCase().startsWith(q) || s.heading.toLowerCase().includes(q)) : act.sections; }, [act, f]);
  return (
    <Panel>
      <PanelHeader title={act.short} sub={`${act.n_sections} sections`} />
      <div className="p-2"><Input value={f} onChange={(e) => setF(e.target.value)} placeholder="Filter by number or title" className="h-8 text-sm" aria-label="Filter sections" /></div>
      <ul className="max-h-[52vh] overflow-y-auto scrollbar-thin pb-1">
        {rows.slice(0, 600).map((s) => (
          <li key={s.no}>
            <button onClick={() => onPick(s.no)} aria-current={s.no === current}
              className={cn("flex w-full items-baseline gap-2 px-4 py-1 text-left text-sm hover:bg-vellum", s.no === current && "bg-brass-soft text-brass")}>
              <span className="w-10 shrink-0 font-medium tabular-nums">{s.no}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{s.heading || "—"}</span>
              {s.judgments > 0 && <span className="text-xs tabular-nums text-faint" title="Judgments in your library">{s.judgments}</span>}
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-3 text-sm text-faint">No section matches.</li>}
      </ul>
    </Panel>
  );
}

function Reader({ s, loaded, go }: { s: SectionDetail; loaded: ActSummary[]; go: (a: string, n?: string) => void }) {
  const have = new Set(loaded.map((a) => a.code));
  const nameOf = (c?: string) => (c ? c.toUpperCase() : "");
  return (
    <div className="space-y-4">
      <Panel className="p-6">
        <p className="text-sm text-cyan">{s.act_name}{s.chapter && ` · ${s.chapter}`}</p>
        <h2 className="font-display mt-1 text-xl font-semibold">Section {s.no}. {s.heading}</h2>
        {!s.official && <p className="mt-3 flex gap-2 rounded-md border border-amber/30 bg-amber-soft p-2.5 text-sm text-amber"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{NOTICE}</p>}
        <div className="prose-judgment mt-4 max-w-[74ch] whitespace-pre-line text-[16px] leading-relaxed">{s.text || <span className="text-faint">The text of this section is empty in the source. Check India Code.</span>}</div>
        <div className="mt-6 flex justify-between gap-3 border-t border-rule pt-3 text-sm">
          {s.prev ? <button onClick={() => go(s.act, s.prev!.no)} className="text-muted hover:text-brass">← s.{s.prev.no} {s.prev.heading}</button> : <span />}
          {s.next && <button onClick={() => go(s.act, s.next!.no)} className="text-right text-muted hover:text-brass">s.{s.next.no} {s.next.heading} →</button>}
        </div>
      </Panel>

      {(s.new.length > 0 || s.old.length > 0 || s.deleted_in_new) && (
        <Panel>
          <PanelHeader title="Old and new law" sub="IPC→BNS, CrPC→BNSS and Evidence Act→BSA (CC-BY-4.0 mapping). Check the new text before relying on the change." />
          <ul className="divide-y divide-rule">
            {s.new.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-base">
                <Badge tone={m.status === "Retained" ? "leaf" : "amber"}>{m.status}</Badge>
                <span>now</span>
                {have.has(m.new_act!) ? <button onClick={() => go(m.new_act!, m.new_no)} className="font-medium text-brass hover:underline">{nameOf(m.new_act)} s.{m.new_no}</button> : <span className="font-medium">{nameOf(m.new_act)} s.{m.new_no}</span>}
              </li>
            ))}
            {s.old.map((m, i) => (
              <li key={`o${i}`} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-base">
                <Badge tone={m.status === "Retained" ? "leaf" : "amber"}>{m.status}</Badge>
                <span>was</span>
                {have.has(m.old_act!) ? <button onClick={() => go(m.old_act!, m.old_no)} className="font-medium text-brass hover:underline">{nameOf(m.old_act)} s.{m.old_no}</button> : <span className="font-medium">{nameOf(m.old_act)} s.{m.old_no}</span>}
              </li>
            ))}
            {s.deleted_in_new && <li className="px-4 py-2.5 text-base text-amber">Not carried into the new law ({s.deleted_in_new.status}).</li>}
          </ul>
        </Panel>
      )}

      <Panel>
        <PanelHeader title="Judgments that discuss this section" sub={s.judgments ? `${s.judgments} in your library, most discussed first` : undefined} />
        {s.cases.length === 0 ? <p className="p-4 text-sm text-muted">None in your library yet. Load more judgments from the Library page and they are tagged automatically.</p> : (
          <ul className="divide-y divide-rule">
            {s.cases.map((c) => (
              <li key={c.id}>
                <Link href={`/judgments/${encodeURIComponent(c.id)}${c.paras[0] !== undefined ? `?para=${c.paras[0]}` : ""}`} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-vellum">
                  <span className="min-w-0"><span className="block truncate text-base">{c.title}</span>
                    <span className="text-sm text-muted">{[c.citation, c.court, c.year].filter(Boolean).join(" · ")}{c.paras.length ? ` · para ${c.paras.join(", ")}` : ""}</span></span>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-rule px-4 py-2.5 text-sm"><Link className="text-brass hover:underline" href={`/research${qs({ q: `section ${s.no}`, act: s.act, section: s.no })}`}>Search inside these judgments →</Link></div>
      </Panel>
    </div>
  );
}

function Upload({ acts, onDone }: { acts: ActSummary[]; onDone: () => void }) {
  const [code, setCode] = useState("bns");
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append("code", code); fd.append("file", file!); return api.upload<{ count: number }>("/acts/upload", fd); },
    onSuccess: (r) => { toast.success(`${r.count} sections saved`); setFile(null); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const a = acts.find((x) => x.code === code);
  return (
    <div className="flex flex-wrap items-end gap-3 p-4">
      <label className="block space-y-1.5"><span className="text-sm font-medium">Act</span>
        <Select value={code} onChange={(e) => setCode(e.target.value)} className="w-72">{acts.map((x) => <option key={x.code} value={x.code}>{x.name}{x.expected ? ` (${x.expected} sections)` : ""}</option>)}</Select></label>
      <input ref={ref} type="file" accept=".pdf,.txt" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <Button onClick={() => ref.current?.click()}><FileUp className="h-4 w-4" />{file ? file.name : "Choose PDF or text"}</Button>
      <Button variant="primary" disabled={!file} loading={m.isPending} onClick={() => m.mutate()}>Load</Button>
      <p className="basis-full text-sm text-faint">{a?.expected ? `The load is refused unless exactly ${a.expected} sections are found, so a damaged PDF cannot replace good text. ` : ""}Scanned PDFs need OCR first.</p>
    </div>
  );
}
