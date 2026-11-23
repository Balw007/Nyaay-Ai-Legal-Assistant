"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ExternalLink, Search } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { ConvertResponse, ConvertResult } from "@/lib/types";
import { Badge, Empty, ErrorNote, PageHeader, Panel, Spinner } from "@/components/ui/misc";
import { Input } from "@/components/ui/field";

const EXAMPLES = ["302 IPC", "420 IPC", "438 CrPC", "482 CrPC", "65B Evidence Act", "103(1) BNS", "528 BNSS"];

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

function Ref({ r, strong }: { r: { code: string; name: string; section: string }; strong?: boolean }) {
  return (
    <div className={strong ? "" : "text-muted"}>
      <p className="text-xs text-faint">{r.name}</p>
      <p className="font-mono text-lg"><span className="text-faint">{r.code}</span> s.{r.section}</p>
    </div>
  );
}

function Row({ r }: { r: ConvertResult }) {
  const url = /^https?:\/\//.test(r.source) ? r.source : null;
  return (
    <Panel as="article" className="p-4">
      <div className="flex flex-wrap items-center gap-4">
        <Ref r={r.old} strong={r.matched === "old"} />
        <ArrowRight className="h-4 w-4 text-brass" aria-hidden />
        <Ref r={r.new} strong={r.matched === "new"} />
        <div className="ml-auto flex flex-wrap gap-1.5">{r.tags.map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}</div>
      </div>
      <p className="mt-2 font-medium">{r.title}</p>
      {r.note && <p className="mt-1 text-sm text-muted">{r.note}</p>}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-faint">
        <ExternalLink className="h-3 w-3" /> Source: {url ? <a href={url} target="_blank" rel="noreferrer" className="underline hover:text-brass">{url}</a> : r.source}
      </p>
    </Panel>
  );
}

export default function ConvertPage() {
  return <Suspense fallback={<Spinner />}><ConvertInner /></Suspense>;
}

function ConvertInner() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const dq = useDebounced(q.trim());
  const res = useQuery({ queryKey: ["convert", dq], enabled: dq.length > 0, queryFn: () => api.get<ConvertResponse>(`/tools/convert${qs({ q: dq })}`) });
  const data = res.data;

  return (
    <>
      <PageHeader title="Section converter" sub="IPC to BNS, CrPC to BNSS, Evidence Act to BSA, and back. Type a section with its Act." />
      <p className="mb-4 flex items-start gap-2 rounded-md border border-amber/30 bg-amber-soft px-3 py-2 text-sm text-amber">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {data?.notice ?? "Only mappings confirmed against official comparison tables are listed. Verify every section against the Gazette text before relying on it in a filing."}
      </p>
      <div className="relative mb-3 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 302 IPC, 438 CrPC, 103 BNS" className="pl-9" aria-label="Section and Act" />
      </div>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {EXAMPLES.map((e) => <button key={e} onClick={() => setQ(e)} className="rounded-full border border-rule px-2.5 py-0.5 text-sm text-muted hover:border-brass/50 hover:text-text">{e}</button>)}
      </div>
      {!dq ? (
        <Panel><Empty icon={ArrowRight} title="Type a section">Works in both directions. Sub-sections like 103(1) are matched to their parent section.</Empty></Panel>
      ) : res.isLoading ? <Spinner /> : res.isError ? <ErrorNote error={res.error} /> : data && (
        <div className="space-y-3">
          {data.results.map((r, i) => <Row key={i} r={r} />)}
          {data.omitted.map((o, i) => (
            <Panel key={`o${i}`} className="p-4">
              <p className="font-medium">{o.old.name} s.{o.old.section} — {o.title}</p>
              <p className="mt-1 text-sm text-muted">{o.note}</p>
              <p className="mt-2 text-xs text-faint">Source: {o.source}</p>
            </Panel>
          ))}
          {data.new_provisions.map((o, i) => (
            <Panel key={`n${i}`} className="p-4">
              <p className="font-medium">{o.new.code} s.{o.new.section} — {o.title} <Badge tone="cyan">New provision</Badge></p>
              <p className="mt-1 text-sm text-muted">{o.note}</p>
              <p className="mt-2 text-xs text-faint">Source: {o.source}</p>
            </Panel>
          ))}
          {data.unchanged.map((u, i) => <Panel key={`u${i}`} className="p-4"><p className="font-medium">{u.act}</p><p className="mt-1 text-sm text-muted">{u.note}</p></Panel>)}
          {!data.results.length && !data.omitted.length && !data.new_provisions.length && !data.unchanged.length && (
            <Panel><Empty icon={Search} title="No confirmed mapping">{data.message ?? "Nothing in the verified table matches. That does not mean there is no equivalent. Check the official comparison table."}</Empty></Panel>
          )}
        </div>
      )}
    </>
  );
}
