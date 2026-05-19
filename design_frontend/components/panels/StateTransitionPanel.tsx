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
function stateKind(s: string): "terminal" | "success" | "danger" | "warning" | "default" {
  const l = s.toLowerCase();
  if (l === "init" || l === "deleted" || l === "void") return "terminal";
  if (l.includes("approved") || l.includes("active") || l.includes("done") || l.includes("ready")) return "success";
  if (l.includes("rejected") || l.includes("failed") || l.includes("error") || l.includes("cancel")) return "danger";
  if (l.includes("pending") || l.includes("await") || l.includes("review") || l.includes("draft")) return "warning";
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

export function StateTransitionPanel({ table, height = 340 }: StateTransitionPanelProps) {
  const { nodes, edges } = React.useMemo(() => {
    const allStates = new Set<string>(table.states ?? []);
    allStates.add("init");
    allStates.add("deleted");
    table.transitions.forEach((t) => {
      allStates.add(t.from_state);
      allStates.add(t.to_state);
    });
    const ordered = Array.from(allStates);

    // Layout: scale radius with state count so labels don't overlap.
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
        // We inline both background AND text colour so the global
        // .react-flow__node CSS can't leave the label invisible.
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

    // Detect cycles between A<->B so we can curve one direction differently
    // and avoid edge labels stacking on top of each other.
    const reverseExists = (from: string, to: string) =>
      table.transitions.some(
        (t) => t.from_state === to && t.to_state === from
      );

    const edges: Edge[] = table.transitions.map((t, i) => {
      const key = `${t.from_state}|${t.to_state}`;
      const labels = actionByPair[key] || [];
      const isSelfLoop = t.from_state === t.to_state;
      const hasReverse = reverseExists(t.from_state, t.to_state);
      return {
        id: `e${i}`,
        source: t.from_state,
        target: t.to_state,
        label: labels.join(" / ") || undefined,
        type: isSelfLoop ? "default" : hasReverse ? "default" : "smoothstep",
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "rgb(168 119 255)",
          width: 18,
          height: 18
        },
        style: {
          stroke: "rgb(168 119 255 / 0.85)",
          strokeWidth: 1.6
        },
        // !!! The crucial fix: label background was defaulting to white,
        // making white-ish text invisible. Force both bg and text colour.
        labelStyle: {
          fill: "rgb(232 234 240)",
          fontSize: 11,
          fontWeight: 500
        },
        labelBgStyle: {
          fill: "rgb(18 22 33)",
          fillOpacity: 0.92,
          stroke: "rgb(38 45 65)"
        },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 6
      };
    });

    return { nodes, edges };
  }, [table]);

  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border bg-bg/40"
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
      >
        <Background gap={16} color="rgb(38 45 65)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
