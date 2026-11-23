"use client";
import { Command } from "cmdk";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftRight, Clock, CornerDownLeft, FileSignature, FolderOpen, Gavel, Keyboard, Moon, Plus, Search, ShieldCheck, Sparkles, Sun } from "lucide-react";
import { api, qs } from "@/lib/api";
import type { GlobalSearch } from "@/lib/types";
import { readRecent, type Recent } from "@/lib/recent";
import { floatIn } from "@/lib/motion";
import { useTheme } from "@/components/providers";
import { Kbd } from "@/components/ui/misc";
import { ALL_NAV } from "./nav";

function useDebounced<T>(v: T, ms = 200) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

// "IPC 420", "s. 302 IPC", "CrPC 438" → offer the section converter.
const SECTION = /\b(ipc|crpc|cr\.?p\.?c|iea|evidence act|bns|bnss|bsa)\b[\s.,]*(?:s(?:ec(?:tion)?)?\.?\s*)?(\d+[a-z]?)|\b(?:s(?:ec(?:tion)?)?\.?\s*)(\d+[a-z]?)\s*(?:of\s+(?:the\s+)?)?(ipc|crpc|bns|bnss|bsa)\b/i;

const item = "group relative flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-base text-muted aria-selected:bg-brass-soft aria-selected:text-text";
const group = "px-1.5 pb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint";
const Enter = () => <CornerDownLeft className="ml-auto h-3.5 w-3.5 shrink-0 text-faint opacity-0 group-aria-selected:opacity-100" />;

export type PaletteMode = "search" | "ask";

