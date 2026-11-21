// Render backend snippets that contain <mark>…</mark> without using innerHTML.
// Any other tag-like text is shown as plain text.
export function Marked({ html, className }: { html: string; className?: string }) {
  const parts = html.split(/(<mark>[\s\S]*?<\/mark>)/g);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        const m = p.match(/^<mark>([\s\S]*?)<\/mark>$/);
        return m ? <mark key={i}>{decode(m[1])}</mark> : <span key={i}>{decode(p)}</span>;
      })}
    </span>
  );
}

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Highlight every occurrence of `term` (case-insensitive) in plain text. Used by find-in-judgment.
export function Highlight({ text, term, activeIndex, offset = 0 }: { text: string; term: string; activeIndex?: number; offset?: number }) {
  if (!term || term.length < 2) return <>{text}</>;
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${esc})`, "gi"));
  let k = offset;
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 1) {
          const idx = k++;
          return <mark key={i} data-find={idx} className={idx === activeIndex ? "!bg-brass !text-[#0a0e18] outline outline-2 outline-brass/60" : undefined}>{p}</mark>;
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export function countMatches(text: string, term: string) {
  if (!term || term.length < 2) return 0;
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (text.match(new RegExp(esc, "gi")) || []).length;
}
