"use client";
// The authority map. Every node and edge comes from the backend:
//   judgment → judgment   GET /judgments/{id}/links  (cites, cited_by with treatment and citing paragraphs)
//   matter   → judgment   GET /bookmarks             (paragraphs saved to a matter)
//   judgment → court      court field of the judgment
// The map grows when you expand a judgment. Statutes and legal principles are not extracted by the backend
// yet, so they are not drawn (see docs/redesign/LIMITATIONS.md).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export type NodeKind = "judgment" | "matter" | "court" | "saved";
export type EdgeKind = "cites" | "negative" | "caution" | "positive" | "cited" | "saved" | "court";
export interface GNode extends SimulationNodeDatum { id: string; kind: NodeKind; title: string; sub?: string; year?: number; expanded?: boolean; loading?: boolean; seed?: boolean; ref: string }
export interface GEdge extends SimulationLinkDatum<GNode> { id: string; source: string | GNode; target: string | GNode; kind: EdgeKind; paras?: number[] }

export const EDGE_COLOR: Record<EdgeKind, string> = {
  cites: "var(--cyan)", cited: "var(--platinum)", positive: "var(--leaf)", caution: "var(--amber)", negative: "var(--tape)", saved: "var(--brass)", court: "var(--platinum)",
};
export const EDGE_LABEL: Record<EdgeKind, string> = {
  cites: "Relies on", cited: "Cited by", positive: "Followed by", caution: "Distinguished or doubted by", negative: "May be overruled by", saved: "Saved to matter", court: "Decided by",
};
const NODE_R: Record<NodeKind, number> = { judgment: 7, matter: 9, court: 11, saved: 9 };

const idOf = (v: string | GNode) => (typeof v === "string" ? v : v.id);

