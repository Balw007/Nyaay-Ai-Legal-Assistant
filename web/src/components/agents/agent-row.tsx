"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { boing } from "@/components/shell/specular";
import { FileSignature, Gavel, Search, ShieldCheck } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { isActive, utc, type AgentId, type AgentTask } from "@/lib/agents";
import { cn } from "@/lib/utils";

export const AGENT_ICON: Record<AgentId, React.ComponentType<{ className?: string }>> = {
  research: Search, judgment: Gavel, citation: ShieldCheck, drafting: FileSignature,
};
const RING: Record<AgentId, string> = {
  research: "border-cyan/40 bg-cyan-soft text-cyan",
  judgment: "border-electric/40 bg-[color-mix(in_srgb,var(--electric)_14%,transparent)] text-electric",
  citation: "border-leaf/40 bg-leaf-soft text-leaf",
  drafting: "border-brass/40 bg-brass-soft text-brass",
};

export function AgentIcon({ agent, className }: { agent: AgentId; className?: string }) {
  const Icon = AGENT_ICON[agent] ?? Search;
  return <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl border", RING[agent], className)}><Icon className="h-4 w-4" /></span>;
}

/** Progress exactly as the agent reported it. While the model is writing there is no honest percentage, so the bar sweeps. */
export function AgentProgress({ t, className }: { t: AgentTask; className?: string }) {
  const active = isActive(t);
  const tone = t.status === "failed" ? "bg-tape" : t.status === "cancelled" ? "bg-faint" : t.status === "done" ? "bg-leaf" : "bg-gradient-to-r from-electric to-cyan";
  return (
    <div className={cn("relative h-1.5 overflow-hidden rounded-full bg-vellum", className)} role="progressbar"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={t.indeterminate || t.status === "queued" ? undefined : t.progress} aria-label={`${t.agent_name}: ${t.step}`}>
      {active && (t.indeterminate || t.status === "queued")
        ? <div className={cn("absolute inset-y-0 w-1/3 animate-[scan_1.6s_linear_infinite]", t.status === "queued" ? "bg-gradient-to-r from-transparent via-faint to-transparent" : "bg-gradient-to-r from-transparent via-cyan to-transparent")} />
        : <div className={cn("relative h-full overflow-hidden rounded-full transition-[width] duration-700", tone, t.status === "running" && "progress-live")} style={{ width: `${t.status === "done" ? 100 : t.progress}%` }} />}
    </div>
  );
}

export function statusLabel(t: AgentTask) {
  return t.status === "queued" ? "Waiting" : t.status === "running" ? "Working" : t.status === "done" ? "Ready to review" : t.status === "failed" ? "Could not finish" : "Stopped";
}

export function AgentRow({ t, compact }: { t: AgentTask; compact?: boolean }) {
  const when = t.finished_at ?? t.started_at ?? t.created_at;
  // A task that finishes while you watch gives one boing, so the change is noticed without a flashing badge.
  const row = useRef<HTMLAnchorElement>(null);
  const was = useRef(isActive(t));
  useEffect(() => {
    const now = isActive(t);
    if (was.current && !now) boing(row.current, t.status === "failed" ? 0.6 : 1);
    was.current = now;
  }, [t]);
  return (
    <Link ref={row} href={`/intelligence?task=${t.id}`} data-specular=""
      className="glass-3 group relative block rounded-xl px-3 py-2.5 transition-colors hover:border-cyan/30">
      <div className="relative z-[3] flex items-start gap-3">
        <AgentIcon agent={t.agent} className={cn(compact && "h-8 w-8", t.status === "running" && "agent-working")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium">{t.agent_name}</p>
            <span className={cn("shrink-0 text-[11px]", t.status === "failed" ? "text-tape" : t.status === "done" ? "text-leaf" : isActive(t) ? "text-cyan" : "text-faint")}>
              {isActive(t) || t.status === "failed" || t.status === "cancelled" ? statusLabel(t) : timeAgo(utc(when))}
            </span>
          </div>
          <p className="truncate text-xs text-muted">{isActive(t) ? t.step : t.status === "failed" ? t.error || t.title : t.title}</p>
          <AgentProgress t={t} className="mt-2" />
        </div>
      </div>
    </Link>
  );
}
