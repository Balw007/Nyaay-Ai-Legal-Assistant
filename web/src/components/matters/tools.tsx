"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarDays, Copy, Download, MessageCircle, MessagesSquare, Route, Scale, Send, Target } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { MatterDetail, OpposingResult, RoutesResponse, Task } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { canApprove, useMe } from "@/lib/hooks";
import { Badge, Empty, ErrorNote, Panel, PanelHeader, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Drawer } from "./modal";
import { TreatmentWord } from "@/components/research/treatment";

const toastErr = (e: unknown) => toast.error((e as Error).message);

/* ---------------------------------------------------------------- calendar export */

export function IcsDownload({ matterId, label = "Add to calendar" }: { matterId?: number; label?: string }) {
  const href = matterId ? `/api/matters/${matterId}/calendar.ics?download=true` : "/api/calendar.ics?download=true";
  return (
    <a href={href} download>
      <Button type="button" title="Download a .ics file for Google Calendar, Apple Calendar or Outlook"><Download className="h-4 w-4" /> {label}</Button>
    </a>
  );
}

/* ---------------------------------------------------------------- client message (approved -> copy / WhatsApp) */

export function ClientMessage({ t, onChanged }: { t: Task; onChanged?: () => void }) {
  const msg = String((t.payload as { message?: string })?.message ?? t.detail ?? "");
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(msg);
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["approvals"] }); onChanged?.(); };
  const save = useMutation({ mutationFn: () => api.patch(`/tasks/${t.id}`, { detail: text }), onSuccess: () => { setEdit(false); toast.success("Message updated"); refresh(); }, onError: toastErr });
  const sent = useMutation({ mutationFn: () => api.post(`/tasks/${t.id}/done`), onSuccess: () => { toast.success("Marked as sent"); refresh(); }, onError: toastErr });
  const wa = useMutation({
    mutationFn: () => api.get<{ whatsapp_url: string }>(`/tasks/${t.id}/share`),
    onSuccess: (r) => window.open(r.whatsapp_url, "_blank", "noopener"), onError: toastErr,
  });
  const ready = t.status === "approved" || t.status === "done";
  return (
    <div className="mt-2 space-y-2">
      {edit ? (
        <>
          <Textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} aria-label="Client message" />
          <div className="flex gap-2"><Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button><Button size="sm" variant="ghost" onClick={() => { setText(msg); setEdit(false); }}>Cancel</Button></div>
        </>
      ) : (
        <blockquote className="whitespace-pre-wrap rounded-md border-l-2 border-brass bg-vellum px-3 py-2 text-sm text-muted">{msg}</blockquote>
      )}
      {!edit && (
        <div className="flex flex-wrap gap-1.5">
          {t.status === "proposed" && <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>Edit message</Button>}
          {ready && <>
            <Button size="sm" onClick={() => { navigator.clipboard.writeText(msg); toast.success("Message copied"); }}><Copy className="h-3.5 w-3.5" /> Copy</Button>
            <Button size="sm" variant="brass" loading={wa.isPending} onClick={() => wa.mutate()}><MessageCircle className="h-3.5 w-3.5" /> Share on WhatsApp</Button>
            {t.status === "approved" && <Button size="sm" variant="ghost" loading={sent.isPending} onClick={() => sent.mutate()}>Mark as sent</Button>}
          </>}
          {t.status === "proposed" && <span className="self-center text-xs text-faint">Approve it first to copy or share. Nothing is ever sent for you.</span>}
        </div>
      )}
    </div>
  );
}

export function ClientUpdateButton({ d }: { d: MatterDetail }) {
  const m = d.matter;
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState("en");
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const make = useMutation({
    mutationFn: () => api.post<Task>(`/matters/${m.id}/client-update`, { language, note }),
    onSuccess: () => { toast.success("Draft added to Approvals. Check it, approve it, then share."); setOpen(false); setNote(""); qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["matter", m.id] }); },
    onError: toastErr,
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}><MessagesSquare className="h-4 w-4" /> Client update</Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Draft a client update">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); make.mutate(); }}>
          <p className="text-sm text-muted">Written from this matter's confirmed dates and stage. It goes to your approvals queue. Nothing is sent from here.</p>
          <Field label="Language"><Select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en">English</option><option value="hi">हिन्दी (Hindi)</option><option value="mr">मराठी (Marathi)</option></Select></Field>
          <Field label="Add a line of your own (optional)" hint="Added exactly as you type it."><Textarea rows={3} value={note} maxLength={600} onChange={(e) => setNote(e.target.value)} /></Field>
          <ErrorNote error={make.error} />
          <Button type="submit" variant="primary" loading={make.isPending}>Add to approvals</Button>
        </form>
      </Drawer>
    </>
  );
}

/* ---------------------------------------------------------------- hearing notes */

