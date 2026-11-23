"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeCheck, Download, Plus, ShieldCheck, Target, Trash2, XCircle } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { GoldBenchmark, GoldEntry, GoldSuggestion } from "@/lib/types";
import { isAdmin, useMe } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Empty, ErrorNote, PageHeader, Panel, PanelHeader, Spinner, Tabs } from "@/components/ui/misc";

type Tab = "candidate" | "verified" | "rejected";

export default function GoldPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const admin = isAdmin(me?.user.role);
  const [tab, setTab] = useState<Tab>("candidate");
  const q = useQuery({ queryKey: ["gold"], queryFn: () => api.get<{ entries: GoldEntry[]; counts: Record<Tab, number> }>("/gold") });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["gold"] }); qc.invalidateQueries({ queryKey: ["gold-for"] }); qc.invalidateQueries({ queryKey: ["gold-bench"] }); };
  if (q.isLoading) return <Spinner label="Opening the gold set" />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const rows = q.data!.entries.filter((e) => e.status === tab);
  const counts = q.data!.counts;

  return (
    <div className="space-y-6">
      <PageHeader title="Gold set" sub="Judgments an advocate in your firm has read and vouched for. They show as “Verified” everywhere, and they test whether search finds the right authority."
        actions={<a href="/api/gold/export.csv"><Button size="sm"><Download className="h-3.5 w-3.5" /> Export CSV</Button></a>} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Tabs<Tab> value={tab} onChange={setTab} items={[
            { value: "candidate", label: `To review (${counts.candidate})` }, { value: "verified", label: `Verified (${counts.verified})` }, { value: "rejected", label: `Rejected (${counts.rejected})` }]} />
          {rows.length === 0 ? (
            <Panel><Empty icon={ShieldCheck} title={tab === "candidate" ? "Nothing waiting for review" : tab === "verified" ? "No verified judgments yet" : "Nothing rejected"}>
              {tab === "candidate" ? "Pick a section on the right to see the judgments worth reading first, add them here, then write the headnote in your own words and verify." : undefined}
            </Empty></Panel>
          ) : rows.map((e) => <Entry key={e.id} e={e} admin={admin} onChange={refresh} />)}
        </div>
        <div className="space-y-4">
          <Suggest onAdded={refresh} />
          <Benchmark />
        </div>
      </div>
    </div>
  );
}

