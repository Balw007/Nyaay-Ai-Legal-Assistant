"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, BadgeCheck, BookOpen, Sparkles } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { GoldEntry, SectionHit } from "@/lib/types";
import { isActive, useStartAgent, useTask, type ResearchResult } from "@/lib/agents";
import { Badge, Empty, Panel, Spinner, Tabs } from "@/components/ui/misc";
import { Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { AgentProgress } from "@/components/agents/agent-row";
import { Marked } from "./marked";
import { InfoTip } from "@/components/ui/info";

type ResultTab = "judgments" | "acts" | "headnotes";

const useActHits = (q: string) => useQuery({
  queryKey: ["acts-search", q], enabled: q.trim().length >= 2, retry: false,
  queryFn: () => api.get<{ query: string; results: SectionHit[] }>(`/acts/search${qs({ q, limit: 30 })}`),
});

const useHeadnotes = (q: string) => useQuery({
  queryKey: ["gold", "verified"], retry: false,
  queryFn: () => api.get<{ entries: GoldEntry[] }>("/gold?status=verified"),
  select: (d) => {
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    return d.entries.filter((e) => {
      const hay = [e.title, e.topic, e.headnote, e.held, e.citation].join(" ").toLowerCase();
      return words.length === 0 || words.some((w) => hay.includes(w));
    });
  },
});

export function ResultTabs({ q, tab, setTab, total }: { q: string; tab: ResultTab; setTab: (t: ResultTab) => void; total?: number }) {
  const acts = useActHits(q);
  const heads = useHeadnotes(q);
  const n = (v?: number) => (v === undefined ? "" : ` ${v.toLocaleString("en-IN")}`);
  return (
    <div className="flex items-end gap-2 border-b border-rule">
    <Tabs<ResultTab> className="flex-1 border-b-0" value={tab} onChange={setTab} items={[
      { value: "judgments", label: <>Judgments<span className="text-faint">{n(total)}</span></> },
      { value: "acts", label: <>Acts &amp; Rules<span className="text-faint">{n(acts.data?.results.length)}</span></> },
      { value: "headnotes", label: <>Verified headnotes<span className="text-faint">{n(heads.data?.length)}</span></> },
    ]} />
    <InfoTip k="Research" title="Research" className="mb-2.5 mr-1" />
    </div>
  );
}

export function ActsResults({ q }: { q: string }) {
  const r = useActHits(q);
  if (r.isLoading) return <Spinner label="Searching the Acts" />;
  if (r.isError || !r.data?.results.length) return (
    <Panel><Empty icon={BookOpen} title="No sections matched" action={<Link href="/acts"><Button size="sm">Open Acts &amp; Rules</Button></Link>}>
      Sections are searched in the Bare Acts loaded in your library. An admin can load the standard Acts from Acts &amp; Rules.
    </Empty></Panel>
  );
  return (
    <ol className="space-y-2">
      {r.data.results.map((h) => (
        <li key={`${h.act}-${h.no}`}>
          <Link href={`/acts?act=${h.act}&no=${encodeURIComponent(h.no)}`} data-specular="" className="glass-3 block rounded-xl p-4 hover:border-brass/40">
            <span className="relative z-[3] flex items-baseline gap-2"><Badge tone="brass">{h.short} s.{h.no}</Badge><span className="font-medium">{h.heading}</span></span>
            {h.snippet && <Marked html={h.snippet} className="prose-judgment relative z-[3] mt-1.5 line-clamp-3 block text-sm text-muted" />}
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function HeadnoteResults({ q }: { q: string }) {
  const r = useHeadnotes(q);
  if (r.isLoading) return <Spinner label="Searching verified headnotes" />;
  if (!r.data?.length) return (
    <Panel><Empty icon={BadgeCheck} title="No verified headnotes match" action={<Link href="/gold"><Button size="sm">Open the Gold set</Button></Link>}>
      Headnotes appear here once an advocate in your chambers writes and verifies them in the Gold set.
    </Empty></Panel>
  );
  return (
    <ol className="space-y-2">
      {r.data.map((e) => (
        <li key={e.id}>
          <Link href={`/judgments/${encodeURIComponent(e.jid)}`} className="glass-3 block rounded-xl border-leaf/30 p-4 hover:border-leaf/50">
            <span className="relative z-[3] flex flex-wrap items-center gap-2"><Badge tone="leaf"><BadgeCheck className="h-3 w-3" />Verified by {e.reviewer_name}</Badge><span className="font-medium">{e.title}</span></span>
            {e.topic && <span className="relative z-[3] mt-1 block text-sm">{e.topic}</span>}
            <span className="relative z-[3] mt-1 line-clamp-3 block text-sm text-muted">{e.headnote}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** The assistant beside the results. It runs the real Research Agent and shows its live steps and answer. */
export function ResearchAssistant({ q }: { q: string }) {
  const suggestion = q ? (/[?]$/.test(q.trim()) ? q.trim() : `What do the judgments in my library say about ${q.trim()}?`) : "";
  const [question, setQuestion] = useState(suggestion);
  const [taskId, setTaskId] = useState<number | null>(null);
  useEffect(() => setQuestion(suggestion), [suggestion]);
  const start = useStartAgent();
  const { data: t } = useTask(taskId);
  const r = t?.result as ResearchResult | undefined;
  const acts = useActHits(q);

  return (
    <div className="space-y-4">
      <Panel level={4} className="rounded-2xl p-4">
        <div className="relative z-[3]">
          <h2 className="flex items-center gap-2 text-md font-medium"><Sparkles className="h-4 w-4 text-cyan" />AI research assistant<InfoTip k="AI research assistant" /></h2>
          <form className="mt-3 space-y-2" onSubmit={(e) => {
            e.preventDefault();
            if (question.trim().length < 5) return;
            start.mutate({ agent: "research", input: { question: question.trim() } }, { onSuccess: (x) => setTaskId(x.id), onError: (e) => toast.error((e as Error).message) });
          }}>
            <Textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Question for the Research Agent" className="text-sm" placeholder="Ask about these judgments" />
            <Button type="submit" variant="ai" className="w-full justify-center" loading={start.isPending || (!!t && isActive(t))} disabled={question.trim().length < 5}>Ask the Research Agent</Button>
          </form>
          {t && (
            <div className="mt-4 space-y-2 border-t border-rule pt-3">
              <p className="text-xs text-faint">{t.step}</p>
              <AgentProgress t={t} />
              {t.status === "done" && r && (
                <>
                  {r.mode === "answer" && r.answer ? (
                    <><Badge tone="cyan" className="mt-2">AI answer, not verified</Badge>
                      <p className="line-clamp-[10] border-l-2 border-cyan/40 pl-3 text-sm leading-6">{r.answer.replace(/\[S(\d+)\]/g, "[$1]")}</p></>
                  ) : <p className="text-sm text-amber">{r.message}</p>}
                  <Link href={`/intelligence?task=${t.id}`} className="inline-flex items-center gap-1 text-sm text-brass hover:underline">
                    {r.sources?.length ? `See the ${r.sources.length} paragraphs it used` : "See the full analysis"}<ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </>
              )}
              {t.status === "failed" && <p className="text-sm text-tape">{t.error}</p>}
            </div>
          )}
        </div>
      </Panel>
      {!!acts.data?.results.length && (
        <Panel className="p-4">
          <h3 className="relative z-[3] text-sm font-medium">Related provisions</h3>
          <div className="relative z-[3] mt-2 flex flex-wrap gap-1.5">
            {acts.data.results.slice(0, 8).map((h) => (
              <Link key={`${h.act}-${h.no}`} href={`/acts?act=${h.act}&no=${encodeURIComponent(h.no)}`} title={h.heading}
                className="rounded-lg border border-brass/30 bg-brass-soft px-2 py-0.5 text-xs text-brass hover:border-brass/60">{h.short} s.{h.no}</Link>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
