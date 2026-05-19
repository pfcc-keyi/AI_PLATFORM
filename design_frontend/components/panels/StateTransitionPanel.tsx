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
import { Loader2 } from "lucide-react";
import type { SchemaDesign } from "@/lib/types";

// ELK is loaded on-demand the first time a state diagram is rendered, so
// the ~400kb of layout-engine code doesn't bloat the design page's initial
// bundle. Tracked at module scope so subsequent diagrams reuse the worker.
type ElkInstance = {
  layout: <T extends ElkNode>(graph: T) => Promise<T>;
};
type ElkNode = {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  edges?: Array<{
    id: string;
    sources: string[];
    targets: string[];
    sections?: Array<{
      startPoint: { x: number; y: number };
      endPoint: { x: number; y: number };
      bendPoints?: { x: number; y: number }[];
    }>;
  }>;
};
type ElkPoint = { x: number; y: number };

let elkInstancePromise: Promise<ElkInstance> | null = null;
function getElk(): Promise<ElkInstance> {
  if (!elkInstancePromise) {
    elkInstancePromise = import("elkjs/lib/elk.bundled.js").then((mod) => {
      const Ctor = (mod as unknown as { default: new () => ElkInstance }).default;
      return new Ctor();
    });
  }
  return elkInstancePromise;
}

interface StateTransitionPanelProps {
  table: SchemaDesign;
  /** Optional explicit pixel height; otherwise fills its parent. */
  height?: number | string;
}

/* ---------------------------------------------------------------------------
 * Visual constants
 * ------------------------------------------------------------------------ */

/* One palette for every "real" state. Pseudo-states (init/deleted/void) get
 * a muted look so they read as scaffolding, not normal states. */
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

const EDGE_COLOR = "rgb(168 119 255)";
const EDGE_COLOR_PINNED = "rgb(232 234 240)";

const NODE_W = 130;
const NODE_H = 36;

function isTerminal(s: string): boolean {
  const l = s.toLowerCase();
  return l === "init" || l === "deleted" || l === "void";
}

/* ---------------------------------------------------------------------------
 * Custom edge — consumes ELK's pre-computed bend points and renders an
 * orthogonal polyline with small rounded corners. Self-loops are intercepted
 * and drawn as a clean arc above the node instead, because ELK's default
 * self-loop rendering goes through ports that don't match our setup.
 * ------------------------------------------------------------------------ */

interface EdgeData {
  /** Absolute points (in graph coords) that the edge passes through, in
   *  order: [start, ...bendPoints, end]. Empty array for self-loops. */
  points: { x: number; y: number }[];
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

  /* -- Self-loop ---------------------------------------------------------
   * ReactFlow's default edges collapse to invisible when source === target.
   * For TB layout (source handle on bottom, target handle on top) we draw a
   * cubic-bezier loop that exits the bottom, swings around the right side
   * of the node, and comes back into the top. Going around the side (not
   * above the node) keeps clear of any other state pills stacked above. */
  if (source === target) {
    const r = 36;
    const c1x = sourceX + r * 1.8;
    const c1y = sourceY + r * 0.4; // pulls the curve out and slightly down
    const c2x = targetX + r * 1.8;
    const c2y = targetY - r * 0.4; // brings it back in from above-right
    const path = `M ${sourceX} ${sourceY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${targetX} ${targetY}`;
    const labelX = sourceX + r * 2.2;
    const labelY = (sourceY + targetY) / 2;
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
          <EdgeLabel x={labelX} y={labelY}>
            {label}
          </EdgeLabel>
        ) : null}
      </>
    );
  }

  /* -- Orthogonal polyline from ELK bend points -------------------------
   * Fall back to a simple bezier if we didn't get points (e.g. ELK failure
   * or stale render before layout finished). */
  const points = (data as EdgeData | undefined)?.points;
  if (!points || points.length < 2) {
    const path = `M ${sourceX} ${sourceY} C ${sourceX} ${(sourceY + targetY) / 2}, ${targetX} ${(sourceY + targetY) / 2}, ${targetX} ${targetY}`;
    return (
      <>
        <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} interactionWidth={20} />
        {label ? <EdgeLabel x={(sourceX + targetX) / 2} y={(sourceY + targetY) / 2}>{label}</EdgeLabel> : null}
      </>
    );
  }

  const path = roundedPolyline(points, 10);
  const mid = midOfPolyline(points);

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} interactionWidth={20} />
      {label ? <EdgeLabel x={mid.x} y={mid.y}>{label}</EdgeLabel> : null}
    </>
  );
}

