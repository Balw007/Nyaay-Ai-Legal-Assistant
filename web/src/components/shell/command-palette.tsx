"use client";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, CalendarDays, CheckCheck, FileSignature, FolderOpen, Gavel, LayoutDashboard, Library, Plus, Search, Settings, ShieldCheck, Users } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { GlobalSearch } from "@/lib/types";

function useDebounced<T>(v: T, ms = 200) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

const PAGES = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Approvals", href: "/approvals", icon: CheckCheck },
  { label: "Calendar", href: "/calendar", icon: CalendarDays },
  { label: "Matters", href: "/matters", icon: FolderOpen },
  { label: "Drafts", href: "/drafts", icon: FileSignature },
  { label: "Clients", href: "/clients", icon: Users },
  { label: "Research", href: "/research", icon: Search },
  { label: "Citation check", href: "/citations", icon: ShieldCheck },
  { label: "Library", href: "/library", icon: Library },
  { label: "Section converter (IPC to BNS)", href: "/tools/convert", icon: ArrowLeftRight },
  { label: "Settings", href: "/settings", icon: Settings },
];

const item = "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-base text-muted aria-selected:bg-brass-soft aria-selected:text-text";
const group = "px-1 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint";

export function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const { data } = useQuery({ queryKey: ["global-search", dq], enabled: open && dq.length >= 2, queryFn: () => api.get<GlobalSearch>(`/search${qs({ q: dq })}`) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(!open); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  useEffect(() => { if (!open) setQ(""); }, [open]);

  const go = (href: string) => { setOpen(false); router.push(href); };

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Search Nyaay" shouldFilter={dq.length < 2}
      overlayClassName="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[14vh] z-50 w-[min(640px,92vw)] -translate-x-1/2 glass rounded-xl overflow-hidden !bg-surface-solid/95">
      <div className="flex items-center gap-2 border-b border-rule px-4">
        <Search className="h-4 w-4 text-faint" />
        <Command.Input value={q} onValueChange={setQ} autoFocus placeholder="Search matters, drafts, judgments, or jump to a page"
          className="h-12 w-full bg-transparent text-md text-text placeholder:text-faint outline-none" />
      </div>
      <Command.List className="max-h-[60vh] overflow-y-auto scrollbar-thin p-2">
        <Command.Empty className="px-3 py-8 text-center text-base text-muted">
          {dq.length >= 2 ? <>Nothing matched. <button className="text-brass underline" onClick={() => go(`/research?q=${encodeURIComponent(dq)}`)}>Search judgments for “{dq}”</button></> : "Type to search."}
        </Command.Empty>
        {dq.length >= 2 && (
          <Command.Group heading="Research" className={group}>
            <Command.Item value={`research ${dq}`} onSelect={() => go(`/research?q=${encodeURIComponent(dq)}`)} className={item}>
              <Search className="h-4 w-4 text-cyan" /> Search judgments for “{dq}”
            </Command.Item>
            <Command.Item value={`ask ${dq}`} onSelect={() => go(`/research?ask=${encodeURIComponent(dq)}`)} className={item}>
              <Gavel className="h-4 w-4 text-cyan" /> Ask AI: “{dq}”
            </Command.Item>
          </Command.Group>
        )}
        {!!data?.matters.length && (
          <Command.Group heading="Matters" className={group}>
            {data.matters.map((m) => (
              <Command.Item key={`m${m.id}`} value={`matter ${m.id} ${m.title}`} onSelect={() => go(`/matters/${m.id}`)} className={item}>
                <FolderOpen className="h-4 w-4" /><span className="truncate">{m.title}</span>{m.sub && <span className="ml-auto truncate text-sm text-faint">{m.sub}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {!!data?.drafts.length && (
          <Command.Group heading="Drafts" className={group}>
            {data.drafts.map((d) => (
              <Command.Item key={`d${d.id}`} value={`draft ${d.id} ${d.title}`} onSelect={() => go(`/drafts/${d.id}`)} className={item}>
                <FileSignature className="h-4 w-4" /><span className="truncate">{d.title}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {!!data?.judgments.length && (
          <Command.Group heading="Judgments" className={group}>
            {data.judgments.map((j) => (
              <Command.Item key={`j${j.id}`} value={`judgment ${j.id} ${j.title}`} onSelect={() => go(`/judgments/${encodeURIComponent(j.id)}`)} className={item}>
                <Gavel className="h-4 w-4" /><span className="truncate">{j.title}</span><span className="ml-auto truncate text-sm text-faint">{j.sub}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {dq.length < 2 && (
          <>
            <Command.Group heading="Create" className={group}>
              <Command.Item onSelect={() => go("/matters?new=1")} className={item}><Plus className="h-4 w-4 text-brass" /> New matter</Command.Item>
              <Command.Item onSelect={() => go("/citations")} className={item}><ShieldCheck className="h-4 w-4 text-brass" /> Check citations in a draft</Command.Item>
            </Command.Group>
            <Command.Group heading="Go to" className={group}>
              {PAGES.map((p) => (
                <Command.Item key={p.href} onSelect={() => go(p.href)} className={item}><p.icon className="h-4 w-4" /> {p.label}</Command.Item>
              ))}
            </Command.Group>
          </>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
