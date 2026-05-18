"use client";

import * as React from "react";
import type { ERDLayout } from "@/lib/types";

interface MiniMapProps {
  layout: ERDLayout;
  selectedTable?: string;
  focusedCluster?: string;
}

export function MiniMap({ layout, selectedTable, focusedCluster }: MiniMapProps) {
  const size = 160;
  const padding = 8;

  const { minX, maxX, minZ, maxZ } = React.useMemo(() => {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const t of layout.tables) {
      if (t.x < minX) minX = t.x;
      if (t.x > maxX) maxX = t.x;
      if (t.z < minZ) minZ = t.z;
      if (t.z > maxZ) maxZ = t.z;
    }
    if (!isFinite(minX)) {
      minX = -1; maxX = 1; minZ = -1; maxZ = 1;
    }
    return { minX, maxX, minZ, maxZ };
  }, [layout.tables]);

  const rangeX = Math.max(maxX - minX, 1);
  const rangeZ = Math.max(maxZ - minZ, 1);

  function toPx(x: number, z: number) {
    const px = padding + ((x - minX) / rangeX) * (size - padding * 2);
    const pz = padding + ((z - minZ) / rangeZ) * (size - padding * 2);
    return [px, pz];
  }

  return (
    <div
      className="rounded-lg border border-border bg-surface/80 p-2 backdrop-blur-sm shadow-glow"
      style={{ width: size + 16, height: size + 28 }}
    >
      <div className="mb-1 text-[10px] text-muted">Map</div>
      <svg width={size} height={size}>
        <rect
          x={0}
          y={0}
          width={size}
          height={size}
          rx={6}
          fill="rgb(11 13 20 / 0.6)"
        />
        {layout.tables.map((t) => {
          const [cx, cy] = toPx(t.x, t.z);
          const dimmed =
            focusedCluster &&
            t.cluster_id &&
            t.cluster_id !== focusedCluster;
          const isSelected = t.table_name === selectedTable;
          return (
            <circle
              key={t.table_name}
              cx={cx}
              cy={cy}
              r={isSelected ? 3 : 2}
              fill={
                isSelected
                  ? "rgb(168 119 255)"
                  : dimmed
                    ? "rgb(38 45 65)"
                    : "rgb(79 209 255 / 0.8)"
              }
            />
          );
        })}
      </svg>
    </div>
  );
}
