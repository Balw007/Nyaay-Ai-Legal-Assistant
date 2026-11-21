"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Download, Save, ShieldCheck, Sparkles, Stamp, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Draft } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { canApprove, useMe } from "@/lib/hooks";
import { Badge, ErrorNote, Panel, PanelHeader, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { DraftEditor, type EditorHandle } from "@/components/matters/draft-editor";

type Polish = { body: string; changes: string[]; problems: string[]; accepted: boolean };
const PH = /\[\[[^\]]+\]\]/g;

export default function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const editor = useRef<EditorHandle>(null);
  const q = useQuery({ queryKey: ["draft", id], queryFn: () => api.get<Draft>(`/drafts/${id}`) });
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [suggest, setSuggest] = useState<Polish | null>(null);
  useEffect(() => { if (q.data) { setBody(q.data.body); setTitle(q.data.title); } }, [q.data]);

  const dirty = !!q.data && (body !== q.data.body || title !== q.data.title);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (extra?: { status?: string }) => api.put<Draft>(`/drafts/${id}`, { body, title, ...extra }),
    onSuccess: (r, extra) => {
      qc.setQueryData(["draft", id], (old: Draft | undefined) => ({ ...(old as Draft), ...r }));
      qc.invalidateQueries({ queryKey: ["drafts"] });
      toast.success(extra?.status === "final" ? "Marked final" : extra?.status === "draft" ? "Back to draft" : "Saved");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const polish = useMutation({
    mutationFn: async () => { if (dirty) await save.mutateAsync(undefined); return api.post<Polish>(`/drafts/${id}/polish`); },
    onSuccess: setSuggest,
  });
  const check = useMutation({
    mutationFn: () => api.post<{ id: number }>("/citations/check", { text: body, matter_id: q.data?.matter_id ?? null }),
    onSuccess: (r) => router.push(`/citations?id=${r.id}`),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/drafts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["drafts"] }); router.replace("/drafts"); },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (dirty) save.mutate(undefined); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, save]);

  if (q.isLoading) return <Spinner label="Opening draft" />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const blanks = [...new Set(body.match(PH) ?? [])];
  const isFinal = d.status === "final";

  return (
    <div className="space-y-5">
      <div>
        <Link href={d.matter_id ? `/matters/${d.matter_id}` : "/drafts"} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"><ArrowLeft className="h-3.5 w-3.5" /> {d.matter_id ? "Matter" : "Drafts"}</Link>
        <div className="flex flex-wrap items-center gap-3">
          <Input aria-label="Draft title" value={title} onChange={(e) => setTitle(e.target.value)} className="font-display h-11 min-w-[260px] flex-1 border-transparent bg-transparent px-0 text-xl font-semibold hover:border-rule focus:px-3" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => check.mutate()} loading={check.isPending}><ShieldCheck className="h-4 w-4" /> Check citations</Button>
            <Button onClick={() => polish.mutate()} loading={polish.isPending}><Sparkles className="h-4 w-4 text-cyan" /> AI polish</Button>
            <a href={`/api/drafts/${id}/export?format=docx`} onClick={(e) => { if (dirty) { e.preventDefault(); toast.info("Save your changes first, then export."); } }}>
              <Button type="button"><Download className="h-4 w-4" /> Word</Button>
            </a>
            <Button variant="primary" onClick={() => save.mutate(undefined)} disabled={!dirty} loading={save.isPending && !save.variables}><Save className="h-4 w-4" /> Save</Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-faint">
          <Badge tone={isFinal ? "leaf" : "neutral"}>{isFinal ? "Final" : "Draft"}</Badge>
          <Badge tone={d.template_review === "approved" ? "leaf" : "amber"}>{d.template_review === "approved" ? "Template reviewed by an advocate" : "Template not yet reviewed"}</Badge>
          <span>{dirty ? "Unsaved changes" : `Saved ${timeAgo(d.updated_at)}`}</span>
        </div>
      </div>

      <ErrorNote error={polish.error instanceof ApiError && polish.error.status === 409 ? new Error("AI is not available. Start Ollama, or ask an admin to switch AI on in Settings.") : polish.error} />
      <ErrorNote error={check.error} />

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <DraftEditor ref={editor} value={body} onChange={setBody} />
        <aside className="space-y-4">
          <Panel>
            <PanelHeader title="Blanks to fill" sub={blanks.length ? "Click one to jump to it" : undefined} />
            {blanks.length === 0 ? (
              <p className="px-4 py-4 text-sm text-leaf">Every fact is filled. Read the whole draft once against the documents.</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto scrollbar-thin p-2">
                {blanks.map((b) => (
                  <li key={b}><button onClick={() => editor.current?.selectBlank(b)} className="w-full rounded-md px-2 py-1.5 text-left text-sm text-amber hover:bg-amber-soft">{b.slice(2, -2)}</button></li>
                ))}
              </ul>
            )}
          </Panel>

          {suggest && (
            <Panel className="border-cyan/30">
              <PanelHeader title="AI suggestion" sub="Your draft is unchanged until you accept." />
              <div className="space-y-3 p-4">
                {suggest.problems.length > 0 && (
                  <div className="space-y-1 rounded-md border border-tape/30 bg-tape-soft px-3 py-2 text-sm text-tape">
                    <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" /> Blocked: the suggestion changed facts</p>
                    {suggest.problems.map((p) => <p key={p}>{p}</p>)}
                  </div>
                )}
                {suggest.changes.length > 0 && <ul className="space-y-1">{suggest.changes.map((c) => <li key={c} className="flex gap-2 text-sm text-muted"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-cyan" />{c}</li>)}</ul>}
                <details><summary className="cursor-pointer text-sm text-brass">Preview the suggested text</summary>
                  <pre className="prose-judgment mt-2 max-h-64 overflow-y-auto scrollbar-thin whitespace-pre-wrap rounded-md bg-vellum p-3 text-sm">{suggest.body}</pre>
                </details>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSuggest(null)}>Discard</Button>
                  <Button size="sm" variant="primary" disabled={!suggest.accepted} onClick={() => { setBody(suggest.body); setSuggest(null); toast.info("Suggestion applied. Review it, then save."); }}>Accept</Button>
                </div>
              </div>
            </Panel>
          )}

          <Panel className="p-4 space-y-2">
            {canApprove(me?.user.role) && (isFinal
              ? <Button className="w-full justify-center" onClick={() => save.mutate({ status: "draft" })}>Reopen as draft</Button>
              : <Button variant="brass" className="w-full justify-center" disabled={blanks.length > 0} title={blanks.length ? "Fill every blank first" : undefined} onClick={() => save.mutate({ status: "final" })}><Stamp className="h-4 w-4" /> Mark final</Button>)}
            <p className="text-xs text-faint">Before filing, run the citation check and confirm every authority.</p>
            <button onClick={() => confirm("Delete this draft? This cannot be undone.") && del.mutate()} className="flex items-center gap-1.5 pt-2 text-sm text-faint hover:text-tape"><Trash2 className="h-3.5 w-3.5" /> Delete draft</button>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