export function CommandPalette({ open, setOpen, mode = "search", onShortcuts }: { open: boolean; setOpen: (v: boolean) => void; mode?: PaletteMode; onShortcuts: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const { theme, toggle } = useTheme();
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);
  const panel = useRef<HTMLDivElement>(null);
  const dq = useDebounced(q.trim());
  const asking = mode === "ask";
  const { data, isFetching } = useQuery({ queryKey: ["global-search", dq], enabled: open && !asking && dq.length >= 2, queryFn: () => api.get<GlobalSearch>(`/search${qs({ q: dq })}`) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(!open); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  useEffect(() => {
    if (!open) { setQ(""); return; }
    setRecent(readRecent().slice(0, 5));
    const opener = document.activeElement as HTMLElement | null;
    return () => opener?.focus?.();
  }, [open]);

  const go = (href: string) => { setOpen(false); router.push(href); };
  const section = dq.match(SECTION);
  const sectionQuery = section ? `${section[1] ?? section[5]} ${section[2] ?? section[4]}` : null;
  const onJudgment = path.startsWith("/judgments/");

  function trap(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    if (e.key === "Tab" && panel.current) {
      const f = Array.from(panel.current.querySelectorAll<HTMLElement>("input,button"));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" onKeyDown={trap}>
          <motion.div className="absolute inset-0 bg-[#02040a]/50 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
          <motion.div ref={panel} role="dialog" aria-modal="true" aria-label={asking ? "Ask your library" : "Search Nyaay"} {...floatIn}
            className="glass-4 absolute left-1/2 top-[11vh] w-[min(680px,94vw)] overflow-hidden rounded-2xl" style={{ x: "-50%" }}>
            <Command label={asking ? "Ask" : "Search Nyaay"} shouldFilter={!asking && dq.length < 2} loop className="relative z-[3]">
              <div className="flex items-center gap-3 border-b border-rule px-4">
                {asking ? <Sparkles className="h-5 w-5 text-cyan" /> : <Search className="h-5 w-5 text-faint" />}
                <Command.Input value={q} onValueChange={setQ} autoFocus
                  placeholder={asking ? "Ask a legal question. The answer cites paragraphs from your library." : "Search matters, drafts, judgments, or type a command"}
                  className="h-14 w-full bg-transparent text-md text-text placeholder:text-faint outline-none" />
                {isFetching && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan animate-[breathe_1s_ease-in-out_infinite]" aria-label="Searching" />}
              </div>
              <Command.List className="max-h-[58vh] overflow-y-auto scrollbar-thin py-1.5">
                {asking ? (
                  <Command.Group heading="Ask" className={group}>
                    <Command.Item value="ask-now" disabled={dq.length < 5} onSelect={() => go(`/research?ask=${encodeURIComponent(dq)}`)} className={item}>
                      <Sparkles className="h-4 w-4 text-cyan" />
                      <span className="min-w-0 flex-1 truncate">{dq.length >= 5 ? <>Ask: <span className="text-text">{dq}</span></> : "Type at least a few words"}</span><Enter />
                    </Command.Item>
                    <p className="px-3 pb-2 pt-1 text-sm text-faint">Your local AI answers only from judgments in your library, and every reference is checked against the paragraph it cites.</p>
                  </Command.Group>
                ) : (
                  <>
                    <Command.Empty className="px-4 py-10 text-center text-base text-muted">
                      {dq.length >= 2 ? <>Nothing in your matters or drafts matched. <button className="text-brass underline" onClick={() => go(`/research?q=${encodeURIComponent(dq)}`)}>Search judgments for “{dq}”</button></> : "Type to search."}
                    </Command.Empty>
                    {dq.length >= 2 && (
                      <Command.Group heading="Research" className={group}>
                        <Command.Item value={`research ${dq}`} onSelect={() => go(`/research?q=${encodeURIComponent(dq)}`)} className={item}>
                          <Search className="h-4 w-4 text-brass" /><span className="truncate">Search judgments for “{dq}”</span><Enter />
                        </Command.Item>
                        <Command.Item value={`ask ${dq}`} onSelect={() => go(`/research?ask=${encodeURIComponent(dq)}`)} className={item}>
                          <Sparkles className="h-4 w-4 text-cyan" /><span className="truncate">Ask AI: “{dq}”</span><Enter />
                        </Command.Item>
                        {sectionQuery && (
                          <Command.Item value={`convert ${dq}`} onSelect={() => go(`/tools/convert?q=${encodeURIComponent(sectionQuery)}`)} className={item}>
                            <ArrowLeftRight className="h-4 w-4 text-brass" /><span className="truncate">Convert {sectionQuery.toUpperCase()} to the new criminal laws</span><Enter />
                          </Command.Item>
                        )}
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
                        {onJudgment && (
                          <Command.Group heading="This judgment" className={group}>
                            <Command.Item onSelect={() => { setOpen(false); window.dispatchEvent(new CustomEvent("nyaay:reader", { detail: "find" })); }} className={item}><Search className="h-4 w-4 text-brass" />Find in this judgment<Kbd className="ml-auto">Ctrl F</Kbd></Command.Item>
                            <Command.Item onSelect={() => { setOpen(false); window.dispatchEvent(new CustomEvent("nyaay:reader", { detail: "ask" })); }} className={item}><Sparkles className="h-4 w-4 text-cyan" />Ask about this judgment<Enter /></Command.Item>
                            <Command.Item onSelect={() => { setOpen(false); window.dispatchEvent(new CustomEvent("nyaay:reader", { detail: "headnote" })); }} className={item}><Sparkles className="h-4 w-4 text-cyan" />Write an AI headnote<Enter /></Command.Item>
                          </Command.Group>
                        )}
                        {recent.length > 0 && (
                          <Command.Group heading="Recently opened" className={group}>
                            {recent.map((r) => (
                              <Command.Item key={`${r.kind}${r.id}`} value={`recent ${r.kind} ${r.id} ${r.title}`} onSelect={() => go(r.kind === "matter" ? `/matters/${r.id}` : `/judgments/${encodeURIComponent(r.id)}`)} className={item}>
                                <Clock className="h-4 w-4" /><span className="truncate">{r.title}</span><span className="ml-auto shrink-0 text-sm text-faint">{r.kind === "matter" ? "Matter" : "Judgment"}</span>
                              </Command.Item>
                            ))}
                          </Command.Group>
                        )}
                        <Command.Group heading="Create" className={group}>
                          <Command.Item onSelect={() => go("/matters?new=1")} className={item}><Plus className="h-4 w-4 text-brass" />New matter<Enter /></Command.Item>
                          <Command.Item onSelect={() => go("/drafts")} className={item}><FileSignature className="h-4 w-4 text-brass" />New draft from a template<Enter /></Command.Item>
                          <Command.Item onSelect={() => go("/citations")} className={item}><ShieldCheck className="h-4 w-4 text-brass" />Check citations in a draft<Enter /></Command.Item>
                        </Command.Group>
                        <Command.Group heading="Go to" className={group}>
                          {ALL_NAV.map((p) => (
                            <Command.Item key={p.href} value={`go ${p.label}`} onSelect={() => go(p.href)} className={item}>
                              <p.icon className="h-4 w-4" />{p.label}
                              {p.key && <span className="ml-auto flex gap-1"><Kbd>G</Kbd><Kbd>{p.key.toUpperCase()}</Kbd></span>}
                            </Command.Item>
                          ))}
                        </Command.Group>
                        <Command.Group heading="Preferences" className={group}>
                          <Command.Item onSelect={() => { toggle(); setOpen(false); }} className={item}>{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}Switch to {theme === "dark" ? "light" : "dark"} mode</Command.Item>
                          <Command.Item onSelect={() => { setOpen(false); onShortcuts(); }} className={item}><Keyboard className="h-4 w-4" />Keyboard shortcuts<Kbd className="ml-auto">?</Kbd></Command.Item>
                        </Command.Group>
                      </>
                    )}
                  </>
                )}
              </Command.List>
              <footer className="flex items-center gap-4 border-t border-rule px-4 py-2.5 text-xs text-faint">
                <span className="inline-flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
                <span className="inline-flex items-center gap-1.5"><Kbd>Enter</Kbd> open</span>
                <span className="inline-flex items-center gap-1.5"><Kbd>Esc</Kbd> close</span>
                <span className="ml-auto hidden sm:inline">{asking ? "Answers come from your library only" : "Matters, drafts and judgments in your chambers"}</span>
              </footer>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
