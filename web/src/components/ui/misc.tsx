"use client";
import { useId } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";
import { helpFor, type Help } from "@/lib/help";
import { InfoTip } from "@/components/ui/info";

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
  return <span title={title} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-xs font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

/** L3 surface. `level={4}` raises it to a floating surface; `lit` lets the pointer light it. */
export function Panel({ className, children, as: As = "section", level = 3, lit, tilt, ripple, ...rest }:
  { className?: string; children: React.ReactNode; as?: "section" | "div" | "article" | "aside"; level?: 2 | 3 | 4 | 5; lit?: boolean; tilt?: boolean | number; ripple?: boolean | string } & React.HTMLAttributes<HTMLElement>) {
  // Motion is opt-in and used sparingly (see components/shell/specular.tsx): `ripple` gives a glanceable panel the
  // drum skin, `tilt` makes a small choice card lean towards the cursor. Panels people read or work in get neither.
  return (
    <As className={cn(level === 2 ? "glass-2" : level === 4 ? "glass-4" : level === 5 ? "glass-5" : "glass-3", "rounded-xl", className)}
      data-specular={lit || tilt ? "" : undefined} data-tilt={tilt ? (typeof tilt === "number" ? tilt : 3) : undefined}
      data-ripple={ripple ? (typeof ripple === "string" ? ripple : "panel") : undefined} {...rest}>
      {children}
    </As>
  );
}

/** A panel's title row. Titles listed in lib/help.ts get an (i) automatically; pass `info` to override, `false` for none. */
export function PanelHeader({ title, action, sub, info }: { title: React.ReactNode; action?: React.ReactNode; sub?: React.ReactNode; info?: Help | string | false }) {
  const h = info === false ? undefined : typeof info === "object" ? info : helpFor(typeof info === "string" ? info : title);
  const name = typeof info === "string" ? info : typeof title === "string" ? title : undefined;
  return (
    <header className="relative z-[3] flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-md font-medium text-text">{title}{h && <InfoTip help={h} title={name} />}</h2>
        {sub && <p className="text-sm text-faint mt-0.5">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

/** Loading: a small breathing light, the same mark the AI status uses, plus what is happening. */
export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2.5 text-muted", className)}>
      <span aria-hidden className="relative grid h-4 w-4 place-items-center">
        <span className="absolute inset-0 rounded-full bg-cyan/25 animate-[breathe_1.6s_ease-in-out_infinite]" />
        <span className="h-1.5 w-1.5 rounded-full bg-cyan" />
      </span>
      <span className="text-sm">{label}…</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton h-4", className)} />;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex min-w-[1.4rem] justify-center rounded-md border border-rule-strong bg-vellum px-1.5 py-px font-sans text-xs text-muted shadow-[inset_0_-1px_0_var(--rule-strong)]", className)}>{children}</kbd>;
}

export function Empty({ icon: Icon, title, children, action, className }: { icon?: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center text-center px-6 py-12", className)}>
      {Icon && (
        <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-rule bg-vellum shadow-[inset_0_1px_0_var(--rim-hi)]">
          <Icon className="h-5 w-5 text-muted" />
        </span>
      )}
      <p className="text-md font-medium text-text">{title}</p>
      {children && <div className="mt-1 max-w-md text-base text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <p role="alert" className={cn("rounded-lg border border-tape/30 bg-tape-soft px-3 py-2 text-sm text-tape", className)}>{msg}</p>;
}

/** Editorial page header. `hero` makes it the landing point of a shared-element morph. */
export function PageHeader({ title, sub, actions, hero, className, info }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; hero?: boolean; className?: string; info?: Help | string | false }) {
  const h = info === false ? undefined : typeof info === "object" ? info : helpFor(typeof info === "string" ? info : title);
  const name = typeof info === "string" ? info : typeof title === "string" ? title : undefined;
  return (
    <div className={cn("mb-7 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className={cn("min-w-0", hero && "vt-hero")}>
        <h1 className="title-in flex items-center gap-2.5 font-editorial text-[2.15rem] leading-[1.12] text-text md:text-3xl">{title}{h && <InfoTip help={h} title={name} className="h-6 w-6 [&>svg]:h-4.5 [&>svg]:w-4.5" />}</h1>
        {sub && <p className="mt-2 max-w-[70ch] text-base text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Tabs with a lit indicator that glides between tabs. Arrow keys move between tabs. */
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode }[]; className?: string }) {
  const id = useId();
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = items.findIndex((it) => it.value === value);
    const n = items[(i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length];
    onChange(n.value);
    requestAnimationFrame(() => (document.querySelector(`[data-tab="${id}-${n.value}"]`) as HTMLElement | null)?.focus());
  };
  return (
    <div role="tablist" onKeyDown={onKey} className={cn("no-scrollbar flex gap-1 overflow-x-auto border-b border-rule", className)}>
      {items.map((it) => {
        const on = value === it.value;
        return (
          <button key={it.value} role="tab" aria-selected={on} tabIndex={on ? 0 : -1} data-tab={`${id}-${it.value}`} onClick={() => onChange(it.value)}
            className={cn("relative whitespace-nowrap px-3 py-2.5 text-base transition-colors", on ? "text-text font-medium" : "text-muted hover:text-text")}>
            {it.label}
            {on && <motion.span layoutId={`tab-${id}`} transition={spring.snappy}
              className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-brass shadow-[0_0_12px_0_var(--brass)]" />}
          </button>
        );
      })}
    </div>
  );
}

/** A segmented control for modes (e.g. Search / Ask). The selection glides. */
export function Segmented<T extends string>({ value, onChange, items, label, className }:
  { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode; tone?: "brass" | "cyan" }[]; label: string; className?: string }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-xl border border-rule bg-vellum p-1", className)}>
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button key={it.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(it.value)}
            className={cn("relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
              on ? (it.tone === "cyan" ? "text-cyan" : "text-brass") : "text-muted hover:text-text")}>
            {on && <motion.span layoutId={`seg-${id}`} transition={spring.snappy}
              className={cn("absolute inset-0 rounded-lg border", it.tone === "cyan" ? "border-cyan/30 bg-cyan-soft" : "border-brass/30 bg-brass-soft")} />}
            <span className="relative inline-flex items-center gap-1.5">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
