"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Cpu, Database, FileUp, Landmark, Play, Square, Trash2, Waypoints } from "lucide-react";
import { api } from "@/lib/api";
import type { LibraryStatus } from "@/lib/types";
import { isAdmin, useMe } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Badge, ErrorNote, PageHeader, Panel, PanelHeader, Spinner, Tabs } from "@/components/ui/misc";
import { QualityPanel } from "@/components/data/quality-panel";
import { cn } from "@/lib/utils";

type Source = "sc" | "hc" | "files";
type Status = LibraryStatus & { example_data?: { matters: number; judgments: number }; quality?: Record<string, number> };

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 1950 + 1 }, (_, i) => THIS_YEAR - i);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="font-display mt-1 text-[1.75rem] font-semibold leading-none tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-faint">{sub}</p>}
    </div>
  );
}

function CopyCmd({ cmd }: { cmd: string }) {
  return (
    <button onClick={() => { navigator.clipboard?.writeText(cmd); toast.success("Copied"); }} title="Copy"
      className="block w-full rounded-md border border-rule bg-vellum px-3 py-1.5 text-left font-mono text-sm text-text hover:border-brass/50">{cmd}</button>
  );
}

export default function LibraryPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const admin = isAdmin(me?.user.role);
  const st = useQuery({
    queryKey: ["library"], queryFn: () => api.get<Status>("/library/status"),
    refetchInterval: (q) => (q.state.data?.job.state === "running" ? 1500 : 15000),
  });
  const courts = useQuery({ queryKey: ["hc-courts"], queryFn: () => api.get<{ code: string; name: string }[]>("/library/hc-courts"), staleTime: Infinity });

  const [source, setSource] = useState<Source>("sc");
  const [from, setFrom] = useState(THIS_YEAR - 2);
  const [to, setTo] = useState(THIS_YEAR);
  const [court, setCourt] = useState("27_1");
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const job = st.data?.job;
  const running = job?.state === "running";
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [job?.log.length]);
  const prevState = useRef(job?.state);
  useEffect(() => {
    if (prevState.current === "running" && job && job.state !== "running") {
      qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["health"] });
      if (job.state === "done") toast.success(`Library updated: ${job.added.toLocaleString("en-IN")} judgments added`);
      if (job.state === "failed") toast.error("Loading stopped with an error");
    }
    prevState.current = job?.state;
  }, [job, qc]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["library"] });
  const load = useMutation({
    mutationFn: () => {
      if (source === "files") {
        const fd = new FormData(); files.forEach((f) => fd.append("files", f));
        return api.upload("/library/upload", fd);
      }
      const years = []; for (let y = Math.min(from, to); y <= Math.max(from, to); y++) years.push(y);
      return api.post("/library/load", { source, years, courts: source === "hc" ? [court] : [] });
    },
    onSuccess: () => { setFiles([]); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const stop = useMutation({ mutationFn: () => api.post("/library/stop"), onSuccess: refresh });
  const embed = useMutation({ mutationFn: () => api.post("/library/embed"), onSuccess: refresh, onError: (e) => toast.error((e as Error).message) });
  const removeExamples = useMutation({
    mutationFn: () => api.post<{ removed_matters: number; removed_judgments: number }>("/firm/remove-example-data"),
    onSuccess: (r) => { toast.success(`Removed ${r.removed_matters} example matters and ${r.removed_judgments} example judgments`); qc.invalidateQueries(); },
  });

  if (st.isLoading) return <Spinner label="Reading the library" />;
  if (st.isError) return <ErrorNote error={st.error} />;
  const s = st.data!;
  const c = s.corpus;
  const courtMax = Math.max(1, ...c.courts.map((x) => x.count));
  const yearsCount = Math.abs(to - from) + 1;
  const ex = s.example_data;

  return (
    <div className="space-y-6">
      <PageHeader title="Library" sub="The judgments Nyaay searches, quotes and checks citations against. Everything here comes from official open data or your own files." />

      {ex && (ex.matters > 0 || ex.judgments > 0) && (
        <Panel className="flex flex-wrap items-center gap-4 border-amber/30 p-4">
          <CircleAlert className="h-5 w-5 text-amber" />
          <div className="flex-1 min-w-[240px]">
            <p className="font-medium">Example data found</p>
            <p className="text-sm text-muted">{ex.matters} fictional matters and {ex.judgments} fictional judgments from an earlier demo. Remove them so only real work remains.</p>
          </div>
          <Button variant="danger" disabled={!admin} loading={removeExamples.isPending}
            onClick={() => { if (confirm("Permanently delete all example matters and judgments?")) removeExamples.mutate(); }}>
            <Trash2 className="h-4 w-4" /> Remove example data
          </Button>
        </Panel>
      )}

      <Panel className="grid grid-cols-2 lg:grid-cols-4 lg:divide-x divide-rule overflow-hidden">
        <Stat label="Real judgments" value={c.real_judgments.toLocaleString("en-IN")} />
        <Stat label="Paragraphs indexed" value={c.paragraphs.toLocaleString("en-IN")} />
        <Stat label="Courts" value={String(c.courts.length)} />
        <Stat label="Years covered" value={c.year_min ? `${c.year_min}–${c.year_max}` : "—"} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Panel>
          <PanelHeader title="Load judgments" sub="Runs on your computer. Already-loaded judgments are skipped, so you can stop and resume any time." />
          <div className="p-4 space-y-4">
            <Tabs value={source} onChange={setSource} items={[
              { value: "sc", label: <span className="inline-flex items-center gap-1.5"><Landmark className="h-4 w-4" />Supreme Court</span> },
              { value: "hc", label: <span className="inline-flex items-center gap-1.5"><Landmark className="h-4 w-4" />High Courts</span> },
              { value: "files", label: <span className="inline-flex items-center gap-1.5"><FileUp className="h-4 w-4" />Your files</span> },
            ]} />
            {source !== "files" ? (
              <>
                {source === "hc" && (
                  <Field label="High Court">
                    <Select value={court} onChange={(e) => setCourt(e.target.value)}>
                      {(courts.data ?? [{ code: "27_1", name: "Bombay High Court" }]).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
                    </Select>
                  </Field>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From year"><Select value={from} onChange={(e) => setFrom(+e.target.value)}>{YEARS.map((y) => <option key={y}>{y}</option>)}</Select></Field>
                  <Field label="To year"><Select value={to} onChange={(e) => setTo(+e.target.value)}>{YEARS.map((y) => <option key={y}>{y}</option>)}</Select></Field>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[["This year", 0], ["Last 3 years", 2], ["Last 10 years", 9], ["Since 2000", THIS_YEAR - 2000]].map(([l, n]) => (
                    <button key={l as string} onClick={() => { setFrom(THIS_YEAR - (n as number)); setTo(THIS_YEAR); }}
                      className="rounded-sm border border-rule px-2 py-0.5 text-sm text-muted hover:border-brass/50 hover:text-text">{l}</button>
                  ))}
                </div>
                <p className="text-sm text-faint">
                  {source === "sc" ? "Source: Supreme Court of India judgments on AWS Open Data (CC-BY-4.0)." : "Source: Indian High Court judgments on AWS Open Data, collected from the eCourts portal."}
                  {" "}About {source === "sc" ? "1,000" : "several thousand"} judgments a year; {yearsCount > 3 ? "a long range can run overnight." : "expect minutes to an hour."}
                </p>
              </>
            ) : (
              <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFiles([...e.dataTransfer.files].filter((f) => /\.(pdf|txt)$/i.test(f.name))); }}
                className="rounded-lg border border-dashed border-rule-strong p-6 text-center">
                <FileUp className="mx-auto h-6 w-6 text-faint" />
                <p className="mt-2 text-base">Drop judgment PDFs or text files here</p>
                <p className="text-sm text-faint">Text-based PDFs only; scanned PDFs need OCR first. Up to 200 files.</p>
                <input ref={fileRef} type="file" multiple accept=".pdf,.txt" className="hidden" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
                <Button size="sm" className="mt-3" onClick={() => fileRef.current?.click()}>Choose files</Button>
                {files.length > 0 && <p className="mt-2 text-sm text-brass">{files.length} file(s) ready</p>}
              </div>
            )}
            <div className="flex items-center gap-2">
              {running ? (
                <Button variant="danger" onClick={() => stop.mutate()} loading={stop.isPending}><Square className="h-4 w-4" /> Stop after this batch</Button>
              ) : (
                <Button variant="primary" disabled={!admin || (source === "files" && !files.length)} loading={load.isPending} onClick={() => load.mutate()}>
                  <Play className="h-4 w-4" /> {source === "files" ? "Add files" : "Start loading"}
                </Button>
              )}
              {!admin && <span className="text-sm text-faint">Only owners and admins can load judgments.</span>}
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Activity" sub={job?.label || "No job yet"} action={job && job.state !== "idle" ? (
            <Badge tone={running ? "cyan" : job.state === "done" ? "leaf" : job.state === "failed" ? "tape" : "amber"}>
              {running && <span className="h-1.5 w-1.5 rounded-full bg-cyan pulse-dot text-cyan" />}
              {{ running: "Running", done: "Finished", stopped: "Stopped", failed: "Failed", idle: "Idle" }[job.state]}
            </Badge>
          ) : undefined} />
          <div className="grid grid-cols-2 divide-x divide-rule border-b border-rule">
            <Stat label="Added" value={(job?.added ?? 0).toLocaleString("en-IN")} />
            <Stat label="Failed" value={(job?.failed ?? 0).toLocaleString("en-IN")} />
          </div>
          {running && <div className="h-0.5 overflow-hidden bg-vellum"><div className="h-full w-1/3 bg-gradient-to-r from-transparent via-cyan to-transparent animate-[scan_1.6s_linear_infinite]" /></div>}
          {job?.error && <ErrorNote error={job.error} className="m-4" />}
          <div ref={logRef} className="h-64 overflow-y-auto scrollbar-thin px-4 py-3 font-mono text-[12px] leading-5 text-muted">
            {job?.log.length ? job.log.map((l, i) => <div key={i} className={cn(i === job.log.length - 1 && running && "text-cyan")}>{l}</div>) : <p className="font-sans text-sm text-faint">Progress appears here while judgments load.</p>}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Courts in your library" />
          {c.courts.length === 0 ? <p className="p-4 text-sm text-muted">No judgments loaded yet.</p> : (
            <ul className="space-y-2.5 p-4">
              {c.courts.slice(0, 10).map((x, i) => (
                <li key={x.court}>
                  <div className="mb-1 flex justify-between gap-2 text-sm"><span className="truncate text-muted">{x.court}</span><span className="tabular-nums">{x.count.toLocaleString("en-IN")}</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-vellum">
                    <motion.div className="h-full rounded-full bg-gradient-to-r from-brass to-cyan" initial={{ width: 0 }} animate={{ width: `${(x.count / courtMax) * 100}%` }} transition={{ delay: i * 0.04, duration: 0.6 }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Local AI" sub="Ollama on this computer" action={<Cpu className={cn("h-4 w-4", s.ai.ready ? "text-leaf" : "text-amber")} />} />
          <div className="space-y-3 p-4 text-sm">
            <p className={cn("flex items-center gap-2", s.ai.ready ? "text-leaf" : "text-amber")}>
              {s.ai.ready ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}{s.ai.message}
            </p>
            {s.ai.model && <p className="text-muted">Answers: <span className="text-text">{s.ai.model}</span>{s.ai.model_fast && <> · Routine work: <span className="text-text">{s.ai.model_fast}</span></>}</p>}
            {(s.ai.missing ?? []).map((m) => <CopyCmd key={m} cmd={`ollama pull ${m}`} />)}
            {!s.ai.ready && !(s.ai.missing ?? []).length && <p className="text-muted">Install Ollama from ollama.com, open it, then run the commands under Settings → AI.</p>}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Search by meaning" sub="Finds paragraphs with the same idea in different words" action={<Waypoints className={cn("h-4 w-4", s.semantic.ready ? "text-cyan" : "text-faint")} />} />
          <div className="space-y-3 p-4 text-sm">
            <div className="flex justify-between"><span className="text-muted">Paragraphs with vectors</span><span className="tabular-nums">{s.semantic.vectors.toLocaleString("en-IN")} / {s.semantic.paragraphs.toLocaleString("en-IN")}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-vellum"><div className="h-full rounded-full bg-cyan" style={{ width: `${s.semantic.paragraphs ? (s.semantic.vectors / s.semantic.paragraphs) * 100 : 0}%` }} /></div>
            <p className="text-muted">{s.semantic.model ? `Model: ${s.semantic.model}` : "Needs Ollama with nomic-embed-text."} New judgments get vectors automatically after loading.</p>
            <Button size="sm" disabled={!admin || running || !s.semantic.paragraphs} loading={embed.isPending} onClick={() => embed.mutate()}><Database className="h-3.5 w-3.5" /> Build missing vectors</Button>
          </div>
        </Panel>
      </div>

      <QualityPanel admin={admin} running={!!running} onJob={refresh} />
    </div>
  );
}
