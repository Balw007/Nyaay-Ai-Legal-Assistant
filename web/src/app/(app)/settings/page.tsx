"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Copy, Download, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { AiStatus, FirmSettings, Review, User } from "@/lib/types";
import { fmtDate, timeAgo } from "@/lib/format";
import { canApprove, isAdmin, useMe } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Empty, ErrorNote, PageHeader, Panel, PanelHeader, Spinner, Tabs } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { ReviewPackDownload, SystemCheck } from "@/components/settings/system-panels";
import { CalendarFeedCard, TelegramCard } from "@/components/settings/connect-panels";

type Tab = "profile" | "chambers" | "team" | "ai" | "review" | "holidays" | "data";
const TABS: { value: Tab; label: string }[] = [
  { value: "profile", label: "Profile" }, { value: "chambers", label: "Chambers" }, { value: "team", label: "Team" },
  { value: "ai", label: "AI" }, { value: "review", label: "Legal review" }, { value: "holidays", label: "Court holidays" }, { value: "data", label: "Data & pilot" },
];
const toastErr = (e: unknown) => toast.error((e as Error).message);

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start justify-between gap-4 py-3", disabled && "opacity-60")}>
      <span><span className="block text-base">{label}</span>{hint && <span className="block text-sm text-faint">{hint}</span>}</span>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors", checked ? "border-brass bg-brass" : "border-rule-strong bg-vellum")}>
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
      </button>
    </label>
  );
}

function Profile() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [p, setP] = useState({ name: "", phone: "", enrolment_no: "", whatsapp_brief: false });
  const [pw, setPw] = useState({ current: "", new: "" });
  useEffect(() => { if (me) setP({ name: me.user.name, phone: me.user.phone ?? "", enrolment_no: me.user.enrolment_no ?? "", whatsapp_brief: me.user.whatsapp_brief }); }, [me]);
  const save = useMutation({ mutationFn: () => api.patch("/auth/me", p), onSuccess: () => { toast.success("Profile saved"); qc.invalidateQueries({ queryKey: ["me"] }); }, onError: toastErr });
  const pass = useMutation({ mutationFn: () => api.post("/auth/password", pw), onSuccess: () => { toast.success("Password changed"); setPw({ current: "", new: "" }); }, onError: toastErr });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel>
        <PanelHeader title="Your profile" sub={me ? `${me.user.email} · ${me.user.role}` : undefined} />
        <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label="Name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
          <Field label="Bar enrolment number" hint="Recorded with every approval and legal sign-off you make."><Input value={p.enrolment_no} onChange={(e) => setP({ ...p, enrolment_no: e.target.value })} /></Field>
          <Field label="WhatsApp number" hint="With country code, e.g. 919876543210."><Input value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></Field>
          <Toggle checked={p.whatsapp_brief} onChange={(v) => setP({ ...p, whatsapp_brief: v })} label="Morning brief on WhatsApp" hint="Today's cause list and deadlines at 8 am. Needs WhatsApp to be connected by an admin." />
          <Button variant="primary" loading={save.isPending}>Save profile</Button>
        </form>
      </Panel>
      <Panel className="self-start">
        <PanelHeader title="Password" />
        <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); pass.mutate(); }}>
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></Field>
          <Field label="New password" hint="At least 10 characters."><Input type="password" autoComplete="new-password" minLength={10} value={pw.new} onChange={(e) => setPw({ ...pw, new: e.target.value })} required /></Field>
          <Button loading={pass.isPending}>Change password</Button>
        </form>
      </Panel>
      <TelegramCard />
      <CalendarFeedCard />
    </div>
  );
}

type Firm = { id: number; name: string; settings: FirmSettings; usage_this_month: number; budget: number };

function useFirm() {
  return useQuery({ queryKey: ["firm"], queryFn: () => api.get<Firm>("/firm") });
}
function usePatchFirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { name?: string; settings?: Partial<FirmSettings> }) => api.patch<Firm>("/firm", b),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["firm"] }); qc.invalidateQueries({ queryKey: ["me"] }); },
    onError: toastErr,
  });
}

