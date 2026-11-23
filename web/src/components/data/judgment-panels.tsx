"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { GoldEntry, JudgmentSection } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Badge, Panel } from "@/components/ui/misc";
import { ActChip } from "./act-chip";
import { InfoTip } from "@/components/ui/info";

/** Acts and sections this judgment discusses, as links into Bare Acts. */
export function SectionsPanel({ jid }: { jid: string }) {
  const q = useQuery({ queryKey: ["jsections", jid], queryFn: () => api.get<JudgmentSection[]>(`/judgments/${encodeURIComponent(jid)}/sections`) });
  const rows = q.data ?? [];
  if (!rows.length) return null;
  const hasInferred = rows.some((r) => r.inferred);
  return (
    <Panel className="p-4">
      <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-medium">Provisions discussed<InfoTip k="Provisions discussed" /></h2>
      <div className="flex flex-wrap gap-1.5">
        {rows.slice(0, 30).map((r) => <ActChip key={`${r.act}-${r.section}`} act={r.act} name={r.act_name} section={r.section} inferred={r.inferred} />)}
      </div>
      {hasInferred && <p className="mt-2 text-xs text-faint">* The judgment says “of the Act” and names no other Act, so Nyaay read it as the Act named elsewhere in the judgment.</p>}
    </Panel>
  );
}

export function useGold(jid: string) {
  return useQuery({ queryKey: ["gold-for", jid], queryFn: () => api.get<GoldEntry | null>(`/gold/for/${encodeURIComponent(jid)}`) });
}

/** The advocate's own headnote, shown only when verified. */
export function GoldBadge({ jid }: { jid: string }) {
  const g = useGold(jid);
  if (g.data?.status !== "verified") return null;
  return <Badge tone="leaf" title={`Verified by ${g.data.reviewer_name}`}><BadgeCheck className="h-3 w-3" />Verified by advocate</Badge>;
}

export function GoldPanel({ jid, onJump }: { jid: string; onJump: (n: number) => void }) {
  const g = useGold(jid);
  const e = g.data;
  if (!e || e.status !== "verified") return null;
  return (
    <Panel className="border-leaf/30 p-4">
      <h2 className="mb-1 flex items-center gap-1.5 font-display text-sm font-medium text-leaf"><BadgeCheck className="h-4 w-4" />Verified headnote<InfoTip k="Verified headnote" /></h2>
      {e.topic && <p className="text-sm font-medium">{e.topic}</p>}
      <p className="mt-1.5 text-sm leading-relaxed">{e.headnote}</p>
      <p className="mt-2 text-sm"><span className="text-muted">Held: </span>{e.held}</p>
      {e.key_paras.length > 0 && (
        <p className="mt-2 text-sm text-muted">Key paragraphs: {e.key_paras.map((n, i) => (
          <span key={n}>{i > 0 && ", "}<button onClick={() => onJump(n)} className="text-brass hover:underline">{n}</button></span>))}</p>
      )}
      <p className="mt-3 border-t border-rule pt-2 text-xs text-faint">Written and verified by {e.reviewer_name} ({e.reviewer_enrolment}) on {fmtDate(e.verified_at)}. <Link href="/gold" className="text-brass hover:underline">Gold set</Link></p>
    </Panel>
  );
}
