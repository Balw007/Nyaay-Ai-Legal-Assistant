"use client";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { Links } from "@/lib/types";

type Node = { id: string; title: string; year?: number; treatment?: string; side: "cites" | "by" };

const EDGE: Record<string, string> = { negative: "var(--tape)", caution: "var(--amber)", positive: "var(--leaf)" };

// This judgment glows gold in the centre. What it relies on fans out to the left (cyan);
// later judgments that cite it fan out to the right, coloured by how they treat it.
export function CitationGraph({ links, title }: { links: Links; title: string }) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<Node | null>(null);
  const cites: Node[] = links.cites.slice(0, 9).map((c) => ({ id: String(c.id ?? c.jid), title: c.title, year: c.year, side: "cites" }));
  const by: Node[] = links.cited_by.slice(0, 9).map((c) => ({ id: String(c.id ?? c.jid), title: c.title, year: c.year, treatment: c.treatment, side: "by" }));
  const W = 320, H = 220, cx = W / 2, cy = H / 2, R = 118;

  const place = (list: Node[], side: "cites" | "by") => list.map((n, i) => {
    const span = Math.min(150, 26 * Math.max(1, list.length - 1));
    const a = (list.length === 1 ? 0 : -span / 2 + (span * i) / (list.length - 1)) * (Math.PI / 180);
    const x = side === "cites" ? cx - R * Math.cos(a) * 1.05 : cx + R * Math.cos(a) * 1.05;
    return { ...n, x, y: cy + R * 0.78 * Math.sin(a) };
  });
  const nodes = [...place(cites, "cites"), ...place(by, "by")];

  if (nodes.length === 0) {
    return <p className="text-sm text-muted">No links yet. {links.citations_in_text > 0
      ? `This judgment cites ${links.citations_in_text} authorities, none of them in your library yet.`
      : "No other judgment in your library cites this one."}</p>;
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Citation network: cites ${links.cites.length}, cited by ${links.cited_by.length}`}>
        <defs>
          <radialGradient id="cg-core"><stop offset="0%" stopColor="var(--brass)" stopOpacity="0.8" /><stop offset="100%" stopColor="var(--brass)" stopOpacity="0" /></radialGradient>
        </defs>
        {nodes.map((n, i) => {
          const color = n.side === "cites" ? "var(--cyan)" : EDGE[n.treatment ?? ""] ?? "var(--cyan)";
          const mx = (n.x + cx) / 2, my = (n.y + cy) / 2 - (n.y - cy) * 0.25;
          return (
            <motion.path key={`e${i}`} d={`M${cx},${cy} Q${mx},${my} ${n.x},${n.y}`} fill="none" stroke={color}
              strokeOpacity={hover && hover.id !== n.id ? 0.12 : n.treatment === "negative" ? 0.9 : 0.45} strokeWidth={n.treatment === "negative" ? 1.6 : 1}
              strokeDasharray={n.treatment === "caution" ? "3 3" : undefined}
              initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, delay: 0.1 + i * 0.04 }} />
          );
        })}
        <circle cx={cx} cy={cy} r={30} fill="url(#cg-core)" />
        <circle cx={cx} cy={cy} r={8} fill="var(--brass)" />
        <text x={cx} y={cy + 24} textAnchor="middle" fontSize="9" fill="var(--muted)">this judgment</text>
        {nodes.map((n, i) => {
          const color = n.side === "cites" ? "var(--cyan)" : EDGE[n.treatment ?? ""] ?? "var(--cyan)";
          return (
            <Link key={`n${i}`} href={`/judgments/${encodeURIComponent(n.id)}`} aria-label={`${n.side === "cites" ? "Cites" : "Cited by"} ${n.title}`}>
              <motion.circle cx={n.x} cy={n.y} r={hover?.id === n.id ? 7 : 5} fill={color} stroke="var(--paper)" strokeWidth={1.5}
                style={{ filter: `drop-shadow(0 0 4px ${color})`, cursor: "pointer" }}
                initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.04 }}
                onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(n)} onBlur={() => setHover(null)} />
            </Link>
          );
        })}
        <text x={8} y={14} fontSize="9" fill="var(--faint)">Relies on · {links.cites.length}</text>
        <text x={W - 8} y={14} fontSize="9" fill="var(--faint)" textAnchor="end">Cited by · {links.cited_by.length}</text>
      </svg>
      <p className="mt-1 min-h-[2.5rem] text-sm text-muted" aria-live="polite">
        {hover ? <><span className="text-text">{hover.title}</span>{hover.year ? ` (${hover.year})` : ""}{hover.side === "by" && hover.treatment && hover.treatment !== "cited" ? ` · ${hover.treatment === "negative" ? "may overrule or disapprove" : hover.treatment === "caution" ? "distinguishes or doubts" : "follows"} ${title.length > 40 ? "this case" : title}` : ""}</>
          : "Point at a dot to see the case. Red lines mean a later case may have overruled or disapproved this one."}
      </p>
    </div>
  );
}