function Chambers() {
  const { data: me } = useMe();
  const admin = isAdmin(me?.user.role);
  const firm = useFirm();
  const patch = usePatchFirm();
  const [name, setName] = useState("");
  useEffect(() => { if (firm.data) setName(firm.data.name); }, [firm.data]);
  if (!firm.data) return <Spinner />;
  const s = firm.data.settings;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel>
        <PanelHeader title="Chambers" />
        <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); patch.mutate({ name }); }}>
          <Field label="Chambers or firm name"><Input value={name} disabled={!admin} onChange={(e) => setName(e.target.value)} /></Field>
          <Button disabled={!admin} loading={patch.isPending}>Save name</Button>
        </form>
      </Panel>
      <Panel>
        <PanelHeader title="Court calendar" sub="Used to move filing deadlines past days the court is closed" />
        <div className="p-4">
          <Field label="Saturdays the court is closed">
            <Select disabled={!admin} value={s.closed_saturdays} onChange={(e) => patch.mutate({ settings: { closed_saturdays: e.target.value } })}>
              <option value="second_fourth">Second and fourth Saturdays</option>
              <option value="all">All Saturdays</option>
              <option value="none">None</option>
            </Select>
          </Field>
          <Toggle disabled={!admin} checked={s.require_review} onChange={(v) => patch.mutate({ settings: { require_review: v } })}
            label="Require advocate sign-off on legal rules" hint="Deadline rules, stages and templates show a warning until an advocate approves them." />
        </div>
      </Panel>
    </div>
  );
}

