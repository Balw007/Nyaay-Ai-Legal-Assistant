"use client";
import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

// A citation network: each point is a judgment, each line a citation. Gold points are verified authorities.
// Deterministic layout (seeded) so the picture is stable between renders.
function rand(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export function Constellation({ className, nodes = 46, seed = 7 }: { className?: string; nodes?: number; seed?: number }) {
  const reduce = useReducedMotion();
  const { pts, edges } = useMemo(() => {
    const r = rand(seed);
    const pts = Array.from({ length: nodes }, (_, i) => ({
      x: 40 + r() * 520, y: 40 + r() * 520, r: 1.4 + r() * 2.6, gold: r() > 0.8, i,
    }));
    const edges: [number, number][] = [];
    pts.forEach((p, i) => {
      const near = pts.map((q, j) => ({ j, d: Math.hypot(p.x - q.x, p.y - q.y) })).filter((o) => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 2);
      near.forEach((n) => { if (n.d < 150 && !edges.some(([a, b]) => (a === n.j && b === i))) edges.push([i, n.j]); });
    });
    return { pts, edges };
  }, [nodes, seed]);

  return (
    <svg viewBox="0 0 600 600" className={className} role="img" aria-label="Network of judgments connected by citations">
      <defs>
        <radialGradient id="gold-glow"><stop offset="0%" stopColor="var(--brass)" stopOpacity="0.9" /><stop offset="100%" stopColor="var(--brass)" stopOpacity="0" /></radialGradient>
        <radialGradient id="cyan-glow"><stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.5" /><stop offset="100%" stopColor="var(--cyan)" stopOpacity="0" /></radialGradient>
      </defs>
      {edges.map(([a, b], k) => (
        <motion.line key={k} x1={pts[a].x} y1={pts[a].y} x2={pts[b].x} y2={pts[b].y}
          stroke={pts[a].gold && pts[b].gold ? "var(--brass)" : "var(--cyan)"} strokeOpacity={pts[a].gold || pts[b].gold ? 0.45 : 0.18} strokeWidth={0.8}
          initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, delay: 0.2 + k * 0.012, ease: "easeOut" }} />
      ))}
      {pts.map((p) => (
        <g key={p.i}>
          <circle cx={p.x} cy={p.y} r={p.r * (p.gold ? 7 : 4)} fill={p.gold ? "url(#gold-glow)" : "url(#cyan-glow)"} opacity={p.gold ? 0.55 : 0.25} />
          <motion.circle cx={p.x} cy={p.y} r={p.r} fill={p.gold ? "var(--brass)" : "var(--cyan)"}
            initial={reduce ? false : { opacity: 0, scale: 0 }} animate={{ opacity: p.gold ? 1 : 0.75, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 + p.i * 0.02 }} />
        </g>
      ))}
    </svg>
  );
}
