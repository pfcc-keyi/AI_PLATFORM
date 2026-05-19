"use client";

import * as React from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Node,
  Position,
  MarkerType
} from "reactflow";
import "reactflow/dist/style.css";
import type { SchemaDesign } from "@/lib/types";

interface StateTransitionPanelProps {
  table: SchemaDesign;
  /** Optional explicit pixel height; otherwise fills its parent. */
  height?: number | string;
}

/** Loosely categorise a state into a colour bucket so the graph reads at a
 * glance. "init" / "deleted" are terminal pseudo-states; "approved" /
 * "active" feel like success; "rejected" / "void" feel like failure; anything
 * else is neutral accent. */
function stateKind(
  s: string
): "terminal" | "success" | "danger" | "warning" | "default" {
  const l = s.toLowerCase();
  if (l === "init" || l === "deleted" || l === "void") return "terminal";
  if (
    l.includes("approved") ||
    l.includes("active") ||
    l.includes("done") ||
    l.includes("ready")
  )
    return "success";
  if (
    l.includes("rejected") ||
    l.includes("failed") ||
    l.includes("error") ||
    l.includes("cancel")
  )
    return "danger";
  if (
    l.includes("pending") ||
    l.includes("await") ||
    l.includes("review") ||
    l.includes("draft")
  )
    return "warning";
  return "default";
}

const STATE_PALETTE: Record<
  ReturnType<typeof stateKind>,
  { bg: string; border: string; text: string }
> = {
  terminal: {
    bg: "rgb(25 30 45)",
    border: "rgb(148 156 178 / 0.45)",
    text: "rgb(232 234 240)"
  },
  success: {
    bg: "rgb(92 218 162 / 0.18)",
    border: "rgb(92 218 162 / 0.7)",
    text: "rgb(220 255 235)"
  },
  danger: {
    bg: "rgb(246 96 122 / 0.18)",
    border: "rgb(246 96 122 / 0.7)",
    text: "rgb(255 220 230)"
  },
  warning: {
    bg: "rgb(252 196 110 / 0.18)",
    border: "rgb(252 196 110 / 0.7)",
    text: "rgb(255 240 215)"
  },
  default: {
    bg: "rgb(168 119 255 / 0.18)",
    border: "rgb(168 119 255 / 0.6)",
    text: "rgb(232 234 240)"
  }
};

export function StateTransitionPanel({
  table,
  height = 340
}: StateTransitionPanelProps) {
  const [hoveredEdge, setHoveredEdge] = React.useState<string | null>(null);
  const [pinnedEdge, setPinnedEdge] = React.useState<string | null>(null);

  // Build a stable map: edge_id → list of action names. Doing this here
  // lets the JSX below stay declarative about hover state.
  const { nodes, baseEdges, actionsByEdge } = React.useMemo(() => {
    const allStates = new Set<string>(table.states ?? []);
    allStates.add("init");
    allStates.add("deleted");
    table.transitions.forEach((t) => {
      allStates.add(t.from_state);
      allStates.add(t.to_state);
    });
    const ordered = Array.from(allStates);

    const n = Math.max(1, ordered.length);
    const radius = 90 + n * 14;
    const cx = 200;
    const cy = 160;
    const nodes: Node[] = ordered.map((s, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      const kind = stateKind(s);
      const palette = STATE_PALETTE[kind];
      return {
        id: s,
        position: {
          x: cx + Math.cos(angle) * radius - 60,
          y: cy + Math.sin(angle) * radius - 18
        },
        data: { label: s },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          borderRadius: 999,
          padding: "6px 14px",
          background: palette.bg,
          borderColor: palette.border,
          color: palette.text,
          fontWeight: 500,
          fontSize: 12,
          letterSpacing: "0.02em"
        }
      };
    });

    const actionByPair: Record<string, string[]> = {};
    table.actions.forEach((a) => {
      if (!a.transition) return;
      const key = `${a.transition.from_state}|${a.transition.to_state}`;
      actionByPair[key] ||= [];
      actionByPair[key].push(a.name);
    });

    const baseEdges: Edge[] = table.transitions.map((t, i) => {
      const key = `${t.from_state}|${t.to_state}`;
      const edgeId = `e${i}`;
      return {
        id: edgeId,
        source: t.from_state,
        target: t.to_state,
        type: "smoothstep",
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "rgb(168 119 255)",
          width: 18,
          height: 18
        },
        style: {
          stroke: "rgb(168 119 255 / 0.75)",
          strokeWidth: 1.6
        }
      };
    });

    const actionsByEdge: Record<string, string[]> = {};
    baseEdges.forEach((e, i) => {
      const t = table.transitions[i];
      const k = `${t.from_state}|${t.to_state}`;
      actionsByEdge[e.id] = actionByPair[k] || [];
    });

    return { nodes, baseEdges, actionsByEdge };
  }, [table]);

  // Decorate base edges with hover/pinned state on each render. Only the
  // hovered or pinned edge shows its action labels — the rest stay clean,
  // which fixes the previous "long action names overlap with state pills"
  // problem.
  const edges: Edge[] = React.useMemo(() => {
    return baseEdges.map((e) => {
      const isActive = hoveredEdge === e.id || pinnedEdge === e.id;
      const actions = actionsByEdge[e.id] || [];
      const label = isActive && actions.length > 0 ? actions.join(" / ") : undefined;
      return {
        ...e,
        label,
        style: {
          ...e.style,
          stroke: isActive
            ? "rgb(168 119 255)"
            : "rgb(168 119 255 / 0.55)",
          strokeWidth: isActive ? 2.4 : 1.4
        },
        labelStyle: {
          fill: "rgb(232 234 240)",
          fontSize: 11,
          fontWeight: 500
        },
        labelBgStyle: {
          fill: "rgb(18 22 33)",
          fillOpacity: 0.96,
          stroke: "rgb(168 119 255 / 0.6)"
        },
        labelBgPadding: [8, 5] as [number, number],
        labelBgBorderRadius: 6
      };
    });
  }, [baseEdges, actionsByEdge, hoveredEdge, pinnedEdge]);

  const activeId = pinnedEdge || hoveredEdge;
  const activeActions = activeId ? actionsByEdge[activeId] || [] : [];

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-border bg-bg/40"
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnDrag
        onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdge(null)}
        onEdgeClick={(_, edge) =>
          setPinnedEdge((cur) => (cur === edge.id ? null : edge.id))
        }
        onPaneClick={() => setPinnedEdge(null)}
      >
        <Background gap={16} color="rgb(38 45 65)" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* Hint overlay — disappears as soon as the user starts interacting. */}
      {!hoveredEdge && !pinnedEdge ? (
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 rounded-md bg-surface/85 px-2 py-1 text-[10px] text-muted backdrop-blur-sm">
          Hover an arrow to see the action(s); click to pin.
        </div>
      ) : null}

      {/* Pinned/hovered actions readout — full text outside the diagram
          so long names can wrap without crowding the state pills. */}
      {activeActions.length > 0 ? (
        <div className="pointer-events-none absolute right-2 top-2 max-w-[60%] rounded-md border border-accent/40 bg-surface/95 px-2.5 py-1.5 text-[11px] shadow-glow backdrop-blur">
          <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
            {pinnedEdge ? "Pinned action(s)" : "Action(s)"}
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