function Team() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const admin = isAdmin(me?.user.role);
  const team = useQuery({ queryKey: ["team"], queryFn: () => api.get<{ users: User[]; invites: { id: number; email: string; role: string; expires_at?: string }[] }>("/team") });
  const [inv, setInv] = useState({ email: "", role: "advocate" });
  const [link, setLink] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => api.post<{ link: string; note: string }>("/team/invites", inv),
    onSuccess: (r) => { setLink(r.link); setInv({ email: "", role: "advocate" }); qc.invalidateQueries({ queryKey: ["team"] }); }, onError: toastErr,
  });
  const patch = useMutation({ mutationFn: ({ id, b }: { id: number; b: Record<string, unknown> }) => api.patch(`/team/${id}`, b), onSuccess: () => qc.invalidateQueries({ queryKey: ["team"] }), onError: toastErr });
  const revoke = useMutation({ mutationFn: (id: number) => api.del(`/team/invites/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["team"] }) });

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Panel>
        <PanelHeader title="People" sub="Clerks prepare work. Only advocates and above approve." />
        {!team.data ? <Spinner className="p-4" /> : (
          <ul className="divide-y divide-rule">
            {team.data.users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-vellum text-sm font-medium">{u.name[0]?.toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{u.name} {!u.active && <Badge tone="tape">Disabled</Badge>}</p>
                  <p className="truncate text-sm text-faint">{u.email}{u.enrolment_no ? ` · ${u.enrolment_no}` : ""}{u.last_login ? ` · active ${timeAgo(u.last_login)}` : ""}</p>
                </div>
                {admin && u.role !== "owner" && u.id !== me?.user.id ? (
                  <>
                    <Select className="h-8 w-32" value={u.role} onChange={(e) => patch.mutate({ id: u.id, b: { role: e.target.value } })}>
                      <option value="admin">Admin</option><option value="advocate">Advocate</option><option value="clerk">Clerk</option>
                    </Select>
                    <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: u.id, b: { active: !u.active } })}>{u.active ? "Disable" : "Enable"}</Button>
                  </>
                ) : <Badge tone={u.role === "owner" ? "brass" : "neutral"}>{u.role}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="self-start">
        <PanelHeader title="Invite a colleague" />
        <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
          <Field label="Email"><Input type="email" required disabled={!admin} value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
          <Field label="Role"><Select disabled={!admin} value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>
            <option value="advocate">Advocate</option><option value="clerk">Clerk</option><option value="admin">Admin</option>
          </Select></Field>
          <Button variant="primary" disabled={!admin} loading={invite.isPending}>Create invite link</Button>
          {link && (
            <div className="space-y-2 rounded-md border border-brass/30 bg-brass-soft p-3">
              <p className="text-sm">Share this link privately. It works once and expires in 7 days.</p>
              <button type="button" onClick={() => { navigator.clipboard?.writeText(link); toast.success("Link copied"); }}
                className="flex w-full items-center gap-2 truncate rounded border border-rule bg-vellum px-2 py-1.5 text-left text-sm"><Copy className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{link}</span></button>
            </div>
          )}
          {!!team.data?.invites.length && (
            <ul className="space-y-1 border-t border-rule pt-3 text-sm">
              {team.data.invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2"><span className="truncate text-muted">{i.email} · {i.role}</span>
                  {admin && <button type="button" className="text-tape hover:underline" onClick={() => revoke.mutate(i.id)}>Revoke</button>}</li>
              ))}
            </ul>
          )}
        </form>
      </Panel>
    </div>
  );
}

function Ai() {
  const { data: me } = useMe();
  const admin = isAdmin(me?.user.role);
  const firm = useFirm();
  const patch = usePatchFirm();
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.get<{ ai: AiStatus }>("/health") });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => api.get<{ month_tokens: number; budget: number; by_feature: { feature: string; calls: number; tokens: number }[] }>("/firm/usage") });
  const ai = health.data?.ai;
  const s = firm.data?.settings;
  const pct = usage.data ? Math.min(100, (usage.data.month_tokens / Math.max(1, usage.data.budget)) * 100) : 0;
  return (
    <div id="ai" className="grid gap-6 lg:grid-cols-2">
      <Panel>
        <PanelHeader title="Local AI with Ollama" sub="Free and private: models run on this computer and nothing is sent to an AI company." />
        <div className="space-y-4 p-4 text-sm">
          {ai && <p className={cn("flex items-center gap-2 text-base", ai.ready ? "text-leaf" : "text-amber")}>{ai.ready ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}{ai.message}</p>}
          {ai?.model && <p className="text-muted">Answers and drafting: <span className="text-text">{ai.model}</span>. Summaries and order reading: <span className="text-text">{ai.model_fast}</span>.</p>}
          <ol className="list-decimal space-y-2 pl-5 text-muted">
            <li>Install Ollama from <a className="text-brass hover:underline" href="https://ollama.com" target="_blank" rel="noreferrer">ollama.com</a> and open it.</li>
            <li>In a terminal, run each command once:</li>
          </ol>
          {["ollama pull qwen3:8b", "ollama pull qwen3:4b", "ollama pull nomic-embed-text"].map((c) => (
            <button key={c} onClick={() => { navigator.clipboard?.writeText(c); toast.success("Copied"); }}
              className={cn("block w-full rounded-md border px-3 py-1.5 text-left font-mono text-sm", ai?.missing?.some((m) => c.endsWith(m)) ? "border-amber/40 bg-amber-soft" : "border-rule bg-vellum")}>{c}</button>
          ))}
          <p className="text-faint">On a laptop without a graphics card, answers take several seconds. Nyaay uses the small model for routine work to keep it quick.</p>
        </div>
      </Panel>
      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Privacy and limits" />
          {!s ? <Spinner className="p-4" /> : (
            <div className="divide-y divide-rule px-4">
              <Toggle disabled={!admin} checked={s.ai_enabled} onChange={(v) => patch.mutate({ settings: { ai_enabled: v } })} label="Use AI in this chambers" hint="When off, research, deadlines and drafting still work; nothing goes to any model." />
              <Toggle disabled={!admin} checked={s.redact_pii} onChange={(v) => patch.mutate({ settings: { redact_pii: v } })} label="Hide personal identifiers from the AI" hint="Aadhaar, PAN, phone, email, IFSC and account numbers are masked before the model sees text, and restored after." />
              <Toggle disabled={!admin} checked={s.rerank} onChange={(v) => patch.mutate({ settings: { rerank: v } })} label="AI re-ranking of search results" hint="Better ordering of results; slower on CPU." />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Usage this month" />
          <div className="space-y-3 p-4 text-sm">
            <div className="flex justify-between"><span className="text-muted">Tokens processed</span><span className="tabular-nums">{(usage.data?.month_tokens ?? 0).toLocaleString("en-IN")} / {(usage.data?.budget ?? 0).toLocaleString("en-IN")}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-vellum"><div className={cn("h-full rounded-full", pct > 85 ? "bg-tape" : "bg-cyan")} style={{ width: `${pct}%` }} /></div>
            {usage.data?.by_feature.map((f) => <div key={f.feature} className="flex justify-between text-muted"><span>{f.feature}</span><span className="tabular-nums">{f.calls} calls · {f.tokens.toLocaleString("en-IN")}</span></div>)}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function LegalReview() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ["reviews"], queryFn: () => api.get<{ items: Review[]; approved: number; total: number }>("/reviews") });
  const [comment, setComment] = useState<Record<string, string>>({});
  const decide = useMutation({
    mutationFn: (b: { kind: string; ref: string; status: string; comment: string }) => api.post("/reviews", b),
    onSuccess: () => { toast.success("Recorded with your enrolment number"); qc.invalidateQueries({ queryKey: ["reviews"] }); }, onError: toastErr,
  });
  if (!q.data) return q.isError ? <ErrorNote error={q.error} /> : <Spinner />;
  const groups = q.data.items.reduce<Record<string, Review[]>>((a, r) => ({ ...a, [r.group]: [...(a[r.group] ?? []), r] }), {});
  const can = canApprove(me?.user.role) && !!me?.user.enrolment_no;
  return (
    <div className="space-y-4">
      <ReviewPackDownload />
      <Panel className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex-1">
          <p className="font-medium">{q.data.approved} of {q.data.total} legal rules approved</p>
          <p className="text-sm text-muted">Every deadline rule, stage and template was written from general knowledge. A practising advocate must check each one before real client use.</p>
        </div>
        <div className="h-2 w-48 overflow-hidden rounded-full bg-vellum"><div className="h-full rounded-full bg-leaf" style={{ width: `${(q.data.approved / Math.max(1, q.data.total)) * 100}%` }} /></div>
      </Panel>
      {!can && <p className="text-sm text-amber">Sign-off needs an advocate account with an enrolment number (Settings → Profile).</p>}
      {Object.entries(groups).map(([g, items]) => (
        <Panel key={g}>
          <PanelHeader title={g} />
          <ul className="divide-y divide-rule">
            {items.map((r) => {
              const k = `${r.kind}:${r.ref}`;
              return (
                <li key={k} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={r.status === "approved" ? "leaf" : r.status === "changes_requested" ? "tape" : "amber"}>{r.status === "approved" ? "Approved" : r.status === "changes_requested" ? "Changes requested" : "Not reviewed"}</Badge>
                      <Badge>{r.kind}</Badge>
                    </div>
                    <p className="mt-1.5">{r.label}</p>
                    <p className="text-sm text-faint">{r.detail}</p>
                    {r.reviewer && <p className="mt-1 text-xs text-muted">{r.reviewer} ({r.enrolment}) · {fmtDate(r.at)}{r.comment ? ` · “${r.comment}”` : ""}</p>}
                  </div>
                  {can && r.status !== "approved" && (
                    <div className="flex flex-col gap-2 md:w-64">
                      <Textarea rows={2} placeholder="Comment (required to request changes)" value={comment[k] ?? ""} onChange={(e) => setComment({ ...comment, [k]: e.target.value })} />
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" onClick={() => decide.mutate({ kind: r.kind, ref: r.ref, status: "approved", comment: comment[k] ?? "" })}>Approve</Button>
                        <Button size="sm" onClick={() => decide.mutate({ kind: r.kind, ref: r.ref, status: "changes_requested", comment: comment[k] ?? "" })}>Request changes</Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

function Holidays() {
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const q = useQuery({ queryKey: ["holidays"], queryFn: () => api.get<{ id: number; day: string; name: string; court: string }[]>("/holidays") });
  const [h, setH] = useState({ day: "", name: "", court: "" });
  const [csv, setCsv] = useState("");
  const inv = () => { qc.invalidateQueries({ queryKey: ["holidays"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const add = useMutation({ mutationFn: () => api.post("/holidays", h), onSuccess: () => { setH({ day: "", name: "", court: "" }); inv(); }, onError: toastErr });
  const imp = useMutation({ mutationFn: () => api.post<{ added?: number }>("/holidays/import", { csv }), onSuccess: (r) => { toast.success(`Imported ${r.added ?? ""} holidays`); setCsv(""); inv(); }, onError: toastErr });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/holidays/${id}`), onSuccess: inv });
  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <Panel>
        <PanelHeader title="Court holidays" sub="Filing deadlines that fall on these days move to the next open day (s.10 General Clauses Act)." />
        {!q.data ? <Spinner className="p-4" /> : q.data.length === 0 ? <Empty title="No holidays added">Add your court's official holiday list for {year} so deadlines are moved correctly.</Empty> : (
          <ul className="divide-y divide-rule">
            {q.data.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-28 shrink-0 tabular-nums text-muted">{fmtDate(x.day)}</span><span className="flex-1">{x.name}</span><span className="text-faint">{x.court || "All courts"}</span>
                <button aria-label={`Delete ${x.name}`} onClick={() => del.mutate(x.id)} className="rounded p-1 text-faint hover:text-tape"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Add a holiday" />
          <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <Field label="Date"><Input type="date" required value={h.day} onChange={(e) => setH({ ...h, day: e.target.value })} /></Field>
            <Field label="Name"><Input required value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} placeholder="Diwali" /></Field>
            <Field label="Court (empty for all)"><Input value={h.court} onChange={(e) => setH({ ...h, court: e.target.value })} /></Field>
            <Button loading={add.isPending}>Add holiday</Button>
          </form>
        </Panel>
        <Panel>
          <PanelHeader title="Import a list" sub="One per line: date,name[,court]" />
          <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); imp.mutate(); }}>
            <Textarea rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={`${year}-01-26,Republic Day\n${year}-08-15,Independence Day`} className="font-mono text-sm" />
            <Button disabled={!csv.trim()} loading={imp.isPending}>Import</Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function Data() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const admin = isAdmin(me?.user.role);
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: () => api.get<{ users: number; active_this_week: number; searches: number; zero_result_searches: { query: string; count?: number }[] | string[]; ai_proposals: number; ai_proposals_decided: number; ai_acceptance: number | null; feedback: { up: number; down: number } }>("/metrics") });
  const purge = useMutation({ mutationFn: () => api.post("/firm/purge-ai-cache"), onSuccess: () => toast.success("AI answer cache cleared"), onError: toastErr });
  const m = metrics.data;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="lg:col-span-2"><SystemCheck admin={admin} /></div>
      <Panel>
        <PanelHeader title="Your data" sub="Client data stays on the machine running Nyaay." />
        <div className="space-y-4 p-4">
          <div>
            <p className="font-medium">Export everything</p>
            <p className="text-sm text-muted">Matters, orders, tasks, drafts, notes and saved authorities as one JSON file.</p>
            <a href="/api/firm/export" className={cn("mt-2 inline-flex", !admin && "pointer-events-none opacity-50")}><Button size="sm"><Download className="h-3.5 w-3.5" /> Download export</Button></a>
          </div>
          <div className="border-t border-rule pt-4">
            <p className="font-medium">Clear saved AI answers</p>
            <p className="text-sm text-muted">Answers are cached for 7 days to save time. Clear them after loading new judgments.</p>
            <Button size="sm" className="mt-2" disabled={!admin} loading={purge.isPending} onClick={() => purge.mutate()}>Clear cache</Button>
          </div>
          <p className="border-t border-rule pt-4 text-sm text-muted">To erase a single matter permanently, open it and use “Erase matter”. Example data can be removed from the Library page.</p>
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Pilot signals" sub="Is Nyaay becoming a habit?" action={<button className="text-sm text-brass hover:underline" onClick={() => qc.invalidateQueries({ queryKey: ["metrics"] })}>Refresh</button>} />
        {!m ? <Spinner className="p-4" /> : (
          <dl className="grid grid-cols-2 gap-px bg-rule">
            {[["People active this week", `${m.active_this_week} / ${m.users}`], ["Searches", m.searches], ["AI proposals accepted", m.ai_acceptance === null ? "—" : `${Math.round(m.ai_acceptance * 100)}%`], ["Decided proposals", `${m.ai_proposals_decided} / ${m.ai_proposals}`], ["Thumbs up", m.feedback.up], ["Thumbs down", m.feedback.down]].map(([k, v]) => (
              <div key={k as string} className="bg-surface-solid/60 px-4 py-3"><dt className="text-xs text-muted">{k}</dt><dd className="font-display text-lg font-semibold">{v}</dd></div>
            ))}
          </dl>
        )}
        {!!m?.zero_result_searches.length && (
          <div className="border-t border-rule p-4">
            <p className="mb-2 text-sm text-muted">Searches that found nothing (gaps in the library)</p>
            <div className="flex flex-wrap gap-1.5">{m.zero_result_searches.slice(0, 12).map((z, i) => <Badge key={i}>{typeof z === "string" ? z : z.query}</Badge>)}</div>
          </div>
        )}
      </Panel>
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("profile");
  useEffect(() => {
    const h = location.hash.slice(1) as Tab;
    if (TABS.some((t) => t.value === h)) setTab(h);
  }, []);
  const change = (t: Tab) => { setTab(t); history.replaceState(null, "", `#${t}`); };
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={change} items={TABS} className="overflow-x-auto scrollbar-thin" />
      {tab === "profile" && <Profile />}
      {tab === "chambers" && <Chambers />}
      {tab === "team" && <Team />}
      {tab === "ai" && <Ai />}
      {tab === "review" && <LegalReview />}
      {tab === "holidays" && <Holidays />}
      {tab === "data" && <Data />}
    </div>
  );
}
