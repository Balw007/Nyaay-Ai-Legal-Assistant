"use client";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const base = "w-full rounded-lg border border-rule-strong bg-vellum shadow-[inset_0_1px_2px_rgba(0,0,0,.12)] transition-[border-color,box-shadow] px-3 text-base text-text placeholder:text-faint " +
  "focus:outline-none focus:border-brass focus:ring-2 focus:ring-brass/25 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...p }, ref) { return <input ref={ref} className={cn(base, "h-9", className)} {...p} />; });

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...p }, ref) { return <textarea ref={ref} className={cn(base, "py-2 leading-relaxed", className)} {...p} />; });

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...p }, ref) {
    return <select ref={ref} className={cn(base, "h-9 pr-8", className)} {...p}>{children}</select>;
  });

export function Field({ label, hint, error, children, className }: { label: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-sm font-medium text-text">{label}</span>
      {children}
      {error ? <span className="block text-sm text-tape">{error}</span> : hint ? <span className="block text-sm text-faint">{hint}</span> : null}
    </label>
  );
}
