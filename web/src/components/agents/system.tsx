"use client";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ArrowLeftRight, BookOpenCheck, CalendarClock, CheckCheck, Cpu, FileScan, FileSignature, Gavel, Layers, MessageSquareText, NotebookPen, Search, ShieldCheck, Sparkles, Square, Swords, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { Activity, ApprovalQueue, LibraryStatus } from "@/lib/types";
import { plural, timeAgo } from "@/lib/format";
import { isAdmin, useHealth, useMe, type Health } from "@/lib/hooks";
import { Badge, Empty, ErrorNote, Panel, PanelHeader, Skeleton } from "@/components/ui/misc";
import { Titled } from "@/components/ui/info";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Everything on this screen is read from the running system: /health, /library/status, /approvals/queue
// and /activity. Capability availability is derived from those states using the engine each feature
// actually uses (see docs/redesign/AUDIT.md, "Capabilities"). Nothing here is simulated.

type Ocr = { tesseract?: boolean; ready?: boolean; languages_installed?: string[]; languages_missing?: string[]; rasteriser?: string | null };
type LibStatus = LibraryStatus & { ocr?: Ocr; job: LibraryStatus["job"] & { duplicates?: number } };
type Level = "full" | "reduced" | "off";

function useSystem() {
  const { data: me } = useMe();
  const health = useHealth();
  const lib = useQuery({
    queryKey: ["library-status"], queryFn: () => api.get<LibStatus>("/library/status"),
    refetchInterval: (q) => (q.state.data?.job.state === "running" ? 2000 : 30_000),
  });
  const h = health.data;
  const ai = h?.ai;
  const aiOn = !!ai?.ready && (me?.firm.settings.ai_enabled ?? true);
  return { me, health, h, ai, aiOn, lib, ocr: lib.data?.ocr, semantic: lib.data?.semantic };
}

/** System health: one card per part Nyaay depends on, read live from /health and /library/status. */
export function SystemHealth() {
  const { me, health, h, ai, aiOn, lib, ocr, semantic } = useSystem();
  return (
    <section aria-labelledby="health-h">
      <h2 id="health-h" className="mb-3 flex items-center gap-2 text-md font-medium"><Titled k="System health">System health</Titled></h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Runtime icon={Cpu} title="Local AI" level={health.isError ? "off" : !ai ? undefined : aiOn ? "full" : "off"}
          value={health.isError ? "Server offline" : ai ? (ai.ready ? ai.model ?? ai.provider : "Not running") : null}
          lines={ai ? [
            ai.ready ? `Fast model: ${ai.model_fast ?? "same"}` : ai.message,
            ...(ai.missing?.length ? [`Missing models: ${ai.missing.join(", ")}`] : []),
            ...(me && !me.firm.settings.ai_enabled ? ["Turned off for your chambers in Settings"] : []),
            ...(me?.firm.settings.redact_pii ? ["Names and numbers are masked before the model sees them"] : []),
          ] : []} />
        <Runtime icon={Layers} title="Judgment library" level={!h ? undefined : h.real_judgments > 0 ? "full" : "reduced"}
          value={h ? `${h.real_judgments.toLocaleString("en-IN")} real ${h.real_judgments === 1 ? "judgment" : "judgments"}` : null}
          lines={lib.data ? [`${lib.data.corpus.paragraphs.toLocaleString("en-IN")} paragraphs searchable`,
            ...(h && h.judgments_indexed > h.real_judgments ? [`Plus ${plural(h.judgments_indexed - h.real_judgments, "fictional test judgment")}`] : []),
            ...(lib.data.corpus.year_min ? [`Decided ${lib.data.corpus.year_min} to ${lib.data.corpus.year_max}`] : [])] : []} />
        <Runtime icon={Search} title="Meaning search" level={!semantic ? undefined : semantic.ready ? "full" : "reduced"}
          value={semantic ? (semantic.ready ? "On" : "Off, keyword search only") : null}
          lines={semantic ? [`${semantic.vectors.toLocaleString("en-IN")} of ${semantic.paragraphs.toLocaleString("en-IN")} paragraphs indexed`, ...(semantic.model ? [`Model: ${semantic.model}`] : [])] : lib.isError ? ["Visible to advocates and above"] : []}
          action={semantic && !semantic.ready && isAdmin(me?.user.role) && semantic.paragraphs > 0 ? <BuildIndex /> : undefined} />
        <Runtime icon={FileScan} title="Reading scans (OCR)" level={!ocr ? undefined : ocr.ready ? "full" : "off"}
          value={ocr ? (ocr.ready ? "Tesseract ready" : "Not installed") : null}
          lines={ocr ? [
            ...(ocr.languages_installed?.length ? [`${ocr.languages_installed.length} languages installed`] : []),
            ...(ocr.languages_missing?.length ? [`Missing: ${ocr.languages_missing.join(", ")}`] : []),
            ...(!ocr.ready ? ["Scanned orders cannot be read until Tesseract is installed (see README)"] : []),
          ] : lib.isError ? ["Visible to advocates and above"] : []} />
      </div>
    </section>
  );
}

