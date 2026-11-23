"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, qs } from "@/lib/api";
import type { DraftListItem, GlobalSearch, Matter } from "@/lib/types";
import { useAgents, useStartAgent, type AgentId, type AgentInfo } from "@/lib/agents";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Panel, Skeleton } from "@/components/ui/misc";
import { AgentIcon } from "./agent-row";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/info";

/** Pick an agent, give it its input, and it starts in the background. Availability comes from the backend. */
export function AgentLauncher({ onStarted }: { onStarted: (id: number) => void }) {
  const { data: agents, isLoading } = useAgents();
  const [pick, setPick] = useState<AgentId | null>(null);
  if (isLoading) return <Panel className="p-5"><Skeleton className="h-28" /></Panel>;
  return (
    <Panel className="p-1.5">
      <h2 className="relative z-[3] flex items-center gap-1.5 border-b border-rule px-3 pb-3 pt-2.5 text-md font-medium">Start an agent<InfoTip k="Start an agent" /></h2>
      <div className="relative z-[3] grid gap-2 p-1.5 sm:grid-cols-2">
        {agents?.map((a) => (
          <button key={a.id} onClick={() => setPick(pick === a.id ? null : a.id)} aria-pressed={pick === a.id} data-tilt="4" data-press="" data-specular=""
            className={cn("glass-2 rounded-xl p-3 text-left transition-colors", pick === a.id ? "border-cyan/50" : "hover:border-cyan/30", !a.available && "opacity-70")}>
            <span className="relative z-[3] flex items-start gap-3">
              <AgentIcon agent={a.id} />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5"><span className="text-sm font-medium">{a.name}</span>
                  <Badge tone={a.mode === "full" ? "leaf" : a.mode === "reduced" ? "amber" : "neutral"}>{a.mode === "full" ? "Ready" : a.mode === "reduced" ? "Without AI" : "Needs AI"}</Badge></span>
                <span className="mt-1 line-clamp-2 block text-xs text-muted">{a.mode === "full" ? a.does : a.without_ai}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {pick && agents && (
          <motion.div key={pick} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="relative z-[3] overflow-hidden">
            <AgentForm a={agents.find((x) => x.id === pick)!} onStarted={(id) => { setPick(null); onStarted(id); }} />
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}

function AgentForm({ a, onStarted }: { a: AgentInfo; onStarted: (id: number) => void }) {
  const start = useStartAgent();
  const [question, setQuestion] = useState("");
  const [jq, setJq] = useState("");
  const [jid, setJid] = useState<{ id: string; title: string } | null>(null);
  const [text, setText] = useState("");
  const [matter, setMatter] = useState("");
  const [draft, setDraft] = useState("");
  const judgments = useQuery({ queryKey: ["global-search", jq.trim()], enabled: a.id === "judgment" && jq.trim().length >= 2, queryFn: () => api.get<GlobalSearch>(`/search${qs({ q: jq.trim() })}`) });
  const matters = useQuery({ queryKey: ["matters"], enabled: a.id === "citation", queryFn: () => api.get<Matter[]>("/matters") });
  const drafts = useQuery({ queryKey: ["drafts"], enabled: a.id === "drafting", queryFn: () => api.get<DraftListItem[]>("/drafts") });

  const go = () => {
    const input: Record<string, unknown> =
      a.id === "research" ? { question } : a.id === "judgment" ? { jid: jid?.id } :
      a.id === "citation" ? { text, matter_id: matter ? Number(matter) : null } : { draft_id: Number(draft) };
    start.mutate({ agent: a.id, input }, {
      onSuccess: (t) => { toast.success(`${a.name} started`); onStarted(t.id); },
      onError: (e) => toast.error((e as Error).message),
    });
  };
  const ready = a.id === "research" ? question.trim().length >= 5 : a.id === "judgment" ? !!jid : a.id === "citation" ? !!text.trim() : !!draft;

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) go(); }} className="space-y-3 border-t border-rule p-4">
      {a.id === "research" && <Textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} autoFocus placeholder="What are the essentials of a valid demand notice under section 138?" aria-label="Question" />}
      {a.id === "judgment" && (
        <div className="space-y-2">
          <Input value={jid ? jid.title : jq} onChange={(e) => { setJid(null); setJq(e.target.value); }} autoFocus placeholder="Find a judgment by name or citation" aria-label="Judgment" />
          {!jid && !!judgments.data?.judgments.length && (
            <ul className="max-h-48 overflow-y-auto rounded-lg border border-rule">
              {judgments.data.judgments.map((j) => <li key={j.id}><button type="button" onClick={() => setJid({ id: j.id, title: j.title })} className="w-full px-3 py-2 text-left text-sm hover:bg-vellum">{j.title}<span className="block text-xs text-faint">{j.sub}</span></button></li>)}
            </ul>
          )}
        </div>
      )}
      {a.id === "citation" && (
        <>
          <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="Paste the draft, or the paragraphs with citations" aria-label="Draft text" />
          <Select value={matter} onChange={(e) => setMatter(e.target.value)} aria-label="Matter"><option value="">Not linked to a matter</option>{matters.data?.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</Select>
        </>
      )}
      {a.id === "drafting" && (
        <Select value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Draft" autoFocus>
          <option value="">Choose a draft</option>{drafts.data?.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </Select>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-faint">{a.engine.join(" + ")}. Runs in the background; you can leave this page.</p>
        <Button type="submit" variant="ai" loading={start.isPending} disabled={!ready || !a.available}>Start {a.name.replace(" Agent", "").toLowerCase()} agent</Button>
      </div>
    </form>
  );
}