function Entry({ e, admin, onChange }: { e: GoldEntry; admin: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(e.status === "candidate");
  const [f, setF] = useState({ topic: e.topic, headnote: e.headnote, held: e.held, key_paras: e.key_paras.join(", "), issues: e.issues.join("\n"), notes: e.notes });
  const dirty = f.topic !== e.topic || f.headnote !== e.headnote || f.held !== e.held || f.key_paras !== e.key_paras.join(", ") || f.issues !== e.issues.join("\n") || f.notes !== e.notes;
  const body = () => ({ topic: f.topic, headnote: f.headnote, held: f.held, notes: f.notes,
    issues: f.issues.split("\n").map((x) => x.trim()).filter(Boolean),
    key_paras: f.key_paras.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n > 0) });
  const err = (x: unknown) => toast.error((x as Error).message);
  const save = useMutation({ mutationFn: () => api.patch(`/gold/${e.id}`, body()), onSuccess: () => { toast.success("Saved"); onChange(); }, onError: err });
  const verify = useMutation({
    mutationFn: async () => { if (dirty) await api.patch(`/gold/${e.id}`, body()); return api.post(`/gold/${e.id}/verify`); },
    onSuccess: () => { toast.success("Verified in your name"); onChange(); }, onError: (x) => { err(x); onChange(); },
  });
  const reject = useMutation({ mutationFn: () => api.post(`/gold/${e.id}/reject`, { note: f.notes }), onSuccess: onChange, onError: err });
  const del = useMutation({ mutationFn: () => api.del(`/gold/${e.id}`), onSuccess: onChange, onError: err });

  return (
    <Panel>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left" aria-expanded={open}>
        <span className="min-w-0">
          <span className="block truncate font-display text-md font-medium">{e.title}</span>
          <span className="text-sm text-muted">{[e.citation, e.topic || "No topic yet"].filter(Boolean).join(" · ")}</span>
        </span>
        {e.status === "verified" ? <Badge tone="leaf"><BadgeCheck className="h-3 w-3" />Verified</Badge> : e.status === "rejected" ? <Badge tone="tape">Rejected</Badge> : <Badge tone="amber">To review</Badge>}
      </button>
      {open && (
        <div className="space-y-4 border-t border-rule p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Point of law (topic)" hint="What is this judgment the authority for?"><Input value={f.topic} onChange={(x) => setF({ ...f, topic: x.target.value })} placeholder="NI Act s.139 presumption is rebuttable" /></Field>
            <Field label="Key paragraph numbers" hint="Paragraphs that carry the point"><Input value={f.key_paras} onChange={(x) => setF({ ...f, key_paras: x.target.value })} placeholder="23, 25" /></Field>
          </div>
          <Field label="Headnote (your words)" hint="At least 40 characters. Not copied from a reporter: SCC and AIR headnotes are copyright."><Textarea rows={3} value={f.headnote} onChange={(x) => setF({ ...f, headnote: x.target.value })} /></Field>
          <Field label="Held"><Textarea rows={2} value={f.held} onChange={(x) => setF({ ...f, held: x.target.value })} /></Field>
          <Field label="Issues (one per line)"><Textarea rows={2} value={f.issues} onChange={(x) => setF({ ...f, issues: x.target.value })} /></Field>
          <Field label="Notes"><Input value={f.notes} onChange={(x) => setF({ ...f, notes: x.target.value })} /></Field>
          {e.status === "verified" && <p className="text-sm text-leaf">Verified by {e.reviewer_name} ({e.reviewer_enrolment}) on {fmtDate(e.verified_at)}. Changing any field takes the verification back until you verify again.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/judgments/${encodeURIComponent(e.jid)}${e.key_paras[0] ? `?para=${e.key_paras[0]}` : ""}`} className="text-sm text-brass hover:underline">Read the judgment →</Link>
            <span className="flex-1" />
            <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
            <Button size="sm" variant="primary" loading={verify.isPending} onClick={() => verify.mutate()} disabled={e.status === "verified" && !dirty}><BadgeCheck className="h-3.5 w-3.5" />Verify</Button>
            {e.status !== "rejected" && <Button size="sm" variant="ghost" onClick={() => reject.mutate()}><XCircle className="h-3.5 w-3.5" />Reject</Button>}
            {admin && <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete this entry?")) del.mutate(); }}><Trash2 className="h-3.5 w-3.5" /></Button>}
          </div>
        </div>
      )}
    </Panel>
  );
}

const ACTS = [["ni", "NI Act"], ["ipc", "IPC"], ["bns", "BNS"], ["crpc", "CrPC"], ["bnss", "BNSS"], ["iea", "Evidence Act"], ["bsa", "BSA"], ["cpc", "CPC"], ["const", "Constitution"], ["limitation", "Limitation Act"], ["arbitration", "Arbitration Act"], ["mv", "MV Act"]];

function Suggest({ onAdded }: { onAdded: () => void }) {
  const [act, setAct] = useState("ni");
  const [section, setSection] = useState("138");
  const [applied, setApplied] = useState({ act: "ni", section: "138" });
  const s = useQuery({ queryKey: ["gold-suggest", applied], queryFn: () => api.get<GoldSuggestion[]>(`/gold/suggest${qs(applied)}`) });
  const add = useMutation({
    mutationFn: (jid: string) => api.post("/gold", { jid, topic: `${ACTS.find((a) => a[0] === applied.act)?.[1] ?? applied.act} s.${applied.section}`.trim() }),
    onSuccess: () => { toast.success("Added to review"); onAdded(); s.refetch(); }, onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Panel>
      <PanelHeader title="What to read first" sub="Judgments that discuss a section the most and are cited the most by others in your library" />
      <form className="flex items-end gap-2 p-4" onSubmit={(e) => { e.preventDefault(); setApplied({ act, section: section.trim() }); }}>
        <Field label="Act" className="flex-1"><Select value={act} onChange={(e) => setAct(e.target.value)}>{ACTS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select></Field>
        <Field label="Section" className="w-24"><Input value={section} onChange={(e) => setSection(e.target.value)} /></Field>
        <Button type="submit">Show</Button>
      </form>
      {s.isLoading ? <div className="px-4 pb-4"><Spinner /></div> : !s.data?.length ? <p className="px-4 pb-4 text-sm text-muted">No judgments in your library discuss this section yet.</p> : (
        <ul className="divide-y divide-rule border-t border-rule">
          {s.data.map((x) => (
            <li key={x.id} className="flex items-start gap-2 px-4 py-2.5">
              <span className="min-w-0 flex-1"><Link href={`/judgments/${encodeURIComponent(x.id)}`} className="block truncate text-base hover:text-brass">{x.title}</Link>
                <span className="text-xs text-muted">{[x.citation, x.court, x.year].filter(Boolean).join(" · ")} · cited by {x.cited_by}</span></span>
              <Button size="sm" variant="brass" onClick={() => add.mutate(x.id)} loading={add.isPending && add.variables === x.id}><Plus className="h-3.5 w-3.5" />Add</Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Benchmark() {
  const b = useQuery({ queryKey: ["gold-bench"], queryFn: () => api.get<GoldBenchmark>("/gold/benchmark") });
  return (
    <Panel>
      <PanelHeader title="Does search find them?" sub="Searches each verified topic and checks where its judgment lands" action={<Target className="h-4 w-4 text-faint" />} />
      {b.isLoading ? <div className="p-4"><Spinner /></div> : !b.data?.entries ? <p className="p-4 text-sm text-muted">Verify a judgment with a topic and this shows whether a search for that topic puts it in the top 10.</p> : (
        <div className="p-4">
          <p className="font-display text-[1.75rem] font-semibold tabular-nums">{b.data.found}<span className="text-faint"> / {b.data.entries}</span></p>
          <p className="text-sm text-muted">in the top {b.data.k}; {b.data.first} in first place.</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {b.data.rows.map((r) => (
              <li key={r.jid} className="flex items-center justify-between gap-2"><span className="truncate text-muted" title={r.title}>{r.topic}</span>
                {r.rank ? <Badge tone={r.rank === 1 ? "leaf" : "neutral"}>#{r.rank}</Badge> : <Badge tone="tape">not found</Badge>}</li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
