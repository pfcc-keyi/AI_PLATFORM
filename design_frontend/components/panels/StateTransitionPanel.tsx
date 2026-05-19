"use client";

import * as React from "react";
import ReactFlow, {
  Background,
  BaseEdge,
  Controls,
  Edge,
  EdgeLabelRenderer,
  EdgeProps,
  MarkerType,
  Node,
  Position
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import type { SchemaDesign } from "@/lib/types";

interface StateTransitionPanelProps {
  table: SchemaDesign;
  /** Optional explicit pixel height; otherwise fills its parent. */
  height?: number | string;
}

/* ---------------------------------------------------------------------------
 * Visual constants
 * ------------------------------------------------------------------------ */

/* Per UX feedback we no longer colour-code states by name (success / warning
 * / danger buckets felt arbitrary and "all transparent"). Every real state
 * uses the SAME palette; only the synthetic `init` / `deleted` / `void`
 * pseudo-states get a different muted look so users can tell at a glance
 * which states are real vs scaffolding. */
const STATE_STYLE = {
  bg: "rgb(168 119 255 / 0.22)",
  border: "rgb(168 119 255)",
  text: "rgb(232 234 240)"
} as const;

const TERMINAL_STYLE = {
  bg: "rgb(25 30 45)",
  border: "rgb(148 156 178 / 0.7)",
  text: "rgb(200 206 224)"
} as const;

/* Edges are solid (no alpha) — user explicitly asked for no transparent
 * lines. The pinned colour is a brighter white so the selected edge pops
 * even on a busy diagram. */
const EDGE_COLOR = "rgb(168 119 255)";
const EDGE_COLOR_PINNED = "rgb(232 234 240)";

const NODE_W = 130;
const NODE_H = 36;

function isTerminal(s: string): boolean {
  const l = s.toLowerCase();
  return l === "init" || l === "deleted" || l === "void";
}

/* ---------------------------------------------------------------------------
 * Custom edge: handles self-loops + parallel/back-edges without overlap
 * ------------------------------------------------------------------------ */

interface EdgeData {
  /** Perpendicular offset multiplier (..-1, 0, +1..) used when several edges
   *  connect the same unordered pair of nodes so they don't sit on top of
   *  each other. */
  parallelOffset: number;
}

function StateEdge(props: EdgeProps) {
  const {
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    style,
    markerEnd,
    label,
    data
  } = props;

  const parallelOffset = (data as EdgeData | undefined)?.parallelOffset ?? 0;

  /* -- Self-loop (source === target) -----------------------------------
   * ReactFlow's built-in edges collapse to a 0-length line when source
   * and target coincide, so we draw our own cubic-bezier "ear" looping
   * above the node. */
  if (source === target) {
    const r = 30;
    const c1x = sourceX + r * 1.7;
    const c1y = sourceY - r * 2.4;
    const c2x = sourceX - r * 1.7;
    const c2y = sourceY - r * 2.4;
    const path = `M ${sourceX} ${sourceY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${targetX} ${targetY}`;
    return (
      <>
        <BaseEdge
          id={id}
          path={path}
          style={style}
          markerEnd={markerEnd}
          interactionWidth={20}
        />
        {label ? (
          <EdgeLabel x={sourceX} y={sourceY - r * 1.9}>
            {label}
          </EdgeLabel>
        ) : null}
      </>
    );
  }

  /* -- Normal edge: quadratic bezier with perpendicular offset ---------
   * The control point sits on the perpendicular of the source→target
   * line so back-edges and parallel edges land on opposite sides. This
   * lets the user "see" two edges between the same pair without them
   * overlapping into one fat invisible line. */
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  // Base curve is always present so even single edges feel less harsh;
  // parallel siblings push further out in alternating directions.
  const offset = 24 + parallelOffset * 38;
  const mx = (sourceX + targetX) / 2 + px * offset;
  const my = (sourceY + targetY) / 2 + py * offset;
  const path = `M ${sourceX} ${sourceY} Q ${mx} ${my} ${targetX} ${targetY}`;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerEnd={markerEnd}
        interactionWidth={20}
      />
      {label ? (
        <EdgeLabel x={mx} y={my}>
          {label}
        </EdgeLabel>
      ) : null}
    </>
  );
}

