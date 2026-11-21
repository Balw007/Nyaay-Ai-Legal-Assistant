"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Check, CheckCheck, History, Lock, ShieldCheck, X } from "lucide-react";
import { api } from "@/lib/api";
import type { ApprovalQueue, BatchResult, LogEntry, QueueTask } from "@/lib/types";
import { fmtDate, timeAgo } from "@/lib/format";
import { canApprove, useMe } from "@/lib/hooks";
import { Badge, Empty, ErrorNote, PageHeader, Panel, PanelHeader, Spinner, Tabs } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { SOURCE_LABEL } from "@/components/matters/labels";
import { ClientMessage } from "@/components/matters/tools";
import { cn } from "@/lib/utils";

const sourceTone = (s: string) => (s === "order" || s === "ecourts" ? "cyan" : s === "whatsapp" || s === "client_update" ? "leaf" : s === "hearing_note" ? "brass" : "neutral") as "cyan" | "leaf" | "brass" | "neutral";
const ACTION_LABEL: Record<string, string> = { approve: "Approved", reject: "Rejected", done: "Marked done", batch_approve: "Approved in a batch", batch_reject: "Rejected in a batch", edit_task: "Edited", draft_client_update: "Drafted a client update" };

function Log() {
  const q = useQuery({ queryKey: ["approvals", "log"], queryFn: () => api.get<LogEntry[]>("/approvals/log?limit=100") });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} />;
  if (!q.data?.length) return <Panel><Empty icon={History} title="No decisions yet">Every approval, rejection and edit is recorded here with who did it and when.</Empty></Panel>;
  return (
    <Panel>
      <PanelHeader title="Decision log" sub="Newest first. Recorded with the name of the person who decided." />
      <ul className="divide-y divide-rule">
        {q.data.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm">
            <Badge tone={e.action.includes("reject") ? "tape" : e.action.includes("approve") ? "leaf" : "neutral"}>{ACTION_LABEL[e.action] ?? e.action}</Badge>
            <span className="min-w-0 flex-1">{e.title ?? (e.count !== null ? `${e.count} task(s)` : "")}{e.matter && <span className="text-faint"> · {e.matter}</span>}</span>
            <span className="text-xs text-faint">{e.actor} · {timeAgo(e.at)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const allowed = canApprove(me?.user.role);
  const [view, setView] = useState<"queue" | "log">("queue");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const q = useQuery({ queryKey: ["approvals", "queue"], queryFn: () => api.get<ApprovalQueue>("/approvals/queue") });

  const after = () => {
    ["approvals", "tasks", "dashboard", "matter", "matters"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const batch = useMutation({
    mutationFn: ({ ids, decision }: { ids: number[]; decision: "approve" | "reject" }) => api.post<BatchResult>("/tasks/batch", { ids, decision }),
    onSuccess: (r) => {
      setSel(new Set());
      if (r.done.length) toast.success(`${r.decision === "approve" ? "Approved" : "Rejected"} ${r.done.length}`);
      r.skipped.forEach((s) => toast.error(`Skipped: ${s.reason}`));
      after();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const all = useMemo(() => q.data?.groups.flatMap((g) => g.tasks) ?? [], [q.data]);
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const run = (ids: number[], decision: "approve" | "reject", what: string) => {
    if (!ids.length) return;
    if (confirm(`${decision === "approve" ? "Approve" : "Reject"} ${what}? Each decision is recorded with your name.`)) batch.mutate({ ids, decision });
  };

  return (
    <>
      <PageHeader title="Approvals" sub="Nyaay proposes; an advocate decides. Every decision is recorded with your name."
        actions={<Tabs value={view} onChange={setView} items={[{ value: "queue", label: `Queue${q.data ? ` (${q.data.total})` : ""}` }, { value: "log", label: "Decision log" }]} />} />
      {!allowed && (
        <p className="mb-4 flex items-center gap-2 rounded-md border border-amber/30 bg-amber-soft px-3 py-2 text-sm text-amber">
          <Lock className="h-4 w-4" /> Only advocates can approve. You can review the queue and prepare the work.
        </p>
      )}
      {view === "log" ? <Log /> : q.isLoading ? <Spinner label="Loading approvals" /> : q.isError ? <ErrorNote error={q.error} /> : !q.data || q.data.total === 0 ? (
        <Panel><Empty icon={CheckCheck} title="Nothing waiting for approval">When an order is read, hearing notes are saved or a client update is drafted, the proposal appears here.</Empty></Panel>
      ) : (
        <div className="space-y-5">
          <Panel className="flex flex-wrap items-center gap-3 p-4">
            <p className="min-w-0 flex-1 text-base" aria-live="polite">{q.data.summary}</p>
            {allowed && <>
              <Button size="sm" variant="brass" disabled={!q.data.safe_ids.length} loading={batch.isPending} title="Only plain to-dos. Date changes, stage changes and client messages are never included."
                onClick={() => run(q.data!.safe_ids, "approve", `all ${q.data!.safe_ids.length} plain to-dos (no date, stage or message changes)`)}>
                <ShieldCheck className="h-3.5 w-3.5" /> Approve all safe ({q.data.safe_ids.length})
              </Button>
              <Button size="sm" variant="primary" disabled={!sel.size} loading={batch.isPending} onClick={() => run([...sel], "approve", `${sel.size} selected`)}><Check className="h-3.5 w-3.5" /> Approve selected ({sel.size})</Button>
              <Button size="sm" variant="ghost" disabled={!sel.size} loading={batch.isPending} onClick={() => run([...sel], "reject", `${sel.size} selected`)}><X className="h-3.5 w-3.5" /> Reject selected</Button>
            </>}
          </Panel>
          {allowed && all.length > 1 && (
            <label className="flex items-center gap-2 px-1 text-sm text-muted">
              <input type="checkbox" checked={sel.size === all.length} onChange={(e) => setSel(e.target.checked ? new Set(all.map((t) => t.id)) : new Set())} className="h-4 w-4 accent-[var(--brass)]" /> Select everything
            </label>
          )}
          {q.data.groups.map((g) => (
            <Panel key={g.matter.id}>
              <PanelHeader title={<Link href={`/matters/${g.matter.id}`} className="hover:text-brass">{g.matter.title}</Link>}
                sub={`${g.tasks.length} proposal${g.tasks.length === 1 ? "" : "s"}${g.matter.next_date ? ` · next hearing ${fmtDate(g.matter.next_date)}` : ""}`} />
              <ul className="divide-y divide-rule">
                {g.tasks.map((t: QueueTask) => (
                  <li key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-4">
                    {allowed && <input type="checkbox" aria-label={`Select: ${t.title}`} checked={sel.has(t.id)} onChange={() => toggle(t.id)} className="mt-1.5 h-4 w-4 accent-[var(--brass)]" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{t.title.replace(/^Suggested: /, "")}</p>
                        <Badge tone={sourceTone(t.source)}>{SOURCE_LABEL[t.source] ?? t.source}</Badge>
                        {t.action === "set_next_date" && <Badge tone="cyan">Changes next date</Badge>}
                        {t.action === "set_stage" && <Badge tone="cyan">Changes stage</Badge>}
                      </div>
                      {t.due_date && <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><CalendarClock className="h-3.5 w-3.5" /> Due {fmtDate(t.due_date)}</p>}
                      {t.conflict && <p className="mt-1 flex items-center gap-1.5 text-sm text-amber"><AlertTriangle className="h-3.5 w-3.5" /> {t.conflict}</p>}
                      {t.action === "client_update" ? <ClientMessage t={t} onChanged={after} />
                        : t.detail && t.detail !== t.title && (t.title === "Send client update"
                          ? <blockquote className="mt-2 whitespace-pre-wrap rounded-md border-l-2 border-brass bg-vellum px-3 py-2 text-sm text-muted">{t.detail}</blockquote>
                          : <p className="mt-1 text-sm text-muted">{t.detail}</p>)}
                    </div>
                    <div className={cn("flex gap-1.5", !allowed && "hidden")}>
                      <Button size="sm" variant="ghost" onClick={() => batch.mutate({ ids: [t.id], decision: "reject" })} aria-label={`Reject: ${t.title}`}><X className="h-3.5 w-3.5" /> Reject</Button>
                      <Button size="sm" variant="primary" onClick={() => batch.mutate({ ids: [t.id], decision: "approve" })} aria-label={`Approve: ${t.title}`}><Check className="h-3.5 w-3.5" /> Approve</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
