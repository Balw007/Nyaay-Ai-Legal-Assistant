"use client";
import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "brass" | "ai";
type Size = "sm" | "md" | "lg" | "icon";

// primary: the one brass action on a screen. ai: actions that run the local model (cyan, so it is never
// mistaken for a verified result). Pressing squashes the button like rubber and it boings back (components/shell/specular.tsx).
const variants: Record<Variant, string> = {
  primary: "bg-gradient-to-b from-[color-mix(in_srgb,var(--brass)_88%,white)] to-brass text-on-brass font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_8px_22px_-10px_var(--brass)] hover:brightness-[1.06]",
  secondary: "bg-vellum text-text border border-rule-strong shadow-[inset_0_1px_0_var(--rim-hi)] hover:border-brass/45 hover:bg-brass-soft",
  ghost: "text-muted hover:text-text hover:bg-vellum",
  danger: "bg-tape text-white hover:brightness-110",
  brass: "bg-brass-soft text-brass border border-brass/40 hover:bg-brass/20",
  ai: "bg-cyan-soft text-cyan border border-cyan/35 hover:bg-cyan/20 shadow-[0_0_20px_-10px_var(--cyan)]",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-sm gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-base gap-2 rounded-lg",
  lg: "h-11 px-5 text-md gap-2 rounded-xl",
  icon: "h-8 w-8 justify-center rounded-lg",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} data-press="" disabled={disabled || loading} aria-busy={loading || undefined}
      className={cn("inline-flex items-center font-medium whitespace-nowrap transition-[color,background-color,border-color,filter,transform] duration-150 motion-reduce:active:scale-[0.98]",
        "disabled:opacity-50 disabled:pointer-events-none", variants[variant], sizes[size], className)} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