function EdgeLabel({
  x,
  y,
  children
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}) {
  return (
    <EdgeLabelRenderer>
      <div
        style={{
          position: "absolute",
          transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
          background: "rgb(18 22 33)",
          color: "rgb(232 234 240)",
          padding: "3px 8px",
          borderRadius: 6,
          border: "1px solid rgb(168 119 255)",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
          pointerEvents: "all",
          boxShadow: "0 2px 8px rgb(0 0 0 / 0.45)"
        }}
      >
        {children}
      </div>
    </EdgeLabelRenderer>
  );
}

/* Defined at module scope so ReactFlow doesn't yell about "new edgeTypes
 * object every render". */
const EDGE_TYPES = { state: StateEdge } as const;

/* ---------------------------------------------------------------------------
 * Graph builder
 * ------------------------------------------------------------------------ */

/** Build nodes + edges from a SchemaDesign.
 *
 * Edges are the UNION of:
 *   - `table.transitions[*]` (declared state-machine moves), and
 *   - `table.actions[*].transition` (every action's effect — this is what
 *     surfaces self-loops like `approve_kyc (active → active)` that don't
 *     have an explicit transitions row).
 *
 * Each unique (from, to) pair becomes ONE edge; the action labels for that
 * pair are joined on the edge so clicking it shows every action that fires
 * along that line. */
function buildGraph(table: SchemaDesign) {
  /* Collect the full pair set (transitions ∪ actions) ------------------ */
  const pairSet = new Set<string>();
  const pairs: { from: string; to: string }[] = [];

  function addPair(from: string, to: string) {
    if (!from || !to) return;
    const key = `${from}|${to}`;
    if (pairSet.has(key)) return;
    pairSet.add(key);
    pairs.push({ from, to });
  }

  table.transitions.forEach((t) => addPair(t.from_state, t.to_state));
  table.actions.forEach((a) => {
    if (a.transition) addPair(a.transition.from_state, a.transition.to_state);
  });

  /* States: union of declared states + every referenced state ---------- */
  const allStates = new Set<string>(table.states ?? []);
  pairs.forEach((p) => {
    allStates.add(p.from);
    allStates.add(p.to);
  });
  const states = Array.from(allStates);

  /* Dagre LR layout — self-loops are not real edges in dagre's eyes,
   * we skip them so they don't distort node ranks. */
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: 60,
    ranksep: 110,
    marginx: 24,
    marginy: 24,
    ranker: "longest-path"
  });
  for (const s of states) {
    g.setNode(s, { width: NODE_W, height: NODE_H });
  }
  for (const p of pairs) {
    if (p.from !== p.to) g.setEdge(p.from, p.to);
  }
  dagre.layout(g);

  /* Nodes -------------------------------------------------------------- */
  const nodes: Node[] = states.map((s) => {
    const pos = g.node(s);
    const palette = isTerminal(s) ? TERMINAL_STYLE : STATE_STYLE;
    return {
      id: s,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      data: { label: s },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {
        width: NODE_W,
        height: NODE_H,
        borderRadius: 999,
        padding: "6px 14px",
        background: palette.bg,
        borderColor: palette.border,
        borderWidth: 1.5,
        color: palette.text,
        fontWeight: 500,
        fontSize: 12,
        letterSpacing: "0.02em",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }
    };
  });

  /* Group action names per pair --------------------------------------- */
  const actionByPair: Record<string, string[]> = {};
  table.actions.forEach((a) => {
    if (!a.transition) return;
    const key = `${a.transition.from_state}|${a.transition.to_state}`;
    actionByPair[key] ||= [];
    actionByPair[key].push(a.name);
  });

  /* Parallel edge handling -------------------------------------------- *
   * Two directed pairs that share the same unordered endpoints (A→B and
   * B→A) need to live on opposite sides of the line so they don't
   * overlap. Count siblings per unordered key, then assign offsets
   * symmetrically around 0. */
  const unorderedCount: Record<string, number> = {};
  const unorderedAssigned: Record<string, number> = {};
  for (const p of pairs) {
    if (p.from === p.to) continue;
    const k = [p.from, p.to].sort().join("|");
    unorderedCount[k] = (unorderedCount[k] || 0) + 1;
  }

  const actionsByEdge: Record<string, string[]> = {};
  const baseEdges: Edge[] = pairs.map((p, i) => {
    const edgeId = `e${i}`;
    actionsByEdge[edgeId] = actionByPair[`${p.from}|${p.to}`] || [];

    let parallelOffset = 0;
    if (p.from !== p.to) {
      const k = [p.from, p.to].sort().join("|");
      const total = unorderedCount[k];
      const assigned = unorderedAssigned[k] || 0;
      unorderedAssigned[k] = assigned + 1;
      if (total > 1) {
        // Center offsets around 0 so 2 edges get -0.5/+0.5, 3 get -1/0/+1, etc.
        const centred = assigned - (total - 1) / 2;
        // Forward vs back edges already flip the perpendicular sign because
        // (px, py) is computed from (target - source). So an A→B edge and a
        // B→A edge with the same `centred` value end up on opposite sides
        // automatically. We still nudge same-direction parallels (rare) so
        // they don't stack.
        parallelOffset = centred;
      }
    }

    return {
      id: edgeId,
      source: p.from,
      target: p.to,
      type: "state",
      data: { parallelOffset } as EdgeData,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: EDGE_COLOR,
        width: 18,
        height: 18
      },
      style: {
        stroke: EDGE_COLOR, // solid — no alpha
        strokeWidth: 1.8,
        fill: "none"
      }
    };
  });

  return { nodes, baseEdges, actionsByEdge };
}