/** Every feature, what it relies on, and what it can do with the system as it is now. */
export function CapabilitiesPanel() {
  const { h, aiOn, ocr, semantic } = useSystem();
  return (
    <Panel>
      <PanelHeader title="Capabilities" sub="What each feature uses, and what it can do with the system as it is now" />
      {!h ? <div className="space-y-3 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : (
        <ul className="relative z-[3] grid divide-rule md:grid-cols-2 md:[&>li:nth-child(odd)]:border-r [&>li]:border-b [&>li]:border-rule md:[&>li:last-child:nth-child(odd)]:col-span-2 md:[&>li:last-child:nth-child(odd)]:border-r-0">
          {capabilities(h, aiOn, !!ocr?.ready, !!semantic?.ready).map((c) => (
            <li key={c.name} className="flex gap-4 px-4 py-3.5">
              <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border",
                c.level === "full" ? "border-leaf/30 bg-leaf-soft text-leaf" : c.level === "reduced" ? "border-amber/30 bg-amber-soft text-amber" : "border-rule bg-vellum text-faint")}>
                <c.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={c.href} className="font-medium hover:text-brass">{c.name}</Link>
                  {c.engines.map((e) => <Badge key={e} tone={e === "Local AI" ? "cyan" : e === "Fixed rules" ? "brass" : "neutral"}>{e}</Badge>)}
                </div>
                <p className="mt-0.5 text-sm text-muted">{c.what}</p>
                <p className={cn("mt-1 text-sm", c.level === "full" ? "text-leaf" : c.level === "reduced" ? "text-amber" : "text-faint")}>{c.now}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Library jobs in progress. */
export function RunningNow() {
  const { me, lib } = useSystem();
  return <JobPanel lib={lib.data} error={lib.error} canStop={isAdmin(me?.user.role)} />;
}

/** Proposals waiting for an advocate. */
export function WaitingPanel() {
  const queue = useQuery({ queryKey: ["approvals-queue"], queryFn: () => api.get<ApprovalQueue>("/approvals/queue"), refetchInterval: 60_000 });
  return (
    <Panel lit>
      <PanelHeader title="Waiting for an advocate" sub="AI and rule proposals are never applied until an advocate approves them" action={<Link href="/approvals" className="text-sm text-brass hover:underline">Review</Link>} />
      <div className="relative z-[3] p-4">
        {queue.isLoading ? <Skeleton className="h-10" /> : queue.isError ? <ErrorNote error={queue.error} /> : (
          <>
            <p className="tnum text-3xl font-semibold text-brass">{queue.data!.total}</p>
            <p className="mt-1 text-sm text-muted">{queue.data!.summary}</p>
            {queue.data!.groups.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {queue.data!.groups.slice(0, 5).map((g) => (
                  <li key={g.matter.id} className="flex items-center justify-between gap-3 text-sm">
                    <Link href={`/matters/${g.matter.id}`} className="min-w-0 truncate hover:text-brass">{g.matter.title}</Link>
                    <span className="tnum shrink-0 text-faint">{g.tasks.length}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

/** Automatic work, from the activity log. */
export function DoneByNyaay() {
  const activity = useQuery({ queryKey: ["activity"], queryFn: () => api.get<Activity[]>("/activity?limit=50") });
  return (
    <Panel>
      <PanelHeader title="Done by Nyaay" sub="Recent automatic work, from the activity log" />
      {activity.isLoading ? <div className="p-4"><Skeleton className="h-20" /></div> : (
        (() => {
          const list = (activity.data ?? []).filter((a) => a.actor === "system").slice(0, 8);
          return list.length === 0 ? <Empty title="Nothing automatic yet">Order reading, eCourts sync and the morning brief log their work here.</Empty> : (
            <ul className="relative z-[3] divide-y divide-rule">
              {list.map((a) => (
                <li key={a.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
                  <span className="w-16 shrink-0 text-faint">{timeAgo(a.at)}</span>
                  <span className="min-w-0 flex-1 text-muted">{a.text}{a.matter_id && <>, in <Link className="hover:text-brass" href={`/matters/${a.matter_id}`}>{a.matter}</Link></>}</span>
                </li>
              ))}
            </ul>
          );
        })()
      )}
    </Panel>
  );
}

function Runtime({ icon: Icon, title, level, value, lines, action }:
  { icon: React.ComponentType<{ className?: string }>; title: string; level?: Level; value: string | null; lines: string[]; action?: React.ReactNode }) {
  const tone = level === "full" ? "bg-leaf" : level === "reduced" ? "bg-amber" : level === "off" ? "bg-tape" : "bg-faint";
  return (
    <Panel lit tilt={5} className="min-h-[136px] p-4">
      <div className="relative z-[3]">
        <div className="depth-3 flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-sm text-muted"><Icon className="h-4 w-4" />{title}</span>
          <span role="img" className="relative grid h-3 w-3 place-items-center" aria-label={level === "full" ? "Working" : level === "reduced" ? "Partly working" : level === "off" ? "Not working" : "Checking"}>
            {level === "full" && <span className={cn("absolute inset-0 rounded-full opacity-40 animate-[breathe_2.4s_ease-in-out_infinite]", tone)} />}
            <span className={cn("h-2 w-2 rounded-full", tone)} />
          </span>
        </div>
        {value === null ? <Skeleton className="mt-3 h-6 w-32" /> : <p className="depth-2 mt-2 truncate text-lg font-medium" title={value}>{value}</p>}
        <ul className="depth-1 mt-2 space-y-0.5 text-xs text-faint">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </Panel>
  );
}

function BuildIndex() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post("/library/embed"),
    onSuccess: () => { toast.success("Building the meaning index"); qc.invalidateQueries({ queryKey: ["library-status"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  return <Button size="sm" onClick={() => m.mutate()} loading={m.isPending}>Build meaning index</Button>;
}

function JobPanel({ lib, error, canStop }: { lib?: LibStatus; error: unknown; canStop: boolean }) {
  const qc = useQueryClient();
  const stop = useMutation({
    mutationFn: () => api.post("/library/stop"),
    onSuccess: () => { toast.success("Stopping after the current batch"); qc.invalidateQueries({ queryKey: ["library-status"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const job = lib?.job;
  const running = job?.state === "running";
  return (
    <Panel level={running ? 4 : 3}>
      <PanelHeader title="Running now" sub="Library loading and indexing jobs" action={<Link href="/library" className="text-sm text-brass hover:underline">Library</Link>} />
      <div className="relative z-[3] p-4">
        {error ? <p className="text-sm text-muted">Job status is visible to advocates and above.</p> : !job ? <Skeleton className="h-10" /> : (
          <>
            <div className="flex items-center gap-3">
              <span className={cn("relative grid h-9 w-9 place-items-center rounded-xl border", running ? "border-cyan/40 bg-cyan-soft text-cyan" : "border-rule bg-vellum text-faint")}>
                {running ? <RefreshCw className="h-4 w-4 animate-spin [animation-duration:2s]" /> : <Square className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{running ? job.label || "Working" : job.state === "idle" ? "Nothing is running" : `Last job ${job.state}: ${job.label}`}</p>
                <p className="tnum text-sm text-muted">
                  {job.state === "idle" ? "Load judgments from the Library." : `${job.added.toLocaleString("en-IN")} added${job.failed ? `, ${job.failed} failed` : ""}${job.duplicates ? `, ${job.duplicates} already in the library` : ""}${job.finished_at ? `, finished ${timeAgo(job.finished_at)}` : job.started_at ? `, started ${timeAgo(job.started_at)}` : ""}`}
                </p>
              </div>
              {running && canStop && <Button size="sm" variant="ghost" onClick={() => stop.mutate()} loading={stop.isPending}>Stop</Button>}
            </div>
            {running && <div className="mt-3 h-1 overflow-hidden rounded-full bg-vellum" aria-hidden><div className="h-full w-1/3 bg-gradient-to-r from-transparent via-cyan to-transparent animate-[scan_1.8s_linear_infinite]" /></div>}
            {job.error && <ErrorNote error={new Error(job.error)} className="mt-3" />}
            <AnimatePresence initial={false}>
              {job.log.length > 0 && (
                <motion.ol initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 max-h-40 space-y-0.5 overflow-y-auto scrollbar-thin rounded-lg border border-rule bg-vellum p-2.5 font-mono text-[11.5px] leading-5 text-muted" aria-live="polite">
                  {job.log.slice(-12).map((l, i) => <li key={`${i}-${l}`}>{l}</li>)}
                </motion.ol>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </Panel>
  );
}

type Cap = { name: string; icon: React.ComponentType<{ className?: string }>; href: string; engines: string[]; what: string; level: Level; now: string };

// Derived from the audited engine of each feature (docs/redesign/AUDIT.md). Only states the system reports.
function capabilities(h: Health, ai: boolean, ocr: boolean, semantic: boolean): Cap[] {
  const lib = h.real_judgments > 0 || h.judgments_indexed > 0;
  return [
    { name: "Search judgments", icon: Search, href: "/research", engines: ["Library search", ...(semantic ? ["Meaning search"] : [])],
      what: "Paragraph-level keyword search with legal synonyms, fused with meaning search when the index is built.",
      level: lib ? (semantic ? "full" : "reduced") : "off", now: !lib ? "Load judgments first." : semantic ? "Keyword and meaning search." : "Keyword search only. Build the meaning index for better recall." },
    { name: "Ask with cited answers", icon: Sparkles, href: "/research", engines: ["Library search", "Local AI"],
      what: "Writes an answer from retrieved paragraphs. Every [S] reference is checked; uncited sentences are flagged.",
      level: !lib ? "off" : ai ? "full" : "reduced", now: !lib ? "Load judgments first." : ai ? "Answers with checked references." : "Shows the matching paragraphs, without a written answer." },
    { name: "Citation check", icon: ShieldCheck, href: "/citations", engines: ["Fixed rules", "Local AI", ...(h.integrations.indiankanoon ? ["Indian Kanoon"] : [])],
      what: "Finds every citation in a draft, matches it to your library and finds the paragraph. The AI only judges whether that paragraph supports the point.",
      level: ai ? "full" : "reduced", now: ai ? "Can mark citations Verified." : "Matches citations, but none can be Verified until the AI runs or an advocate confirms each." },
    { name: "Statutory deadlines", icon: CalendarClock, href: "/matters", engines: ["Fixed rules"],
      what: "Calculated from dates you confirm, by fixed NI Act s.138 and s.142 rules with court holidays. The AI never computes a date.",
      level: "full", now: "Always available. Rules stay marked as draft until an advocate signs them off." },
    { name: "Order reading", icon: Gavel, href: "/matters", engines: ["Fixed rules", ...(ocr ? ["OCR"] : []), "Local AI"],
      what: "Reads order date, next date and stage by rules, then proposes tasks for approval. The AI only writes the summary and client message.",
      level: ai && ocr ? "full" : "reduced", now: [!ocr && "Scanned orders need Tesseract.", !ai && "Rule-based summary; Hindi and Marathi messages need the AI."].filter(Boolean).join(" ") || "Text and scanned orders, with AI summaries." },
    { name: "AI headnotes", icon: BookOpenCheck, href: "/research", engines: ["Local AI"],
      what: "Issues, holding and key paragraphs from one judgment. Saved once written.",
      level: ai ? "full" : "off", now: ai ? "Available in every judgment." : "Needs the local AI. Headnotes already written still show." },
    { name: "Draft polish", icon: FileSignature, href: "/drafts", engines: ["Local AI", "Fixed rules"],
      what: "Suggests clearer wording. Blocked automatically if it drops a blank, or adds a citation or a number.",
      level: ai ? "full" : "off", now: ai ? "Available in every draft." : "Needs the local AI." },
    { name: "Opposing counsel check", icon: Swords, href: "/matters", engines: ["Library search", "Local AI"],
      what: "Finds adverse treatment of your saved authorities and contrary paragraphs; the AI writes counter-arguments.",
      level: !lib ? "off" : ai ? "full" : "reduced", now: ai ? "With counter-arguments." : "Adverse treatment and contrary paragraphs only." },
    { name: "Hearing notes to tasks", icon: NotebookPen, href: "/matters", engines: ["Fixed rules", "Local AI"],
      what: "Turns your hearing notes into proposed tasks. Dates not written in the notes are dropped.",
      level: ai ? "full" : "reduced", now: ai ? "AI and rules." : "Rules only." },
    { name: "Client updates", icon: MessageSquareText, href: "/matters", engines: ["Templates"],
      what: "English, Hindi and Marathi updates from the matter's facts. Proposed for approval; never sent by Nyaay.",
      level: "full", now: "Always available. No AI used." },
    { name: "IPC to BNS", icon: ArrowLeftRight, href: "/tools/convert", engines: ["Reference table"],
      what: "Maps sections between the old and new criminal laws from a fixed comparison table.",
      level: "full", now: "Always available. No AI used." },
    { name: "eCourts sync", icon: RefreshCw, href: "/matters", engines: ["eCourts"],
      what: "Fetches new orders and next dates by CNR. Changes become proposals.",
      level: h.integrations.ecourts ? "full" : "off", now: h.integrations.ecourts ? "Connected." : "Not configured: add ECOURTSINDIA_TOKEN." },
    { name: "Approvals", icon: CheckCheck, href: "/approvals", engines: ["Advocate"],
      what: "Every date change, stage change and client message proposed by Nyaay waits here.",
      level: "full", now: "Only advocates and above can approve." },
  ];
}
