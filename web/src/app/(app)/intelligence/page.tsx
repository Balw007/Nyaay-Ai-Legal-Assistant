"use client";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Bot } from "lucide-react";
import { useHealth } from "@/lib/hooks";
import { isActive, useTasks } from "@/lib/agents";
import { sheetIn } from "@/lib/motion";
import { Panel, Segmented, Skeleton, Spinner } from "@/components/ui/misc";
import { AgentRow } from "@/components/agents/agent-row";
import { AgentLauncher } from "@/components/agents/launcher";
import { TaskDetail } from "@/components/agents/task-detail";
import { CapabilitiesPanel, DoneByNyaay, RunningNow, SystemHealth, WaitingPanel } from "@/components/agents/system";
import { InfoTip, Titled } from "@/components/ui/info";
import { cn } from "@/lib/utils";

type Filter = "all" | "active" | "done" | "failed";

function Centre() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("task") ? Number(params.get("task")) : null;
  const select = (id: number | null) => router.replace(id ? `/intelligence?task=${id}` : "/intelligence", { scroll: false });
  const { data: tasks, isLoading } = useTasks(50);
  const [filter, setFilter] = useState<Filter>("all");
  const list = useMemo(() => (tasks ?? []).filter((t) => filter === "all" || (filter === "active" ? isActive(t) : t.status === filter)), [tasks, filter]);
  const { data: h } = useHealth();
  const running = (tasks ?? []).filter(isActive).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-cyan/30 bg-cyan-soft text-cyan shadow-[0_0_30px_-10px_var(--cyan)]"><Bot className="h-7 w-7" /></span>
          <div>
            <h1 className="flex items-center gap-2.5 font-editorial text-[2.15rem] leading-tight md:text-3xl">AI Intelligence Centre<InfoTip k="AI Intelligence Centre" className="h-6 w-6" /></h1>
            <p className="text-base text-muted">Your agents, what they are doing step by step, and the health of everything they run on.</p>
          </div>
        </div>
        <span className={cn("inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm", h?.ai.ready ? "border-leaf/30 bg-leaf-soft text-leaf" : "border-amber/30 bg-amber-soft text-amber")}>
          <span className={cn("h-2 w-2 rounded-full", h?.ai.ready ? "bg-leaf" : "bg-amber")} />Local AI ({h?.ai.provider ?? "…"}): {h?.ai.ready ? `running ${h.ai.model}` : "not running"}
        </span>
      </header>

      <SystemHealth />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <AgentLauncher onStarted={(id) => select(id)} />
          <Panel>
            <div className="relative z-[3] flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3">
              <div>
                <h2 className="flex items-center gap-1.5 text-md font-medium">Agents at work<InfoTip k="Agents at work" /></h2>
                <p className="mt-0.5 text-sm text-faint">{running ? <span className="text-cyan">{running} working now</span> : "None working now"}</p>
              </div>
              <Segmented label="Show" value={filter} onChange={setFilter} items={[{ value: "all", label: "All" }, { value: "active", label: "Working", tone: "cyan" }, { value: "done", label: "Ready" }, { value: "failed", label: "Failed" }]} />
            </div>
            <div className="relative z-[3] space-y-1.5 p-1.5">
              {isLoading ? <div className="space-y-1.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[60px] rounded-xl" />)}</div> : list.length === 0 ? <p className="px-2 py-6 text-center text-sm text-muted">No tasks here yet. Start an agent above.</p> :
                list.map((t) => (
                  <div key={t.id} className={cn("rounded-xl", selected === t.id && "ring-1 ring-cyan/50")}>
                    <AgentRow t={t} />
                  </div>
                ))}
            </div>
          </Panel>
        </div>
        <div className="min-w-0 space-y-6">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div key={selected} {...sheetIn}><TaskDetail id={selected} onClose={() => select(null)} /></motion.div>
            ) : (
              <motion.div key="side" className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <WaitingPanel />
                <RunningNow />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <section aria-labelledby="what-h" className="space-y-4 pt-2">
        <h2 id="what-h" className="font-editorial text-xl"><Titled k="Capabilities">What Nyaay can do</Titled></h2>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <CapabilitiesPanel />
          <div className="min-w-0 space-y-6">
            {selected && <WaitingPanel />}
            {selected && <RunningNow />}
            <DoneByNyaay />
          </div>
        </div>
      </section>
    </div>
  );
}

export default function IntelligencePage() {
  return <Suspense fallback={<Spinner />}><Centre /></Suspense>;
}
