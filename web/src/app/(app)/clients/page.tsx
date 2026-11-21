"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { api } from "@/lib/api";
import type { Client } from "@/lib/types";
import { daysUntil, fmtDay, relDays } from "@/lib/format";
import { Input } from "@/components/ui/field";
import { Badge, Empty, ErrorNote, PageHeader, Panel, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";

export default function ClientsPage() {
  const q = useQuery({ queryKey: ["clients"], queryFn: () => api.get<Client[]>("/clients") });
  const [f, setF] = useState("");
  const list = useMemo(() => (q.data ?? []).filter((c) => c.name.toLowerCase().includes(f.toLowerCase())), [q.data, f]);

  return (
    <div className="space-y-6">
      <PageHeader title="Clients" sub="Everyone you act for, with their matters and next dates"
        actions={<Input placeholder="Filter clients" value={f} onChange={(e) => setF(e.target.value)} className="w-56" />} />
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorNote error={q.error} /> : list.length === 0 ? (
        <Panel><Empty icon={Users} title={f ? "No client matches" : "No clients yet"} action={!f && <Link href="/matters?new=1"><Button variant="primary">Add a matter</Button></Link>}>
          {!f && "Clients appear here when you add a matter with a client name."}
        </Empty></Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => {
            const n = daysUntil(c.next_date);
            return (
              <Panel key={c.name} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-brass/40 bg-brass-soft font-display font-semibold text-brass">
                    {c.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{c.name}</p>
                    <p className="text-sm text-muted">{c.active} active {c.active === 1 ? "matter" : "matters"}</p>
                  </div>
                  {c.next_date && <Badge tone={n !== null && n <= 2 ? "cyan" : "neutral"}>Next {relDays(n)}</Badge>}
                </div>
                <ul className="mt-3 space-y-1.5 border-t border-rule pt-3">
                  {c.matters.map((m) => (
                    <li key={m.id} className="flex items-baseline justify-between gap-2 text-sm">
                      <Link href={`/matters/${m.id}`} className="truncate hover:text-brass">{m.title}</Link>
                      <span className="shrink-0 text-faint">{m.next_date ? fmtDay(m.next_date) : m.status}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
