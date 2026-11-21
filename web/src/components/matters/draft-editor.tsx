"use client";
import { forwardRef, useImperativeHandle, useRef } from "react";

const PH = /\[\[[^\]]+\]\]/g;

function escape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface EditorHandle { selectBlank: (label: string) => void }

// A paper writing surface. The textarea holds the text; a backdrop behind it highlights every [[blank]].
export const DraftEditor = forwardRef<EditorHandle, { value: string; onChange: (v: string) => void; readOnly?: boolean }>(
  function DraftEditor({ value, onChange, readOnly }, ref) {
    const ta = useRef<HTMLTextAreaElement>(null);
    const back = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => ({
      selectBlank(label: string) {
        const el = ta.current; if (!el) return;
        const i = el.value.indexOf(label);
        if (i < 0) return;
        el.focus(); el.setSelectionRange(i, i + label.length);
        const before = el.value.slice(0, i).split("\n").length;
        el.scrollTop = Math.max(0, (before - 4) * 30);
      },
    }));
    const html = escape(value).replace(PH, (m) => `<mark class="draft-blank">${m}</mark>`) + "\n";
    const shared = "prose-judgment whitespace-pre-wrap break-words px-10 py-10 text-[15px] leading-[30px]";
    return (
      <div className="relative min-h-[70vh] overflow-hidden rounded-lg border border-rule bg-[#fbfaf6] text-[#1d2333] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.8)]">
        <style>{`.draft-blank{background:rgba(227,184,101,.38);color:transparent;border-radius:3px;box-shadow:0 0 0 1px rgba(168,120,31,.55)}`}</style>
        <div ref={back} aria-hidden className={`${shared} pointer-events-none absolute inset-0 overflow-hidden text-transparent`} dangerouslySetInnerHTML={{ __html: html }} />
        <textarea ref={ta} value={value} readOnly={readOnly} spellCheck lang="en-IN" aria-label="Draft text"
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => { if (back.current) back.current.scrollTop = e.currentTarget.scrollTop; }}
          className={`${shared} relative block h-[70vh] w-full resize-none bg-transparent caret-[#8f6d33] outline-none selection:bg-[rgba(168,120,31,.25)]`} />
      </div>
    );
  });
