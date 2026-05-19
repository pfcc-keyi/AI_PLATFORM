"use client";

import * as React from "react";
import { Map as MapIcon, Minimize2, Maximize2 } from "lucide-react";
import type { ERDLayout } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MiniMapProps {
  layout: ERDLayout;
  selectedTable?: string;
  focusedCluster?: string;
  onPickTable?: (tableName: string) => void;
}

/**
 * Top-down minimap that lives in the bottom of the left rail and stretches
 * to the rail's width. Uses an SVG viewBox so the dots scale cleanly
 * regardless of container width.
 *
 * - Click a dot to focus that table in the 3D scene.
 * - Toggle the maximize/minimize button to expand vertically.
 * - Persists open + height preset to localStorage.
 */
export function MiniMap({
  layout,
  selectedTable,
  focusedCluster,
  onPickTable
}: MiniMapProps) {
  const padding = 12;
  const VB_W = 200;
  // VB_H is computed from data range below so the dots aren't squashed.

  const [open, setOpen] = React.useState<boolean>(true);
  const [tall, setTall] = React.useState<boolean>(false);

  React.useEffect(() => {
    try {
      const o = window.localStorage.getItem("minimap_open");
      if (o !== null) setOpen(o === "1");
      const t = window.localStorage.getItem("minimap_tall");
      if (t !== null) setTall(t === "1");
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem("minimap_open", open ? "1" : "0");
      window.localStorage.setItem("minimap_tall", tall ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open, tall]);

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
      minX = -1;
      maxX = 1;
      minZ = -1;
      maxZ = 1;
    }
    return { minX, maxX, minZ, maxZ };
  }, [layout.tables]);

  const rangeX = Math.max(maxX - minX, 1);
  const rangeZ = Math.max(maxZ - minZ, 1);

  // Make viewBox aspect match the actual data range so dots aren't squashed
  // when the rail is wider than tall (the common case). Clamp the height so
  // the minimap can't dominate the rail.
  const dataAspect = rangeX / rangeZ;
  const compactAspect = Math.min(Math.max(dataAspect, 1.2), 2.2);
  const tallAspect = Math.min(Math.max(dataAspect, 0.9), 1.4);
  const aspect = tall ? tallAspect : compactAspect;
  const VB_H = Math.round(VB_W / aspect);

  function toVB(x: number, z: number) {
    const px = padding + ((x - minX) / rangeX) * (VB_W - padding * 2);
    const pz = padding + ((z - minZ) / rangeZ) * (VB_H - padding * 2);
    return [px, pz];
  }

  const tableCount = layout.tables.length;

  // Collapsed: render a thin inline button that still fits the rail width.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "pointer-events-auto flex w-full items-center justify-center gap-1.5",
          "rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[11px] text-muted",
          "hover:bg-surfaceAlt hover:text-text"
        )}
        title="Show map"
      >
        <MapIcon className="h-3 w-3" />
        Show map · {tableCount}
      </button>
    );
  }

  return (
    <div className="pointer-events-auto flex w-full flex-col gap-1 rounded-md border border-border/60 bg-bg/30 p-2">
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted">
          <MapIcon className="h-3 w-3 text-accent" />
          Map · {tableCount} tables
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setTall((t) => !t)}
            className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-surfaceAlt hover:text-text"
            title={tall ? "Shrink map" : "Enlarge map"}
          >
            {tall ? (
              <Minimize2 className="h-3 w-3" />
            ) : (
              <Maximize2 className="h-3 w-3" />
            )}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-surfaceAlt hover:text-text"
            title="Hide map"
          >
            <span className="text-[14px] leading-none">×</span>
          </button>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="block rounded"
        style={{ touchAction: "none", background: "rgb(11 13 20 / 0.6)" }}
      >
        {layout.tables.map((t) => {
          const [cx, cy] = toVB(t.x, t.z);
          const dimmed =
            focusedCluster &&
            t.cluster_id &&
            t.cluster_id !== focusedCluster;
          const isSelected = t.table_name === selectedTable;
          return (
            <g
              key={t.table_name}
              role="button"
              aria-label={`Focus camera on ${t.table_name}`}
              tabIndex={0}
              style={{
                cursor: onPickTable ? "pointer" : "default",
                outline: "none"
              }}
              onClick={() => onPickTable?.(t.table_name)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPickTable?.(t.table_name);
                }
              }}
              data-table={t.table_name}
              data-testid={`map-dot-${t.table_name}`}
            >
              {/* Invisible large hit area in viewBox units */}
              <circle
                cx={cx}
                cy={cy}
                r={9}
                fill="transparent"
                style={{ pointerEvents: "all" }}
              />
              {isSelected ? (
                <circle
                  cx={cx}
                  cy={cy}
                  r={6}
                  fill="rgb(168 119 255 / 0.25)"
                  stroke="rgb(168 119 255)"
                  strokeWidth={1.5}
                  style={{ pointerEvents: "none" }}
                />
              ) : null}
              <circle
                cx={cx}
                cy={cy}
                r={isSelected ? 3.5 : 2.6}
                fill={
                  isSelected
                    ? "rgb(168 119 255)"
                    : dimmed
                      ? "rgb(38 45 65)"
                      : "rgb(79 209 255 / 0.85)"
                }
                style={{ pointerEvents: "none" }}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
