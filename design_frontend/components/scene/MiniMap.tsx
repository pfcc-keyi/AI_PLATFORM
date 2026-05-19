"use client";

import * as React from "react";
import { Map as MapIcon, X } from "lucide-react";
import type { ERDLayout } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MiniMapProps {
  layout: ERDLayout;
  selectedTable?: string;
  focusedCluster?: string;
  onPickTable?: (tableName: string) => void;
}

/**
 * Compact, collapsible top-down minimap.
 *
 * - Click a dot to focus that table in the 3D scene.
 * - Header (with chip-count + cluster filter readout) is always visible.
 * - Click the chevron / icon button to collapse to a single icon button.
 * - Persists collapsed state in localStorage.
 */
export function MiniMap({
  layout,
  selectedTable,
  focusedCluster,
  onPickTable
}: MiniMapProps) {
  const size = 132;
  const padding = 6;
  const [open, setOpen] = React.useState<boolean>(true);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem("minimap_open");
      if (stored !== null) setOpen(stored === "1");
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem("minimap_open", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

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

  function toPx(x: number, z: number) {
    const px = padding + ((x - minX) / rangeX) * (size - padding * 2);
    const pz = padding + ((z - minZ) / rangeZ) * (size - padding * 2);
    return [px, pz];
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "pointer-events-auto inline-flex h-9 w-9 items-center justify-center",
          "rounded-full border border-border bg-surface/85 text-muted",
          "backdrop-blur transition hover:bg-surfaceAlt hover:text-text"
        )}
        title="Show map"
      >
        <MapIcon className="h-4 w-4" />
      </button>
    );
  }

  const tableCount = layout.tables.length;

  return (
    <div
      className="pointer-events-auto rounded-xl border border-border bg-surface/85 p-2 backdrop-blur"
      style={{ width: size + 16 }}
    >
      <div className="mb-1 flex items-center justify-between gap-1 px-1">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted">
          <MapIcon className="h-3 w-3" />
          Map · {tableCount}
        </div>
        <button
          onClick={() => setOpen(false)}
          className="flex h-4 w-4 items-center justify-center rounded-full text-muted hover:bg-surfaceAlt hover:text-text"
          title="Hide map"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <svg
        width={size}
        height={size}
        className="block"
        style={{ touchAction: "none" }}
      >
        <rect
          x={0}
          y={0}
          width={size}
          height={size}
          rx={6}
          fill="rgb(11 13 20 / 0.65)"
          stroke="rgb(38 45 65)"
        />
        {layout.tables.map((t) => {
          const [cx, cy] = toPx(t.x, t.z);
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
              style={{ cursor: onPickTable ? "pointer" : "default", outline: "none" }}
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
              {/* Invisible large hit area so users (and automation) can
                  reliably click dots that would otherwise be 2-3 px wide. */}
              <circle
                cx={cx}
                cy={cy}
                r={8}
                fill="transparent"
                style={{ pointerEvents: "all" }}
              />
              {isSelected ? (
                <circle
                  cx={cx}
                  cy={cy}
                  r={5}
                  fill="rgb(168 119 255 / 0.25)"
                  stroke="rgb(168 119 255)"
                  strokeWidth={1}
                  style={{ pointerEvents: "none" }}
                />
              ) : null}
              <circle
                cx={cx}
                cy={cy}
                r={isSelected ? 2.8 : 2}
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
