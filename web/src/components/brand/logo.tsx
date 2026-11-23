/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

// The न्याय logo, cut out of the original artwork in two colourings: cream and gold for dark surfaces, ink and
// deep gold for light ones. The theme class on <html> decides which one shows, so there is no flash on load.
export function Logo({ variant = "wordmark", className, alt = "Nyaay" }: { variant?: "wordmark" | "full"; className?: string; alt?: string }) {
  const w = variant === "full" ? 1400 : 900, h = variant === "full" ? 504 : 188;
  return (
    <span className={cn("inline-block w-max", className)} role="img" aria-label={alt}>
      <img src={`/brand/logo-${variant}-dark.png`} width={w} height={h} alt="" draggable={false} className="h-full w-auto max-w-none select-none light:hidden" />
      <img src={`/brand/logo-${variant}-light.png`} width={w} height={h} alt="" draggable={false} className="hidden h-full w-auto max-w-none select-none light:block" />
    </span>
  );
}
