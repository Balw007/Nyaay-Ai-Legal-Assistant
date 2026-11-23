"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { toast } from "sonner";
import { AlertTriangle, BookOpen, FileSignature, ShieldCheck, Square, X } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { isActive, useCancelAgent, useTask, utc, type AgentTask, type ResearchResult } from "@/lib/agents";
import { statusMeta } from "@/components/research/status";
import { Badge, ErrorNote, Panel, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { AgentIcon, AgentProgress, statusLabel } from "./agent-row";
import { cn } from "@/lib/utils";

const reader = (jid: string, para?: number) => `/judgments/${encodeURIComponent(jid)}${para !== undefined ? `?para=${para}` : ""}`;

/** One agent task, inspected: what it was asked, every step it took with the time, and what it produced. */
export function TaskDetail({ id, onClose }: { id: number; onClose?: () => void }) {
  const { data: t, isLoading, error } = useTask(id);
  const cancel = useCancelAgent();
  if (isLoading) return <Panel level={4} className="space-y-3 rounded-2xl p-5"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24" /></Panel>;
  if (error || !t) return <ErrorNote error={error ?? new Error("Task not found")} />;
  return (
    <Panel level={4} className="flex flex-col overflow-hidden rounded-2xl">
      <header className="relative z-[3] flex items-start gap-3 border-b border-rule p-4">
        <AgentIcon agent={t.agent} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-md font-medium">{t.agent_name}</h2>
            <Badge tone={t.status === "done" ? "leaf" : t.status === "failed" ? "tape" : isActive(t) ? "cyan" : "neutral"}>{statusLabel(t)}</Badge>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted">{t.title}</p>
          <p className="mt-1 text-xs text-faint">Started by {t.user_name || "you"} {timeAgo(utc(t.created_at))}{t.finished_at ? `, finished ${timeAgo(utc(t.finished_at))}` : ""}</p>
        </div>
        {isActive(t) && <Button size="sm" variant="ghost" loading={cancel.isPending} disabled={t.cancel_requested}
          onClick={() => cancel.mutate(t.id, { onError: (e) => toast.error((e as Error).message) })}><Square className="h-3.5 w-3.5" />{t.cancel_requested ? "Stopping" : "Stop"}</Button>}
        {onClose && <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-vellum hover:text-text"><X className="h-4 w-4" /></button>}
      </header>

      <div className="relative z-[3] max-h-[70vh] space-y-5 overflow-y-auto scrollbar-thin p-4">
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-faint"><span>{t.step}</span>{!t.indeterminate && isActive(t) && <span className="tnum">{t.progress}%</span>}</div>
          <AgentProgress t={t} />
        </div>

        {t.status === "failed" && <ErrorNote error={new Error(t.error || "The agent could not finish.")} />}
        {t.status === "done" && <Result t={t} />}

        <section aria-label="Steps">
          <h3 className="mb-2 text-xs text-faint">Steps, as they happened</h3>
          <ol className="relative space-y-2 border-l border-rule pl-4">
            {t.steps.map((s, i) => (
              <motion.li key={`${i}-${s.at}`} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="relative text-sm">
                <span className={cn("absolute -left-[21px] top-1.5 h-2 w-2 rounded-full", i === t.steps.length - 1 && isActive(t) ? "bg-cyan shadow-[0_0_8px_var(--cyan)]" : "bg-rule-strong")} />
                <span className="tnum mr-2 text-xs text-faint">{new Date(utc(s.at)!).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                <span className="text-muted">{s.text}</span>
              </motion.li>
            ))}
          </ol>
        </section>
        <p className="border-t border-rule pt-3 text-xs text-faint">Nothing an agent produces is applied anywhere until a person acts on it. AI text is a draft to check, never a verified result.</p>
      </div>
    </Panel>
  );
}

function Result({ t }: { t: AgentTask }) {
  const r = t.result ?? {};
  if (t.agent === "research") {
    const x = r as unknown as ResearchResult;
    return (
      <section aria-label="Result" className="space-y-3">
        {x.mode === "answer" && x.answer ? (
          <>
            <div className="flex flex-wrap gap-2"><Badge tone="cyan">AI answer, not verified</Badge>{x.confidence && <Badge title="The model's own estimate, not a check of the law">Model&apos;s own confidence: {x.confidence}</Badge>}</div>
            <p className="whitespace-pre-line border-l-2 border-cyan/40 pl-3 text-sm leading-7">{x.answer}</p>
            {!!x.checks?.uncited_sentences.length && <p className="flex gap-1.5 text-xs text-amber"><AlertTriangle className="h-3.5 w-3.5" />{x.checks.uncited_sentences.length} sentence(s) have no source. Do not rely on them.</p>}
          </>
        ) : <p className="rounded-lg border border-amber/30 bg-amber-soft p-3 text-sm text-amber">{x.message ?? "No written answer."}</p>}
        {!!x.sources?.length && (
          <div>
            <h3 className="mb-1.5 text-xs text-faint">Paragraphs it relied on</h3>
            <ol className="space-y-1.5">
              {x.sources.map((s) => (
                <li key={s.sid}>
                  <Link href={reader(s.jid, s.para_no)} className="block rounded-lg border border-rule px-3 py-2 hover:border-brass/40 hover:bg-vellum">
                    <span className="text-sm"><span className="mr-1.5 rounded border border-brass/40 bg-brass-soft px-1 text-[11px] font-semibold text-brass">S{s.sid}</span>{s.title}</span>
                    <span className="block text-xs text-faint">{[s.citation, s.court, `para ${s.para_no}`].filter(Boolean).join(", ")}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    );
  }
  if (t.agent === "judgment") {
    const x = r as { jid?: string; issues?: string[]; held?: string; disposition?: string; key_paragraphs?: number[]; basis?: string };
    return (
      <section aria-label="Result" className="space-y-3 text-sm">
        <Badge tone="cyan">AI headnote, not verified</Badge>
        {!!x.issues?.length && <div><p className="text-xs text-faint">Issues</p><ul className="mt-1 list-disc space-y-1 pl-4 text-muted">{x.issues.map((i) => <li key={i}>{i}</li>)}</ul></div>}
        {x.held && <div><p className="text-xs text-faint">Held</p><p className="mt-1 border-l-2 border-cyan/40 pl-3 leading-6">{x.held}</p></div>}
        {x.disposition && <div><p className="text-xs text-faint">Result</p><p className="mt-1 text-muted">{x.disposition}</p></div>}
        {!!x.key_paragraphs?.length && x.jid && <div className="flex flex-wrap gap-1">{x.key_paragraphs.map((n) => <Link key={n} href={reader(x.jid!, n)} className="rounded-md border border-brass/40 bg-brass-soft px-1.5 text-xs text-brass hover:bg-brass hover:text-on-brass">¶ {n}</Link>)}</div>}
        {x.jid && <Link href={reader(x.jid)} className="inline-flex items-center gap-1 text-sm text-brass hover:underline"><BookOpen className="h-3.5 w-3.5" />Open the judgment</Link>}
        {x.basis && <p className="text-xs text-faint">{x.basis}</p>}
      </section>
    );
  }
  if (t.agent === "citation") {
    const x = r as { check_id?: number; summary?: { total: number; can_export: boolean; counts: Record<string, number> }; statuses?: { citation: string; status: string }[] };
    return (
      <section aria-label="Result" className="space-y-3 text-sm">
        <p>{x.summary?.total ?? 0} citations checked. {x.summary?.can_export ? <span className="text-leaf">Ready to file.</span> : <span className="text-amber">Not ready to file: some need checking or an advocate&apos;s confirmation.</span>}</p>
        <ul className="space-y-1">
          {x.statuses?.map((s, i) => { const m = statusMeta(s.status); return (
            <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-rule px-3 py-1.5"><span className="truncate">{s.citation}</span><Badge tone={m.tone}>{m.label}</Badge></li>
          ); })}
        </ul>
        {x.check_id && <Link href={`/citations?id=${x.check_id}`} className="inline-flex items-center gap-1 text-brass hover:underline"><ShieldCheck className="h-3.5 w-3.5" />Open the full check to read paragraphs and confirm</Link>}
      </section>
    );
  }
  if (t.agent === "drafting") {
    const x = r as { draft_id?: number; changes?: string[]; problems?: string[]; accepted?: boolean; body?: string };
    return (
      <section aria-label="Result" className="space-y-3 text-sm">
        {x.problems?.length ? <p className="rounded-lg border border-tape/30 bg-tape-soft p-3 text-tape">Blocked: {x.problems.join("; ")}. The draft was not changed.</p>
          : <p className="text-muted">Suggested wording is ready. Your draft has not been changed.</p>}
        {!!x.changes?.length && <ul className="list-disc space-y-1 pl-4 text-muted">{x.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
        {x.draft_id && <Link href={`/drafts/${x.draft_id}`} className="inline-flex items-center gap-1 text-brass hover:underline"><FileSignature className="h-3.5 w-3.5" />Open the draft to compare and accept</Link>}
      </section>
    );
  }
  return <pre className="text-xs">{JSON.stringify(r, null, 2)}</pre>;
}