/** SVG path string for an orthogonal polyline whose corners are rounded
 *  with a quadratic-bezier arc of approximate `radius`. The radius is
 *  clamped per segment so very short segments don't fold over. */
function roundedPolyline(points: { x: number; y: number }[], radius: number): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const len1 = Math.hypot(dx1, dy1) || 1;
    const r1 = Math.min(radius, len1 / 2);
    const ax = curr.x - (dx1 / len1) * r1;
    const ay = curr.y - (dy1 / len1) * r1;

    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len2 = Math.hypot(dx2, dy2) || 1;
    const r2 = Math.min(radius, len2 / 2);
    const bx = curr.x + (dx2 / len2) * r2;
    const by = curr.y + (dy2 / len2) * r2;

    d += ` L ${ax} ${ay} Q ${curr.x} ${curr.y} ${bx} ${by}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** Midpoint of the polyline by arc length — used to place the pinned-action
 *  label so it sits visually on the line regardless of how many bends it has. */
function midOfPolyline(points: { x: number; y: number }[]): { x: number; y: number } {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  let total = 0;
  const segLen: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const l = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    segLen.push(l);
    total += l;
  }
  let target = total / 2;
  for (let i = 0; i < segLen.length; i++) {
    if (target <= segLen[i]) {
      const t = target / segLen[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t
      };
    }
    target -= segLen[i];
  }
  return points[points.length - 1];
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
 * Layout — async, returns nodes + edges ready for ReactFlow
 * ------------------------------------------------------------------------ */

interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
  actionsByEdge: Record<string, string[]>;
  /** Total layout dimensions (used for fitView padding). */
  width: number;
  height: number;
}

async function computeLayout(table: SchemaDesign): Promise<LayoutResult> {
  /* -- Collect the full pair set (transitions ∪ actions) --------------- */
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

  const allStates = new Set<string>(table.states ?? []);
  pairs.forEach((p) => {
    allStates.add(p.from);
    allStates.add(p.to);
  });
  const states = Array.from(allStates);

  /* -- Group action names per pair ------------------------------------- */
  const actionByPair: Record<string, string[]> = {};
  table.actions.forEach((a) => {
    if (!a.transition) return;
    const key = `${a.transition.from_state}|${a.transition.to_state}`;
    actionByPair[key] ||= [];
    actionByPair[key].push(a.name);
  });

  /* -- Run ELK ---------------------------------------------------------
   * Layered + orthogonal routing is what state machine visualisers like
   * XState/Stately use because it:
   *   - lays nodes in topological tiers (init → … → terminal),
   *   - routes back-edges around the side instead of through other nodes,
   *   - guarantees no edge-edge overlap (each edge gets its own lane),
   *   - keeps the diagram tall enough to feel like a state machine, not a
   *     left-to-right sausage.
   *
   * `DOWN` (TB) is the default direction — most state machines read
   * naturally top-down (init at top, terminal at bottom). For 4–10 states
   * this fits a panel that's typically taller than wide much better than
   * the previous LR layout. */
  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
      "elk.spacing.nodeNode": "40",
      "elk.spacing.edgeNode": "20",
      "elk.spacing.edgeEdge": "15",
      "elk.layered.crossingMinimization.semiInteractive": "true",
      "elk.layered.feedbackEdges": "true",
      "elk.layered.considerModelOrder.strategy": "PREFER_EDGES"
    },
    children: states.map((s) => ({
      id: s,
      width: NODE_W,
      height: NODE_H
    })),
    edges: pairs
      .filter((p) => p.from !== p.to) // ELK can't route self-loops cleanly; we draw them ourselves
      .map((p, i) => ({
        id: `e${i}`,
        sources: [p.from],
        targets: [p.to]
      }))
  };

  let laidOut: ElkNode;
  try {
    const elk = await getElk();
    laidOut = await elk.layout(elkGraph);
  } catch (err) {
    // Fall back to a trivial grid layout if ELK fails for any reason.
    // eslint-disable-next-line no-console
    console.warn("ELK layout failed, falling back to grid:", err);
    laidOut = fallbackGrid(states);
  }

  /* -- Build node/edge lists from ELK output --------------------------- */
  const nodePos: Record<string, { x: number; y: number }> = {};
  for (const c of laidOut.children ?? []) {
    nodePos[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
  }

  const nodes: Node[] = states.map((s) => {
    const pos = nodePos[s] ?? { x: 0, y: 0 };
    const palette = isTerminal(s) ? TERMINAL_STYLE : STATE_STYLE;
    return {
      id: s,
      position: pos,
      data: { label: s },
      // TB layout → source flows from the bottom, target enters from the top.
      // Self-loop edges still work because they go top→top via our custom arc.
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
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

  /* -- Map ELK edge sections back to our edge list --------------------- */
  const elkEdgeById: Record<string, ElkPoint[]> = {};
  for (const e of (laidOut.edges ?? []) as Array<{
    id: string;
    sections?: Array<{ startPoint: ElkPoint; endPoint: ElkPoint; bendPoints?: ElkPoint[] }>;
  }>) {
    const sec = e.sections?.[0];
    if (!sec) continue;
    const pts: ElkPoint[] = [sec.startPoint];
    if (sec.bendPoints) pts.push(...sec.bendPoints);
    pts.push(sec.endPoint);
    elkEdgeById[e.id] = pts;
  }

  /* -- Re-emit every pair as a ReactFlow Edge -------------------------- */
  const actionsByEdge: Record<string, string[]> = {};
  const edges: Edge[] = pairs.map((p, idx) => {
    const edgeId = `e${idx}`;
    actionsByEdge[edgeId] = actionByPair[`${p.from}|${p.to}`] || [];
    const points =
      p.from === p.to
        ? []
        : (elkEdgeById[edgeId] ?? []).map((pt) => ({ x: pt.x, y: pt.y }));
    return {
      id: edgeId,
      source: p.from,
      target: p.to,
      type: "state",
      data: { points } satisfies EdgeData,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: EDGE_COLOR,
        width: 18,
        height: 18
      },
      style: {
        stroke: EDGE_COLOR,
        strokeWidth: 1.8,
        fill: "none"
      }
    };
  });

  /* -- Overall canvas size for fitView padding heuristics -------------- */
  const width = laidOut.width ?? 400;
  const height = laidOut.height ?? 300;

  return { nodes, edges, actionsByEdge, width, height };
}

/** Last-resort grid layout if ELK fails (e.g. web worker blocked). */
function fallbackGrid(states: string[]): ElkNode {
  return {
    id: "root",
    children: states.map((s, i) => ({
      id: s,
      x: (i % 4) * (NODE_W + 40),
      y: Math.floor(i / 4) * (NODE_H + 60),
      width: NODE_W,
      height: NODE_H
    })),
    edges: []
  };
}

/* ---------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------ */

export function StateTransitionPanel({
  table,
  height = 340
}: StateTransitionPanelProps) {
  const [layout, setLayout] = React.useState<LayoutResult | null>(null);
  const [pinnedEdge, setPinnedEdge] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLayout(null);
    computeLayout(table).then((res) => {
      if (!cancelled) setLayout(res);
    });
    return () => {
      cancelled = true;
    };
  }, [table]);

  /* Decorate edges with pin state.
   * Per UX feedback: NO hover behaviour, NO transparency. Pinned edge
   * gets a brighter colour + thicker stroke + the joined action label. */
  const decoratedEdges: Edge[] = React.useMemo(() => {
    if (!layout) return [];
    return layout.edges.map((e) => {
      const isPinned = pinnedEdge === e.id;
      const actions = layout.actionsByEdge[e.id] || [];
      const label = isPinned && actions.length > 0 ? actions.join(" / ") : undefined;
      return {
        ...e,
        label,
        style: {
          ...e.style,
          stroke: isPinned ? EDGE_COLOR_PINNED : EDGE_COLOR,
          strokeWidth: isPinned ? 2.8 : 1.8,
          fill: "none"
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isPinned ? EDGE_COLOR_PINNED : EDGE_COLOR,
          width: 18,
          height: 18
        }
      };
    });
  }, [layout, pinnedEdge]);

  const activeActions =
    pinnedEdge && layout ? layout.actionsByEdge[pinnedEdge] || [] : [];

  return (
    <div
      className="state-transition-panel relative w-full overflow-hidden rounded-lg border border-border bg-bg/40"
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    >
      {/* Hide ReactFlow's default edge-connection handles — they're not
          interactive here (nodesConnectable=false) so the visible dots are
          just visual noise. */}
      <style>{`
        .state-transition-panel .react-flow__handle {
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `}</style>
      {!layout ? (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted">
          <Loader2 className="mr-1.5 h-3 w-3 animate-spin text-accent" />
          Laying out state machine…
        </div>
      ) : (
        <ReactFlow
          nodes={layout.nodes}
          edges={decoratedEdges}
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
      )}

      {/* Hint overlay — disappears as soon as the user pins an edge. */}
      {layout && !pinnedEdge ? (
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