/* ---------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------ */

export function StateTransitionPanel({
  table,
  height = 340
}: StateTransitionPanelProps) {
  const [pinnedEdge, setPinnedEdge] = React.useState<string | null>(null);

  const { nodes, baseEdges, actionsByEdge } = React.useMemo(
    () => buildGraph(table),
    [table]
  );

  /* Decorate base edges with pin state.
   * Per UX feedback: NO hover behaviour, NO transparency. Pinned edge
   * gets a brighter colour + thicker stroke + the joined action label. */
  const edges: Edge[] = React.useMemo(() => {
    return baseEdges.map((e) => {
      const isPinned = pinnedEdge === e.id;
      const actions = actionsByEdge[e.id] || [];
      const label = isPinned && actions.length > 0 ? actions.join(" / ") : undefined;
      return {
        ...e,
        label,
        style: {
          ...e.style,
          stroke: isPinned ? EDGE_COLOR_PINNED : EDGE_COLOR,
          strokeWidth: isPinned ? 2.8 : 1.8
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isPinned ? EDGE_COLOR_PINNED : EDGE_COLOR,
          width: 18,
          height: 18
        }
      };
    });
  }, [baseEdges, actionsByEdge, pinnedEdge]);

  const activeActions = pinnedEdge ? actionsByEdge[pinnedEdge] || [] : [];

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-border bg-bg/40"
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnDrag
        onEdgeClick={(_, edge) =>
          setPinnedEdge((cur) => (cur === edge.id ? null : edge.id))
        }
        onPaneClick={() => setPinnedEdge(null)}
      >
        <Background gap={16} color="rgb(38 45 65)" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* Hint overlay — disappears as soon as the user pins an edge. */}
      {!pinnedEdge ? (
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 rounded-md bg-surface/85 px-2 py-1 text-[10px] text-muted backdrop-blur-sm">
          Click an arrow to see the action(s) it fires. Click again to unpin.
        </div>
      ) : null}

      {/* Pinned actions readout — full text outside the diagram so long
          names can wrap without crowding the state pills. */}
      {activeActions.length > 0 ? (
        <div className="pointer-events-none absolute right-2 top-2 max-w-[60%] rounded-md border border-accent/40 bg-surface/95 px-2.5 py-1.5 text-[11px] shadow-glow backdrop-blur">
          <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
            Pinned action(s)
          </div>
          <div className="flex flex-col gap-0.5 font-mono text-text">
            {activeActions.map((a) => (
              <span key={a} className="break-all">
                {a}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
