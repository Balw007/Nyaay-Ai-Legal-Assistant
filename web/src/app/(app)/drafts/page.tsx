"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FileText, Search } from "lucide-react";
import { api } from "@/lib/api";
import type { DraftListItem, Matter, Templates } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { Badge, Empty, ErrorNote, PageHeader, Panel, PanelHeader, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";

export default function DraftsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const drafts = useQuery({ queryKey: ["drafts", "all"], queryFn: () => api.get<DraftListItem[]>("/drafts") });
  const tpl = useQuery({ queryKey: ["templates"], queryFn: () => api.get<Templates>("/drafts/templates"), staleTime: Infinity });
  const matters = useQuery({ queryKey: ["matters"], queryFn: () => api.get<Matter[]>("/matters") });
  const [q, setQ] = useState("");
  const [template, setTemplate] = useState("");
  const [matter, setMatter] = useState("");
  const create = useMutation({
    mutationFn: () => api.post<{ id: number }>("/drafts", { template, matter_id: matter ? Number(matter) : null }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["drafts"] }); router.push(`/drafts/${r.id}`); },
  });
  const rows = (drafts.data ?? []).filter((d) => !q || [d.title, d.matter].some((x) => x?.toLowerCase().includes(q.toLowerCase())));
  const groups = (tpl.data?.templates ?? []).reduce<Record<string, Templates["templates"]>>((a, t) => ((a[t.group] ??= []).push(t), a), {});

  return (
    <>
      <PageHeader title="Drafts" sub="Notices, complaints and applications filled from your matters. Missing facts stay as visible blanks." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input aria-label="Search drafts" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search drafts" className="pl-9" />
          </div>
          <Panel className="overflow-hidden">
            {drafts.isLoading ? <div className="p-4"><Spinner /></div> : drafts.isError ? <ErrorNote error={drafts.error} className="m-4" /> : rows.length === 0 ? (
              <Empty icon={FileText} title={drafts.data!.length ? "No drafts match" : "No drafts yet"}>{!drafts.data!.length && "Create one from a template on the right, or from a matter's Drafts tab."}</Empty>
            ) : (
              <ul className="divide-y divide-rule">
                {rows.map((d) => (
                  <li key={d.id}>
                    <Link href={`/drafts/${d.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-vellum">
                      <FileText className="h-4 w-4 shrink-0 text-brass" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{d.title}</p>
                        <p className="truncate text-xs text-faint">{d.matter ?? "No matter"} · edited {timeAgo(d.updated_at)}</p>
                      </div>
                      {!!d.placeholders && <Badge tone="amber">{d.placeholders} blank{d.placeholders === 1 ? "" : "s"}</Badge>}
                      <Badge tone={d.status === "final" ? "leaf" : "neutral"}>{d.status === "final" ? "Final" : "Draft"}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <Panel className="h-fit">
          <PanelHeader title="New draft" />
          <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Field label="Template">
              <Select required value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="" disabled>Choose a template</option>
                {Object.entries(groups).map(([g, ts]) => <optgroup key={g} label={g}>{ts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
              </Select>
            </Field>
            <Field label="Matter" hint="Facts are taken from this matter. Without one, every fact is left blank.">
              <Select value={matter} onChange={(e) => setMatter(e.target.value)}>
                <option value="">No matter</option>
                {matters.data?.filter((m) => m.status !== "closed").map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </Select>
            </Field>
            <ErrorNote error={create.error} />
            <Button type="submit" variant="primary" className="w-full justify-center" disabled={!template} loading={create.isPending}><FilePlus2 className="h-4 w-4" /> Create draft</Button>
          </form>
        </Panel>
      </div>
    </>
  );
}
