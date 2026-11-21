import { cn } from "@/lib/utils";

// न is the first letter of न्याय (justice). A brass seal, because every authority in Nyaay is checked.
export function Seal({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-grid place-items-center rounded-full bg-brass text-[#0a0e18] font-medium leading-none select-none", className)}
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
