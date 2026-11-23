"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** "NI Act s.138" as a link into the Bare Acts reader. */
export function ActChip({ act, name, section, inferred, className }: { act: string; name: string; section: string; inferred?: boolean; className?: string }) {
  return (
    <Link href={`/acts?act=${act}&no=${encodeURIComponent(section)}`}
      title={inferred ? "The judgment says “of the Act” and names no other Act; Nyaay read it as this one" : "Open the section"}
      className={cn("inline-flex items-center gap-1 rounded-sm border border-brass/30 bg-brass-soft px-1.5 py-px text-xs font-medium text-brass hover:border-brass/60", inferred && "border-dashed", className)}>
      {name} s.{section}{inferred && <span aria-hidden>*</span>}
    </Link>
  );
}
