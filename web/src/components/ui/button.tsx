"use client";
import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "brass";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-brass text-[#0a0e18] font-semibold hover:brightness-110 shadow-[0_0_20px_-6px_var(--brass)]",
  secondary: "bg-vellum text-text border border-rule-strong hover:border-brass/50 hover:bg-brass-soft",
  ghost: "text-muted hover:text-text hover:bg-vellum",
  danger: "bg-tape text-white hover:brightness-110",
  brass: "bg-brass-soft text-brass border border-brass/40 hover:bg-brass/20",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-sm gap-1.5",
  md: "h-9 px-3.5 text-base gap-2",
  lg: "h-11 px-5 text-md gap-2",
  icon: "h-8 w-8 justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading}
      className={cn("inline-flex items-center rounded-md font-medium whitespace-nowrap transition-colors",
        "disabled:opacity-50 disabled:pointer-events-none", variants[variant], sizes[size], className)} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
