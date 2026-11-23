"use client";
import { MorphLink, useNavigate } from "@/lib/transition";
import type { MatterDetail } from "@/lib/types";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConical, FolderOpen, Plus, Search } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { CalEvent, Matter } from "@/lib/types";
import { daysUntil, fmtDate, relDays, todayISO } from "@/lib/format";
import { Badge, Empty, ErrorNote, PageHeader, Panel, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { NewMatter } from "@/components/matters/new-matter";
import { STATUS_LABEL } from "@/components/matters/labels";
import { cn } from "@/lib/utils";

type Playbook = { stages: { id: string; name: string }[] };

function plusDays(n: number) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function MattersInner() {
  const router = useRouter();
  const qc = useQueryClient();
  const testCase = useMutation({
    mutationFn: () => api.post<{ matter_id: number; created: boolean }>("/firm/add-test-case"),
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast.success(r.created ? "Test case added. Remove it any time from Library, Remove example data." : "The test case is already here.");
      router.push(`/matters/${r.matter_id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add the test case"),
  });
  const params = useSearchParams();
  const showNew = params.get("new") === "1";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [stage, setStage] = useState("");

  const matters = useQuery({ queryKey: ["matters"], queryFn: () => api.get<Matter[]>("/matters") });
  const pb = useQuery({ queryKey: ["playbook", "ni138"], queryFn: () => api.get<Playbook>("/playbooks/ni138"), staleTime: Infinity });
  const cal = useQuery({ queryKey: ["calendar", plusDays(-30), plusDays(90)], queryFn: () => api.get<{ events: CalEvent[] }>(`/calendar${qs({ start: plusDays(-30), end: plusDays(90) })}`) });

  const stageName = (id?: string | null) => pb.data?.stages.find((s) => s.id === id)?.name ?? id ?? "Not set";
  const nearest = useMemo(() => {
    const out = new Map<number, CalEvent>();
    const today = todayISO();
    (cal.data?.events ?? []).filter((e) => e.type === "deadline" && e.matter_id && e.date >= plusDays(-30))
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((e) => { if (!out.has(e.matter_id!) && (e.date >= today || !out.has(e.matter_id!))) out.set(e.matter_id!, e); });
    return out;
  }, [cal.data]);

  const navigate = useNavigate();
  const qcx = useQueryClient();
  const prefetchMatter = (id: number) => qcx.prefetchQuery({ queryKey: ["matter", id], queryFn: () => api.get<MatterDetail>(`/matters/${id}`) });
  const rows = (matters.data ?? []).filter((m) =>
    (!status || m.status === status) && (!stage || m.current_stage === stage) &&
    (!q || [m.title, m.client_name, m.court, m.case_number, m.cnr].some((x) => x?.toLowerCase().includes(q.toLowerCase()))));

  const closeNew = () => router.replace("/matters");

  return (
    <>
      <PageHeader title="Matters" sub={matters.data ? `${matters.data.filter((m) => m.status === "active").length} active` : undefined}
        actions={<div className="flex gap-2">
          <Button onClick={() => testCase.mutate()} loading={testCase.isPending} title="Adds one clearly labelled practice case so you can see deadlines, tasks and drafts working"><FlaskConical className="h-4 w-4" /> Add a test case</Button>
          <Button variant="primary" onClick={() => router.push("/matters?new=1")}><Plus className="h-4 w-4" /> New matter</Button>
        </div>} />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input aria-label="Search matters" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by party, client, court, case number or CNR" className="pl-9" />
        </div>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)} className="w-56">
          <option value="">All stages</option>
          {pb.data?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>

      {matters.isLoading ? <Spinner label="Loading matters" /> : matters.isError ? <ErrorNote error={matters.error} /> : (
        <Panel className="overflow-hidden">
          {rows.length === 0 ? (
            matters.data!.length === 0
              ? <Empty icon={FolderOpen} title="No matters yet" action={<div className="flex gap-2"><Button variant="primary" onClick={() => router.push("/matters?new=1")}>Add your first matter</Button><Button onClick={() => testCase.mutate()} loading={testCase.isPending}>Try a test case</Button></div>}>
                  Add a matter to track its stage, deadlines, orders and drafts in one place. Or try a test case to see how it works.
                </Empty>
              : <Empty title="No matters match these filters" action={<Button size="sm" onClick={() => { setQ(""); setStatus(""); setStage(""); }}>Clear filters</Button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-rule text-sm text-faint">
                  <tr>
                    <th className="px-4 py-2.5 font-normal">Matter</th>
                    <th className="px-4 py-2.5 font-normal">Stage</th>
                    <th className="px-4 py-2.5 font-normal">Next hearing</th>
                    <th className="px-4 py-2.5 font-normal">Nearest deadline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {rows.map((m) => {
                    const dl = nearest.get(m.id);
                    const dd = daysUntil(dl?.date);
                    const nd = daysUntil(m.next_date);
                    return (
                      <tr key={m.id} data-morph className="group cursor-pointer transition-colors hover:bg-vellum" onMouseEnter={() => prefetchMatter(m.id)} onClick={(e) => navigate(`/matters/${m.id}`, { source: e.currentTarget, prepare: () => prefetchMatter(m.id) })}>
                        <td className="px-4 py-3 align-top">
                          <MorphLink href={`/matters/${m.id}`} prepare={() => prefetchMatter(m.id)} className="font-medium group-hover:text-brass" onClick={(e) => e.stopPropagation()}>{m.title}</MorphLink>
                          <p className="text-sm text-muted">{[m.client_name, m.court, m.case_number].filter(Boolean).join(" · ") || "No court details yet"}</p>
                          {m.status !== "active" && <Badge className="mt-1">{STATUS_LABEL[m.status] ?? m.status}</Badge>}
                        </td>
                        <td className="px-4 py-3 align-top"><Badge tone="cyan">{stageName(m.current_stage)}</Badge></td>
                        <td className="px-4 py-3 align-top text-sm">
                          {m.next_date ? <><p>{fmtDate(m.next_date)}</p><p className={cn("text-xs", nd === 0 ? "text-cyan" : "text-faint")}>{relDays(nd)}</p></> : <span className="text-faint">Not set</span>}
                        </td>
                        <td className="px-4 py-3 align-top text-sm">
                          {dl ? <><p className={cn(dd !== null && dd <= 3 ? "text-tape" : dd !== null && dd <= 10 ? "text-amber" : "")}>{fmtDate(dl.date)} <span className="text-xs">({relDays(dd)})</span></p><p className="max-w-[260px] truncate text-xs text-faint">{dl.title}</p></> : <span className="text-faint">None</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
      <NewMatter open={showNew} onClose={closeNew} />
    </>
  );
}

export default function MattersPage() {
  return <Suspense fallback={<Spinner />}><MattersInner /></Suspense>;
}