export function AuthorityGraph({ nodes, edges, selected, onSelect, focus, hiddenKinds, className }:
  { nodes: GNode[]; edges: GEdge[]; selected: string | null; onSelect: (id: string | null) => void; focus: boolean; hiddenKinds: Set<EdgeKind>; className?: string }) {
  const reduce = useReducedMotion();
  const svg = useRef<SVGSVGElement>(null);
  const [, setTick] = useState(0);
  const sim = useRef<ReturnType<typeof forceSimulation<GNode>> | null>(null);
  const pos = useRef(new Map<string, { x: number; y: number }>());
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const visEdges = useMemo(() => edges.filter((e) => !hiddenKinds.has(e.kind)), [edges, hiddenKinds]);

  // Run the layout. Positions persist across updates so the map grows instead of reshuffling.
  useEffect(() => {
    const ns = nodes.map((n) => {
      const p = pos.current.get(n.id);
      return Object.assign(n, p ? { x: p.x, y: p.y } : {});
    });
    const ls = visEdges.map((e) => ({ ...e, source: idOf(e.source), target: idOf(e.target) }));
    sim.current?.stop();
    const s = forceSimulation<GNode>(ns)
      .force("link", forceLink<GNode, GEdge>(ls).id((d) => d.id).distance((l) => (l.kind === "court" ? 150 : l.kind === "saved" ? 110 : 130)).strength((l) => (l.kind === "court" ? 0.15 : 0.6)))
      .force("charge", forceManyBody<GNode>().strength((d) => (d.kind === "court" ? -420 : -240)))
      .force("collide", forceCollide<GNode>().radius((d) => NODE_R[d.kind] + (d.kind === "judgment" ? 56 : 64)).strength(1))
      .force("x", forceX(0).strength(0.04))
      .force("y", forceY(0).strength(0.06));
    sim.current = s;
    if (reduce) {
      s.stop();
      for (let i = 0; i < 260; i++) s.tick();
      ns.forEach((n) => pos.current.set(n.id, { x: n.x!, y: n.y! }));
      setTick((t) => t + 1);
    } else {
      s.alpha(pos.current.size ? 0.5 : 1).on("tick", () => {
        ns.forEach((n) => pos.current.set(n.id, { x: n.x!, y: n.y! }));
        setTick((t) => t + 1);
      });
    }
    return () => { s.stop(); };
  }, [nodes, visEdges, reduce]);

  const neighbours = useMemo(() => {
    if (!selected) return null;
    const set = new Set([selected]);
    visEdges.forEach((e) => { const a = idOf(e.source), b = idOf(e.target); if (a === selected) set.add(b); if (b === selected) set.add(a); });
    return set;
  }, [selected, visEdges]);
  const dim = (id: string) => focus && neighbours && !neighbours.has(id);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const k = Math.min(3, Math.max(0.3, view.k * (e.deltaY > 0 ? 0.9 : 1.1)));
    setView((v) => ({ ...v, k }));
  }, [view.k]);

  // Fit the map to its contents (never zooming in so far that a few nodes look huge).
  const pts = nodes.map((n) => pos.current.get(n.id)).filter(Boolean) as { x: number; y: number }[];
  const minX = Math.min(-520, ...pts.map((p) => p.x - 130)), maxX = Math.max(520, ...pts.map((p) => p.x + 130));
  const minY = Math.min(-300, ...pts.map((p) => p.y - 60)), maxY = Math.max(300, ...pts.map((p) => p.y + 60));
  const W = maxX - minX, H = maxY - minY;
  const P = (id: string) => pos.current.get(id) ?? { x: 0, y: 0 };

  return (
    <svg ref={svg} viewBox={`${minX} ${minY} ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className={cn("h-full w-full touch-none select-none", className)}
      role="group" aria-label={`Authority map with ${nodes.length} items. Use Tab to move between them and Enter to inspect one.`}
      onWheel={onWheel}
      onPointerDown={(e) => { if ((e.target as Element).closest("[data-node]")) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.target as Element).setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => { if (!drag.current || !svg.current) return; const s = W / svg.current.clientWidth; setView((v) => ({ ...v, x: drag.current!.vx + (e.clientX - drag.current!.x) * s, y: drag.current!.vy + (e.clientY - drag.current!.y) * s })); }}
      onPointerUp={() => { drag.current = null; }}
      onClick={(e) => { if (!(e.target as Element).closest("[data-node]")) onSelect(null); }}>
      <defs>
        <radialGradient id="ag-brass"><stop offset="0%" stopColor="var(--brass)" stopOpacity="0.55" /><stop offset="100%" stopColor="var(--brass)" stopOpacity="0" /></radialGradient>
        <radialGradient id="ag-cyan"><stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.4" /><stop offset="100%" stopColor="var(--cyan)" stopOpacity="0" /></radialGradient>
        <marker id="ag-arrow" viewBox="0 0 8 8" refX="15" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="var(--faint)" /></marker>
      </defs>
      <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
        {visEdges.map((e) => {
          const a = P(idOf(e.source)), b = P(idOf(e.target));
          const on = selected && (idOf(e.source) === selected || idOf(e.target) === selected);
          const faded = focus && selected && !on;
          const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
          return (
            <path key={e.id} d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`} fill="none" stroke={EDGE_COLOR[e.kind]}
              strokeWidth={e.kind === "negative" ? 1.8 : on ? 1.6 : 1} strokeDasharray={e.kind === "caution" ? "4 3" : e.kind === "court" ? "2 4" : undefined}
              strokeOpacity={faded ? 0.06 : on ? 0.95 : e.kind === "court" ? 0.22 : 0.55}
              markerEnd={e.kind === "cites" || e.kind === "saved" ? undefined : undefined}
              style={{ transition: "stroke-opacity 200ms" }} />
          );
        })}
        {nodes.map((n) => {
          const p = P(n.id);
          const r = NODE_R[n.kind];
          const sel = selected === n.id;
          const color = n.kind === "matter" || n.kind === "saved" ? "var(--brass)" : n.kind === "court" ? "var(--platinum)" : "var(--cyan)";
          const label = n.title.length > 26 ? n.title.slice(0, 24) + "…" : n.title;
          return (
            <g key={n.id} data-node transform={`translate(${p.x},${p.y})`} tabIndex={0} role="button" aria-pressed={sel}
              aria-label={`${n.kind === "judgment" ? "Judgment" : n.kind === "matter" ? "Matter" : n.kind === "court" ? "Court" : "Saved"}: ${n.title}${n.sub ? `, ${n.sub}` : ""}`}
              onClick={(ev) => { ev.stopPropagation(); onSelect(sel ? null : n.id); }}
              onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(sel ? null : n.id); } }}
              className="cursor-pointer outline-none [&:focus-visible>circle.ring]:stroke-[var(--brass)]"
              style={{ opacity: dim(n.id) ? 0.12 : 1, transition: "opacity 220ms" }}>
              {(sel || n.seed) && <circle r={r * 3.4} fill={n.kind === "judgment" ? "url(#ag-cyan)" : "url(#ag-brass)"} />}
              <circle className="ring" r={r + 4} fill="none" stroke={sel ? "var(--brass)" : "transparent"} strokeWidth={1.5} />
              {n.kind === "court" ? (
                <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} fill="var(--paper)" stroke={color} strokeWidth={1.5} />
              ) : n.kind === "matter" || n.kind === "saved" ? (
                <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2} transform="rotate(45)" fill={color} style={{ filter: "drop-shadow(0 0 5px var(--brass))" }} />
              ) : (
                <circle r={r} fill={n.expanded ? color : "var(--paper)"} stroke={color} strokeWidth={1.8} style={{ filter: n.expanded ? `drop-shadow(0 0 4px ${color})` : undefined }} />
              )}
              {n.loading && <circle r={r + 7} fill="none" stroke="var(--cyan)" strokeWidth={1} strokeDasharray="3 5" className="origin-center animate-spin [animation-duration:1.4s]" />}
              <text y={r + 15} textAnchor="middle" fontSize={n.kind === "court" ? 13 : 12.5} fill={sel ? "var(--text)" : "var(--muted)"}
                style={{ paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 3, fontWeight: sel || n.kind === "matter" ? 600 : 400 }}>{label}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
