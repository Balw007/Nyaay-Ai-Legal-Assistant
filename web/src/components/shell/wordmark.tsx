import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

// न is the first letter of न्याय (justice). A brass seal, because every authority in Nyaay is checked.
export function Seal({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-grid place-items-center rounded-full font-medium leading-none select-none text-on-brass",
      "bg-[radial-gradient(circle_at_32%_28%,color-mix(in_srgb,var(--brass)_70%,white),var(--brass)_55%,var(--brass-deep))]",
      "shadow-[inset_0_1px_1px_rgba(255,255,255,.45),0_0_18px_-6px_var(--brass)]", className)}
      style={{ fontFamily: "'IBM Plex Sans Devanagari', sans-serif" }}>न</span>
  );
}

export function Wordmark({ className, onInk }: { className?: string; onInk?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Seal className="h-7 w-7 text-[15px] pt-px" />
      <span className={cn("font-display text-[1.3rem] font-semibold", onInk ? "text-on-ink" : "text-text")}>Nyaay</span>
    </span>
  );
}

/** Opening the chambers: the seal with a turning ring of light while the session loads. */
export function BootSeal({ label = "Opening your chambers" }: { label?: string }) {
  return (
    <div role="status" className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-5">
        <Logo className="h-11" alt="Nyaay" />
        <span className="relative grid h-10 w-10 place-items-center">
          <span aria-hidden className="absolute inset-0 rounded-full animate-spin [animation-duration:2.4s]"
            style={{ background: "conic-gradient(from 0deg, transparent 0 70%, var(--brass) 88%, transparent)", mask: "radial-gradient(closest-side, transparent 88%, #000 90%)", WebkitMask: "radial-gradient(closest-side, transparent 88%, #000 90%)" }} />
          <span aria-hidden className="absolute inset-1 rounded-full bg-brass/20 blur-xl animate-[breathe_2.4s_ease-in-out_infinite]" />
        </span>
        <p className="text-sm text-muted">{label}…</p>
      </div>
    </div>
  );
}
