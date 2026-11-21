"use client";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "brass" | "tape" | "leaf" | "amber" | "ink" | "cyan";
const tones: Record<Tone, string> = {
  neutral: "bg-vellum text-muted border-rule",
  brass: "bg-brass-soft text-brass border-brass/30",
  tape: "bg-tape-soft text-tape border-tape/30",
  leaf: "bg-leaf-soft text-leaf border-leaf/30",
  amber: "bg-amber-soft text-amber border-amber/30",
  ink: "bg-ink text-on-ink border-ink",
  cyan: "bg-cyan-soft text-cyan border-cyan/30",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: Tone; className?: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={cn("inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-xs font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Panel({ className, children, as: As = "section" }: { className?: string; children: React.ReactNode; as?: "section" | "div" | "article" | "aside" }) {
  return <As className={cn("glass rounded-lg", className)}>{children}</As>;
}

export function PanelHeader({ title, action, sub }: { title: React.ReactNode; action?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
      <div className="min-w-0"><h2 className="font-display text-md font-medium text-text">{title}</h2>{sub && <p className="text-sm text-faint mt-0.5">{sub}</p>}</div>
      {action}
    </header>
  );
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <span role="status" className={cn("inline-flex items-center gap-2 text-muted", className)}><Loader2 className="h-4 w-4 animate-spin" aria-hidden /><span className="text-sm">{label}…</span></span>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-rule-strong bg-vellum px-1.5 py-px font-sans text-xs text-muted">{children}</kbd>;
}

export function Empty({ icon: Icon, title, children, action, className }: { icon?: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center text-center px-6 py-12", className)}>
      {Icon && <Icon className="h-6 w-6 text-faint mb-3" />}
      <p className="text-md font-medium text-text">{title}</p>
      {children && <div className="mt-1 max-w-md text-base text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <p role="alert" className={cn("rounded-md border border-tape/30 bg-tape-soft px-3 py-2 text-sm text-tape", className)}>{msg}</p>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold text-text">{title}</h1>
        {sub && <p className="mt-1 text-base text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("flex gap-1 border-b border-rule", className)}>
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={cn("-mb-px border-b-2 px-3 py-2 text-base transition-colors",
            value === it.value ? "border-brass text-text font-medium" : "border-transparent text-muted hover:text-text")}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