export function HearingNotesBox({ id }: { id: number }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [res, setRes] = useState<{ method: string; needs_review: string[]; tasks: Task[] } | null>(null);
  const run = useMutation({
    mutationFn: () => api.post<{ method: string; needs_review: string[]; tasks: Task[] }>(`/matters/${id}/hearing-notes`, { text, hearing_date: date || null }),
    onSuccess: (r) => { setRes(r); setText(""); qc.invalidateQueries({ queryKey: ["matter", id] }); qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success(r.tasks.length ? `${r.tasks.length} task(s) proposed` : "Note saved. No new tasks found."); },
    onError: toastErr,
  });
  return (
    <Panel className="p-4">
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
        <p className="text-sm font-medium">Hearing notes to tasks</p>
        <Textarea aria-label="Hearing notes" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"What happened in court. For example:\nCourt directed us to file the list of witnesses.\nCollect the original return memo from the client.\nNext date of hearing is 25/05/2027."} />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Hearing date (optional)"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" /></Field>
          <Button type="submit" variant="primary" loading={run.isPending} disabled={text.trim().length < 10}>Save note and propose tasks</Button>
        </div>
        <p className="text-xs text-faint">The note is saved below. Proposed tasks wait in Approvals; dates are only taken from what you wrote.</p>
      </form>
      {res && (
        <div className="mt-3 space-y-1.5 border-t border-rule pt-3 text-sm">
          <p className="text-muted">Read with {res.method === "ai" ? "AI" : "plain rules"}. <Link href="/approvals" className="text-brass hover:underline">Review in Approvals</Link></p>
          {res.needs_review.map((n) => <p key={n} className="text-amber">{n}</p>)}
          <ul className="list-disc pl-5">{res.tasks.map((t) => <li key={t.id}>{t.title}{t.due_date && <span className="text-faint"> · {fmtDate(t.due_date)}</span>}</li>)}</ul>
        </div>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- opposing side */

export function OpposingPanel({ d }: { d: MatterDetail }) {
  const [pos, setPos] = useState(d.matter.goal ?? "");
  const run = useMutation({ mutationFn: () => api.post<OpposingResult>(`/matters/${d.matter.id}/opposing-check`, { position: pos }), onError: toastErr });
  const r = run.data;
  return (
    <Panel>
      <PanelHeader title="What could the other side say?" sub="Checks your saved authorities for later adverse treatment, then looks for paragraphs in the library that point the other way." />
      <div className="space-y-3 p-4">
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
          <Field label="Your proposition"><Textarea rows={2} value={pos} onChange={(e) => setPos(e.target.value)} placeholder="e.g. the demand notice was served within 30 days of the bank's information" /></Field>
          <Button type="submit" variant="primary" size="sm" loading={run.isPending}><Scale className="h-3.5 w-3.5" /> Check</Button>
        </form>
        <ErrorNote error={run.error} />
        {r && (
          <div className="space-y-4">
            {r.message && <p className="rounded-md border border-rule bg-vellum px-3 py-2 text-sm text-muted">{r.message}</p>}
            {r.answer && (
              <div className="rounded-md border border-brass/30 bg-brass-soft p-3">
                <p className="whitespace-pre-wrap text-base">{r.answer}</p>
                {r.checks?.invalid_markers_removed.length ? <p className="mt-1 text-xs text-amber">Unmatched source markers were removed.</p> : null}
                {r.checks?.uncited_sentences.length ? <p className="mt-1 text-xs text-amber">{r.checks.uncited_sentences.length} sentence(s) carry no source. Treat them as unverified.</p> : null}
              </div>
            )}
            <div>
              <p className="mb-1.5 text-sm font-medium">Your saved authorities ({r.saved_authorities})</p>
              {r.adverse_treatment.length ? r.adverse_treatment.map((a) => (
                <div key={a.jid} className="mb-2 rounded-md border border-tape/30 bg-tape-soft/40 p-3">
                  <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-tape" /><Link href={`/judgments/${encodeURIComponent(a.jid)}`} className="hover:text-brass">{a.title}</Link></p>
                  <ul className="mt-1 space-y-0.5 text-sm text-muted">{a.citing.map((c) => <li key={c.id}><Badge tone={c.treatment === "negative" ? "tape" : "amber"}>{c.treatment}</Badge> <Link href={`/judgments/${encodeURIComponent(c.id)}`} className="hover:text-brass">{c.title}</Link> ({c.court}, {c.year})</li>)}</ul>
                </div>
              )) : <p className="text-sm text-muted">{r.saved_authorities ? "No later judgment in the library overruled, doubted or distinguished them. The library may not hold every later case." : "Nothing saved to this matter yet."}</p>}
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium">Paragraphs that may be used against you</p>
              {r.contrary_sources.length ? r.contrary_sources.map((s) => (
                <article key={s.sid} className="mb-2 rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/judgments/${encodeURIComponent(s.jid)}?para=${s.para_no}`} className="font-medium hover:text-brass">[S{s.sid}] {s.title}</Link>
                    <TreatmentWord value={s.treatment} />
                    {s.why && <Badge tone="amber">{s.why}</Badge>}
                  </div>
                  <p className="text-xs text-faint">{s.citation} · {s.court} · para {s.para_no}</p>
                  <p className="prose-judgment mt-1 line-clamp-4 text-sm text-muted">{s.text}</p>
                </article>
              )) : <p className="text-sm text-muted">Nothing else in the library matches.</p>}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- route options */

export function RoutesTab({ d }: { d: MatterDetail }) {
  const id = d.matter.id;
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [wi, setWi] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ["routes", id, wi], queryFn: () => api.get<RoutesResponse>(`/matters/${id}/routes${qs(wi)}`) });
  const pick = useMutation({
    mutationFn: (route_id: string) => api.put<{ goal: string; draft: boolean }>(`/matters/${id}/goal`, { route_id }),
    onSuccess: (r) => { toast.success(r.draft ? "Goal set. This route is still a draft until an advocate signs it off." : "Goal set"); qc.invalidateQueries({ queryKey: ["matter", id] }); qc.invalidateQueries({ queryKey: ["routes", id] }); },
    onError: toastErr,
  });
  if (q.isLoading && !q.data) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const r = q.data!;
  const inputs = r.inputs.filter((i) => r.routes.some((x) => x.what_if_inputs.includes(i.name)));
  return (
    <div className="space-y-5">
      <p className="rounded-md border border-amber/30 bg-amber-soft px-3 py-2 text-sm text-amber"><AlertTriangle className="mr-1.5 inline h-4 w-4" />{r.note || "Dates come from fixed rules. Confirm each one yourself."} Routes marked draft have not been signed off by an advocate.</p>
      {inputs.length > 0 && (
        <Panel>
          <PanelHeader title="What if…" sub="Try a date to see how the deadlines move. This is not saved to the matter." />
          <div className="flex flex-wrap items-end gap-3 p-4">
            {inputs.map((i) => (
              <Field key={i.name} label={i.label} hint={i.saved ? `Saved: ${fmtDate(i.saved)}` : "Not recorded yet"}>
                <Input type="date" className="w-48" value={wi[i.name] ?? ""} onChange={(e) => setWi((w) => { const n = { ...w }; if (e.target.value) n[i.name] = e.target.value; else delete n[i.name]; return n; })} />
              </Field>
            ))}
            {Object.keys(wi).length > 0 && <Button size="sm" variant="ghost" onClick={() => setWi({})}>Clear</Button>}
          </div>
        </Panel>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {r.routes.map((x) => {
          const chosen = r.route_id === x.id;
          return (
            <Panel as="article" key={x.id} className={chosen ? "border-brass/60" : ""}>
              <PanelHeader title={x.name} sub={x.authority} action={<div className="flex gap-1.5">{x.draft ? <Badge tone="amber">Draft</Badge> : <Badge tone="leaf">Signed off</Badge>}{chosen && <Badge tone="brass">Your goal</Badge>}</div>} />
              <div className="space-y-3 p-4 text-sm">
                <p className="text-base text-muted">{x.summary}</p>
                <ol className="list-decimal space-y-1 pl-5">{x.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                {x.deadlines.length > 0 && (
                  <ul className="space-y-1.5 rounded-md border border-rule p-2.5">
                    {x.deadlines.map((dl) => (
                      <li key={dl.rule_id} className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>{dl.label}</span>
                        <span className={dl.changed_by_what_if ? "font-medium text-cyan" : "text-muted"}>{dl.due_date ? fmtDate(dl.due_date) : <span className="text-faint">{dl.note || "needs a date"}</span>}{dl.changed_by_what_if && dl.saved_due_date && <span className="text-faint"> (saved: {fmtDate(dl.saved_due_date)})</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {x.consider.length > 0 && <div><p className="font-medium">Consider</p><ul className="list-disc pl-5 text-muted">{x.consider.map((s) => <li key={s}>{s}</li>)}</ul></div>}
                {x.risks.length > 0 && <div><p className="font-medium text-tape">Risks</p><ul className="list-disc pl-5 text-muted">{x.risks.map((s) => <li key={s}>{s}</li>)}</ul></div>}
                {canApprove(me?.user.role) && <Button size="sm" variant={chosen ? "ghost" : "brass"} disabled={chosen} loading={pick.isPending && pick.variables === x.id} onClick={() => pick.mutate(x.id)}><Target className="h-3.5 w-3.5" /> {chosen ? "Chosen as the goal" : "Choose as the goal"}</Button>}
              </div>
            </Panel>
          );
        })}
      </div>
      {r.routes.length === 0 && <Panel><Empty icon={Route} title="No route options for this case type yet" /></Panel>}
    </div>
  );
}
