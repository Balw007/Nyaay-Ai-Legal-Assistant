"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Pencil, RefreshCw, Target, X } from "lucide-react";
import { api } from "@/lib/api";
import type { MatterDetail } from "@/lib/types";
import { fmtDate, timeAgo } from "@/lib/format";
import { Badge, ErrorNote, Panel, PanelHeader, Skeleton, Spinner, Tabs } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { StageRail } from "@/components/visuals/stage-rail";
import { CaseTimeline } from "@/components/visuals/case-timeline";
import { pushRecent } from "@/lib/recent";
import { ClientUpdateButton, IcsDownload, RoutesTab } from "@/components/matters/tools";
import { AuthoritiesTab, DraftsTab, EraseMatter, NotesTab, OrdersTab, OverviewTab, PartiesTab, TasksTab } from "@/components/matters/tabs";
import { InfoTip } from "@/components/ui/info";

type Playbook = { name: string; status: string; inputs: { name: string; label: string }[]; stages: { id: string; name: string }[] };
type Tab = "overview" | "orders" | "tasks" | "drafts" | "notes" | "authorities" | "routes" | "parties";

function GoalEditor({ id, goal }: { id: number; goal: string | null }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(goal ?? "");
  const save = useMutation({
    mutationFn: () => api.patch(`/matters/${id}`, { goal: v.trim() || null }),
    onSuccess: () => { setEdit(false); qc.invalidateQueries({ queryKey: ["matter", id] }); toast.success("Goal updated"); },
  });
  return (
    <div className="flex items-center gap-2">
      <Target className="h-4 w-4 shrink-0 text-brass" aria-hidden />
      <span className="text-sm text-faint">Goal</span>
      {edit ? (
        <form className="flex flex-1 items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} className="h-8 max-w-md" aria-label="Goal" />
          <Button size="icon" variant="brass" type="submit" aria-label="Save goal" loading={save.isPending}><Check className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" type="button" aria-label="Cancel" onClick={() => { setV(goal ?? ""); setEdit(false); }}><X className="h-4 w-4" /></Button>
        </form>
      ) : (
        <button onClick={() => setEdit(true)} className="group flex items-center gap-1.5 text-base text-text hover:text-brass">
          {goal || <span className="text-faint">Set the client's goal</span>}
          <Pencil className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}

export default function MatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = use(params);
  const id = Number(raw);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const q = useQuery({ queryKey: ["matter", id], queryFn: () => api.get<MatterDetail>(`/matters/${id}`), enabled: Number.isFinite(id) });
  const pb = useQuery({
    queryKey: ["playbook", q.data?.matter.case_type], enabled: !!q.data, staleTime: Infinity,
    queryFn: () => api.get<Playbook>(`/playbooks/${q.data!.matter.case_type}`),
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ new_orders: number; proposed_tasks: number; next_date: string | null }>(`/matters/${id}/sync`),
    onSuccess: (r) => {
      toast.success(`eCourts synced. ${r.new_orders} new order(s), ${r.proposed_tasks} proposal(s).`);
      qc.invalidateQueries({ queryKey: ["matter", id] }); qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  useEffect(() => {
    if (q.data) pushRecent({ kind: "matter", id: String(q.data.matter.id), title: q.data.matter.title, sub: q.data.matter.court ?? undefined });
  }, [q.data]);

  if (q.isLoading) return <div className="space-y-4" aria-busy="true"><Spinner label="Opening matter" /><Skeleton className="h-9 w-2/3" /><Skeleton className="h-4 w-1/3" /><Skeleton className="mt-6 h-40" /></div>;
  if (q.isError) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const m = d.matter;
  const proposed = (d.tasks ?? []).filter((t) => t.status === "proposed").length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/matters" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"><ArrowLeft className="h-3.5 w-3.5" /> Matters</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="vt-hero min-w-0">
            <h1 className="font-editorial text-[2rem] leading-[1.12] md:text-[2.35rem]">{m.title} <InfoTip k="Matter" title="This matter" className="h-6 w-6 -translate-y-1" /></h1>
            <p className="mt-2 text-base text-muted">{[m.client_name && `Client: ${m.client_name}`, m.court, m.case_number, m.cnr && `CNR ${m.cnr}`].filter(Boolean).join(", ") || "Add court details in the overview below."}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {m.status !== "active" && <Badge>{m.status === "on_hold" ? "On hold" : "Closed"}</Badge>}
              {m.next_date && <Badge tone="cyan">Next hearing {fmtDate(m.next_date)}</Badge>}
              {proposed > 0 && <Link href="/approvals"><Badge tone="brass">{proposed} waiting for approval</Badge></Link>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              <ClientUpdateButton d={d} />
              <IcsDownload matterId={m.id} label="Calendar (.ics)" />
            </div>
            <Button onClick={() => sync.mutate()} loading={sync.isPending} disabled={!m.cnr} title={m.cnr ? "Fetch new orders and next date from eCourts" : "Add the CNR to sync with eCourts"}>
              <RefreshCw className="h-4 w-4" /> Sync with eCourts
            </Button>
            {m.sync_status && <p className="mt-1 max-w-xs text-xs text-faint">{m.sync_status}{m.synced_at && ` · ${timeAgo(m.synced_at)}`}</p>}
          </div>
        </div>
      </div>

      <Panel className="p-5" lit>
        <div className="relative z-[3] mb-3 flex flex-wrap items-center justify-between gap-3">
          <GoalEditor id={m.id} goal={m.goal} />
          <span className="text-sm text-faint">{Math.round(d.plan.progress * 100)}% of the way through {pb.data?.name ?? m.case_type}</span>
        </div>
        <div className="relative z-[3]"><StageRail stages={d.plan.stages} progress={d.plan.progress} /></div>
        <div className="relative z-[3] mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-cyan/25 bg-cyan-soft p-4">
            <p className="text-sm font-medium text-cyan">Do now: {d.plan.current_stage_name}</p>
            {d.plan.current_actions.length ? (
              <ul className="mt-2 space-y-1.5">{d.plan.current_actions.map((a) => <li key={a} className="flex gap-2 text-base"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />{a}</li>)}</ul>
            ) : <p className="mt-2 text-sm text-muted">Nothing pending at this stage.</p>}
          </div>
          <div className="rounded-xl border border-rule bg-vellum p-4">
            <p className="text-sm font-medium text-muted">Next{d.plan.next_stage ? `: ${d.plan.next_stage}` : ""}</p>
            {d.plan.next_stage_actions.length ? (
              <ul className="mt-2 space-y-1.5">{d.plan.next_stage_actions.map((a) => <li key={a} className="flex gap-2 text-base text-muted"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rule-strong" />{a}</li>)}</ul>
            ) : <p className="mt-2 text-sm text-muted">This is the last stage.</p>}
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Case timeline" sub="Dates you entered, deadlines calculated by fixed rules, and dates from the court, on one line" />
        <div className="relative z-[3] p-4"><CaseTimeline d={d} inputs={pb.data?.inputs} /></div>
      </Panel>

      <Tabs value={tab} onChange={setTab} className="overflow-x-auto" items={[
        { value: "overview", label: "Overview" },
        { value: "orders", label: `Orders${d.orders?.length ? ` (${d.orders.length})` : ""}` },
        { value: "tasks", label: `Tasks${proposed ? ` (${proposed})` : ""}` },
        { value: "drafts", label: "Drafts" },
        { value: "notes", label: "Notes" },
        { value: "authorities", label: "Authorities" },
        { value: "routes", label: "Route options" },
        { value: "parties", label: "Parties and cheque" },
      ]} />

      <div>
        {tab === "overview" && <OverviewTab d={d} pb={pb.data} />}
        {tab === "orders" && <OrdersTab d={d} />}
        {tab === "tasks" && <TasksTab d={d} />}
        {tab === "drafts" && <DraftsTab d={d} />}
        {tab === "notes" && <NotesTab d={d} />}
        {tab === "authorities" && <AuthoritiesTab d={d} />}
        {tab === "routes" && <RoutesTab d={d} />}
        {tab === "parties" && <PartiesTab d={d} />}
      </div>

      <EraseMatter m={m} />
    </div>
  );
}
