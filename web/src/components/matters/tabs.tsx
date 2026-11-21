"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, BookMarked, CheckCircle2, FilePlus2, FileText, MessageSquareQuote, ScrollText, Trash2, Upload } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { Bookmark, Deadline, DraftListItem, Matter, MatterDetail, Note, Order, Task, Templates } from "@/lib/types";
import { daysUntil, fmtDate, timeAgo } from "@/lib/format";
import { canApprove, isAdmin, useMe } from "@/lib/hooks";
import { Badge, Empty, ErrorNote, Panel, PanelHeader, Spinner, Tabs } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Countdown } from "@/components/visuals/timeline";
import { DETAIL_FIELDS, SOURCE_LABEL } from "./labels";
import { cn } from "@/lib/utils";
import { ClientMessage, HearingNotesBox, OpposingPanel } from "./tools";

type DeadlineX = Deadline & { met?: boolean; review?: string };
type Playbook = { name: string; status: string; inputs: { name: string; label: string }[]; stages: { id: string; name: string }[] };

function useInvalidate(id: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["matter", id] });
    qc.invalidateQueries({ queryKey: ["matters"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["calendar"] });
  };
}

/* ------------------------------------------------------------------ overview */

export function OverviewTab({ d, pb }: { d: MatterDetail; pb?: Playbook }) {
  const m = d.matter;
  const refresh = useInvalidate(m.id);
  const [facts, setFacts] = useState<Record<string, string>>(m.facts ?? {});
  const saveFacts = useMutation({
    mutationFn: () => api.put("/matters/" + m.id + "/facts", { facts: Object.fromEntries(Object.entries(facts).filter(([, v]) => v)) }),
    onSuccess: () => { toast.success("Dates saved. Deadlines recomputed."); refresh(); },
  });
  const patch = useMutation({
    mutationFn: (body: Partial<Matter>) => api.patch<Matter>(`/matters/${m.id}`, body),
    onSuccess: () => { toast.success("Matter updated"); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const deadlines = d.deadlines as DeadlineX[];
  const dirty = pb?.inputs.some((i) => (facts[i.name] ?? "") !== (m.facts?.[i.name] ?? ""));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Key dates" sub="Confirm each date from the documents. Deadlines are computed from these by fixed rules, not by AI." />
          <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); saveFacts.mutate(); }}>
            {pb ? pb.inputs.map((i) => (
              <Field key={i.name} label={i.label}>
                <Input type="date" value={facts[i.name] ?? ""} onChange={(e) => setFacts({ ...facts, [i.name]: e.target.value })} />
              </Field>
            )) : <Spinner />}
            <ErrorNote error={saveFacts.error} />
            <div className="flex justify-end"><Button type="submit" variant="primary" disabled={!dirty} loading={saveFacts.isPending}>Save dates</Button></div>
          </form>
        </Panel>
        <Panel>
          <PanelHeader title="Case status" />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label="Stage" hint="Usually changed by approving a proposal from an order.">
              <Select value={m.current_stage ?? ""} onChange={(e) => patch.mutate({ current_stage: e.target.value })}>
                <option value="" disabled>Choose stage</option>
                {pb?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Next hearing">
              <Input type="date" defaultValue={m.next_date ?? ""} onBlur={(e) => e.target.value !== (m.next_date ?? "") && patch.mutate({ next_date: e.target.value || null })} />
            </Field>
            <Field label="Status">
              <Select value={m.status} onChange={(e) => patch.mutate({ status: e.target.value })}>
                <option value="active">Active</option><option value="on_hold">On hold</option><option value="closed">Closed</option>
              </Select>
            </Field>
            <Field label="Court">
              <Input defaultValue={m.court ?? ""} onBlur={(e) => e.target.value !== (m.court ?? "") && patch.mutate({ court: e.target.value })} />
            </Field>
            <Field label="Case number">
              <Input defaultValue={m.case_number ?? ""} onBlur={(e) => e.target.value !== (m.case_number ?? "") && patch.mutate({ case_number: e.target.value })} />
            </Field>
            <Field label="CNR">
              <Input defaultValue={m.cnr ?? ""} maxLength={16} className="uppercase" onBlur={(e) => e.target.value !== (m.cnr ?? "") && patch.mutate({ cnr: e.target.value.toUpperCase() })} />
            </Field>
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Statutory deadlines" sub={pb?.name} />
        {pb && /draft/i.test(pb.status) && (
          <p className="mx-4 mt-4 flex gap-2 rounded-md border border-amber/30 bg-amber-soft px-3 py-2 text-sm text-amber">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            These rules are a draft until an advocate in your chambers signs them off in Settings. Confirm every date before relying on it.
          </p>
        )}
        {deadlines.length === 0 ? (
          <Empty title="No deadlines yet">Enter the key dates on the left. Nyaay computes each statutory deadline from them.</Empty>
        ) : (
          <ul className="divide-y divide-rule">
            {deadlines.map((x) => {
              const n = daysUntil(x.due_date);
              return (
                <li key={x.id} className={cn("flex gap-3 px-4 py-3.5", x.met && "opacity-60")}>
                  {x.met ? <CheckCircle2 className="h-11 w-11 shrink-0 p-2 text-leaf" aria-label="Stage passed" /> : n !== null ? <Countdown days={n} /> : <span className="h-11 w-11" />}
                  <div className="min-w-0 flex-1">
                    <p className="leading-snug">{x.label}</p>
                    <p className="text-sm text-muted">{fmtDate(x.due_date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · {x.authority}</p>
                    {x.original_due_date && x.original_due_date !== x.due_date && <p className="text-xs text-faint">Moved from {fmtDate(x.original_due_date)} because the court is closed that day.</p>}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {x.met && <Badge tone="leaf">Stage passed</Badge>}
                      {!x.met && x.needs_confirmation && <Badge tone="amber">Confirm this date</Badge>}
                      {x.review && x.review !== "approved" && <Badge title="An advocate has not yet signed off this rule">Rule not reviewed</Badge>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ orders */

export function OrdersTab({ d }: { d: MatterDetail }) {
  const id = d.matter.id;
  const refresh = useInvalidate(id);
  const orders = useQuery({ queryKey: ["matter", id, "orders"], queryFn: () => api.get<Order[]>(`/matters/${id}/orders`) });
  const [mode, setMode] = useState<"paste" | "file">("file");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [lang, setLang] = useState("en");
  const add = useMutation({
    mutationFn: () => {
      const f = new FormData();
      if (mode === "paste") f.set("text", text); else if (file) f.set("file", file);
      f.set("language", lang);
      return api.upload<{ order: Order; proposed_tasks: Task[]; duplicate: boolean }>(`/matters/${id}/orders`, f);
    },
    onSuccess: (r) => {
      if (r.duplicate) toast.info("This order was already read for this matter.");
      else toast.success(`Order read. ${r.proposed_tasks.length} proposal${r.proposed_tasks.length === 1 ? "" : "s"} sent to Approvals.`);
      setText(""); setFile(null); refresh(); orders.refetch();
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Panel className="h-fit">
        <PanelHeader title="Add an order" sub="Nyaay reads the date, next date, directions and stage. Nothing changes until you approve." />
        <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Tabs value={mode} onChange={setMode} items={[{ value: "file", label: "Upload file" }, { value: "paste", label: "Paste text" }]} />
          {mode === "file" ? (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-rule-strong px-4 py-8 text-center hover:border-brass/60 hover:bg-brass-soft">
              <Upload className="h-5 w-5 text-brass" />
              <span className="text-base">{file ? file.name : "Choose a PDF, photo or Word file"}</span>
              <span className="text-xs text-faint">Scanned and Hindi or Marathi orders are read with OCR or local AI</span>
              <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          ) : (
            <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the order text here" />
          )}
          <Field label="Language of the order">
            <Select value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="en">English</option><option value="hi">Hindi</option><option value="mr">Marathi</option>
            </Select>
          </Field>
          <ErrorNote error={add.error} />
          <Button type="submit" variant="primary" className="w-full justify-center" loading={add.isPending}
            disabled={mode === "paste" ? text.trim().length < 20 : !file}>Read order</Button>
        </form>
      </Panel>

      <div className="space-y-4">
        {orders.isLoading ? <Spinner /> : orders.isError ? <ErrorNote error={orders.error} /> : orders.data!.length === 0 ? (
          <Panel><Empty icon={ScrollText} title="No orders yet">Upload the latest order to update the next date and get proposed actions.</Empty></Panel>
        ) : orders.data!.map((o) => <OrderCard key={o.id} o={o} />)}
      </div>
    </div>
  );
}

function OrderCard({ o }: { o: Order }) {
  const [msg, setMsg] = useState(false);
  return (
    <Panel as="article" className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display font-medium">Order of {fmtDate(o.order_date)}</h3>
        {o.detected_stage && <Badge tone="cyan" title="Stage the order points to">{o.detected_stage.replace(/_/g, " ")}{o.stage_confidence !== null && ` · ${Math.round(o.stage_confidence * 100)}%`}</Badge>}
        <Badge>{o.extraction_method}</Badge>
        <Badge>{SOURCE_LABEL[o.source] ?? o.source}</Badge>
        <span className="ml-auto text-sm text-faint">Next date: <span className="text-text">{fmtDate(o.next_date)}</span></span>
      </div>
      {o.summary && <p className="mt-2 text-base text-muted">{o.summary}</p>}
      {o.directions.length > 0 && (
        <ul className="mt-3 space-y-1">
          {o.directions.map((x, i) => <li key={i} className="flex gap-2 text-base"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brass" />{x}</li>)}
        </ul>
      )}
      {o.needs_review.length > 0 && (
        <div className="mt-3 space-y-1 rounded-md border border-amber/30 bg-amber-soft px-3 py-2">
          {o.needs_review.map((x, i) => <p key={i} className="flex gap-2 text-sm text-amber"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{x}</p>)}
        </div>
      )}
      {o.client_message && (
        <div className="mt-3">
          <button onClick={() => setMsg(!msg)} className="flex items-center gap-1.5 text-sm text-brass hover:underline" aria-expanded={msg}>
            <MessageSquareQuote className="h-3.5 w-3.5" /> {msg ? "Hide" : "Show"} client update
          </button>
          {msg && <pre className="mt-2 whitespace-pre-wrap rounded-md border-l-2 border-brass bg-vellum px-3 py-2 font-sans text-sm text-muted">{o.client_message}</pre>}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ tasks */

export function TasksTab({ d }: { d: MatterDetail }) {
  const id = d.matter.id;
  const refresh = useInvalidate(id);
  const { data: me } = useMe();
  const tasks = useQuery({ queryKey: ["tasks", "matter", id], queryFn: () => api.get<Task[]>(`/tasks${qs({ matter_id: id })}`) });
  const act = useMutation({
    mutationFn: ({ t, a }: { t: Task; a: "approve" | "reject" | "done" }) => api.post<Task>(`/tasks/${t.id}/${a}`),
    onSuccess: (_, v) => { toast.success(v.a === "done" ? "Marked done" : v.a === "approve" ? "Approved" : "Rejected"); refresh(); tasks.refetch(); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (tasks.isLoading) return <Spinner />;
  if (tasks.isError) return <ErrorNote error={tasks.error} />;
  const groups: [string, Task[]][] = [
    ["Waiting for approval", tasks.data!.filter((t) => t.status === "proposed")],
    ["To do", tasks.data!.filter((t) => t.status === "approved")],
    ["Done or rejected", tasks.data!.filter((t) => t.status === "done" || t.status === "rejected")],
  ];
  if (tasks.data!.length === 0) return <Panel><Empty title="No tasks yet">Tasks appear when an order is read or the playbook suggests the next step.</Empty></Panel>;
  return (
    <div className="space-y-6">
      {groups.filter(([, ts]) => ts.length).map(([label, ts]) => (
        <Panel key={label}>
          <PanelHeader title={label} sub={`${ts.length}`} />
          <ul className="divide-y divide-rule">
            {ts.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className={cn(t.status === "rejected" && "line-through text-faint")}>{t.title}</p>
                  <p className="text-xs text-faint">{SOURCE_LABEL[t.source] ?? t.source}{t.due_date && ` · due ${fmtDate(t.due_date)}`}{t.decided_by && ` · ${t.status} by ${t.decided_by}`}</p>
                  {t.action === "client_update" && t.status !== "rejected" && <ClientMessage t={t} onChanged={() => { refresh(); tasks.refetch(); }} />}
                </div>
                {t.status === "proposed" && canApprove(me?.user.role) && (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => act.mutate({ t, a: "reject" })}>Reject</Button>
                    <Button size="sm" variant="brass" onClick={() => act.mutate({ t, a: "approve" })}>Approve</Button>
                  </div>
                )}
                {t.status === "approved" && <Button size="sm" onClick={() => act.mutate({ t, a: "done" })}><CheckCircle2 className="h-3.5 w-3.5" /> Mark done</Button>}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ drafts */

export function DraftsTab({ d }: { d: MatterDetail }) {
  const id = d.matter.id;
  const router = useRouter();
  const qc = useQueryClient();
  const drafts = useQuery({ queryKey: ["drafts", id], queryFn: () => api.get<DraftListItem[]>(`/drafts${qs({ matter_id: id })}`) });
  const tpl = useQuery({ queryKey: ["templates"], queryFn: () => api.get<Templates>("/drafts/templates"), staleTime: Infinity });
  const [template, setTemplate] = useState("");
  const create = useMutation({
    mutationFn: () => api.post<{ id: number }>("/drafts", { template, matter_id: id }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["drafts"] }); router.push(`/drafts/${r.id}`); },
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Panel className="h-fit">
        <PanelHeader title="New draft" sub="Filled from this matter's facts. Missing facts stay as visible blanks." />
        <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Template">
            <Select value={template} onChange={(e) => setTemplate(e.target.value)} required>
              <option value="" disabled>Choose a template</option>
              {Object.entries((tpl.data?.templates ?? []).reduce<Record<string, Templates["templates"]>>((a, t) => ((a[t.group] ??= []).push(t), a), {})).map(([g, ts]) => (
                <optgroup key={g} label={g}>{ts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
              ))}
            </Select>
          </Field>
          {d.plan.current_drafts.length > 0 && <p className="text-sm text-muted">Suggested at this stage: {d.plan.current_drafts.join(", ")}</p>}
          <ErrorNote error={create.error} />
          <Button type="submit" variant="primary" className="w-full justify-center" disabled={!template} loading={create.isPending}><FilePlus2 className="h-4 w-4" /> Create draft</Button>
        </form>
      </Panel>
      <Panel>
        <PanelHeader title="Drafts for this matter" />
        {drafts.isLoading ? <div className="p-4"><Spinner /></div> : !drafts.data?.length ? <Empty icon={FileText} title="No drafts yet" /> : (
          <ul className="divide-y divide-rule">
            {drafts.data.map((x) => (
              <li key={x.id}>
                <Link href={`/drafts/${x.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-vellum">
                  <FileText className="h-4 w-4 text-brass" />
                  <div className="min-w-0 flex-1"><p className="truncate">{x.title}</p><p className="text-xs text-faint">Edited {timeAgo(x.updated_at)}</p></div>
                  {!!x.placeholders && <Badge tone="amber">{x.placeholders} blank{x.placeholders === 1 ? "" : "s"}</Badge>}
                  <Badge tone={x.status === "final" ? "leaf" : "neutral"}>{x.status === "final" ? "Final" : "Draft"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ notes */

export function NotesTab({ d }: { d: MatterDetail }) {
  const id = d.matter.id;
  const notes = useQuery({ queryKey: ["matter", id, "notes"], queryFn: () => api.get<Note[]>(`/matters/${id}/notes`) });
  const [body, setBody] = useState("");
  const add = useMutation({ mutationFn: () => api.post(`/matters/${id}/notes`, { body }), onSuccess: () => { setBody(""); notes.refetch(); } });
  const del = useMutation({ mutationFn: (nid: number) => api.del(`/notes/${nid}`), onSuccess: () => notes.refetch() });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <HearingNotesBox id={id} />
      <Panel className="p-4">
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="space-y-2">
          <Textarea aria-label="New note" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hearing notes, client instructions, strategy…" />
          <ErrorNote error={add.error} />
          <div className="flex justify-end"><Button type="submit" variant="primary" size="sm" disabled={!body.trim()} loading={add.isPending}>Add note</Button></div>
        </form>
      </Panel>
      {notes.isLoading ? <Spinner /> : !notes.data?.length ? <Empty title="No notes yet" /> : notes.data.map((n) => (
        <Panel as="article" key={n.id} className="group p-4">
          <p className="whitespace-pre-wrap text-base">{n.body}</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-faint">
            <span>{n.author || "Advocate"} · {timeAgo(n.created_at)}</span>
            <button onClick={() => confirm("Delete this note?") && del.mutate(n.id)} className="ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-tape" aria-label="Delete note"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </Panel>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ authorities */

export function AuthoritiesTab({ d }: { d: MatterDetail }) {
  const id = d.matter.id;
  const bm = useQuery({ queryKey: ["bookmarks", id], queryFn: () => api.get<Bookmark[]>(`/bookmarks${qs({ matter_id: id })}`) });
  const del = useMutation({ mutationFn: (bid: number) => api.del(`/bookmarks/${bid}`), onSuccess: () => bm.refetch() });
  if (bm.isLoading) return <Spinner />;
  return (
    <div className="space-y-6">
      {!bm.data?.length ? (
        <Panel><Empty icon={BookMarked} title="No saved authorities" action={<Link href="/research"><Button size="sm">Open research</Button></Link>}>Save judgments or single paragraphs from the reader to this matter.</Empty></Panel>
      ) : (
        <div className="space-y-3">
          {bm.data.map((b) => (
            <Panel as="article" key={b.id} className="group p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Link href={`/judgments/${encodeURIComponent(b.jid)}${b.para_no !== null ? `#p${b.para_no}` : ""}`} className="font-medium hover:text-brass">{b.title}</Link>
                  <p className="text-sm text-muted">{b.citation}{b.para_no !== null && ` · para ${b.para_no}`}</p>
                </div>
                <button onClick={() => del.mutate(b.id)} className="rounded p-1 text-faint opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-tape" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
              </div>
              {b.excerpt && <blockquote className="prose-judgment mt-2 border-l-2 border-brass pl-3 text-base text-muted">{b.excerpt}</blockquote>}
              {b.note && <p className="mt-2 text-sm">{b.note}</p>}
            </Panel>
          ))}
        </div>
      )}
      <OpposingPanel d={d} />
    </div>
  );
}

/* ------------------------------------------------------------------ parties */

export function PartiesTab({ d }: { d: MatterDetail }) {
  const m = d.matter;
  const refresh = useInvalidate(m.id);
  const [f, setF] = useState<Record<string, string>>(m.details ?? {});
  const save = useMutation({
    mutationFn: () => api.patch(`/matters/${m.id}`, { details: f }),
    onSuccess: () => { toast.success("Details saved"); refresh(); },
  });
  return (
    <Panel className="mx-auto max-w-3xl">
      <PanelHeader title="Parties and cheque" sub="Used to fill drafts. Leave a field empty and the draft shows a visible blank." />
      <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {Object.entries(DETAIL_FIELDS).map(([k, label]) => (
          <Field key={k} label={label} className={k.endsWith("address") || k === "liability" ? "sm:col-span-2" : undefined}>
            <Input value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} inputMode={k === "cheque_amount" ? "decimal" : undefined} />
          </Field>
        ))}
        <ErrorNote error={save.error} className="sm:col-span-2" />
        <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" loading={save.isPending}>Save details</Button></div>
      </form>
    </Panel>
  );
}

/* ------------------------------------------------------------------ danger zone */

export function EraseMatter({ m }: { m: Matter }) {
  const { data: me } = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const erase = useMutation({
    mutationFn: () => api.del(`/matters/${m.id}`),
    onSuccess: () => { qc.invalidateQueries(); toast.success("Matter erased"); router.replace("/matters"); },
  });
  if (!isAdmin(me?.user.role)) return null;
  return (
    <Panel className="mt-10 border-tape/30">
      <PanelHeader title="Erase matter permanently" sub="Deletes the matter with its orders, tasks, deadlines, drafts, notes and saved authorities. This cannot be undone. The audit log keeps only that it happened." />
      <form className="flex flex-wrap items-end gap-3 p-4" onSubmit={(e) => { e.preventDefault(); erase.mutate(); }}>
        <Field label={`Type ERASE to confirm`} className="w-60"><Input value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
        <Button type="submit" variant="danger" disabled={typed !== "ERASE"} loading={erase.isPending}>Erase permanently</Button>
        <ErrorNote error={erase.error} className="w-full" />
      </form>
    </Panel>
  );
}
