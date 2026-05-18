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
}

export function StateTransitionPanel({ table }: StateTransitionPanelProps) {
  const { nodes, edges } = React.useMemo(() => {
    const allStates = new Set<string>(table.states ?? []);
    allStates.add("init");
    allStates.add("deleted");
    table.transitions.forEach((t) => {
      allStates.add(t.from_state);
      allStates.add(t.to_state);
    });
    const ordered = Array.from(allStates);

    const radius = 130;
    const cx = 200;
    const cy = 140;
    const nodes: Node[] = ordered.map((s, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, ordered.length);
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
          background:
            s === "init" || s === "deleted"
              ? "rgb(25 30 45)"
              : "rgb(168 119 255 / 0.18)",
          borderColor:
            s === "init" || s === "deleted"
              ? "rgb(38 45 65)"
              : "rgb(168 119 255 / 0.6)"
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

    const edges: Edge[] = table.transitions.map((t, i) => {
      const key = `${t.from_state}|${t.to_state}`;
      const labels = actionByPair[key] || [];
      return {
        id: `e${i}`,
        source: t.from_state,
        target: t.to_state,
        label: labels.join(" / "),
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "rgb(168 119 255 / 0.9)" },
        labelStyle: { fill: "rgb(232 234 240)", fontSize: 10 }
      };
    });

    return { nodes, edges };
  }, [table]);

  return (
    <div className="h-[360px] w-full rounded-lg border border-border bg-bg/40">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} color="rgb(38 45 65)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
