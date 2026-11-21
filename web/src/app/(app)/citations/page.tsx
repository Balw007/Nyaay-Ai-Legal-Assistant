"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import { BadgeCheck, BookOpen, ExternalLink, FileUp, Lock, ShieldCheck, Unlock, UserCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { CitationCheck, CheckItem, Matter } from "@/lib/types";
import { canApprove, useMe } from "@/lib/hooks";
import { plural } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/field";
import { Badge, Empty, ErrorNote, PageHeader, Panel, Spinner } from "@/components/ui/misc";
import { STATUS, statusMeta } from "@/components/research/status";
import { cn } from "@/lib/utils";

const ORDER = ["VERIFIED", "FOUND_EXTERNALLY", "EXISTS_UNCHECKED", "NOT_IN_LIBRARY", "EXISTS_NOT_SUPPORTED", "CITATION_MISMATCH"];
const BAR: Record<string, string> = { leaf: "bg-leaf", amber: "bg-amber", tape: "bg-tape", neutral: "bg-faint", cyan: "bg-cyan" };

function CitationsInner() {
  const params = useSearchParams();
  const { data: me } = useMe();
  const [text, setText] = useState("");
  const [matter, setMatter] = useState(params.get("matter") ?? "");
  const [result, setResult] = useState<CitationCheck | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const matters = useQuery({ queryKey: ["matters"], queryFn: () => api.get<Matter[]>("/matters") });

  const check = useMutation({
    mutationFn: () => api.post<CitationCheck>("/citations/check", { text, matter_id: matter ? Number(matter) : null }),
    onSuccess: setResult,
  });
  const upload = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); if (matter) fd.append("matter_id", matter); return api.upload<CitationCheck>("/citations/check-file", fd); },
    onSuccess: setResult,
  });
  const confirm = useMutation({
    mutationFn: (index: number) => api.post<CitationCheck>(`/citations/${result!.id}/items/${index}/confirm`, { actor: "advocate" }),
    onSuccess: (r) => { setResult(r); toast.success("Confirmed. Your name and enrolment are recorded."); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not confirm"),
  });

  const loadId = params.get("id");
  useEffect(() => {
    if (!loadId) return;
    api.get<CitationCheck>(`/citations/${loadId}`).then(setResult).catch(() => toast.error("Could not open that citation check"));
  }, [loadId]);

  const busy = check.isPending || upload.isPending;
  const s = result?.summary;
  const approver = canApprove(me?.user.role);

  return (
    <div className="space-y-6">
      <PageHeader title="Citation check" sub="Every citation in a draft is matched to a judgment and paragraph. A draft is ready to file only when each one is verified or confirmed by an advocate." />

      <Panel className="p-4">
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) check.mutate(); }} className="space-y-3">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} aria-label="Draft text"
            placeholder="Paste a draft, written submissions, or any text with citations, e.g. (2019) 5 SCC 418, 2024 INSC 12, AIR 1990 SC 123"
            className="prose-judgment text-[15px]" />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" loading={check.isPending} disabled={!text.trim() || busy}><ShieldCheck className="h-4 w-4" />Check citations</Button>
            <Button type="button" onClick={() => file.current?.click()} loading={upload.isPending} disabled={busy}><FileUp className="h-4 w-4" />Upload Word, PDF or text</Button>
            <input ref={file} type="file" accept=".docx,.pdf,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
            <Select value={matter} onChange={(e) => setMatter(e.target.value)} className="h-9 w-auto min-w-[220px] text-sm" aria-label="Attach to matter">
              <option value="">Not attached to a matter</option>
              {matters.data?.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </Select>
          </div>
        </form>
        <ErrorNote error={check.error || upload.error} className="mt-3" />
      </Panel>

      {busy && <Spinner label="Matching citations to judgments" />}

      {result && s && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Panel className={cn("p-5", s.total > 0 && (s.can_export ? "glow-brass" : "border-tape/40"))}>
            <div className="flex flex-wrap items-center gap-4">
              {s.can_export && s.total > 0 ? <Unlock className="h-6 w-6 text-leaf" /> : <Lock className="h-6 w-6 text-tape" />}
              <div className="flex-1 min-w-[220px]">
                <p className="font-display text-lg font-semibold">
                  {s.total === 0 ? "No citations found" : s.can_export ? "Ready to file" : `Not ready to file · ${plural(s.blockers.length, "citation")} to resolve`}
                </p>
                <p className="text-sm text-muted">{s.total === 0 ? s.note || "The text has no recognisable citations." : `${plural(s.total, "citation")} checked${result.method === "llm" ? " · support checked by your local AI" : " · AI was off, so support was not checked automatically"}`}</p>
              </div>
            </div>
            {s.total > 0 && (
              <>
                <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-vellum" role="img" aria-label="Citations by status">
                  {ORDER.filter((k) => s.counts[k]).map((k) => <div key={k} className={BAR[statusMeta(k).tone]} style={{ width: `${(s.counts[k] / s.total) * 100}%` }} />)}
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {Object.entries(s.counts).map(([k, n]) => (
                    <li key={k} className="flex items-center gap-1.5 text-muted"><span className={cn("h-2 w-2 rounded-full", BAR[statusMeta(k).tone])} />{statusMeta(k).label}: <span className="text-text tabular-nums">{n}</span></li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          {result.items.length === 0 ? null : (
            <ol className="space-y-3">
              {result.items.map((it) => <Item key={it.index} it={it} canConfirm={approver} confirming={confirm.isPending && confirm.variables === it.index} onConfirm={() => confirm.mutate(it.index)} />)}
            </ol>
          )}
        </motion.div>
      )}

      {!result && !busy && (
        <Panel>
          <Empty icon={ShieldCheck} title="Check before you file">
            <ul className="mt-2 space-y-1 text-left text-sm">
              {Object.entries(STATUS).slice(0, 4).map(([k, v]) => <li key={k}><span className="text-text">{v.label}.</span> {v.explain}</li>)}
            </ul>
          </Empty>
        </Panel>
      )}
    </div>
  );
}

function Item({ it, canConfirm, confirming, onConfirm }: { it: CheckItem; canConfirm: boolean; confirming: boolean; onConfirm: () => void }) {
  const meta = statusMeta(it.status);
  const done = it.status === "VERIFIED" || it.advocate_confirmed;
  return (
    <li>
      <Panel as="article" className={cn("p-4", done ? "border-leaf/30" : meta.tone === "tape" ? "border-tape/40" : "")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-md font-semibold">{it.citation}</p>
            {it.judgment_title && <p className="text-sm text-muted">{it.judgment_title}{it.court ? ` · ${it.court}` : ""}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {it.status === "VERIFIED" && <BadgeCheck className="h-5 w-5 text-brass" aria-hidden />}
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {it.advocate_confirmed && <Badge tone="leaf"><UserCheck className="h-3 w-3" />Confirmed{it.confirmed_by ? ` by ${it.confirmed_by}` : ""}</Badge>}
          </div>
        </div>
        {it.proposition && <p className="prose-judgment mt-3 border-l-2 border-rule-strong pl-3 text-[15px] text-muted">{it.proposition}</p>}
        <p className="mt-2 text-sm text-faint">{it.message || meta.explain}</p>
        {it.support?.reason && it.support.method !== "none" && <p className="mt-1 text-sm text-muted">AI check: {it.support.reason}</p>}
        {it.paragraphs.length > 0 && it.judgment_id && (
          <ul className="mt-3 space-y-2">
            {it.paragraphs.slice(0, 2).map((p) => (
              <li key={p.no}>
                <Link href={`/judgments/${encodeURIComponent(it.judgment_id!)}?para=${p.no}`} className="group flex gap-3 rounded-md bg-vellum px-3 py-2 hover:bg-brass-soft">
                  <span className="w-9 shrink-0 font-display text-sm text-brass tabular-nums">¶ {p.no}</span>
                  <span className="prose-judgment text-sm text-muted group-hover:text-text line-clamp-3">{p.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {it.judgment_id && <Link href={`/judgments/${encodeURIComponent(it.judgment_id)}${it.paragraphs[0] ? `?para=${it.paragraphs[0].no}` : ""}`}><Button size="sm"><BookOpen className="h-3.5 w-3.5" />Read judgment</Button></Link>}
          {it.search_url && <a href={it.search_url} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="h-3.5 w-3.5" />Search Indian Kanoon</Button></a>}
          {!done && canConfirm && <Button size="sm" variant="brass" loading={confirming} onClick={onConfirm} title="States that you have read the authority yourself. Recorded with your name and enrolment number."><UserCheck className="h-3.5 w-3.5" />I have read it, confirm</Button>}
          {!done && !canConfirm && <span className="text-xs text-faint">An advocate must confirm this citation.</span>}
        </div>
      </Panel>
    </li>
  );
}

export default function CitationsPage() {
  return <Suspense fallback={<Spinner />}><CitationsInner /></Suspense>;
}
